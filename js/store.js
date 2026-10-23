// 狀態存取（localStorage）、備份連結編碼與還原、徽章。
const KEY = 'mrt-explorer-v1';

export function defaultState() {
  return {
    v: 1,
    setupDone: false,
    homeStation: '丹鳳',
    nickname: '',
    familyPhone: '',
    pinHash: '',
    round: 1,
    visits: [],          // {station, spot, date, round, points}
    inProgress: null,    // {station, stage, rerollsLeft, offered, mode, indoorOnly, drawnAt}
    pointsMonth: null,   // {ym, used}
    badges: [],          // {id, date}
    updatedAt: 0,
  };
}

export function load(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(KEY);
    return raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
  } catch {
    return defaultState();
  }
}

export function save(state, storage = globalThis.localStorage) {
  const next = { ...state, updatedAt: Date.now() };
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* 空間不足或被封鎖時仍可繼續用 */ }
  return next;
}

export function clear(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY); } catch { /* 被封鎖時忽略 */ }
  return defaultState();
}

export async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mrt-explorer:${pin}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- 備份連結：JSON → deflate → base64url，放在網址 # 後面（不會傳到伺服器）----

const toB64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeBackup(state) {
  const { pinHash, ...rest } = state; // PIN 不放進備份
  const bytes = new TextEncoder().encode(JSON.stringify(rest));
  return toB64url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

export async function decodeBackup(code) {
  const bytes = await pipe(fromB64url(code), new DecompressionStream('deflate-raw'));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data?.v !== 1 || !Array.isArray(data.visits)) throw new Error('備份格式不正確');
  return data;
}

export function backupUrl(code, base = location.href) {
  const url = new URL(base);
  url.hash = `restore=${code}`;
  url.search = '';
  return url.toString();
}

// 還原：沿用這支手機的 PIN；回傳是否比目前資料舊，讓畫面先警告
export function restore(current, backup) {
  return {
    state: { ...defaultState(), ...backup, pinHash: current.pinHash, setupDone: true },
    older: (backup.updatedAt || 0) < (current.updatedAt || 0) && current.visits.length > 0,
  };
}

// ---- 徽章：某條線上「有內容的站」全部去過；累計第 5／10／20 次 ----

export const MILESTONES = [5, 10, 20];

export function earnedBadges(state, network, spotStations) {
  const visited = new Set(state.visits.map(v => v.station));
  const out = [];
  for (const [line, info] of Object.entries(network.lines)) {
    const onLine = new Set();
    for (const svc of Object.values(network.services)) {
      if (svc.line === line) svc.stations.forEach(s => spotStations.includes(s) && onLine.add(s));
    }
    if (onLine.size && [...onLine].every(s => visited.has(s))) out.push({ id: `line-${line}`, label: `${info.name}全線解鎖` });
  }
  for (const n of MILESTONES) {
    if (state.visits.length >= n) out.push({ id: `count-${n}`, label: `第 ${n} 次探險` });
  }
  return out;
}

// 回傳這次新拿到的徽章，並寫入 state
export function awardBadges(state, network, spotStations, date) {
  const have = new Set(state.badges.map(b => b.id));
  const fresh = earnedBadges(state, network, spotStations).filter(b => !have.has(b.id));
  return { state: { ...state, badges: [...state.badges, ...fresh.map(b => ({ id: b.id, label: b.label, date }))] }, fresh };
}
