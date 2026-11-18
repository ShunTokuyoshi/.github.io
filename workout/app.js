'use strict';

/* ========== データ ========== */
const STORE_KEY = 'workout-app-v1';

const DEFAULT_EXERCISES = [
  ['ベンチプレス', 'strength', '胸'], ['ダンベルプレス', 'strength', '胸'], ['ダンベルフライ', 'strength', '胸'], ['腕立て伏せ', 'bodyweight', '胸'],
  ['デッドリフト', 'strength', '背中'], ['ラットプルダウン', 'strength', '背中'], ['ベントオーバーロウ', 'strength', '背中'], ['懸垂', 'bodyweight', '背中'],
  ['スクワット', 'strength', '脚'], ['レッグプレス', 'strength', '脚'], ['ブルガリアンスクワット', 'strength', '脚'],
  ['ショルダープレス', 'strength', '肩'], ['サイドレイズ', 'strength', '肩'],
  ['バーベルカール', 'strength', '腕'], ['トライセプスエクステンション', 'strength', '腕'],
  ['クランチ', 'bodyweight', '腹'],
  ['ランニング', 'cardio', '有酸素'], ['ウォーキング', 'cardio', '有酸素'], ['エアロバイク', 'cardio', '有酸素'],
];
const PARTS = ['胸', '背中', '脚', '肩', '腕', '腹', '有酸素', 'その他'];
const TYPE_LABEL = { strength: '筋トレ', bodyweight: '自重', cardio: '有酸素' };

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultState() {
  const exercises = DEFAULT_EXERCISES.map(([name, type, part]) => ({ id: uid(), name, type, part }));
  const byName = n => exercises.find(e => e.name === n).id;
  return {
    exercises,
    menus: [
      { id: uid(), name: '胸の日', exIds: ['ベンチプレス', 'ダンベルプレス', 'ダンベルフライ', '腕立て伏せ'].map(byName) },
      { id: uid(), name: '背中の日', exIds: ['デッドリフト', 'ラットプルダウン', 'ベントオーバーロウ', '懸垂'].map(byName) },
      { id: uid(), name: '脚の日', exIds: ['スクワット', 'レッグプレス', 'ブルガリアンスクワット'].map(byName) },
    ],
    logs: [],
    settings: { rest: 90, autoTimer: true, sound: true, vibe: true },
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (isValidState(s)) {
        s.settings = Object.assign(defaultState().settings, s.settings);
        return s;
      }
    }
  } catch (e) { /* 読めなければ初期データ */ }
  return defaultState();
}

function isValidState(s) {
  return s && Array.isArray(s.exercises) && Array.isArray(s.logs) && Array.isArray(s.menus);
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('保存できませんでした（ストレージの空き容量を確認してください）');
  }
}

/* ========== ユーティリティ ========== */
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = n => (Math.round(n * 100) / 100).toLocaleString('ja-JP');

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function fmtDate(s, withWeek = true) {
  const d = parseYmd(s);
  const w = '日月火水木金土'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}` + (withWeek ? `（${w}）` : '');
}
const today = () => ymd(new Date());

const exById = id => state.exercises.find(e => e.id === id);

let toastTimer;
function toast(msg, gold = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('gold', gold);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ========== 集計 ========== */
const e1rm = (w, r) => (r === 1 ? w : w * (1 + r / 30)); // Epley式

function setText(ex, s) {
  if (ex.type === 'strength') return `${fmtNum(s.w)}kg × ${s.r}回`;
  if (ex.type === 'bodyweight') return `${s.r}回`;
  let t = `${fmtNum(s.min)}分`;
  if (s.km) {
    const pace = s.min / s.km;
    const pm = Math.floor(pace), ps = Math.round((pace - pm) * 60);
    t += ` / ${fmtNum(s.km)}km（${pm}:${String(ps).padStart(2, '0')}/km）`;
  }
  return t;
}

function logSummary(ex, log) {
  if (!log.sets.length) return 'セットなし';
  if (ex.type === 'cardio') {
    const min = log.sets.reduce((a, s) => a + s.min, 0);
    const km = log.sets.reduce((a, s) => a + (s.km || 0), 0);
    return `${fmtNum(min)}分` + (km ? ` / ${fmtNum(km)}km` : '');
  }
  // 同じ内容のセットはまとめる（60kg × 10回 × 3セット）
  const groups = [];
  for (const s of log.sets) {
    const key = setText(ex, s);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.n++;
    else groups.push({ key, n: 1 });
  }
  return groups.map(g => g.n > 1 ? `${g.key} × ${g.n}セット` : g.key).join('、');
}

const METRICS = {
  strength: [
    { key: 'maxW', label: '最大重量', unit: 'kg', set: s => s.w },
    { key: 'e1rm', label: '推定1RM', unit: 'kg', set: s => e1rm(s.w, s.r) },
    { key: 'vol', label: '総ボリューム', unit: 'kg', day: sets => sets.reduce((a, s) => a + s.w * s.r, 0) },
  ],
  bodyweight: [
    { key: 'maxR', label: '最大回数', unit: '回', set: s => s.r },
    { key: 'totalR', label: '合計回数', unit: '回', day: sets => sets.reduce((a, s) => a + s.r, 0) },
  ],
  cardio: [
    { key: 'min', label: '時間', unit: '分', day: sets => sets.reduce((a, s) => a + s.min, 0) },
    { key: 'km', label: '距離', unit: 'km', day: sets => sets.reduce((a, s) => a + (s.km || 0), 0) },
  ],
};

function metricOfDay(metric, sets) {
  if (!sets.length) return null;
  return metric.day ? metric.day(sets) : Math.max(...sets.map(metric.set));
}

// 日付ごとの値 [{date, v}]（古い順）
function series(exId, metric) {
  const map = new Map();
  for (const l of state.logs) {
    if (l.exId !== exId || !l.sets.length) continue;
    map.set(l.date, (map.get(l.date) || []).concat(l.sets));
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, sets]) => ({ date, v: metricOfDay(metric, sets) }))
    .filter(p => p.v > 0);
}

// 自己ベスト（各指標の最大値と達成日）
function personalBests(exId) {
  const ex = exById(exId);
  return METRICS[ex.type].map(m => {
    let best = null;
    for (const p of series(exId, m)) if (!best || p.v > best.v) best = p;
    return { metric: m, best };
  });
}

// ある種目で「自己ベストを出したセット」を特定（最大重量・最大回数のみ、最初に達成したセット）
function prSetKeys(exId) {
  const ex = exById(exId);
  if (ex.type === 'cardio') return new Set();
  const metric = METRICS[ex.type][0];
  let best = -Infinity, key = null;
  const logs = state.logs.filter(l => l.exId === exId).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  for (const l of logs) {
    l.sets.forEach((s, i) => {
      const v = metric.set(s);
      if (v > best) { best = v; key = `${l.id}:${i}`; }
    });
  }
  return new Set(key ? [key] : []);
}

/* ========== タブ ========== */
const TAB_TITLES = { log: '記録', history: '履歴', chart: 'グラフ', menu: 'メニュー', settings: '種目・設定' };
let currentTab = 'log';

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('#pageTitle').textContent = TAB_TITLES[name];
  render();
  window.scrollTo(0, 0);
}

document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

function render() {
  ({ log: renderLog, history: renderHistory, chart: renderChart, menu: renderMenus, settings: renderSettings })[currentTab]();
}

/* ========== 記録タブ ========== */
let logDate = today();

function exerciseOptions(placeholder) {
  let html = `<option value="">${placeholder}</option>`;
  for (const part of PARTS) {
    const list = state.exercises.filter(e => e.part === part);
    if (!list.length) continue;
    html += `<optgroup label="${esc(part)}">` + list.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('') + '</optgroup>';
  }
  return html;
}

function previousLog(exId, date) {
  return state.logs
    .filter(l => l.exId === exId && l.date < date && l.sets.length)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function renderLog() {
  $('#logDate').value = logDate;
  $('#menuStart').innerHTML = '<option value="">メニューから開始…</option>' +
    state.menus.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('#exerciseAdd').innerHTML = exerciseOptions('種目を追加…');

  const logs = state.logs.filter(l => l.date === logDate).sort((a, b) => a.order - b.order);
  $('#logEmpty').classList.toggle('hidden', logs.length > 0);

  $('#logList').innerHTML = logs.map(l => {
    const ex = exById(l.exId);
    if (!ex) return '';
    const prev = previousLog(ex.id, logDate);
    const prKeys = prSetKeys(ex.id);
    const last = l.sets[l.sets.length - 1] || (prev && prev.sets[prev.sets.length - 1]) || {};
    const cardio = ex.type === 'cardio';

    let input;
    if (ex.type === 'strength') {
      input = `<div class="set-input">
        <label class="unit"><input type="number" inputmode="decimal" step="0.25" min="0" name="w" value="${last.w ?? ''}" placeholder="重量"><span>kg</span></label>
        <label class="unit"><input type="number" inputmode="numeric" step="1" min="1" name="r" value="${last.r ?? ''}" placeholder="回数"><span>回</span></label>
        <button class="primary" data-action="add-set" data-log="${l.id}">＋セット</button></div>`;
    } else if (ex.type === 'bodyweight') {
      input = `<div class="set-input single">
        <label class="unit"><input type="number" inputmode="numeric" step="1" min="1" name="r" value="${last.r ?? ''}" placeholder="回数"><span>回</span></label>
        <button class="primary" data-action="add-set" data-log="${l.id}">＋セット</button></div>`;
    } else {
      input = `<div class="set-input">
        <label class="unit"><input type="number" inputmode="decimal" step="1" min="0" name="min" value="${last.min ?? ''}" placeholder="時間"><span>分</span></label>
        <label class="unit"><input type="number" inputmode="decimal" step="0.1" min="0" name="km" value="${last.km ?? ''}" placeholder="距離(任意)"><span>km</span></label>
        <button class="primary" data-action="add-set" data-log="${l.id}">＋記録</button></div>`;
    }

    return `<div class="card ex-card" data-log="${l.id}">
      <div class="ex-head">
        <div><span class="ex-name">${esc(ex.name)}</span><span class="tag ${cardio ? 'cardio' : ''}">${esc(ex.part)}</span></div>
        <button class="ex-remove" data-action="remove-log" data-log="${l.id}">削除</button>
      </div>
      <div class="prev">${prev ? `前回 ${fmtDate(prev.date, false)}：${esc(logSummary(ex, prev))}` : '初めての記録'}</div>
      <ul class="sets">${l.sets.map((s, i) => `<li>
        <span class="no">${cardio ? '' : i + 1}</span>
        <span class="val">${esc(setText(ex, s))}</span>
        ${prKeys.has(`${l.id}:${i}`) ? '<span class="pr-badge">PB</span>' : ''}
        <button class="del" data-action="del-set" data-log="${l.id}" data-i="${i}" aria-label="削除">✕</button>
      </li>`).join('')}</ul>
      ${input}
    </div>`;
  }).join('');
}

function addLog(exId) {
  const exists = state.logs.find(l => l.date === logDate && l.exId === exId);
  if (exists) return exists;
  const order = Math.max(0, ...state.logs.filter(l => l.date === logDate).map(l => l.order)) + 1;
  const log = { id: uid(), date: logDate, exId, sets: [], order };
  state.logs.push(log);
  return log;
}

$('#logDate').addEventListener('change', e => { logDate = e.target.value || today(); renderLog(); });
$('#prevDay').addEventListener('click', () => { logDate = addDays(logDate, -1); renderLog(); });
$('#nextDay').addEventListener('click', () => { logDate = addDays(logDate, 1); renderLog(); });

$('#exerciseAdd').addEventListener('change', e => {
  if (!e.target.value) return;
  addLog(e.target.value);
  save();
  renderLog();
  const cards = document.querySelectorAll('.ex-card');
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#menuStart').addEventListener('change', e => {
  const menu = state.menus.find(m => m.id === e.target.value);
  if (!menu) return;
  menu.exIds.filter(exById).forEach(addLog);
  save();
  renderLog();
  toast(`「${menu.name}」を開始しました`);
});

$('#logList').addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const log = state.logs.find(l => l.id === b.dataset.log);
  if (!log) return;
  const ex = exById(log.exId);

  if (b.dataset.action === 'add-set') {
    const card = b.closest('.ex-card');
    const val = n => parseFloat(card.querySelector(`[name="${n}"]`)?.value);
    let set;
    if (ex.type === 'strength') {
      const w = val('w'), r = Math.round(val('r'));
      if (!(w >= 0) || !(r >= 1)) return toast('重量と回数を入力してください');
      set = { w, r };
    } else if (ex.type === 'bodyweight') {
      const r = Math.round(val('r'));
      if (!(r >= 1)) return toast('回数を入力してください');
      set = { r };
    } else {
      const min = val('min'), km = val('km');
      if (!(min > 0)) return toast('時間（分）を入力してください');
      set = { min };
      if (km > 0) set.km = km;
    }
    // 自己ベスト判定：他の日のベストと、今日のこれまでの値を比べる
    const metrics = METRICS[ex.type];
    const todaySets = () => state.logs.filter(x => x.exId === ex.id && x.date === log.date).flatMap(x => x.sets);
    const others = metrics.map(m => {
      const pts = series(ex.id, m).filter(p => p.date !== log.date);
      return pts.length ? Math.max(...pts.map(p => p.v)) : null;
    });
    const before = metrics.map(m => metricOfDay(m, todaySets()) || 0);
    log.sets.push(set);
    save();
    const after = metrics.map(m => metricOfDay(m, todaySets()) || 0);
    const improved = metrics.filter((m, i) => others[i] !== null && (m.day
      ? before[i] <= others[i] && after[i] > others[i]       // 日の合計：初めて超えた瞬間だけ
      : after[i] > Math.max(others[i], before[i])));          // セット単位：今日の分も含めて超えたとき
    if (improved.length) {
      toast(`🏆 自己ベスト更新！ ${improved.map(m => `${m.label} ${fmtNum(after[metrics.indexOf(m)])}${m.unit}`).join('・')}`, true);
    }
    renderLog();
    if (state.settings.autoTimer && ex.type !== 'cardio') startTimer(state.settings.rest);
  }

  if (b.dataset.action === 'del-set') {
    log.sets.splice(Number(b.dataset.i), 1);
    save();
    renderLog();
  }

  if (b.dataset.action === 'remove-log') {
    if (log.sets.length && !confirm(`${ex.name} の記録（${log.sets.length}件）を削除しますか？`)) return;
    state.logs = state.logs.filter(l => l !== log);
    save();
    renderLog();
  }
});

// Enterキーでセット追加
$('#logList').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('input')) {
    e.target.closest('.ex-card').querySelector('[data-action="add-set"]').click();
  }
});

/* ========== 履歴タブ ========== */
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let selectedDay = null;

function logsOn(date) {
  return state.logs.filter(l => l.date === date && l.sets.length && exById(l.exId)).sort((a, b) => a.order - b.order);
}

function renderHistory() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('#calTitle').textContent = `${y}年${m + 1}月`;
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const t = today();
  let html = '<span class="cal-day blank"></span>'.repeat(first);
  let trainDays = 0, totalMin = 0;
  for (let d = 1; d <= days; d++) {
    const date = ymd(new Date(y, m, d));
    const logs = logsOn(date);
    const cls = ['cal-day'];
    if (logs.length) {
      cls.push('has');
      trainDays++;
      if (logs.every(l => exById(l.exId).type === 'cardio')) cls.push('cardio-only');
      totalMin += logs.filter(l => exById(l.exId).type === 'cardio').reduce((a, l) => a + l.sets.reduce((b, s) => b + s.min, 0), 0);
    }
    if (date === t) cls.push('today');
    if (date === selectedDay) cls.push('sel');
    html += `<button class="${cls.join(' ')}" data-date="${date}">${d}${logs.length ? `<span class="dots">${'●'.repeat(Math.min(logs.length, 4))}</span>` : ''}</button>`;
  }
  $('#calGrid').innerHTML = html;
  $('#calStats').textContent = `今月のトレーニング：${trainDays}日` + (totalMin ? ` ／ 有酸素 ${fmtNum(totalMin)}分` : '');
  renderDayDetail();
}

function renderDayDetail() {
  const box = $('#dayDetail');
  if (!selectedDay) { box.innerHTML = ''; return; }
  const logs = logsOn(selectedDay);
  box.innerHTML = `<div class="card">
    <h3>${fmtDate(selectedDay)}</h3>
    ${logs.length ? logs.map(l => {
      const ex = exById(l.exId);
      return `<div class="day-item"><b>${esc(ex.name)}</b><span class="muted">${esc(logSummary(ex, l))}</span></div>`;
    }).join('') : '<p class="muted">記録なし</p>'}
    <button class="primary full" data-open="${selectedDay}">この日の記録を${logs.length ? '編集' : '追加'}</button>
  </div>`;
}

$('#calGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-date]');
  if (!b) return;
  selectedDay = b.dataset.date;
  renderHistory();
});
$('#dayDetail').addEventListener('click', e => {
  const b = e.target.closest('[data-open]');
  if (!b) return;
  logDate = b.dataset.open;
  showTab('log');
});
$('#prevMonth').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() - 1); renderHistory(); });
$('#nextMonth').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() + 1); renderHistory(); });

/* ========== グラフタブ ========== */
let chartRange = 90;
let chartExId = null;
let chartMetricKey = null;

function renderChart() {
  // 記録がある種目を先に
  const used = new Set(state.logs.filter(l => l.sets.length).map(l => l.exId));
  const exs = state.exercises.filter(e => used.has(e.id));
  const sel = $('#chartExercise');
  if (!exs.length) {
    sel.innerHTML = '<option>記録がありません</option>';
    $('#chartMetric').innerHTML = '';
    $('#chartBox').innerHTML = '<p class="empty">記録するとここにグラフが表示されます</p>';
    $('#prList').innerHTML = '';
    return;
  }
  if (!exs.find(e => e.id === chartExId)) chartExId = exs[0].id;
  sel.innerHTML = PARTS.map(p => {
    const list = exs.filter(e => e.part === p);
    return list.length ? `<optgroup label="${esc(p)}">${list.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  sel.value = chartExId;

  const ex = exById(chartExId);
  const metrics = METRICS[ex.type];
  if (!metrics.find(m => m.key === chartMetricKey)) chartMetricKey = metrics[0].key;
  $('#chartMetric').innerHTML = metrics.map(m => `<option value="${m.key}">${m.label}</option>`).join('');
  $('#chartMetric').value = chartMetricKey;

  const metric = metrics.find(m => m.key === chartMetricKey);
  let pts = series(ex.id, metric);
  if (chartRange) {
    const from = addDays(today(), -chartRange);
    pts = pts.filter(p => p.date >= from);
  }
  const box = $('#chartBox');
  box.classList.toggle('cardio', ex.type === 'cardio');
  box.innerHTML = pts.length ? drawChart(pts, metric.unit) + chartSummary(pts, metric.unit) : '<p class="empty">この期間の記録はありません</p>';

  $('#prList').innerHTML = renderPRs();
}

function niceStep(range) {
  const raw = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function drawChart(pts, unit) {
  const W = 360, H = 220, L = 40, R = 12, T = 12, B = 24;
  const vs = pts.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (lo === hi) { lo -= 5; hi += 5; }
  const step = niceStep(hi - lo);
  lo = Math.max(0, Math.floor(lo / step) * step);
  hi = Math.ceil(hi / step) * step;

  const t0 = parseYmd(pts[0].date).getTime();
  const t1 = parseYmd(pts[pts.length - 1].date).getTime();
  const x = d => pts.length === 1 ? (L + W - R) / 2 : L + (parseYmd(d).getTime() - t0) / (t1 - t0) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    g += `<text class="lbl" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`;
  }
  const labelIdx = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
  for (const i of labelIdx) {
    const anchor = pts.length === 1 ? 'middle' : i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle';
    g += `<text class="lbl" x="${x(pts[i].date)}" y="${H - 8}" text-anchor="${anchor}">${fmtDate(pts[i].date, false)}</text>`;
  }
  const line = pts.map(p => `${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${x(pts[0].date)},${H - B} ${line} ${x(pts[pts.length - 1].date)},${H - B}`;
  const dots = pts.length <= 40 ? pts.map(p => `<circle class="pt" cx="${x(p.date)}" cy="${y(p.v)}" r="3.5"><title>${fmtDate(p.date)} ${fmtNum(p.v)}${unit}</title></circle>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="推移グラフ">
    ${g}<polygon class="area" points="${area}"/><polyline class="line" points="${line}"/>${dots}</svg>`;
}

function chartSummary(pts, unit) {
  const first = pts[0].v, last = pts[pts.length - 1].v, max = Math.max(...pts.map(p => p.v));
  const diff = last - first;
  return `<div class="chart-summary">
    <div>最新<b>${fmtNum(last)}${unit}</b></div>
    <div>最高<b>${fmtNum(max)}${unit}</b></div>
    <div>期間内の変化<b>${diff >= 0 ? '+' : ''}${fmtNum(diff)}${unit}</b></div>
    <div>記録日数<b>${pts.length}日</b></div>
  </div>`;
}

function renderPRs() {
  const used = new Set(state.logs.filter(l => l.sets.length).map(l => l.exId));
  return state.exercises.filter(e => used.has(e.id)).map(ex => {
    const pbs = personalBests(ex.id).filter(p => p.best);
    return `<div class="card pr-row">
      <div><b>${esc(ex.name)}</b><br><span class="tag ${ex.type === 'cardio' ? 'cardio' : ''}" style="margin:0">${esc(ex.part)}</span></div>
      <div class="pr-val">${pbs.map(p => `${p.metric.label} ${fmtNum(p.best.v)}${p.metric.unit} <span class="pr-date">${fmtDate(p.best.date, false)}</span>`).join('<br>')}</div>
    </div>`;
  }).join('');
}

$('#chartExercise').addEventListener('change', e => { chartExId = e.target.value; renderChart(); });
$('#chartMetric').addEventListener('change', e => { chartMetricKey = e.target.value; renderChart(); });
document.querySelector('.range-row').addEventListener('click', e => {
  const b = e.target.closest('[data-range]');
  if (!b) return;
  chartRange = Number(b.dataset.range);
  document.querySelectorAll('.range-row button').forEach(x => x.classList.toggle('on', x === b));
  renderChart();
});

/* ========== メニュータブ ========== */
let menuDraft = [];
let editingMenuId = null;

function renderMenus() {
  $('#menuPicker').innerHTML = PARTS.map(p => {
    const list = state.exercises.filter(e => e.part === p);
    if (!list.length) return '';
    return `<div class="part-label">${esc(p)}</div>` + list.map(e => {
      const idx = menuDraft.indexOf(e.id);
      return `<button class="chip ${idx >= 0 ? 'on' : ''}" data-ex="${e.id}">${idx >= 0 ? `<span class="ord">${idx + 1}</span>` : ''}${esc(e.name)}</button>`;
    }).join('');
  }).join('');
  $('#menuSave').textContent = editingMenuId ? '更新' : '保存';

  $('#menuList').innerHTML = state.menus.length ? state.menus.map(m => `<div class="card list-item">
    <div><b>${esc(m.name)}</b><div class="sub">${m.exIds.map(exById).filter(Boolean).map(e => esc(e.name)).join(' → ') || '種目なし'}</div></div>
    <div class="btns">
      <button class="primary" data-start="${m.id}">開始</button>
      <button data-edit="${m.id}">編集</button>
      <button class="danger" data-del="${m.id}">削除</button>
    </div>
  </div>`).join('') : '<p class="empty">メニューはまだありません</p>';
}

$('#menuPicker').addEventListener('click', e => {
  const b = e.target.closest('[data-ex]');
  if (!b) return;
  const id = b.dataset.ex;
  menuDraft = menuDraft.includes(id) ? menuDraft.filter(x => x !== id) : menuDraft.concat(id);
  renderMenus();
});

$('#menuSave').addEventListener('click', () => {
  const name = $('#menuName').value.trim();
  if (!name) return toast('メニュー名を入力してください');
  if (!menuDraft.length) return toast('種目を選んでください（タップした順に並びます）');
  if (editingMenuId) {
    Object.assign(state.menus.find(m => m.id === editingMenuId), { name, exIds: menuDraft });
  } else {
    state.menus.push({ id: uid(), name, exIds: menuDraft });
  }
  save();
  toast(editingMenuId ? 'メニューを更新しました' : 'メニューを保存しました');
  menuDraft = []; editingMenuId = null; $('#menuName').value = '';
  renderMenus();
});

$('#menuList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.start) {
    logDate = today();
    const menu = state.menus.find(m => m.id === b.dataset.start);
    menu.exIds.filter(exById).forEach(addLog);
    save();
    showTab('log');
    toast(`「${menu.name}」を開始しました`);
  }
  if (b.dataset.edit) {
    const m = state.menus.find(x => x.id === b.dataset.edit);
    editingMenuId = m.id;
    menuDraft = m.exIds.filter(exById);
    $('#menuName').value = m.name;
    renderMenus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.del) {
    const m = state.menus.find(x => x.id === b.dataset.del);
    if (!confirm(`メニュー「${m.name}」を削除しますか？（記録は消えません）`)) return;
    state.menus = state.menus.filter(x => x !== m);
    if (editingMenuId === m.id) { editingMenuId = null; menuDraft = []; $('#menuName').value = ''; }
    save();
    renderMenus();
  }
});

/* ========== 種目・設定タブ ========== */
function renderSettings() {
  $('#exList').innerHTML = PARTS.map(p => {
    const list = state.exercises.filter(e => e.part === p);
    if (!list.length) return '';
    return `<div class="card ex-group"><h3>${esc(p)}</h3>` + list.map(e => {
      const n = state.logs.filter(l => l.exId === e.id && l.sets.length).length;
      return `<div class="list-item">
        <div>${esc(e.name)}<div class="sub">${TYPE_LABEL[e.type]}${n ? ` ・ ${n}日分の記録` : ''}</div></div>
        <div class="btns"><button data-rename="${e.id}">名前変更</button><button class="danger" data-delex="${e.id}">削除</button></div>
      </div>`;
    }).join('') + '</div>';
  }).join('');

  const s = state.settings;
  $('#restSec').value = String(s.rest);
  $('#autoTimer').checked = s.autoTimer;
  $('#soundOn').checked = s.sound;
  $('#vibeOn').checked = s.vibe;
}

$('#exType').addEventListener('change', e => {
  if (e.target.value === 'cardio') $('#exPart').value = '有酸素';
  else if ($('#exPart').value === '有酸素') $('#exPart').value = '胸';
});

$('#exSave').addEventListener('click', () => {
  const name = $('#exName').value.trim();
  if (!name) return toast('種目名を入力してください');
  if (state.exercises.some(e => e.name === name)) return toast('同じ名前の種目があります');
  state.exercises.push({ id: uid(), name, type: $('#exType').value, part: $('#exPart').value });
  save();
  $('#exName').value = '';
  toast(`「${name}」を追加しました`);
  renderSettings();
});

$('#exList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.rename) {
    const ex = exById(b.dataset.rename);
    const name = prompt('新しい種目名', ex.name)?.trim();
    if (!name || name === ex.name) return;
    if (state.exercises.some(x => x.name === name)) return toast('同じ名前の種目があります');
    ex.name = name;
    save();
    renderSettings();
  }
  if (b.dataset.delex) {
    const ex = exById(b.dataset.delex);
    const n = state.logs.filter(l => l.exId === ex.id).length;
    if (!confirm(`「${ex.name}」を削除しますか？` + (n ? `\nこの種目の記録（${n}日分）も削除されます。` : ''))) return;
    state.exercises = state.exercises.filter(x => x !== ex);
    state.logs = state.logs.filter(l => l.exId !== ex.id);
    state.menus.forEach(m => { m.exIds = m.exIds.filter(id => id !== ex.id); });
    save();
    renderSettings();
  }
});

$('#restSec').addEventListener('change', e => { state.settings.rest = Number(e.target.value); save(); });
$('#autoTimer').addEventListener('change', e => { state.settings.autoTimer = e.target.checked; save(); });
$('#soundOn').addEventListener('change', e => { state.settings.sound = e.target.checked; save(); });
$('#vibeOn').addEventListener('change', e => { state.settings.vibe = e.target.checked; save(); if (e.target.checked) navigator.vibrate?.(200); });

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `workout-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!isValidState(data)) throw new Error('invalid');
    if (!confirm(`バックアップ（記録 ${data.logs.length}件）で今のデータを上書きしますか？`)) return;
    data.settings = Object.assign(defaultState().settings, data.settings);
    state = data;
    save();
    toast('復元しました');
    render();
  } catch (err) {
    toast('バックアップファイルを読み込めませんでした');
  }
});

/* ========== インターバルタイマー ========== */
let timerEnd = 0, timerTotal = 0, timerTick = null, audioCtx = null;

// iOSなどは操作をきっかけにしないと音が鳴らないので、最初のタップで準備しておく
document.addEventListener('pointerdown', () => {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume();
}, { passive: true });

function beep(times = 3) {
  if (!audioCtx || !state.settings.sound) return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < times; i++) {
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === times - 1 ? 1320 : 880;
    const st = t0 + i * 0.35;
    gain.gain.setValueAtTime(0.0001, st);
    gain.gain.exponentialRampToValueAtTime(0.4, st + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(st);
    osc.stop(st + 0.3);
  }
}

function startTimer(sec) {
  timerTotal = sec;
  timerEnd = Date.now() + sec * 1000;
  $('#timerBar').classList.remove('hidden', 'done');
  document.documentElement.classList.add('timer-on');
  clearInterval(timerTick);
  timerTick = setInterval(updateTimer, 250);
  updateTimer();
}

function stopTimer() {
  clearInterval(timerTick);
  timerTick = null;
  $('#timerBar').classList.add('hidden');
  document.documentElement.classList.remove('timer-on');
  $('#timerBar').classList.remove('done');
}

function updateTimer() {
  const left = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
  $('#timerTime').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  $('#timerProgress').style.width = `${timerTotal ? (left / timerTotal) * 100 : 0}%`;
  if (left === 0) {
    clearInterval(timerTick);
    timerTick = null;
    $('#timerBar').classList.add('done');
    $('#timerTime').textContent = '次のセット！';
    beep();
    if (state.settings.vibe) navigator.vibrate?.([300, 150, 300, 150, 300]);
    setTimeout(() => { if (!timerTick) stopTimer(); }, 5000);
  }
}

$('#timerBar').addEventListener('click', e => {
  const b = e.target.closest('[data-timer]');
  if (!b) return;
  const a = b.dataset.timer;
  if (a === 'stop') return stopTimer();
  const delta = Number(a);
  if (!timerTick) return startTimer(Math.max(15, delta)); // 終了後に+15で延長
  timerEnd = Math.max(Date.now() + 1000, timerEnd + delta * 1000);
  timerTotal = Math.max(timerTotal, Math.ceil((timerEnd - Date.now()) / 1000));
  updateTimer();
});
$('#timerQuick').addEventListener('click', () => startTimer(state.settings.rest));

// 画面がスリープから戻ったときにすぐ表示を合わせる
document.addEventListener('visibilitychange', () => { if (!document.hidden && timerTick) updateTimer(); });

/* ========== 起動 ========== */
save();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
