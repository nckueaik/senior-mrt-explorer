// 敬老卡扣點估算：北捷票價表的「敬老卡愛心卡…優惠票價」欄位（全票 4 折）。
// 新北敬老卡依實際搭乘金額扣點，1 點 = 1 元。

export const MONTHLY_POINTS = 600;

export function seniorFare(fares, from, to) {
  const i = fares.stations.indexOf(from);
  const j = fares.stations.indexOf(to);
  if (i < 0 || j < 0) throw new Error(`票價表沒有 ${from} 或 ${to}`);
  return fares.senior[i][j];
}

export function roundTripPoints(fares, home, dest) {
  return seniorFare(fares, home, dest) + seniorFare(fares, dest, home);
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// 本月探險已用點數；跨月自動歸零
export function pointsThisMonth(state, now) {
  return state.pointsMonth?.ym === monthKey(now) ? state.pointsMonth.used : 0;
}

export function addPoints(state, points, now) {
  const ym = monthKey(now);
  const used = state.pointsMonth?.ym === ym ? state.pointsMonth.used : 0;
  return { ...state, pointsMonth: { ym, used: used + points } };
}
