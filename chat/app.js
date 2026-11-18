'use strict';

/*
 * ほんやくチャット
 * - PeerJS (WebRTC) で端末同士を直接つなぐ。サーバー不要なので GitHub Pages で動く。
 * - ルームを作った人がホストになり、参加者のメッセージを全員に中継する。
 * - 受け取ったメッセージは、受信側が自分の言語へ翻訳して表示する。
 */

const LANGS = [
  ['ja', '日本語'], ['en', 'English'], ['zh-CN', '中文（简体）'], ['zh-TW', '中文（繁體）'],
  ['ko', '한국어'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'],
  ['it', 'Italiano'], ['pt', 'Português'], ['ru', 'Русский'], ['vi', 'Tiếng Việt'],
  ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['tl', 'Filipino'], ['hi', 'हिन्दी'],
  ['ar', 'العربية'], ['tr', 'Türkçe'], ['nl', 'Nederlands'], ['pl', 'Polski'],
];
const LANG_NAME = Object.fromEntries(LANGS);
const PEER_PREFIX = 'honyaku-chat-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O, 1/I を除外

const $ = (id) => document.getElementById(id);
const els = {
  setup: $('setup'), chat: $('chat'),
  name: $('nameInput'), lang: $('langSelect'), code: $('codeInput'),
  create: $('createBtn'), join: $('joinBtn'), setupError: $('setupError'),
  roomCode: $('roomCode'), status: $('status'), leave: $('leaveBtn'), share: $('shareBtn'),
  messages: $('messages'), form: $('sendForm'), input: $('msgInput'), toast: $('toast'),
};

const state = {
  peer: null,
  isHost: false,
  code: '',
  conns: new Map(),      // peerId -> DataConnection
  members: new Map(),    // peerId -> {name, lang}
  seen: new Set(),       // 重複表示防止用のメッセージID
};

/* ---------- 保存（端末ごとの設定） ---------- */
const store = {
  get(k, d) { try { return localStorage.getItem('hchat.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hchat.' + k, v); } catch { /* 保存できなくても動く */ } },
};

function me() {
  return { name: els.name.value.trim() || 'ゲスト', lang: els.lang.value };
}

/* ---------- 翻訳 ---------- */
const cache = new Map();

async function translate(text, target, sourceHint) {
  const key = `${target}|${text}`;
  if (cache.has(key)) return cache.get(key);

  let result = null;
  // 1) Google 翻訳（言語を自動判定できる）
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
      + `&sl=auto&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    result = {
      text: data[0].map((seg) => seg[0]).join(''),
      source: data[2] || sourceHint,
    };
  } catch (e) {
    // 2) 予備: MyMemory（送信者の言語設定を元言語として使う）
    try {
      const src = sourceHint || 'en';
      if (src.split('-')[0] === target.split('-')[0]) return { text, source: src };
      const url = 'https://api.mymemory.translated.net/get'
        + `?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(src)}|${encodeURIComponent(target)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.responseStatus !== 200 && data.responseStatus !== '200') throw new Error(data.responseDetails);
      result = { text: data.responseData.translatedText, source: src };
    } catch (e2) {
      console.warn('翻訳に失敗しました', e, e2);
      return null;
    }
  }
  cache.set(key, result);
  return result;
}

const sameLang = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

/* ---------- 表示 ---------- */
function atBottom() {
  const m = els.messages;
  return m.scrollHeight - m.scrollTop - m.clientHeight < 80;
}
function scrollDown(force) {
  if (force || atBottom()) els.messages.scrollTop = els.messages.scrollHeight;
}

function addSystem(text, atTop) {
  const stick = atBottom();
  const div = document.createElement('div');
  div.className = 'system';
  div.textContent = text;
  if (atTop) els.messages.prepend(div); else els.messages.append(div);
  scrollDown(stick);
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(msg, mine) {
  const stick = atBottom() || mine;
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (mine ? 'mine' : 'theirs');

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = mine ? timeLabel(msg.ts) : `${msg.name} · ${timeLabel(msg.ts)}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const main = document.createElement('div');
  bubble.append(main);

  wrap.append(meta, bubble);
  els.messages.append(wrap);

  if (mine) {
    main.textContent = msg.text;
    scrollDown(true);
    return;
  }

  const myLang = me().lang;
  // 相手と自分の言語設定が同じなら翻訳しない
  if (sameLang(msg.lang, myLang)) {
    main.textContent = msg.text;
    scrollDown(stick);
    return;
  }

  main.textContent = msg.text;
  main.classList.add('translating');
  scrollDown(stick);

  translate(msg.text, myLang, msg.lang).then((r) => {
    main.classList.remove('translating');
    if (!r) {
      meta.textContent += ' · 翻訳できませんでした';
      return;
    }
    if (r.source && sameLang(r.source.split('-')[0], myLang.split('-')[0])) {
      return; // 実は自分の言語で書かれていた
    }
    main.textContent = r.text;

    const original = document.createElement('div');
    original.className = 'original';
    original.textContent = msg.text;
    original.hidden = true;
    bubble.append(original);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toggle';
    const srcName = LANG_NAME[r.source] || LANG_NAME[msg.lang] || r.source;
    const label = () => (original.hidden ? `${srcName}から翻訳 · 原文を表示` : '原文を隠す');
    toggle.textContent = label();
    toggle.addEventListener('click', () => {
      original.hidden = !original.hidden;
      toggle.textContent = label();
    });
    wrap.append(toggle);
    scrollDown(stick);
  });
}

function setStatus(text, ok) {
  els.status.textContent = text;
  els.status.classList.toggle('ok', !!ok);
}

function updateMemberStatus() {
  const others = [...state.members.values()];
  if (others.length === 0) {
    setStatus(state.isHost ? '相手の参加を待っています… 🔗で招待' : '接続中…', false);
  } else {
    setStatus(others.map((m) => `${m.name}（${LANG_NAME[m.lang] || m.lang}）`).join('、'), true);
  }
}

let toastTimer;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2500);
}

/* ---------- 通信 ---------- */
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function makeCode() {
  let s = '';
  const buf = crypto.getRandomValues(new Uint32Array(6));
  for (const n of buf) s += CODE_CHARS[n % CODE_CHARS.length];
  return s;
}

function broadcast(data, exceptId) {
  for (const [id, conn] of state.conns) {
    if (id !== exceptId && conn.open) conn.send(data);
  }
}

function handleData(conn, data) {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'hello') {
    const info = { name: String(data.name || 'ゲスト').slice(0, 20), lang: String(data.lang || 'en') };
    const isNew = !state.members.has(data.from);
    state.members.set(data.from, info);
    if (isNew) addSystem(`${info.name} さんが参加しました（${LANG_NAME[info.lang] || info.lang}）`);
    if (state.isHost) {
      broadcast(data, conn.peer);
      // 新しく来た人に、既にいるメンバーを知らせる
      if (data.from === conn.peer) {
        conn.send({ type: 'hello', from: state.peer.id, ...me() });
        for (const [id, m] of state.members) {
          if (id !== conn.peer) conn.send({ type: 'hello', from: id, ...m });
        }
      }
    }
    updateMemberStatus();
  } else if (data.type === 'bye') {
    removeMember(data.from);
    if (state.isHost) broadcast(data, conn.peer);
  } else if (data.type === 'msg') {
    if (state.seen.has(data.id)) return;
    state.seen.add(data.id);
    if (state.isHost) broadcast(data, conn.peer);
    renderMessage({
      id: data.id,
      name: String(data.name || 'ゲスト').slice(0, 20),
      lang: String(data.lang || ''),
      text: String(data.text || '').slice(0, 4000),
      ts: Number(data.ts) || Date.now(),
    }, false);
  }
}

function removeMember(id) {
  const m = state.members.get(id);
  if (!m) return;
  state.members.delete(id);
  addSystem(`${m.name} さんが退出しました`);
  updateMemberStatus();
}

function setupConn(conn) {
  conn.on('open', () => {
    state.conns.set(conn.peer, conn);
    conn.send({ type: 'hello', from: state.peer.id, ...me() });
  });
  conn.on('data', (d) => handleData(conn, d));
  conn.on('close', () => {
    state.conns.delete(conn.peer);
    if (state.isHost) {
      // 参加者が抜けた → 他の人にも知らせる
      if (state.members.has(conn.peer)) broadcast({ type: 'bye', from: conn.peer });
      removeMember(conn.peer);
    } else {
      // ホストとの接続が切れた → ルーム終了
      for (const id of [...state.members.keys()]) removeMember(id);
      setStatus('ホストとの接続が切れました', false);
      addSystem('ルームが終了しました。新しいルームを作るか、もう一度参加してください。');
    }
  });
  conn.on('error', (e) => console.warn(e));
}

function peerErrorMessage(err) {
  switch (err.type) {
    case 'peer-unavailable': return 'ルームが見つかりません。コードを確認するか、ルームを作った人がページを開いているか確認してください。';
    case 'unavailable-id': return 'このルームコードは使用中です。もう一度お試しください。';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return '接続サーバーにつながりません。ネット接続を確認してください。';
    case 'browser-incompatible': return 'このブラウザは対応していません。';
    default: return '接続エラー: ' + (err.type || err.message);
  }
}

function start(code, asHost) {
  const { name, lang } = me();
  if (!els.name.value.trim()) { showSetupError('名前を入力してください'); els.name.focus(); return; }
  store.set('name', name);
  store.set('lang', lang);

  state.isHost = asHost;
  state.code = code;
  els.create.disabled = els.join.disabled = true;
  showSetupError('');

  const peer = asHost ? new Peer(PEER_PREFIX + code) : new Peer();
  state.peer = peer;
  let entered = false;

  peer.on('open', () => {
    if (asHost) {
      enterChat();
      entered = true;
    } else {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      conn.on('open', () => { if (!entered) { enterChat(); entered = true; } });
      setupConn(conn);
    }
  });
  peer.on('connection', (conn) => {
    if (!state.isHost) { conn.close(); return; }
    setupConn(conn);
  });
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('error', (err) => {
    console.warn(err);
    if (!entered) {
      showSetupError(peerErrorMessage(err));
      peer.destroy();
      state.peer = null;
      els.create.disabled = els.join.disabled = false;
    } else if (err.type !== 'peer-unavailable') {
      toast(peerErrorMessage(err));
    }
  });
}

function enterChat() {
  els.setup.hidden = true;
  els.chat.hidden = false;
  els.roomCode.textContent = state.code;
  // 先に届いた「参加しました」より上に出す
  addSystem(`相手のメッセージは ${LANG_NAME[me().lang]} に翻訳されます。`, true);
  addSystem(state.isHost
    ? `ルーム ${state.code} を作りました。🔗 から招待リンクを相手に送ってください。`
    : `ルーム ${state.code} に参加しました。`, true);
  updateMemberStatus();
  history.replaceState(null, '', `?room=${state.code}`);
  els.input.focus();
}

function leave() {
  if (state.peer) {
    broadcast({ type: 'bye', from: state.peer.id });
    setTimeout(() => state.peer && state.peer.destroy(), 200);
  }
  location.href = location.pathname; // 入室画面に戻る
}

function send(text) {
  text = text.trim();
  if (!text) return;
  if (state.conns.size === 0) {
    toast(state.isHost ? 'まだ誰も参加していません' : '接続が切れています');
    return;
  }
  const msg = { type: 'msg', id: newId(), from: state.peer.id, ...me(), text, ts: Date.now() };
  state.seen.add(msg.id);
  broadcast(msg);
  renderMessage(msg, true);
}

async function share() {
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  const text = `ほんやくチャットに招待します（ルーム ${state.code}）`;
  if (navigator.share) {
    try { await navigator.share({ title: 'ほんやくチャット', text, url }); return; } catch { /* キャンセル */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('招待リンクをコピーしました');
  } catch {
    prompt('このリンクを相手に送ってください', url);
  }
}

function showSetupError(text) {
  els.setupError.textContent = text;
  els.setupError.hidden = !text;
}

/* ---------- 初期化 ---------- */
function init() {
  for (const [code, label] of LANGS) {
    els.lang.append(new Option(label, code));
  }
  const browserLang = (navigator.language || 'ja');
  const guess = LANGS.find(([c]) => c.toLowerCase() === browserLang.toLowerCase())
    || LANGS.find(([c]) => c.split('-')[0] === browserLang.split('-')[0]);
  els.lang.value = store.get('lang', guess ? guess[0] : 'en');
  els.name.value = store.get('name', '');

  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) {
    els.code.value = roomParam.toUpperCase();
    els.join.classList.add('primary');
    els.create.classList.remove('primary');
  }

  els.create.addEventListener('click', () => start(makeCode(), true));
  els.join.addEventListener('click', () => {
    const code = els.code.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { showSetupError('ルームコードを入力してください'); return; }
    start(code, false);
  });
  els.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.join.click(); });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(els.input.value);
    els.input.value = '';
    autoGrow();
    els.input.focus();
  });
  els.input.addEventListener('keydown', (e) => {
    // Enterで送信、Shift+Enterで改行（変換中は送信しない）
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });
  const autoGrow = () => {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px';
  };
  els.input.addEventListener('input', autoGrow);

  els.share.addEventListener('click', share);
  els.leave.addEventListener('click', leave);
  window.addEventListener('pagehide', () => {
    if (state.peer) broadcast({ type: 'bye', from: state.peer.id });
  });
}

init();
