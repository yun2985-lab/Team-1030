"""
Team 1030 - League of Legends 티어 트래커
매일 실행되어 5개 계정의 솔로랭크/자유랭크 티어·LP와
최근 30일간 솔랭/자랭/칼바람 판수·승률을 수집해 data/players.json에 저장한다.
"""

import os
import json
import time
import datetime
import urllib.request
import urllib.error
import urllib.parse

TEAM_NAME = "Team 1030"

PLAYERS = [
    {"label": "최강롯디자잉", "game_name": "최강롯디자잉", "tag_line": "1030"},
    {"label": "심해최강벨코즈", "game_name": "심해최강벨코즈", "tag_line": "ybak"},
    {"label": "부릉부릉배부릉", "game_name": "부릉부릉배부릉", "tag_line": "kr1"},
    {"label": "전지훈", "game_name": "전지훈", "tag_line": "kr1"},
    {"label": "장의사", "game_name": "장의사", "tag_line": "kr1"},
]

PLATFORM_ROUTE = "kr"
REGIONAL_ROUTE = "asia"

RIOT_API_KEY = os.environ.get("RIOT_API_KEY", "").strip()

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PLAYERS_JSON = os.path.join(DATA_DIR, "players.json")
MATCH_CACHE_JSON = os.path.join(DATA_DIR, "match_cache.json")

HISTORY_KEEP_DAYS = 35
RECENT_WINDOW_DAYS = 30

QUEUE_IDS = {
    "solo": 420,
    "flex": 440,
    "aram": 450,
}


def _request(url, max_retries=5):
    req = urllib.request.Request(url, headers={
        "X-Riot-Token": RIOT_API_KEY,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    })
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", "2"))
                print(f"  [429] rate limited, {retry_after}s 대기...")
                time.sleep(retry_after + 1)
                continue
            if e.code == 404:
                return None
            if e.code in (500, 502, 503, 504):
                print(f"  [{e.code}] 서버 오류, 재시도 {attempt+1}/{max_retries}")
                time.sleep(2 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError as e:
            print(f"  네트워크 오류: {e}, 재시도 {attempt+1}/{max_retries}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"요청 실패(재시도 초과): {url}")


def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def get_puuid(game_name, tag_line):
    url = (f"https://{REGIONAL_ROUTE}.api.riotgames.com/riot/account/v1/"
           f"accounts/by-riot-id/{urllib.parse.quote(game_name)}/{urllib.parse.quote(tag_line)}")
    data = _request(url)
    return data["puuid"] if data else None


def get_league_entries(puuid):
    url = f"https://{PLATFORM_ROUTE}.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}"
    data = _request(url)
    return data or []


def get_match_ids(puuid, queue_id, start_time_epoch):
    ids = []
    start = 0
    count = 100
    while True:
        url = (f"https://{REGIONAL_ROUTE}.api.riotgames.com/lol/match/v5/matches/"
               f"by-puuid/{puuid}/ids?queue={queue_id}&startTime={start_time_epoch}"
               f"&start={start}&count={count}")
        batch = _request(url) or []
        ids.extend(batch)
        if len(batch) < count:
            break
        start += count
        time.sleep(0.05)
    return ids


def get_match_result(match_id, puuid, cache):
    """match_cache에 없으면 API 조회 후 캐시에 저장.
    {"win": bool, "game_end": int, "participants": [...]} 반환.
    캐시에 teamId/teamPosition이 없는 예전 형식이면(라인전 상대 기능 추가 이전 캐시)
    다시 조회한다."""
    cached = cache.get(match_id)
    if cached and "participants" in cached and cached["participants"]:
        if "teamId" in cached["participants"][0]:
            return cached

    url = f"https://{REGIONAL_ROUTE}.api.riotgames.com/lol/match/v5/matches/{match_id}"
    data = _request(url)
    if not data:
        return None

    win = None
    participants = []
    for p in data["info"]["participants"]:
        participants.append({
            "puuid": p["puuid"],
            "championName": p.get("championName", "?"),
            "kills": p.get("kills", 0),
            "deaths": p.get("deaths", 0),
            "assists": p.get("assists", 0),
            "damage": p.get("totalDamageDealtToChampions", 0),
            "gold": p.get("goldEarned", 0),
            "vision": p.get("visionScore", 0),
            "win": p.get("win", False),
            "teamId": p.get("teamId"),
            "teamPosition": p.get("teamPosition", ""),
            "individualPosition": p.get("individualPosition", ""),
        })
        if p["puuid"] == puuid:
            win = p["win"]

    result = {
        "win": win,
        "game_end": data["info"].get("gameEndTimestamp"),
        "participants": participants,
    }
    cache[match_id] = result
    return result


def performance_rank(participants, puuid):
    """같은 팀(5명) 안에서 활약도 점수로 정렬해 puuid의 순위를 계산.
    op.gg 등 커뮤니티 스탯 사이트에서 흔히 쓰는 방식(킬관여/딜량/골드/시야)을
    참고한 자체 근사치이며, 공식 순위 지표는 아니다."""
    def score(p):
        return (
            (p["kills"] + p["assists"]) * 2
            - p["deaths"]
            + p["damage"] / 1000
            + p["gold"] / 1000
            + p["vision"] * 0.5
            + (2 if p["win"] else 0)
        )

    me = next((p for p in participants if p["puuid"] == puuid), None)
    if not me:
        return None
    teammates = [p for p in participants if p.get("teamId") == me.get("teamId")]

    ranked = sorted(teammates, key=score, reverse=True)
    for i, p in enumerate(ranked):
        if p["puuid"] == puuid:
            return {"rank": i + 1, "total": len(ranked)}
    return None


def find_lane_opponent(participants, me):
    """me와 같은 포지션(teamPosition)인데 다른 팀인 참가자를 찾는다.
    포지션 정보가 없는 경기(아주 오래된 경기 등)는 None을 반환한다."""
    my_pos = me.get("teamPosition") or me.get("individualPosition")
    if not my_pos:
        return None
    for p in participants:
        if p["puuid"] == me["puuid"]:
            continue
        if p.get("teamId") == me.get("teamId"):
            continue
        opp_pos = p.get("teamPosition") or p.get("individualPosition")
        if opp_pos == my_pos:
            return p
    return None


def tier_rank_lp(entries, queue_type):
    for e in entries:
        if e["queueType"] == queue_type:
            return {
                "tier": e["tier"],
                "rank": e["rank"],
                "lp": e["leaguePoints"],
                "wins": e["wins"],
                "losses": e["losses"],
            }
    return {"tier": "UNRANKED", "rank": "", "lp": 0, "wins": 0, "losses": 0}


def main():
    if not RIOT_API_KEY:
        raise SystemExit("환경변수 RIOT_API_KEY가 설정되어 있지 않습니다.")

    today = datetime.datetime.utcnow().date().isoformat()
    now_epoch = int(time.time())
    recent_start_epoch = now_epoch - RECENT_WINDOW_DAYS * 86400

    players_store = load_json(PLAYERS_JSON, {
        "team_name": TEAM_NAME,
        "updated_at": None,
        "players": [],
    })
    existing = {p["label"]: p for p in players_store.get("players", [])}

    match_cache = load_json(MATCH_CACHE_JSON, {})

    new_players = []

    for cfg in PLAYERS:
        label = cfg["label"]
        print(f"[{label}] 조회 시작...")

        record = existing.get(label, {
            "label": label,
            "riot_id": f"{cfg['game_name']}#{cfg['tag_line']}",
            "puuid": None,
            "history": [],
        })

        puuid = record.get("puuid") or get_puuid(cfg["game_name"], cfg["tag_line"])
        if not puuid:
            print(f"  ! {label} 계정을 찾을 수 없습니다. 건너뜀.")
            new_players.append(record)
            continue
        record["puuid"] = puuid

        entries = get_league_entries(puuid)
        solo = tier_rank_lp(entries, "RANKED_SOLO_5x5")
        flex = tier_rank_lp(entries, "RANKED_FLEX_SR")

        recent_counts = {}
        solo_streak = {"type": "none", "count": 0}
        solo_last_game_days_ago = None
        recent_flex_games = []
        recent_solo_games = []

        for key, qid in QUEUE_IDS.items():
            match_ids = get_match_ids(puuid, qid, recent_start_epoch)
            wins = 0
            losses = 0
            results_with_time = []
            for mid in match_ids:
                result = get_match_result(mid, puuid, match_cache)
                if result is None or result["win"] is None:
                    continue
                if result["win"]:
                    wins += 1
                else:
                    losses += 1
                if result.get("game_end"):
                    results_with_time.append(result)
                time.sleep(0.05)
            games = wins + losses
            recent_counts[key] = {
                "games": games,
                "wins": wins,
                "losses": losses,
                "winrate": round(wins / games * 100, 1) if games else 0.0,
            }
            print(f"  {key}: {games}판 ({wins}승 {losses}패)")

            if key == "solo" and results_with_time:
                results_with_time.sort(key=lambda r: r["game_end"], reverse=True)
                most_recent = results_with_time[0]
                solo_last_game_days_ago = int(
                    (now_epoch * 1000 - most_recent["game_end"]) / 86400000
                )
                streak_type = "win" if most_recent["win"] else "loss"
                streak_count = 0
                for r in results_with_time:
                    if r["win"] == most_recent["win"]:
                        streak_count += 1
                    else:
                        break
                solo_streak = {"type": streak_type, "count": streak_count}

                # 최근 솔랭 3게임: 라인전 상대(같은 포지션, 상대 팀)와 KDA 비교
                for r in results_with_time[:3]:
                    me = next((p for p in r["participants"] if p["puuid"] == puuid), None)
                    if not me:
                        continue
                    opp = find_lane_opponent(r["participants"], me)
                    laner_verdict = None
                    if opp:
                        my_score = me["kills"] - me["deaths"]
                        opp_score = opp["kills"] - opp["deaths"]
                        if my_score > opp_score:
                            laner_verdict = "win"
                        elif my_score < opp_score:
                            laner_verdict = "loss"
                        else:
                            laner_verdict = "even"
                    recent_solo_games.append({
                        "date": datetime.datetime.utcfromtimestamp(
                            r["game_end"] / 1000
                        ).date().isoformat(),
                        "champion": me["championName"],
                        "win": me["win"],
                        "kills": me["kills"],
                        "deaths": me["deaths"],
                        "assists": me["assists"],
                        "position": me.get("teamPosition") or me.get("individualPosition") or "",
                        "opponent_champion": opp["championName"] if opp else None,
                        "opponent_kills": opp["kills"] if opp else None,
                        "opponent_deaths": opp["deaths"] if opp else None,
                        "opponent_assists": opp["assists"] if opp else None,
                        "laner_verdict": laner_verdict,
                    })

            if key == "flex" and results_with_time:
                results_with_time.sort(key=lambda r: r["game_end"], reverse=True)
                for r in results_with_time[:3]:
                    me = next((p for p in r["participants"] if p["puuid"] == puuid), None)
                    if not me:
                        continue
                    rank_info = performance_rank(r["participants"], puuid)
                    recent_flex_games.append({
                        "date": datetime.datetime.utcfromtimestamp(
                            r["game_end"] / 1000
                        ).date().isoformat(),
                        "champion": me["championName"],
                        "win": me["win"],
                        "kills": me["kills"],
                        "deaths": me["deaths"],
                        "assists": me["assists"],
                        "rank": rank_info["rank"] if rank_info else None,
                        "total": rank_info["total"] if rank_info else None,
                    })

        history = [h for h in record.get("history", []) if h["date"] != today]
        history.append({
            "date": today,
            "solo_tier": solo["tier"], "solo_rank": solo["rank"], "solo_lp": solo["lp"],
            "flex_tier": flex["tier"], "flex_rank": flex["rank"], "flex_lp": flex["lp"],
        })
        cutoff = (datetime.datetime.utcnow().date() -
                  datetime.timedelta(days=HISTORY_KEEP_DAYS)).isoformat()
        history = [h for h in history if h["date"] >= cutoff]
        history.sort(key=lambda h: h["date"])

        record.update({
            "solo": solo,
            "flex": flex,
            "recent_30d": recent_counts,
            "solo_streak": solo_streak,
            "solo_last_game_days_ago": solo_last_game_days_ago,
            "recent_flex_games": recent_flex_games,
            "recent_solo_games": recent_solo_games,
            "history": history,
        })
        new_players.append(record)

        save_json(MATCH_CACHE_JSON, match_cache)

    players_store["players"] = new_players
    players_store["updated_at"] = datetime.datetime.utcnow().isoformat() + "Z"
    save_json(PLAYERS_JSON, players_store)

    cutoff_epoch_ms = (now_epoch - (RECENT_WINDOW_DAYS + 5) * 86400) * 1000
    match_cache = {
        mid: v for mid, v in match_cache.items()
        if v.get("game_end") is None or v["game_end"] >= cutoff_epoch_ms
    }
    save_json(MATCH_CACHE_JSON, match_cache)

    print("완료:", PLAYERS_JSON)


if __name__ == "__main__":
    main()
