// 瀏覽器內單元測試：開啟 tests/index.html 即執行
import { findRoute, minutesFrom } from '../js/route.js';
import { seniorFare, roundTripPoints, addPoints, pointsThisMonth } from '../js/fare.js';
import { candidates, neighborsOf, spotFor } from '../js/draw.js';
import { encodeBackup, decodeBackup, defaultState, restore, awardBadges } from '../js/store.js';

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function eq(a, b, msg = '') {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg} 期望 ${B}，實際 ${A}`);
}
function ok(v, msg) { if (!v) throw new Error(msg); }

const [network, fares] = await Promise.all(
  ['../data/network.json', '../data/fares.json'].map(u => fetch(u).then(r => r.json())));

// ---------- 轉乘 ----------
await test('丹鳳 → 古亭：同一條線不用轉乘', () => {
  const r = findRoute(network, '丹鳳', '古亭');
  eq(r.transferCount, 0);
  eq(r.legs[0].toward, '南勢角');
});
await test('丹鳳 → 蘆洲：在大橋頭換往蘆洲的車', () => {
  const r = findRoute(network, '丹鳳', '蘆洲');
  eq(r.transferCount, 1);
  eq(r.transfers[0].from, '大橋頭');
  eq(r.legs[1].toward, '蘆洲');
});
await test('丹鳳 → 淡水：轉乘 1 次（民權西路換紅線）', () => {
  const r = findRoute(network, '丹鳳', '淡水');
  eq(r.transferCount, 1);
  eq(r.transfers[0].from, '民權西路');
  eq(r.legs[1].toward, '淡水');
});
await test('丹鳳 → 新北投：轉乘 2 次（民權西路、北投）', () => {
  const r = findRoute(network, '丹鳳', '新北投');
  eq(r.transferCount, 2);
  eq(r.transfers.map(t => t.from), ['民權西路', '北投']);
});
await test('丹鳳 → 龍山寺：轉乘 1 次', () => {
  const r = findRoute(network, '丹鳳', '龍山寺');
  eq(r.transferCount, 1);
});
await test('新埔民生 ↔ 新埔 算轉乘', () => {
  const r = findRoute(network, '幸福', '江子翠');
  eq(r.transferCount, 1);
  eq([r.transfers[0].from, r.transfers[0].to], ['新埔民生', '新埔']);
});
await test('往返路線轉乘次數一致（回家按鈕）', () => {
  for (const st of ['淡水', '動物園', '新店', '南港展覽館', '頂埔', '新北產業園區']) {
    eq(findRoute(network, st, '丹鳳').transferCount, findRoute(network, '丹鳳', st).transferCount, st);
  }
});
await test('丹鳳出發每站都在 90 分鐘內可到，且有路線', () => {
  const m = minutesFrom(network, '丹鳳');
  eq(Object.keys(m).length, 119);
  ok(Object.values(m).every(x => x > 0 || x === 0), '分鐘數異常');
});

// ---------- 扣點 ----------
await test('票價表敬老價為全票 4 折：松山機場→科技大樓 10 點', () => {
  eq(seniorFare(fares, '松山機場', '科技大樓'), 10);
});
await test('去回扣點＝兩段相加', () => {
  eq(roundTripPoints(fares, '丹鳳', '淡水'), seniorFare(fares, '丹鳳', '淡水') * 2);
});
await test('本月小計跨月歸零', () => {
  let s = addPoints(defaultState(), 30, new Date(2026, 9, 5));
  s = addPoints(s, 20, new Date(2026, 9, 20));
  eq(pointsThisMonth(s, new Date(2026, 9, 31)), 50);
  eq(pointsThisMonth(s, new Date(2026, 10, 1)), 0);
  eq(addPoints(s, 8, new Date(2026, 10, 2)).pointsMonth, { ym: '2026-11', used: 8 });
});

// ---------- 抽站 ----------
const spot = (o = {}) => ({ spots: [{ id: 'a', setting: 'outdoor', closedDays: [], ...o }, { id: 'b', setting: 'indoor', closedDays: [] }] });
const mins = { 古亭: 30, 東門: 31, 中正紀念堂: 33, 淡水: 70, 圓山: 35, 龍山寺: 35, 動物園: 85, 象山: 60, 丹鳳: 0 };
const fixture = { 古亭: spot(), 東門: spot(), 中正紀念堂: spot({ setting: 'indoor', closedDays: [1] }), 淡水: spot(), 圓山: spot(), 龍山寺: spot(), 動物園: spot(), 象山: spot() };
const base = { network, spots: fixture, minutes: mins, home: '丹鳳', indoorOnly: false, weekday: 3 };
const visit = (station, round = 1) => ({ station, round, date: '2026-10-01' });

await test('近程只抽 40 分鐘內', () => {
  const r = candidates({ ...base, state: defaultState(), mode: 'near' });
  eq(r.list.sort(), ['中正紀念堂', '古亭', '圓山', '東門', '龍山寺'].sort());
});
await test('遠程抽 40～90 分鐘', () => {
  eq(candidates({ ...base, state: defaultState(), mode: 'far' }).list.sort(), ['動物園', '淡水', '象山'].sort());
});
await test('相鄰（含跨線）：去過古亭後，東門與中正紀念堂不抽', () => {
  ok(neighborsOf(network, '古亭').has('東門') && neighborsOf(network, '古亭').has('中正紀念堂'), '鄰站計算錯誤');
  const state = { ...defaultState(), visits: [visit('古亭')] };
  eq(candidates({ ...base, state, mode: 'near' }).list.sort(), ['圓山', '龍山寺'].sort());
});
await test('只看前 5 次：第 6 次以前的鄰站可以再抽', () => {
  const state = { ...defaultState(), visits: ['古亭', '淡水', '動物園', '象山', '圓山', '龍山寺'].map(s => visit(s)) };
  const r = candidates({ ...base, state, mode: 'near' });
  eq(r.list.sort(), ['中正紀念堂', '東門'].sort());
  eq(r.relaxed, false);
});
await test('相鄰規則抽不到時放寬', () => {
  const state = { ...defaultState(), visits: ['古亭', '圓山', '龍山寺'].map(s => visit(s)) };
  const r = candidates({ ...base, state, mode: 'near' });
  eq(r.relaxed, true);
  eq(r.list.sort(), ['中正紀念堂', '東門'].sort());
});
await test('休館日排除（週一）', () => {
  ok(!candidates({ ...base, weekday: 1, state: defaultState(), mode: 'near' }).list.includes('中正紀念堂'), '應排除');
});
await test('只要室內', () => {
  eq(candidates({ ...base, indoorOnly: true, state: defaultState(), mode: 'near' }).list, ['中正紀念堂']);
});
await test('換一個：排除已出現的站', () => {
  const r = candidates({ ...base, state: defaultState(), mode: 'far', exclude: ['淡水', '象山'] });
  eq(r.list, ['動物園']);
});
await test('一邊抽完提示改抽另一邊', () => {
  const state = { ...defaultState(), visits: ['淡水', '動物園', '象山'].map(s => visit(s)) };
  eq(candidates({ ...base, state, mode: 'far' }).reason, 'otherMode');
});
await test('全部去過 → roundComplete；下一輪用第二個景點', () => {
  const state = { ...defaultState(), visits: Object.keys(fixture).map(s => visit(s)) };
  eq(candidates({ ...base, state, mode: 'near' }).reason, 'roundComplete');
  const next = { ...state, round: 2 };
  ok(candidates({ ...base, state: next, mode: 'near' }).list.length > 0, '第二輪應可抽');
  eq(spotFor(fixture['古亭'], 2).id, 'b');
  eq(spotFor(fixture['古亭'], 5).id, 'b');
});

// ---------- 備份與徽章 ----------
await test('備份連結編碼後還原一致，且不含 PIN', async () => {
  const s = { ...defaultState(), pinHash: 'secret', nickname: '阿嬤', visits: [visit('淡水')], updatedAt: 5 };
  const back = await decodeBackup(await encodeBackup(s));
  eq(back.visits, s.visits);
  eq(back.nickname, '阿嬤');
  ok(!('pinHash' in back), 'PIN 不應在備份');
});
await test('還原較舊的備份會警告', () => {
  const cur = { ...defaultState(), visits: [visit('淡水')], updatedAt: 100 };
  eq(restore(cur, { ...defaultState(), updatedAt: 50 }).older, true);
  eq(restore(cur, { ...defaultState(), updatedAt: 150 }).older, false);
});
await test('徽章：有內容的站全部去過才解鎖該線', () => {
  const state = { ...defaultState(), visits: [visit('淡水'), visit('圓山')] };
  const { fresh } = awardBadges(state, network, ['淡水', '圓山', '動物園'], '2026-10-23');
  ok(fresh.some(b => b.id === 'line-R'), '應解鎖淡水信義線');
  ok(!fresh.some(b => b.id === 'line-BR'), '文湖線不應解鎖');
});

// ---------- 輸出 ----------
const pass = results.filter(r => r.ok).length;
document.getElementById('out').innerHTML =
  `<h1>${pass} / ${results.length} 通過</h1>` +
  results.map(r => `<div class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : `<br><small>${r.msg}</small>`}</div>`).join('');
window.__testResults = results;
