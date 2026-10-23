// 轉乘路線計算：最少轉乘優先，其次總分鐘（含轉乘步行與候車）。
// 狀態是「某站、搭某條 service」，在 service 上前後移動或在轉乘站換 service。

export const WAIT_MIN = 4;           // 每次上車平均候車分鐘
export const ELDER_WALK_FACTOR = 1.5; // 長輩轉乘步行時間放寬倍數

export function stationServices(network) {
  const map = new Map();
  for (const [sid, svc] of Object.entries(network.services)) {
    svc.stations.forEach((s, i) => {
      if (!map.has(s)) map.set(s, []);
      map.get(s).push({ sid, index: i });
    });
  }
  return map;
}

function linkedOf(network, station) {
  const out = [];
  for (const [a, b] of network.linkedStations || []) {
    if (a === station) out.push(b);
    if (b === station) out.push(a);
  }
  return out;
}

function better(a, b) {
  return a.transfers !== b.transfers ? a.transfers < b.transfers : a.minutes < b.minutes;
}

export function findRoute(network, from, to) {
  if (from === to) return { legs: [], transfers: [], totalMinutes: 0, transferCount: 0 };
  const svcOf = stationServices(network);
  if (!svcOf.has(from) || !svcOf.has(to)) throw new Error(`未知站名：${from} 或 ${to}`);

  const key = (sid, st) => `${sid}|${st}`;
  const best = new Map();
  const prev = new Map();
  const queue = [];
  const push = (sid, st, cost, from) => {
    const k = key(sid, st);
    const cur = best.get(k);
    if (cur && !better(cost, cur)) return;
    best.set(k, cost);
    prev.set(k, from);
    queue.push({ sid, st, cost });
  };
  for (const { sid } of svcOf.get(from)) push(sid, from, { transfers: 0, minutes: WAIT_MIN }, null);

  let goal = null;
  while (queue.length) {
    // 站數很少（約 120 站），用線性找最小值即可
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (better(queue[i].cost, queue[bi].cost)) bi = i;
    const { sid, st, cost } = queue.splice(bi, 1)[0];
    const k = key(sid, st);
    if (best.get(k) !== cost) continue;
    if (st === to) { goal = k; break; }

    const svc = network.services[sid];
    const i = svc.stations.indexOf(st);
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= svc.stations.length) continue;
      const m = svc.minutes[Math.min(i, j)];
      push(sid, svc.stations[j], { transfers: cost.transfers, minutes: cost.minutes + m }, { k, kind: 'ride' });
    }
    const walk = network.transferMinutes[st];
    if (walk != null) {
      for (const other of svcOf.get(st)) {
        if (other.sid === sid) continue;
        push(other.sid, st, {
          transfers: cost.transfers + 1,
          minutes: cost.minutes + walk * ELDER_WALK_FACTOR + WAIT_MIN,
        }, { k, kind: 'transfer', walk });
      }
      for (const linked of linkedOf(network, st)) {
        for (const other of svcOf.get(linked)) {
          push(other.sid, linked, {
            transfers: cost.transfers + 1,
            minutes: cost.minutes + walk * ELDER_WALK_FACTOR + WAIT_MIN,
          }, { k, kind: 'transfer', walk });
        }
      }
    }
  }
  if (!goal) throw new Error(`找不到 ${from} 到 ${to} 的路線`);

  // 回溯路徑
  const path = [];
  for (let k = goal; k; k = prev.get(k)?.k) path.unshift({ k, step: prev.get(k) });
  const legs = [];
  const transfers = [];
  let leg = null;
  for (const { k, step } of path) {
    const [sid, st] = k.split('|');
    if (!step || step.kind === 'transfer') {
      if (step) transfers.push({ from: leg.to, to: st, walkMinutes: step.walk });
      leg = { service: sid, line: network.services[sid].line, from: st, to: st, stations: [st], minutes: 0 };
      legs.push(leg);
    } else {
      const svc = network.services[sid];
      const a = svc.stations.indexOf(leg.to);
      const b = svc.stations.indexOf(st);
      leg.minutes += svc.minutes[Math.min(a, b)];
      leg.to = st;
      leg.stations.push(st);
    }
  }
  for (const l of legs) {
    const svc = network.services[l.service];
    const forward = svc.stations.indexOf(l.to) > svc.stations.indexOf(l.from);
    l.toward = forward ? svc.stations[svc.stations.length - 1] : svc.stations[0];
    l.stops = l.stations.length - 1;
    l.minutes = Math.round(l.minutes);
  }
  const c = best.get(goal);
  return { legs, transfers, totalMinutes: Math.round(c.minutes), transferCount: c.transfers };
}

// 從某站到所有站的估計分鐘（抽站分近程／遠程用）
export function minutesFrom(network, from) {
  const out = {};
  for (const st of stationServices(network).keys()) out[st] = findRoute(network, from, st).totalMinutes;
  return out;
}
