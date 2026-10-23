import { findRoute, minutesFrom } from './route.js';
import { roundTripPoints, seniorFare, pointsThisMonth, addPoints, MONTHLY_POINTS } from './fare.js';
import { candidates, pick, spotFor, REROLLS, NEAR_MAX, FAR_MAX } from './draw.js';
import * as store from './store.js';
import { speak, stopSpeaking, canSpeak } from './speak.js';
import { renderMap } from './map.js';
import { compress, savePhoto, getPhoto, deletePhoto, clearPhotos } from './photos.js';

const app = document.getElementById('app');
const toolbar = document.getElementById('toolbar');

let network, fares, layout, spots;
let state = store.load();
let view = { name: 'home' };
let minutesCache = {};
let installPrompt = null;
let familyUnlocked = false;

// ---------- 小工具 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lineChip = line => `<span class="chip" style="background:${network.lines[line].color};color:${network.lines[line].text}">${network.lines[line].name}</span>`;
const lineShare = text => `https://line.me/R/share?text=${encodeURIComponent(text)}`;
const who = () => state.nickname || '我們';
const minutes = () => (minutesCache[state.homeStation] ||= minutesFrom(network, state.homeStation));
const stationData = st => spots.stations[st];
const currentSpot = () => spotFor(stationData(state.inProgress.station), state.round);

// 家站下拉選單：依路線分組
function stationOptions() {
  return Object.entries(network.lines).map(([line, info]) => {
    const names = [...new Set(Object.values(network.services).filter(v => v.line === line).flatMap(v => v.stations))];
    return `<optgroup label="${esc(info.name)}">${names.map(s => `<option value="${esc(s)}" ${s === state.homeStation ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`;
  }).join('');
}

function commit(next) {
  state = store.save(next);
}
function go(name, extra = {}) {
  stopSpeaking();
  view = { name, ...extra };
  render();
  window.scrollTo(0, 0);
}

// 可朗讀區塊：data-say 放要唸的文字
const sayBtn = text => canSpeak() ? `<button class="ghost" data-action="say" data-say="${esc(text)}">🔊 唸給我聽</button>` : '';

// ---------- 轉乘卡片 ----------
function towardText(leg) {
  // 主幹段上有多種列車都會到（例如古亭往北：迴龍、蘆洲的車都可以）
  const list = new Set([leg.toward]);
  for (const svc of Object.values(network.services)) {
    if (svc.line !== leg.line) continue;
    const idx = leg.stations.map(s => svc.stations.indexOf(s));
    if (idx.some(i => i < 0)) continue;
    const forward = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    const backward = idx.every((v, i) => i === 0 || v === idx[i - 1] - 1);
    if (forward) list.add(svc.stations[svc.stations.length - 1]);
    if (backward) list.add(svc.stations[0]);
  }
  return [...list].map(s => `「${s}」`).join('或');
}

function routeHtml(from, to) {
  const r = findRoute(network, from, to);
  const steps = [];
  const sayParts = [];
  r.legs.forEach((leg, i) => {
    const info = network.lines[leg.line];
    steps.push(`<div class="card leg"><div class="bar" style="background:${info.color}"></div><div>
      <div><span class="step-no">${steps.length + 1}.</span>在 <b>${esc(leg.from)}</b> 站搭 ${lineChip(leg.line)}</div>
      <p>月台方向：往 <b>${towardText(leg)}</b></p>
      <p>坐 <b>${leg.stops}</b> 站，約 ${leg.minutes} 分鐘，在 <b>${esc(leg.to)}</b> 站下車</p>
    </div></div>`);
    sayParts.push(`在${leg.from}站，搭${info.name}，往${towardText(leg).replace(/[「」]/g, '')}方向，坐${leg.stops}站，到${leg.to}站下車。`);
    const t = r.transfers[i];
    if (t) {
      const next = network.lines[r.legs[i + 1].line];
      const walk = t.from === t.to ? `跟著 ${lineChip(r.legs[i + 1].line)} 的指標走` : `出站走到 <b>${esc(t.to)}</b> 站（跟著 ${lineChip(r.legs[i + 1].line)} 指標）`;
      steps.push(`<div class="card transfer"><span class="step-no">${steps.length + 1}.</span>在 <b>${esc(t.from)}</b> 站換車：${walk}，大約走 ${Math.round(t.walkMinutes * 1.5)} 分鐘${t.walkMinutes >= 5 ? '<br><small>這站比較大，慢慢走，可以搭電梯</small>' : ''}</div>`);
      sayParts.push(`在${t.from}站換車，跟著${next.name}的指標走。`);
    }
  });
  if (!r.legs.length) steps.push('<div class="card">就在這一站！</div>');
  const head = `<p>全程約 <b>${r.totalMinutes}</b> 分鐘（含等車），${r.transferCount ? `換車 <b>${r.transferCount}</b> 次` : '<b>不用換車</b>'}</p>`;
  const tip = '<p class="muted">上車前看月台螢幕，確認列車的終點站方向正確。</p>';
  const gmap = `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`捷運${from}站`)}&destination=${encodeURIComponent(`捷運${to}站`)}&travelmode=transit">🗺️ 用 Google 地圖看路線</a>`;
  return { html: head + steps.join('') + tip + sayBtn(sayParts.join('')) + gmap, route: r };
}

function timeAdvice() {
  const h = new Date().getHours();
  if ((h >= 7 && h < 9) || (h >= 17 && h < 19)) return '現在是上下班尖峰，車上比較擠，可以晚一點再出發。';
  if (h >= 15) return '記得天黑前回到家，今天可以選「近一點」。';
  return '';
}

// ---------- 畫面 ----------
const screens = {
  setup() {
    return `<h1>第一次設定</h1>
      <p>請家人陪長輩一起完成。這些資料只存在這支手機裡。</p>
      <form data-form="setup" class="stack">
        <label class="field">怎麼稱呼長輩？<input type="text" name="nickname" value="${esc(state.nickname)}" placeholder="例如：阿公阿嬤"></label>
        <label class="field">家附近的捷運站<select name="homeStation">${stationOptions()}</select></label>
        <label class="field">家人電話（一鍵撥打用）<input type="tel" name="familyPhone" value="${esc(state.familyPhone)}" inputmode="tel"></label>
        <label class="field">家人密碼（4 位數字，進入家人設定用）<input type="password" name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" required></label>
        <button class="primary big" type="submit">完成設定</button>
      </form>`;
  },

  home() {
    const used = pointsThisMonth(state, new Date());
    const ip = state.inProgress;
    const advice = timeAdvice();
    return `<div class="top"><h1>${esc(who())}的捷運探險</h1><button class="gear" data-action="family" aria-label="家人設定">⚙️</button></div>
      <div class="card"><p>已經探險 <b>${state.visits.length}</b> 次（第 ${state.round} 輪）</p>
      <p class="points">本月探險約用 ${used} / ${MONTHLY_POINTS} 點</p><small>實際扣點以刷卡紀錄為準</small></div>
      ${advice ? `<div class="hint">${advice}</div>` : ''}
      <div class="stack" style="margin-top:16px">
        ${ip ? `<button class="accent big" data-action="resume">繼續去「${esc(ip.station)}」探險</button>` : `<button class="primary big" data-action="choose">開始新的探險</button>`}
        <button data-action="map">🗺️ 我的探險地圖</button>
        ${installPrompt ? '<button class="ghost" data-action="install">📲 加到手機主畫面</button>' : ''}
      </div>`;
  },

  choose() {
    const mode = view.mode || 'near';
    return `<h1>今天想走多遠？</h1>
      <div class="choice">
        <button data-action="mode" data-mode="near" aria-pressed="${mode === 'near'}">近一點<br><small>${NEAR_MAX} 分鐘內</small></button>
        <button data-action="mode" data-mode="far" aria-pressed="${mode === 'far'}">遠一點<br><small>${NEAR_MAX}～${FAR_MAX} 分鐘</small></button>
      </div>
      <label class="check"><input type="checkbox" data-action="indoor" ${view.indoorOnly ? 'checked' : ''}> 下雨或太熱，只要室內景點</label>
      ${view.message ? `<div class="hint">${esc(view.message)}</div>` : ''}
      <div class="stack" style="margin-top:12px">
        <button class="primary big" data-action="draw">🎲 抽一站！</button>
        <button class="ghost" data-action="home">回首頁</button>
      </div>`;
  },

  drawn() {
    const ip = state.inProgress;
    const data = stationData(ip.station);
    const { html } = routeHtml(state.homeStation, ip.station);
    const pts = roundTripPoints(fares, state.homeStation, ip.station);
    const departMsg = `${who()}出發去探險囉！目的地：捷運${ip.station}站。`;
    return `<p class="muted">迷霧散開了…今天的目的地是</p>
      <div class="station-name reveal">${esc(ip.station)} 站</div>
      ${ip.relaxed ? '<p class="muted">附近的站最近都去過了，這次放寬了一點。</p>' : ''}
      <div class="hint">🔎 提示：${esc(data.hint)}</div>
      ${sayBtn(`今天的目的地是${ip.station}站。提示：${data.hint}`)}
      <p class="points">去回約扣 ${pts} 點（單程 ${seniorFare(fares, state.homeStation, ip.station)} 點）</p>
      <h2>怎麼去</h2>${html}
      <div class="stack" style="margin-top:16px">
        <a class="btn" href="${lineShare(departMsg)}" target="_blank" rel="noopener">💬 用 LINE 告訴家人出發了</a>
        <button class="primary big" data-action="arriveStation">🚉 我到站了</button>
        ${ip.rerollsLeft > 0 ? `<button data-action="reroll">換一個（還可以換 ${ip.rerollsLeft} 次）</button>` : ''}
        <button class="ghost" data-action="home">改天再去（先保留）</button>
        <button class="ghost" data-action="abandon">不去這站了</button>
      </div>`;
  },

  atStation() {
    const ip = state.inProgress;
    const s = currentSpot();
    const say = `歡迎來到${ip.station}站。今天的景點是${s.name}。從${s.exit}出站，${s.route}，大約走${s.walkMin}分鐘。`;
    return `<p class="muted">${esc(ip.station)} 站到了！今天的景點是</p>
      <div class="station-name reveal">${esc(s.name)}</div>
      ${sayBtn(say)}
      <div class="card hl"><h2 style="margin-top:0">怎麼走</h2>
        <p>🚪 <b>${esc(s.exit)}</b> 出站${s.elevator ? `<br><small>♿ ${esc(s.elevator)}</small>` : ''}</p>
        <p>🚶 ${esc(s.route)}（約 ${s.walkMin} 分鐘）</p>
        ${s.access ? `<p>🦵 ${esc(s.access)}</p>` : ''}
        ${s.toilet ? `<p>🚻 ${esc(s.toilet)}</p>` : ''}
        ${s.hours ? `<p>🕘 ${esc(s.hours)}</p>` : ''}
        <p>🎫 ${esc(s.fee)}</p>
      </div>
      <div class="stack">
        <a class="btn" href="${lineShare(`${who()}已經到捷運${ip.station}站了。`)}" target="_blank" rel="noopener">💬 用 LINE 報平安</a>
        <a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.mapQuery || s.name)}&travelmode=walking">🗺️ 用 Google 地圖走過去</a>
        <button class="primary big" data-action="arriveSpot">📍 我到了</button>
        <button class="ghost" data-action="back" data-to="drawn">回上一步</button>
      </div>`;
  },

  arrived() {
    const ip = state.inProgress;
    const s = currentSpot();
    const data = stationData(ip.station);
    const foods = data.foods.map((f, i) => `<div class="food">
        <b>${esc(f.name)}</b> <span class="tag">${esc(f.price)}</span><br>
        <small>${esc(f.note || '')}</small>
        <p>🚶 ${esc(f.where)}<br>🕘 ${esc(f.hours)}${f.closed ? `（${esc(f.closed)}休）` : ''}${f.phone ? `<br>📞 <a href="tel:${esc(f.phone.replace(/[^\d+]/g, ''))}">${esc(f.phone)}</a>` : ''}</p>
        <a class="btn ghost" href="${lineShare(`回報：${ip.station}站附近的「${f.name}」今天沒開（${today()}），請幫忙更新。`)}" target="_blank" rel="noopener" data-food="${i}">這家今天沒開（回報）</a>
      </div>`).join('');
    return `<div class="celebrate reveal">🎉</div>
      <h1 style="text-align:center">${esc(s.name)}</h1>
      ${s.image ? `<img class="spot-img reveal" src="${esc(s.image.src)}" alt="${esc(s.name)}"><div class="credit">照片：${esc(s.image.author)}／${esc(s.image.license)}（<a href="${esc(s.image.source)}" target="_blank" rel="noopener">來源</a>）</div>` : ''}
      <div class="card">${s.desc.split('\n').map(p => `<p>${esc(p)}</p>`).join('')}${sayBtn(`${s.name}。${s.desc}`)}</div>
      <h2>🍜 附近吃飯</h2><div class="card">${foods}<small>店家資訊整理於 ${esc(spots.checkedAt)}，出發前可以先打電話問。</small></div>
      <div class="stack">
        <label class="btn">📷 拍一張照留念<input type="file" accept="image/*" capture="environment" data-action="photo" hidden></label>
        ${view.photoSaved ? '<p class="points">照片存好了！</p>' : ''}
        <button class="primary big" data-action="complete">✅ 完成探險，撥開迷霧</button>
      </div>`;
  },

  done() {
    const v = state.visits[state.visits.length - 1];
    return `<div class="celebrate reveal">🏅</div>
      <h1 style="text-align:center">探險完成！</h1>
      <p style="text-align:center">${esc(v.station)} 站的迷霧散開了</p>
      ${view.fresh?.length ? `<div class="card hl" style="text-align:center"><b>獲得新徽章</b><br>${view.fresh.map(b => `<span class="badge">🏅 ${esc(b.label)}</span>`).join('')}</div>` : ''}
      ${view.roundComplete ? '<div class="card hl" style="text-align:center"><b>🎊 全地圖解鎖！</b><br>所有探險站都去過了，下一輪會看到新的景點。</div>' : ''}
      <div class="stack">
        <button class="primary big" data-action="sendBackup">💾 把紀錄傳給家人備份（LINE）</button>
        <button data-action="homeRoute">🏠 看回家的路</button>
        <button class="ghost" data-action="map">🗺️ 看我的探險地圖</button>
        <button class="ghost" data-action="home">回首頁</button>
      </div>`;
  },

  homeRoute() {
    const from = view.from || state.inProgress?.station || state.visits.at(-1)?.station || state.homeStation;
    const { html, route } = routeHtml(from, state.homeStation);
    return `<h1>從 ${esc(from)} 站回家</h1>${html}
      <div class="stack" style="margin-top:16px">
        <a class="btn" href="${lineShare(`${who()}準備回家了，從${from}站搭捷運回${state.homeStation}站，大約${route.totalMinutes}分鐘。`)}" target="_blank" rel="noopener">💬 用 LINE 告訴家人要回家了</a>
        <button class="ghost" data-action="home">回首頁</button>
      </div>`;
  },

  map() {
    const visited = new Map(state.visits.map(v => [v.station, v.date]));
    return `<h1>我的探險地圖</h1>
      <p class="muted">可以用手指拖動地圖。橘色是去過的站，藍色是家。</p>
      <div class="map-wrap" id="map"></div>
      <h2>徽章</h2><div>${state.badges.length ? state.badges.map(b => `<span class="badge">🏅 ${esc(b.label)}</span>`).join('') : '<p class="muted">完成探險就會拿到徽章。</p>'}</div>
      <h2>探險紀錄</h2><ol class="visit-list">${state.visits.map((v, i) => `<li><img class="thumb" data-photo="${i}" alt="" hidden>${esc(v.date)}　${esc(v.station)}站・${esc(v.spotName || '')}</li>`).join('') || '<p class="muted">還沒有紀錄。</p>'}</ol>
      <button class="ghost" data-action="home">回首頁</button>`;
  },

  pin() {
    const n = view.entered?.length || 0;
    return `<h1>家人設定</h1><p>請輸入 4 位數家人密碼</p>
      <div class="pin-dots">${'●'.repeat(n)}${'○'.repeat(4 - n)}</div>
      ${view.wrong ? '<p style="color:var(--danger);text-align:center">密碼不對，請再試一次</p>' : ''}
      <div class="pin">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-action="pinKey" data-key="${k}">${k}</button>`).join('')}</div>
      <div style="margin-top:16px"><button class="ghost" data-action="home">回首頁</button></div>`;
  },

  family() {
    const ip = state.inProgress;
    let answer = '<p class="muted">目前沒有進行中的探險。</p>';
    if (ip) {
      const s = currentSpot();
      answer = `<p>進行中：<b>${esc(ip.station)}</b> 站 → <b>${esc(s.name)}</b>（${esc(s.exit)}，步行約 ${s.walkMin} 分鐘）</p>`;
    }
    const drafts = Object.entries(spots.stations).filter(([, d]) => d.draft).length;
    return `<h1>家人設定</h1>
      ${state.pinHash ? '' : '<div class="hint">這支手機還沒有家人密碼，請在下方「基本設定」設定 4 位數密碼。</div>'}
      <div class="card"><h2 style="margin-top:0">目前的答案</h2>${answer}</div>
      <form data-form="settings" class="card">
        <h2 style="margin-top:0">基本設定</h2>
        <label class="field">稱呼<input type="text" name="nickname" value="${esc(state.nickname)}"></label>
        <label class="field">家站<select name="homeStation">${stationOptions()}</select></label>
        <label class="field">家人電話<input type="tel" name="familyPhone" value="${esc(state.familyPhone)}"></label>
        <label class="field">改家人密碼（不改就留空）<input type="password" name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4"></label>
        <button class="primary" type="submit">儲存</button>
      </form>
      <div class="card"><h2 style="margin-top:0">探險紀錄（誤按可刪除）</h2>
        <ol class="visit-list">${state.visits.map((v, i) => `<li>${esc(v.date)} ${esc(v.station)}站 <button class="ghost" style="width:auto;min-height:48px;display:inline-flex" data-action="delVisit" data-i="${i}">刪除</button></li>`).join('') || '<p class="muted">沒有紀錄</p>'}</ol>
        ${ip ? '<button class="danger" data-action="abandon">取消進行中的探險</button>' : ''}
      </div>
      <div class="card"><h2 style="margin-top:0">備份與同步</h2>
        <p>把備份連結傳到 LINE，換手機或第二支手機打開連結就能還原。</p>
        <button data-action="sendBackup">💾 用 LINE 傳備份連結</button>
      </div>
      <div class="card"><h2 style="margin-top:0">內容狀態</h2>
        <p>共 ${Object.keys(spots.stations).length} 站內容，其中 <b>${drafts}</b> 站是<span class="tag draft">草稿</span>，請依內容核對清單逐站確認。</p>
        <small>資料整理於 ${esc(spots.checkedAt)}</small>
      </div>
      <div class="card"><h2 style="margin-top:0">清除所有資料</h2>
        <p>刪除這支手機上的設定、探險紀錄、徽章與留念照，回到第一次設定的畫面。清除前建議先傳一份備份連結。</p>
        <button class="danger" data-action="resetAll">🗑️ 清除所有資料</button>
      </div>
      <button class="ghost" data-action="lock">離開家人設定</button>`;
  },

  restore() {
    const b = view.backup;
    return `<h1>還原探險紀錄</h1>
      <div class="card"><p>這份備份有 <b>${b.visits.length}</b> 次探險紀錄${b.nickname ? `（${esc(b.nickname)}）` : ''}。</p>
      ${view.older ? '<p style="color:var(--danger)"><b>注意：</b>這份備份比手機裡的紀錄舊，還原後會蓋掉比較新的紀錄。</p>' : ''}</div>
      <div class="stack"><button class="primary big" data-action="doRestore">還原這份紀錄</button><button class="ghost" data-action="home">不要還原</button></div>`;
  },
};

// ---------- 底部工具列 ----------
function renderToolbar() {
  const items = [];
  if (state.familyPhone) items.push(`<a class="btn" href="tel:${esc(state.familyPhone.replace(/[^\d+]/g, ''))}"><span class="ico">📞</span>打給家人</a>`);
  if (state.inProgress && ['drawn', 'atStation', 'arrived'].includes(view.name)) items.push('<button data-action="homeRoute"><span class="ico">🏠</span>回家</button>');
  if (view.name !== 'home' && view.name !== 'setup') items.push('<button data-action="home"><span class="ico">⬅️</span>首頁</button>');
  toolbar.innerHTML = items.join('');
  toolbar.hidden = !items.length;
}

function render() {
  if (!state.setupDone && view.name !== 'restore') view = { name: 'setup' };
  if (view.name === 'family' && !familyUnlocked) view = { name: 'pin' };
  app.innerHTML = screens[view.name]();
  renderToolbar();
  if (view.name === 'map') {
    renderMap(document.getElementById('map'), {
      network, layout, home: state.homeStation,
      visited: new Map(state.visits.map(v => [v.station, v.date])),
      highlight: state.inProgress?.station,
      focus: state.visits.at(-1)?.station,
    });
    state.visits.forEach(async (v, i) => {
      const blob = v.photoId && await getPhoto(v.photoId);
      const img = app.querySelector(`img[data-photo="${i}"]`);
      if (blob && img) { img.src = URL.createObjectURL(blob); img.hidden = false; }
    });
  }
}

// ---------- 動作 ----------
function startDraw(mode, indoorOnly, offered = [], rerollsLeft = REROLLS) {
  const r = candidates({
    network, spots: spots.stations, state, minutes: minutes(), home: state.homeStation,
    mode, indoorOnly, weekday: new Date().getDay(), exclude: offered,
  });
  if (r.reason === 'roundComplete') {
    commit({ ...state, round: state.round + 1 });
    return startDraw(mode, indoorOnly, offered, rerollsLeft);
  }
  if (!r.list.length) {
    const msg = r.reason === 'otherMode'
      ? (mode === 'near' ? '近一點的站都去過了，要不要挑戰「遠一點」？' : '遠一點的站都去過了，選「近一點」看看？')
      : offered.length ? '沒有其他站可以換了，就去這一站吧！' : '今天沒有符合條件的站，換個選項試試看。';
    if (offered.length) { alert(msg); return go('drawn'); }
    return go('choose', { mode, indoorOnly, message: msg });
  }
  const station = pick(r.list);
  commit({ ...state, inProgress: { station, stage: 'drawn', rerollsLeft, offered: [...offered, station], mode, indoorOnly, relaxed: r.relaxed, drawnAt: today() } });
  go('drawn');
}

async function sendBackup() {
  const code = await store.encodeBackup(state);
  const url = store.backupUrl(code);
  location.href = lineShare(`【捷運探險紀錄備份】${who()}已探險 ${state.visits.length} 次。換手機時打開這個連結就能還原：\n${url}`);
}

const actions = {
  say: el => speak(el.dataset.say),
  home: () => go('home'),
  choose: () => go('choose', { mode: 'near', indoorOnly: false }),
  mode: el => { view.mode = el.dataset.mode; view.message = ''; render(); },
  indoor: el => { view.indoorOnly = el.checked; },
  draw: () => startDraw(view.mode || 'near', !!view.indoorOnly),
  reroll: () => {
    const ip = state.inProgress;
    startDraw(ip.mode, ip.indoorOnly, ip.offered, ip.rerollsLeft - 1);
  },
  resume: () => go(state.inProgress.stage),
  arriveStation: () => { commit({ ...state, inProgress: { ...state.inProgress, stage: 'atStation', rerollsLeft: 0 } }); go('atStation'); },
  arriveSpot: () => { commit({ ...state, inProgress: { ...state.inProgress, stage: 'arrived' } }); go('arrived'); },
  back: el => { commit({ ...state, inProgress: { ...state.inProgress, stage: el.dataset.to } }); go(el.dataset.to); },
  abandon: () => {
    if (!confirm('確定不去這一站了嗎？這次不會算進紀錄。')) return;
    commit({ ...state, inProgress: null });
    go('home');
  },
  complete: () => {
    const ip = state.inProgress;
    const s = currentSpot();
    const points = roundTripPoints(fares, state.homeStation, ip.station);
    let next = { ...state, inProgress: null, visits: [...state.visits, { station: ip.station, spot: s.id, spotName: s.name, date: today(), round: state.round, points, photoId: view.photoId || null }] };
    next = addPoints(next, points, new Date());
    const awarded = store.awardBadges(next, network, Object.keys(spots.stations), today());
    commit(awarded.state);
    const roundComplete = candidates({ network, spots: spots.stations, state, minutes: minutes(), home: state.homeStation, mode: 'near', indoorOnly: false, weekday: 0 }).reason === 'roundComplete';
    go('done', { fresh: awarded.fresh, roundComplete });
  },
  homeRoute: () => go('homeRoute', { from: state.inProgress?.station }),
  map: () => go('map'),
  sendBackup,
  install: async () => { installPrompt?.prompt(); installPrompt = null; render(); },
  family: () => {
    // 從備份還原的手機沒有密碼（備份不含 PIN），先讓家人直接進來設定
    if (!state.pinHash) familyUnlocked = true;
    go(familyUnlocked ? 'family' : 'pin', { entered: '' });
  },
  pinKey: async el => {
    const k = el.dataset.key;
    view.wrong = false;
    view.entered = k === '⌫' ? (view.entered || '').slice(0, -1) : (view.entered || '') + k;
    if (view.entered.length === 4) {
      if (await store.hashPin(view.entered) === state.pinHash) { familyUnlocked = true; return go('family'); }
      view.entered = '';
      view.wrong = true;
    }
    render();
  },
  lock: () => { familyUnlocked = false; go('home'); },
  resetAll: async () => {
    const n = state.visits.length;
    if (!confirm(`確定要清除所有資料嗎？
會刪除設定、${n} 筆探險紀錄、徽章與留念照。`)) return;
    if (!confirm('再確認一次：清除後無法復原（除非有備份連結）。真的要清除嗎？')) return;
    await clearPhotos();
    state = store.clear();
    familyUnlocked = false;
    go('setup');
  },
  delVisit: el => {
    const i = Number(el.dataset.i);
    const v = state.visits[i];
    if (!confirm(`刪除 ${v.date} ${v.station}站 的紀錄？`)) return;
    if (v.photoId) deletePhoto(v.photoId);
    commit({ ...state, visits: state.visits.filter((_, j) => j !== i) });
    render();
  },
  doRestore: () => {
    const { state: next } = store.restore(state, view.backup);
    commit(next);
    history.replaceState(null, '', location.pathname);
    go('home');
  },
};

app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});
toolbar.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el) { e.preventDefault(); actions[el.dataset.action](el); }
});
app.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.action === 'indoor') actions.indoor(el);
  if (el.dataset.action === 'photo' && el.files[0]) {
    const id = `p${Date.now()}`;
    await savePhoto(id, await compress(el.files[0]));
    view.photoId = id;
    view.photoSaved = true;
    render();
  }
});
app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const pin = f.get('pin');
  const next = { ...state, nickname: f.get('nickname').trim(), homeStation: f.get('homeStation'), familyPhone: f.get('familyPhone').trim() };
  if (pin) {
    if (!/^\d{4}$/.test(pin)) return alert('家人密碼請輸入 4 位數字');
    next.pinHash = await store.hashPin(pin);
  }
  if (e.target.dataset.form === 'setup') {
    next.setupDone = true;
    navigator.storage?.persist?.(); // 申請持久儲存，降低被系統清除的機會
  }
  commit(next);
  go(e.target.dataset.form === 'setup' ? 'home' : 'family');
});

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  if (view.name === 'home') render();
});

// ---------- 啟動 ----------
async function init() {
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  [network, fares, layout, spots] = await Promise.all(['data/network.json', 'data/fares.json', 'data/map-layout.json', 'data/spots.json'].map(get));
  // 家站改變或內容移除時，清掉無效的進行中探險
  if (state.inProgress && !spots.stations[state.inProgress.station]) commit({ ...state, inProgress: null });

  const m = location.hash.match(/^#restore=(.+)$/);
  if (m) {
    try {
      const backup = await store.decodeBackup(m[1]);
      const { older } = store.restore(state, backup);
      view = { name: 'restore', backup, older };
    } catch {
      alert('備份連結無法讀取，可能複製不完整。');
      history.replaceState(null, '', location.pathname);
    }
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init().catch(err => {
  app.innerHTML = `<h1>載入失敗</h1><p>請確認網路後重新開啟。</p><small>${esc(err.message)}</small>`;
});
