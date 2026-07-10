const PLAYER_COLORS = ["#c8a44d", "#5b8fd9", "#4caf82", "#d1495b", "#9a5fd0"];
const PLAYER_POINT_STYLES = ["circle", "rectRot", "triangle", "rect", "star"];

let teamChartInstance = null;
let teamChartZoomed = false;

const TIER_ORDER = [
  "UNRANKED", "IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM",
  "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER",
];
const RANK_ORDER = { "IV": 0, "III": 1, "II": 2, "I": 3, "": 4 };

const TIER_LABEL_KR = {
  UNRANKED: "심해", IRON: "아이언", BRONZE: "브론즈", SILVER: "실버",
  GOLD: "골드", PLATINUM: "플래티넘", EMERALD: "에메랄드", DIAMOND: "다이아",
  MASTER: "마스터", GRANDMASTER: "그랜드마스터", CHALLENGER: "챌린저",
};

// 실제 롤 티어 뱃지 색상에 가깝게 맞춘 색상표 (정확한 라이엇 헥스값은 아니고 근사치)
const TIER_COLORS = {
  UNRANKED: "#8a8f9c", IRON: "#5b5a56", BRONZE: "#8c5a34", SILVER: "#9fa8b5",
  GOLD: "#e8b339", PLATINUM: "#3fa992", EMERALD: "#0fae67", DIAMOND: "#5d7ce0",
  MASTER: "#b153e0", GRANDMASTER: "#e0483f", CHALLENGER: "#61e2f0",
};

// 랭크 로마숫자를 화면 표기용 아라비아 숫자로 변환 (예: "III" -> 3)
const RANK_TO_NUM = { "IV": 4, "III": 3, "II": 2, "I": 1 };

function tierScore(tier, rank, lp) {
  const t = TIER_ORDER.indexOf(tier) * 1000;
  const r = (RANK_ORDER[rank] ?? 0) * 100;
  // lp를 2로만 나눠서, 같은 티어/랭크 내에서도 LP 차이가 그래프에 좀 더 드러나게 함
  // (랭크 간격이 100이라 lp 기여분은 항상 50 미만으로 유지해야 순서가 안 꼬임)
  return t + r + (lp || 0) / 2;
}

// tierScore로 만든 숫자값을 y축에 표시할 "골드 4" 같은 라벨로 되돌리는 함수
function scoreToTierLabel(value) {
  const idx = Math.floor(value / 1000);
  const tier = TIER_ORDER[idx];
  if (!tier) return "";
  const remainder = Math.round(value - idx * 1000);
  const rankKeys = ["IV", "III", "II", "I", ""];
  const rankIdx = Math.min(Math.max(Math.round(remainder / 100), 0), rankKeys.length - 1);
  const rankStr = rankKeys[rankIdx];
  const label = TIER_LABEL_KR[tier] || tier;
  const noRankTiers = ["UNRANKED", "MASTER", "GRANDMASTER", "CHALLENGER"];
  if (noRankTiers.includes(tier)) {
    // 랭크 구분이 없는 티어는 경계값(0, 100, 200...)에서만 라벨을 보여줌
    return remainder === 0 ? label : "";
  }
  const num = RANK_TO_NUM[rankStr];
  return num ? `${label} ${num}` : label;
}

// 같은 값을 실제 롤 티어 색상으로 변환
function scoreToTierColor(value) {
  const idx = Math.floor(value / 1000);
  const tier = TIER_ORDER[idx];
  return TIER_COLORS[tier] || "#7d8aa8";
}

function tierBadgeText(tier, rank, lp) {
  if (!tier || tier === "UNRANKED") return "심해";
  const kr = TIER_LABEL_KR[tier] || tier;
  const rankPart = rank && !["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier) ? ` ${rank}` : "";
  return `${kr}${rankPart} ${lp}LP`;
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function queueRowHTML(label, q) {
  const winrate = q.games ? q.winrate : 0;
  return `
    <div class="queue-row">
      <div class="queue-label">${label}</div>
      <div class="stat-fill">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span class="tier-badge" style="--tier-color: var(--tier-${(q.tier || 'unranked').toLowerCase()})">
            ${tierBadgeText(q.tier, q.rank, q.lp)}
          </span>
          <span class="lp-text">${q.games || 0}판 · ${winrate}%</span>
        </div>
        <div class="winrate-bar"><div class="winrate-bar-fill" style="width:${winrate}%"></div></div>
        <div class="stat-meta"><span>${q.wins || 0}승 ${q.losses || 0}패 (최근 30일)</span></div>
      </div>
    </div>`;
}

function playerComment(player) {
  const inactiveDays = player.solo_last_game_days_ago;
  const streak = player.solo_streak || { type: "none", count: 0 };

  if (inactiveDays === null || inactiveDays === undefined || inactiveDays >= 5) {
    return { text: "연습이 필요합니다. 팀을 위해 연습량을 채워주세요", cls: "inactive" };
  }
  if (streak.type === "loss" && streak.count >= 3) {
    return { text: "진정하세요. 휴식이 필요합니다", cls: "cold" };
  }
  if (streak.type === "win" && streak.count >= 3) {
    return { text: "좋은 퍼포먼스를 보이고 있어요!", cls: "hot" };
  }
  return null;
}

function rankBadgeClass(rank, total) {
  if (!rank || !total) return "";
  if (rank === 1) return "mvp";
  if (rank === total) return "worst";
  return "";
}

const LANE_VERDICT_LABEL = { win: "우위", loss: "열세", even: "비슷" };

function recentSoloGamesHTML(games) {
  if (!games || !games.length) return "";
  const items = games.map(g => {
    const resultCls = g.win ? "win-text" : "loss-text";
    const hasOpponent = g.opponent_champion != null;
    const verdictCls = g.laner_verdict === "win" ? "mvp" : g.laner_verdict === "loss" ? "worst" : "";
    const verdictLabel = LANE_VERDICT_LABEL[g.laner_verdict] || "";
    const laneHTML = hasOpponent
      ? `
        <div class="lane-compare">
          <span class="lane-me">${g.champion} ${g.kills}/${g.deaths}/${g.assists}</span>
          <span class="lane-vs">vs</span>
          <span class="lane-opp">${g.opponent_champion} ${g.opponent_kills}/${g.opponent_deaths}/${g.opponent_assists}</span>
          ${verdictLabel ? `<span class="flex-rank ${verdictCls}">${verdictLabel}</span>` : ""}
        </div>`
      : `<div class="lane-compare"><span class="lane-me">${g.champion} ${g.kills}/${g.deaths}/${g.assists}</span></div>`;

    return `
      <div class="flex-game-row">
        <span class="flex-result ${resultCls}">${g.win ? "승" : "패"}</span>
        ${laneHTML}
      </div>`;
  }).join("");

  return `
    <div class="flex-games-section">
      <div class="flex-games-title">최근 솔로랭크 3게임 · 라인전 비교</div>
      ${items}
    </div>`;
}

function recentFlexGamesHTML(games) {
  if (!games || !games.length) return "";
  const items = games.map(g => {
    const cls = rankBadgeClass(g.rank, g.total);
    const rankText = g.rank ? `${g.rank}/${g.total}등` : "-";
    const resultCls = g.win ? "win-text" : "loss-text";
    return `
      <div class="flex-game-row">
        <span class="flex-champ">${g.champion}</span>
        <span class="flex-kda">${g.kills}/${g.deaths}/${g.assists}</span>
        <span class="flex-result ${resultCls}">${g.win ? "승" : "패"}</span>
        <span class="flex-rank ${cls}">${rankText}</span>
      </div>`;
  }).join("");

  return `
    <div class="flex-games-section">
      <div class="flex-games-title">최근 자유랭크 3게임</div>
      ${items}
    </div>`;
}

function renderCard(player, index) {
  const solo = { ...player.solo, ...player.recent_30d.solo };
  const flex = { ...player.flex, ...player.recent_30d.flex };
  const aram = player.recent_30d.aram || { games: 0, wins: 0, losses: 0, winrate: 0 };
  const tierColorVar = `var(--tier-${(player.solo?.tier || 'unranked').toLowerCase()})`;
  const comment = playerComment(player);

  const card = document.createElement("div");
  card.className = "card";
  card.style.setProperty("--tier-color", tierColorVar);
  card.innerHTML = `
    <div class="card-head">
      <div class="rank-pos">#${index + 1}</div>
      <div>
        <div class="player-name">${player.label}</div>
        <div class="riot-id">${player.riot_id}</div>
      </div>
    </div>
    ${queueRowHTML("솔랭", solo)}
    ${queueRowHTML("자랭", flex)}
    ${recentSoloGamesHTML(player.recent_solo_games)}
    ${recentFlexGamesHTML(player.recent_flex_games)}
    <div class="aram-row">
      <span>칼바람 (최근 30일)</span>
      <b>${aram.games}판 · ${aram.wins}승 ${aram.losses}패 (${aram.winrate}%)</b>
    </div>
    ${comment ? `<div class="player-comment ${comment.cls}">${comment.text}</div>` : ""}
    <div class="chart-wrap"><canvas id="chart-${index}"></canvas></div>
  `;
  return card;
}

function renderChart(canvasId, history) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById(canvasId);
  if (!ctx || !history.length) return;

  const labels = history.map(h => h.date.slice(5));
  const soloLP = history.map(h => tierScore(h.solo_tier, h.solo_rank, h.solo_lp));

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: soloLP,
        borderColor: "#c8a44d",
        backgroundColor: "rgba(200,164,77,0.12)",
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const h = history[item.dataIndex];
              if (!h) return "기록 없음";
              return tierBadgeText(h.solo_tier, h.solo_rank, h.solo_lp);
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          ticks: { color: "#7d8aa8", maxRotation: 0, autoSkip: true, maxTicksLimit: 4, font: { size: 9 } },
          grid: { display: false },
        },
        y: {
          display: true,
          ticks: {
            stepSize: 100,
            font: { size: 9 },
            maxTicksLimit: 5,
            color: (context) => scoreToTierColor(context.tick.value),
            callback: (value) => scoreToTierLabel(value),
          },
          grid: { color: "rgba(126,138,168,0.06)" },
        },
      },
    },
  });
}

function renderTeamLegend(players) {
  const legend = document.getElementById("team-legend");
  legend.innerHTML = players.map((p, i) => `
    <li><span class="dot" style="background:${PLAYER_COLORS[i % PLAYER_COLORS.length]}"></span>${p.label}</li>
  `).join("");
}

function renderTeamChart(players) {
  if (typeof Chart === "undefined") return;
  const ctx = document.getElementById("team-chart");
  if (!ctx) return;

  const allDates = [...new Set(players.flatMap(p => (p.history || []).map(h => h.date)))].sort();
  if (!allDates.length) return;

  const datasets = players.map((p, i) => {
    const byDate = {};
    (p.history || []).forEach(h => { byDate[h.date] = h; });

    const data = [];
    const meta = [];
    allDates.forEach(d => {
      const h = byDate[d];
      if (h) {
        data.push(tierScore(h.solo_tier, h.solo_rank, h.solo_lp));
        meta.push(h);
      } else {
        data.push(null);
        meta.push(null);
      }
    });

    const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
    const pointStyle = PLAYER_POINT_STYLES[i % PLAYER_POINT_STYLES.length];
    return {
      label: p.label,
      data,
      meta,
      borderColor: color,
      backgroundColor: color,
      spanGaps: true,
      borderWidth: 2,
      tension: 0.3,
      // 같은 티어/구간에 있는 선수끼리 선이 겹칠 때도 점 모양으로 구분되도록
      pointStyle,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: "#0b1220",
      pointBorderWidth: 1,
    };
  });

  teamChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels: allDates.map(d => d.slice(5)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const m = item.dataset.meta[item.dataIndex];
              if (!m) return `${item.dataset.label}: 기록 없음`;
              return `${item.dataset.label}: ${tierBadgeText(m.solo_tier, m.solo_rank, m.solo_lp)}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "날짜", color: "#9aa5c0", font: { size: 11 } },
          ticks: { color: "#7d8aa8", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
          grid: { color: "rgba(126,138,168,0.08)" },
        },
        y: {
          display: true,
          title: { display: true, text: "티어", color: "#9aa5c0", font: { size: 11 } },
          ticks: {
            stepSize: 100,
            color: (context) => scoreToTierColor(context.tick.value),
            callback: (value) => scoreToTierLabel(value),
          },
          grid: { color: "rgba(126,138,168,0.06)" },
        },
      },
    },
  });
}

// 돋보기 버튼: 심해(0점) 같은 극단값을 빼고 실제 랭크 구간만 확대해서 보여줌
function setupZoomToggle() {
  const btn = document.getElementById("zoom-toggle-btn");
  if (!btn || !teamChartInstance) return;

  btn.addEventListener("click", () => {
    teamChartZoomed = !teamChartZoomed;
    const yScale = teamChartInstance.options.scales.y;

    if (teamChartZoomed) {
      const scores = teamChartInstance.data.datasets
        .flatMap(ds => ds.data)
        .filter(v => v !== null && v > 0);
      if (scores.length) {
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        const pad = Math.max((max - min) * 0.15, 80);
        yScale.min = Math.max(0, min - pad);
        yScale.max = max + pad;
      }
      btn.style.background = "rgba(200,164,77,0.18)";
      btn.title = "전체 보기";
    } else {
      delete yScale.min;
      delete yScale.max;
      btn.style.background = "none";
      btn.title = "확대해서 격차 보기";
    }
    teamChartInstance.update();
  });
}

async function main() {
  const board = document.getElementById("board");
  const updatedEl = document.getElementById("updated-at");

  let data;
  try {
    const res = await fetch("data/players.json", { cache: "no-store" });
    data = await res.json();
  } catch (e) {
    board.innerHTML = `<div class="loading">데이터를 불러오지 못했습니다. data/players.json을 확인하세요.</div>`;
    return;
  }

  updatedEl.textContent = data.updated_at
    ? `마지막 갱신: ${fmtDate(data.updated_at)}`
    : "아직 갱신되지 않았습니다";

  const players = [...(data.players || [])].sort((a, b) => {
    const sa = tierScore(a.solo?.tier, a.solo?.rank, a.solo?.lp);
    const sb = tierScore(b.solo?.tier, b.solo?.rank, b.solo?.lp);
    return sb - sa;
  });

  try {
    renderTeamLegend(players);
    renderTeamChart(players);
    setupZoomToggle();
  } catch (e) {
    console.error("팀 차트 렌더링 실패:", e);
  }

  board.innerHTML = "";
  if (!players.length) {
    board.innerHTML = `<div class="loading">아직 데이터가 없습니다. GitHub Actions 실행을 기다려주세요.</div>`;
    return;
  }

  players.forEach((p, i) => board.appendChild(renderCard(p, i)));
  players.forEach((p, i) => renderChart(`chart-${i}`, p.history || []));
}

main();
