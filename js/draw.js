// 抽站規則（純函式）
// - 依近程（≤40 分）／遠程（40～90 分）篩選
// - 排除本輪去過的站、前 5 個到訪站及它們任何路線上的前後一站、今天休館或非室內的景點
// - 抽不到時先放寬相鄰規則，再提示改抽另一邊；本輪全部去過則進入下一輪

export const NEAR_MAX = 40;
export const FAR_MAX = 90;
export const RECENT_COUNT = 5;
export const REROLLS = 2;

export function neighborsOf(network, station) {
  const out = new Set();
  for (const svc of Object.values(network.services)) {
    const i = svc.stations.indexOf(station);
    if (i < 0) continue;
    if (i > 0) out.add(svc.stations[i - 1]);
    if (i < svc.stations.length - 1) out.add(svc.stations[i + 1]);
  }
  for (const [a, b] of network.linkedStations || []) {
    if (a === station) out.add(b);
    if (b === station) out.add(a);
  }
  out.delete(station);
  return out;
}

export function inMode(minutes, mode) {
  if (minutes == null || minutes > FAR_MAX) return false;
  return mode === 'near' ? minutes <= NEAR_MAX : minutes > NEAR_MAX;
}

// 第 n 輪（從 1 開始）用該站第 n 個景點，景點不夠就用最後一個
export function spotFor(stationSpots, round) {
  const list = stationSpots.spots;
  return list[Math.min(round - 1, list.length - 1)];
}

export function recentStations(state, count = RECENT_COUNT) {
  return state.visits.slice(-count).map(v => v.station);
}

export function visitedThisRound(state) {
  return new Set(state.visits.filter(v => v.round === state.round).map(v => v.station));
}

/**
 * @param {object} p
 * @param {object} p.network
 * @param {object} p.spots     data/spots.json 的 stations 物件
 * @param {object} p.state     使用者狀態（visits、round）
 * @param {object} p.minutes   家站到各站分鐘
 * @param {'near'|'far'} p.mode
 * @param {boolean} p.indoorOnly
 * @param {number} p.weekday   0=週日 … 6=週六
 * @param {string[]} [p.exclude] 這次已經出現過、要跳過的站（換一個用）
 * @returns {{list: string[], relaxed: boolean, reason: null|'otherMode'|'roundComplete'|'none'}}
 */
export function candidates({ network, spots, state, minutes, mode, indoorOnly, weekday, exclude = [], home }) {
  const visited = visitedThisRound(state);
  const all = Object.keys(spots).filter(st => st !== home && minutes[st] != null && minutes[st] <= FAR_MAX);
  if (all.length && all.every(st => visited.has(st))) return { list: [], relaxed: false, reason: 'roundComplete' };

  const usable = (st, m) => {
    if (!inMode(minutes[st], m) || visited.has(st) || exclude.includes(st)) return false;
    const spot = spotFor(spots[st], state.round);
    if ((spot.closedDays || []).includes(weekday)) return false;
    if (indoorOnly && spot.setting !== 'indoor') return false;
    return true;
  };
  const base = all.filter(st => usable(st, mode));

  const recent = recentStations(state);
  const blocked = new Set(recent);
  for (const st of recent) for (const n of neighborsOf(network, st)) blocked.add(n);

  const strict = base.filter(st => !blocked.has(st));
  if (strict.length) return { list: strict, relaxed: false, reason: null };

  const loose = base.filter(st => !recent.includes(st));
  if (loose.length) return { list: loose, relaxed: true, reason: null };

  const other = mode === 'near' ? 'far' : 'near';
  if (all.some(st => usable(st, other))) return { list: [], relaxed: false, reason: 'otherMode' };
  return { list: [], relaxed: false, reason: 'none' };
}

export function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}
