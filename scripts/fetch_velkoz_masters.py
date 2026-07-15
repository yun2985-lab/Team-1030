#!/usr/bin/env python3
"""
scripts/fetch_velkoz_masters.py
KR 서버 벨코즈 장인 랭킹을 OP.GG에서 가져와 data/velkoz_masters.json 에 저장합니다.
하루 1회(GitHub Actions)로만 실행하세요.
"""

import json
import os
import re
import time
import urllib.request
import urllib.error

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9",
}

LEADERBOARD_URL = "https://op.gg/lol/leaderboards/champions/velkoz?region=kr"

OUTPUT_PATH = os.path.join("data", "velkoz_masters.json")
RAW_DEBUG_PATH = os.path.join("data", "velkoz_masters_debug.html")


def fetch_html(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.read().decode("utf-8", errors="ignore")


def parse_leaderboard(html):
    """장인 랭킹 페이지에서 소환사 목록 추출.
    OP.GG 소환사 프로필 링크 패턴: /lol/summoners/kr/이름-태그
    """
    players = []
    pattern = re.compile(
        r'href="/lol/summoners/kr/([^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{1,30})',
        re.IGNORECASE,
    )
    seen = set()
    for slug, name in pattern.findall(html):
        slug = slug.strip()
        name = name.strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        players.append({
            "slug": slug,
            "riot_id": slug.replace("-", "#", 1),
            "name": name or slug,
        })
        if len(players) >= 50:
            break
    return players


def main():
    result = {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+09:00", time.localtime()),
        "masters": [],
    }

    try:
        html = fetch_html(LEADERBOARD_URL)
        result["masters"] = parse_leaderboard(html)
        if not result["masters"]:
            os.makedirs("data", exist_ok=True)
            with open(RAW_DEBUG_PATH, "w", encoding="utf-8") as f:
                f.write(html)
            print("[경고] 장인 목록이 비어있음 -> data/velkoz_masters_debug.html 확인 필요")
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        print(f"[경고] 장인 랭킹 페이지 요청 실패: {e}")

    os.makedirs("data", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"저장 완료: {OUTPUT_PATH}")
    print(f"장인 {len(result['masters'])}명")


if __name__ == "__main__":
    main()
