"""
Team 1030 - League of Legends 티어 트래커
매일 실행되어 5개 계정의 솔로랭크/자유랭크 티어·LP와
최근 30일간 솔랭/자랭/칼바람 판수·승률을 수집해 data/players.json에 저장한다.

필요 환경변수:
  RIOT_API_KEY   Riot Developer / Personal API Key

실행:
  python fetch_data.py
"""

import os
import json
import time
import datetime
import urllib.request
import urllib.error
import urllib.parse

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

TEAM_NAME = "Team 1030"

# (표시 이름, gameName, tagLine)
PLAYERS = [
    {"label": "최강롯디자잉", "game_name": "최강롯디자잉", "tag_line": "1030"},
    {"label": "심해최강벨코즈", "game_name": "심해최강벨코즈", "tag_line": "ybak"},
    {"label": "부릉부릉배부릉", "game_name": "부릉부릉배부릉", "tag_line": "kr1"},
    {"label": "전지훈", "game_name": "전지훈", "tag_line": "kr1"},
    {"label": "장의사", "game_name": "장의사", "tag_line": "kr1"},
]

# 라우팅 (한국 서버 기준)
PLATFORM_ROUTE = "kr"      # summoner-v4, league-v4
REGIONAL_ROUTE = "asia"    # account-v1, match-v5

RIOT_API_KEY = os.environ.get("RIOT_API_KEY", "").strip()

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PLAYERS_JSON = os.path.join(DATA_DIR, "players.json")
MATCH_CACHE_JSON = os.path.join(DATA_DIR, "match_cache.json")

HISTORY_KEEP_DAYS = 35          # 티어 히스토리 보관 일수
RECENT_WINDOW_DAYS = 30         # "최근 한달" 판수/승률 집계 기준 일수

QUEUE_IDS = {
    "solo": 420,
    "flex": 440,
    "aram": 450,
}

TIER_ORDER = [
    "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM",
    "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER",
]


# ---------------------------------------------------------------------------
# 공용 유틸
# ---------------------------------------------------------------------------

def _request(url, max_retries=5):
    """Riot API 호출 (rate limit 429 및 일시적 오류에 대한 재시도 포함)."""
    req = urllib.request.Request(url, headers={
        "X-Riot-Token": RIOT_API_KEY,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    })
    for attempt in range(max_retries):

def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Riot API 호출 함수
# ---------------------------------------------------------------------------

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
    """queue_id 큐의 start_time_epoch 이후 매치 ID 목록 (최대 100개씩 페이지네이션)."""
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
    """match_cache에 없으면 API 조회 후 캐시에 저장. {"win": bool} 반환."""
    if match_id in cache:
        return cache[match_id]

    url = f"https://{REGIONAL_ROUTE}.api.riotgames.com/lol/match/v5/matches/{match_id}"
    data = _request(url)
    if not data:
        return None

    win = None
    for p in data["info"]["participants"]:
        if p["puuid"] == puuid:
            win = p["win"]
            break

    result = {"win": win, "game_end": data["info"].get("gameEndTimestamp")}
    cache[match_id] = result
    return result


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


# ---------------------------------------------------------------------------
# 메인 로직
# ---------------------------------------------------------------------------

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
    # label -> 기존 player 레코드 매핑
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

        # 최근 30일 판수 집계 (솔랭/자랭/칼바람)
        recent_counts = {}
        for key, qid in QUEUE_IDS.items():
            match_ids = get_match_ids(puuid, qid, recent_start_epoch)
            wins = 0
            losses = 0
            for mid in match_ids:
                result = get_match_result(mid, puuid, match_cache)
                if result is None or result["win"] is None:
                    continue
                if result["win"]:
                    wins += 1
                else:
                    losses += 1
                time.sleep(0.05)
            games = wins + losses
            recent_counts[key] = {
                "games": games,
                "wins": wins,
                "losses": losses,
                "winrate": round(wins / games * 100, 1) if games else 0.0,
            }
            print(f"  {key}: {games}판 ({wins}승 {losses}패)")

        # 오늘자 히스토리 스냅샷 추가 (같은 날짜면 갱신)
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
            "history": history,
        })
        new_players.append(record)

        # 캐시를 매 플레이어마다 저장해 중간에 실패해도 진행 유지
        save_json(MATCH_CACHE_JSON, match_cache)

    players_store["players"] = new_players
    players_store["updated_at"] = datetime.datetime.utcnow().isoformat() + "Z"
    save_json(PLAYERS_JSON, players_store)

    # 매치 캐시 정리: RECENT_WINDOW_DAYS보다 오래된 매치는 캐시에서 제거해 파일 크기 관리
    cutoff_epoch_ms = (now_epoch - (RECENT_WINDOW_DAYS + 5) * 86400) * 1000
    match_cache = {
        mid: v for mid, v in match_cache.items()
        if v.get("game_end") is None or v["game_end"] >= cutoff_epoch_ms
    }
    save_json(MATCH_CACHE_JSON, match_cache)

    print("완료:", PLAYERS_JSON)


if __name__ == "__main__":
    main()
