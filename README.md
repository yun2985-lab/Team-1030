# Team 1030 — 롤 티어 트래커

솔로랭크/자유랭크 티어·LP·승률과 최근 30일 솔랭·자랭·칼바람 판수를 매일 자동으로
수집해서, GitHub Pages 사이트에서 확인할 수 있게 해주는 프로젝트입니다.

## 동작 방식

```
GitHub Actions (매일 09:00 KST)
   └─ fetch_data.py 실행 → Riot API 조회
        └─ data/players.json 갱신 & 자동 커밋
             └─ GitHub Pages가 최신 파일을 그대로 서빙
```

서버가 따로 필요 없고, 전부 무료(GitHub Actions + Pages 무료 티어)로 동작합니다.

## 설정 방법 (최초 1회)

### 1. Riot API Key 발급

1. https://developer.riotgames.com 접속 → Riot 계정으로 로그인
2. 우선 **개발자 키(24시간 유효)** 로 테스트 가능. 매일 자동 갱신하려면
   대시보드에서 **Personal API Key**를 신청하세요 (프로젝트 설명 몇 줄 작성, 보통 빠르게 승인됩니다).

### 2. GitHub 저장소 생성 & 파일 업로드

1. GitHub에서 새 저장소 생성 (예: `team1030`)
2. 이 폴더의 파일 전체를 저장소에 push

```bash
cd team1030
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/<본인계정>/team1030.git
git push -u origin main
```

### 3. Riot API Key를 GitHub Secret으로 등록

저장소 → **Settings → Secrets and variables → Actions → New repository secret**

- Name: `RIOT_API_KEY`
- Value: 발급받은 키 값

### 4. GitHub Pages 활성화

저장소 → **Settings → Pages** → Source를 `main` 브랜치 `/ (root)`로 설정 후 저장.
잠시 후 `https://<본인계정>.github.io/team1030/` 로 접속하면 사이트가 보입니다.

### 5. 첫 데이터 수집 실행

기다리지 않고 바로 확인하고 싶다면:
저장소 → **Actions 탭 → Update Team 1030 Tier Data → Run workflow** 버튼으로 수동 실행.

이후에는 매일 한국시간 오전 9시(UTC 0시)에 자동으로 실행됩니다.

## 로컬에서 미리 테스트하기

```bash
export RIOT_API_KEY="발급받은_키"
python3 fetch_data.py
# data/players.json이 갱신됨

# 간단히 로컬에서 사이트 미리보기
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

## 계정 추가/변경

`fetch_data.py` 상단의 `PLAYERS` 리스트를 수정하면 됩니다.

```python
PLAYERS = [
    {"label": "표시이름", "game_name": "게임이름", "tag_line": "태그"},
    ...
]
```

## 참고 사항

- "최근 30일" 판수·승률은 League-V4의 시즌 누적치가 아니라 **Match-V5 API로 직접
  최근 30일 매치를 세어서** 계산합니다 (칼바람은 이 방법이 유일).
- 매치 결과는 `data/match_cache.json`에 캐시되어, 다음날 실행 시 이미 처리한
  매치는 다시 조회하지 않습니다 (API 호출량 절약).
- 티어 히스토리는 35일치만 보관하며, 그래프에는 최근 30일 추세가 표시됩니다.
- 이 프로젝트는 Riot Games의 공식 상품이 아니며, Riot Games의 승인/보증을 받지
  않았습니다.
