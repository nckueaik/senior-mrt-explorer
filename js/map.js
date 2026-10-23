// 迷霧路線示意圖：去過的站撥開迷霧、亮起站名；家站永遠看得到
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

const LABEL = { r: [12, 6, 'start'], l: [-12, 6, 'end'], t: [0, -12, 'middle'], b: [0, 24, 'middle'] };

export function renderMap(container, { network, layout, visited, home, highlight, focus: focusOn }) {
  const { width, height, stations: pos } = layout;
  const PAD = 90; // 留邊，避免邊緣站名被切掉
  const svg = el('svg', { viewBox: `${-PAD} ${-PAD / 2} ${width + PAD * 2} ${height + PAD}`, role: 'img', 'aria-label': '探險地圖', class: 'fog-map' });

  const defs = el('defs', {}, svg);
  const grad = el('radialGradient', { id: 'clear' }, defs);
  el('stop', { offset: '55%', 'stop-color': '#000' }, grad);
  el('stop', { offset: '100%', 'stop-color': '#fff' }, grad);
  const mask = el('mask', { id: 'fog-mask' }, defs);
  el('rect', { x: -PAD, y: -PAD, width: width + PAD * 2, height: height + PAD * 2, fill: '#fff' }, mask);

  // 路線
  const lines = el('g', { class: 'lines' }, svg);
  for (const svc of Object.values(network.services)) {
    const pts = svc.stations.map(s => pos[s]).filter(Boolean).map(([x, y]) => `${x},${y}`).join(' ');
    el('polyline', { points: pts, fill: 'none', stroke: network.lines[svc.line].color, 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, lines);
  }

  // 站點
  const dots = el('g', {}, svg);
  for (const [name, [x, y]] of Object.entries(pos)) {
    const big = network.transferMinutes[name] != null;
    el('circle', { cx: x, cy: y, r: big ? 9 : 6, fill: '#fff', stroke: '#333', 'stroke-width': big ? 3 : 2 }, dots);
  }

  // 迷霧（去過的站與家站挖洞）
  const revealed = new Set([...visited.keys(), home]);
  for (const name of revealed) {
    const p = pos[name];
    if (p) el('circle', { cx: p[0], cy: p[1], r: 70, fill: 'url(#clear)' }, mask);
  }
  el('rect', { x: -PAD, y: -PAD, width: width + PAD * 2, height: height + PAD * 2, fill: '#cfd6de', opacity: 0.88, mask: 'url(#fog-mask)', class: 'fog' }, svg);

  // 迷霧上方的標籤
  const labels = el('g', { class: 'labels' }, svg);
  for (const name of revealed) {
    const p = pos[name];
    if (!p) continue;
    const [dx, dy, anchor] = LABEL[p[2] || 'r'];
    const g = el('g', {}, labels);
    el('circle', { cx: p[0], cy: p[1], r: 13, fill: name === home ? '#1f5fbf' : '#e07a00', stroke: '#fff', 'stroke-width': 3 }, g);
    const t = el('text', { x: p[0] + dx * 1.4, y: p[1] + dy, 'text-anchor': anchor, class: 'map-label' }, g);
    t.textContent = name === home ? `${name}（家）` : name;
    const date = visited.get(name);
    if (date) {
      const d = el('text', { x: p[0] + dx * 1.4, y: p[1] + dy + 24, 'text-anchor': anchor, class: 'map-date' }, g);
      d.textContent = date.slice(5).replace('-', '/');
    }
  }
  if (highlight && pos[highlight]) {
    const [x, y] = pos[highlight];
    el('circle', { cx: x, cy: y, r: 26, fill: 'none', stroke: '#d1006b', 'stroke-width': 5, class: 'pulse' }, svg);
  }

  container.replaceChildren(svg);
  // 把進行中、最近去過或家站捲到畫面中間
  const focus = pos[highlight] || pos[focusOn] || pos[home];
  if (focus) {
    requestAnimationFrame(() => {
      const scale = svg.getBoundingClientRect().width / (width + PAD * 2);
      container.scrollLeft = (focus[0] + PAD) * scale - container.clientWidth / 2;
      container.scrollTop = (focus[1] + PAD / 2) * scale - container.clientHeight / 2;
    });
  }
}
