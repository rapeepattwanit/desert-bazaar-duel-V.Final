const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);

let ws;
let state = null;
let previousState = null;
let selectedHand = [];
let selectedMarket = [];
let camelTradeCount = 0;
let currentView = 'lobby';
let viewBeforeGuide = 'lobby';
let userInteracted = false;
let bgAudio = null;
let bgStarted = false;
let pendingActionSound = null;
let lastActionSoundId = null;
let roundPopupShownFor = null;
let winnerPopupShownFor = null;
let audioUnlockNoticeShown = false;
let turnNotificationTimer = null;

const BACKGROUND_TRACKS = [
  '/assets/audio/casino-jazz-1.mp3'
];

const EFFECT_FILES = {
  click: '/assets/audio/effects/pick-card.mp3',
  notification: '/assets/audio/effects/notification-chime.mp3',
  takeOne: '/assets/audio/effects/pick-card.mp3',
  takeCamels: '/assets/audio/effects/camel.mp3',
  trade: '/assets/audio/effects/trade.mp3',
  sell: '/assets/audio/effects/sell-money.mp3',
  roundWin: '/assets/audio/effects/winner.mp3',
  winner: '/assets/audio/effects/winner.mp3'
};

const effectTemplates = new Map();
const effectBuffers = new Map();
const effectBufferLoading = new Map();
const lastEffectAt = new Map();
let audioContext = null;
const clientId = localStorage.getItem('dbd_client_id') || crypto.randomUUID();
localStorage.setItem('dbd_client_id', clientId);

const settings = {
  masterVolume: Number(localStorage.getItem('dbd_master_volume') || 5),
  effectsVolume: Number(localStorage.getItem('dbd_effects_volume') || 5),
  notificationVolume: Number(localStorage.getItem('dbd_notification_volume') || 5),
  musicVolume: Number(localStorage.getItem('dbd_music_volume') || 5),
  masterEnabled: localStorage.getItem('dbd_master_enabled') !== 'off',
  effectsEnabled: localStorage.getItem('dbd_effects_enabled') !== 'off',
  notificationEnabled: localStorage.getItem('dbd_notification_enabled') !== 'off',
  musicEnabled: localStorage.getItem('dbd_music_enabled') !== 'off',
  turnPopupEnabled: localStorage.getItem('dbd_turn_popup_enabled') !== 'off'
};

const savedName = localStorage.getItem('dbd_name') || '';
$('nameInput').value = savedName;
if (qs.get('room')) {
  $('roomInput').value = qs.get('room').toUpperCase();
  $('inviteNotice').classList.remove('hidden');
  $('joinBtn').textContent = 'เข้าห้องนี้';
  setTimeout(() => $('nameInput').focus(), 350);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function clamp(num, min, max) {
  const n = Number(num);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function playerName() {
  const name = $('nameInput').value.trim().slice(0, 18) || 'ผู้เล่น';
  localStorage.setItem('dbd_name', name);
  return name;
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('show'), 2800);
}

function setScreen(name) {
  currentView = name;
  ['lobby', 'guide', 'game'].forEach(id => $(id).classList.toggle('hidden', id !== name));
  updateBackgroundMusicState();
}

function showGuide() {
  viewBeforeGuide = currentView === 'game' && state ? 'game' : 'lobby';
  setScreen('guide');
}

function returnFromGuide() {
  if (viewBeforeGuide === 'game' && state) setScreen('game');
  else setScreen('lobby');
}

function goHome() {
  if (state && !confirm('กลับหน้า Home ใช่ไหม? คุณจะออกจากห้องปัจจุบัน')) return;
  try { send({ type: 'leave' }, false); } catch {}
  location.href = location.origin;
}

function markUserInteracted() {
  userInteracted = true;
  resumeAudioContext();
  preloadEffects();
  updateBackgroundMusicState();
}
document.addEventListener('pointerdown', markUserInteracted);
document.addEventListener('keydown', markUserInteracted);

function volumeCurve(level) {
  const ratio = clamp(level, 0, 5) / 5;
  return ratio <= 0 ? 0 : ratio * ratio;
}
function masterRatio() {
  return settings.masterEnabled ? volumeCurve(settings.masterVolume) : 0;
}
function effectsRatio() {
  return settings.effectsEnabled ? volumeCurve(settings.effectsVolume) : 0;
}
function notificationRatio() {
  return settings.notificationEnabled ? volumeCurve(settings.notificationVolume) : 0;
}
function musicRatio() {
  return settings.musicEnabled ? volumeCurve(settings.musicVolume) : 0;
}
function getAudioContext() {
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioContext = new Ctx();
  }
  return audioContext;
}
function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
function canPlayEffects() {
  return userInteracted && masterRatio() > 0 && effectsRatio() > 0;
}
function canPlayNotification() {
  return userInteracted && masterRatio() > 0 && notificationRatio() > 0;
}
function canPlayMusic() {
  return userInteracted && state && currentView === 'game' && masterRatio() > 0 && musicRatio() > 0;
}

function preloadEffects() {
  Object.entries(EFFECT_FILES).forEach(([key, src]) => {
    if (!effectTemplates.has(key)) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.onerror = () => console.warn(`Audio effect not found or unsupported: ${key} -> ${src}`);
      effectTemplates.set(key, audio);
    }

    if (effectBuffers.has(key) || effectBufferLoading.has(key)) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const loadPromise = fetch(src, { cache: 'force-cache' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => effectBuffers.set(key, decoded))
      .catch(err => console.warn(`Audio buffer preload failed: ${key} -> ${src}`, err))
      .finally(() => effectBufferLoading.delete(key));
    effectBufferLoading.set(key, loadPromise);
  });
}

function playEffect(name, opts = {}) {
  const channelRatio = opts.channel === 'notification' ? notificationRatio() : effectsRatio();
  if (!userInteracted || masterRatio() <= 0 || channelRatio <= 0) return;
  const now = performance.now();
  const throttleMs = opts.throttleMs ?? 70;
  if ((lastEffectAt.get(name) || 0) + throttleMs > now) return;
  lastEffectAt.set(name, now);

  const src = EFFECT_FILES[name];
  if (!src) return console.warn(`Unknown effect key: ${name}`);
  const volume = Math.max(0, Math.min(1, masterRatio() * channelRatio * (opts.multiplier || 0.9)));
  if (volume <= 0) return;

  const ctx = getAudioContext();
  const buffer = effectBuffers.get(name);
  if (ctx && buffer) {
    resumeAudioContext();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    try { source.start(0); } catch {}
    return;
  }

  preloadEffects();
  const base = effectTemplates.get(name) || new Audio(src);
  if (!effectTemplates.has(name)) effectTemplates.set(name, base);
  const audio = base.cloneNode(true);
  audio.volume = volume;
  audio.play().catch(() => {
    if (!audioUnlockNoticeShown) {
      audioUnlockNoticeShown = true;
      toast('แตะหน้าจออีกครั้งเพื่อเปิดเสียง');
    }
  });
}
function playNotificationSound() { playEffect('notification', { channel: 'notification', throttleMs: 700, multiplier: 0.9 }); }
function playWinnerSound() { playEffect('winner', { throttleMs: 900, multiplier: 0.95 }); }
function playActionSound(type) {
  const map = { takeOne: 'takeOne', takeCamels: 'takeCamels', trade: 'trade', sell: 'sell' };
  playEffect(map[type] || 'click');
}
function playClickSound() { playEffect('click', { throttleMs: 45, multiplier: 0.45 }); }

function updateBackgroundVolume() {
  if (!bgAudio) return;
  bgAudio.volume = Math.max(0, Math.min(0.75, masterRatio() * musicRatio() * 0.55));
}

function startBackgroundMusic() {
  if (bgStarted || !canPlayMusic() || !BACKGROUND_TRACKS.length) return;
  bgStarted = true;
  if (!bgAudio) {
    bgAudio = new Audio();
    bgAudio.preload = 'auto';
    bgAudio.loop = false;
  }
  const playRandomTrack = () => {
    const src = BACKGROUND_TRACKS[Math.floor(Math.random() * BACKGROUND_TRACKS.length)];
    bgAudio.src = src;
    updateBackgroundVolume();
    bgAudio.onloadedmetadata = () => {
      try {
        if (Number.isFinite(bgAudio.duration) && bgAudio.duration > 10) {
          bgAudio.currentTime = Math.random() * Math.max(0, bgAudio.duration - 8);
        }
      } catch {}
    };
    bgAudio.onended = playRandomTrack;
    bgAudio.onerror = () => {
      bgStarted = false;
      console.warn('Background music file not found or unsupported:', src);
    };
    bgAudio.play().catch(() => {
      bgStarted = false;
      if (!audioUnlockNoticeShown && currentView === 'game') {
        audioUnlockNoticeShown = true;
        toast('กดปุ่มหรือแตะหน้าจอเพื่อเปิดเพลงพื้นหลัง');
      }
    });
  };
  playRandomTrack();
}

function stopBackgroundMusic() {
  if (bgAudio) bgAudio.pause();
  bgStarted = false;
}

function updateBackgroundMusicState() {
  updateBackgroundVolume();
  if (canPlayMusic()) startBackgroundMusic();
  else stopBackgroundMusic();
}

function saveSettings() {
  settings.masterVolume = clamp($('masterVolume').value, 0, 5);
  settings.effectsVolume = clamp($('effectsVolume').value, 0, 5);
  settings.notificationVolume = clamp($('notificationVolume').value, 0, 5);
  settings.musicVolume = clamp($('musicVolume').value, 0, 5);
  settings.masterEnabled = $('masterSoundToggle').checked;
  settings.effectsEnabled = $('effectsSoundToggle').checked;
  settings.notificationEnabled = $('notificationSoundToggle').checked;
  settings.musicEnabled = $('musicSoundToggle').checked;
  settings.turnPopupEnabled = $('turnPopupToggle').checked;
  localStorage.setItem('dbd_master_volume', settings.masterVolume);
  localStorage.setItem('dbd_effects_volume', settings.effectsVolume);
  localStorage.setItem('dbd_notification_volume', settings.notificationVolume);
  localStorage.setItem('dbd_music_volume', settings.musicVolume);
  localStorage.setItem('dbd_master_enabled', settings.masterEnabled ? 'on' : 'off');
  localStorage.setItem('dbd_effects_enabled', settings.effectsEnabled ? 'on' : 'off');
  localStorage.setItem('dbd_notification_enabled', settings.notificationEnabled ? 'on' : 'off');
  localStorage.setItem('dbd_music_enabled', settings.musicEnabled ? 'on' : 'off');
  localStorage.setItem('dbd_turn_popup_enabled', settings.turnPopupEnabled ? 'on' : 'off');
  updateSettingsUi();
  updateBackgroundMusicState();
}

function updateSettingsUi() {
  $('masterVolume').value = settings.masterVolume;
  $('effectsVolume').value = settings.effectsVolume;
  $('notificationVolume').value = settings.notificationVolume;
  $('musicVolume').value = settings.musicVolume;
  $('masterSoundToggle').checked = settings.masterEnabled;
  $('effectsSoundToggle').checked = settings.effectsEnabled;
  $('notificationSoundToggle').checked = settings.notificationEnabled;
  $('musicSoundToggle').checked = settings.musicEnabled;
  $('turnPopupToggle').checked = settings.turnPopupEnabled;
  $('masterVolumeText').textContent = settings.masterVolume;
  $('effectsVolumeText').textContent = settings.effectsVolume;
  $('notificationVolumeText').textContent = settings.notificationVolume;
  $('musicVolumeText').textContent = settings.musicVolume;
}

function openSettings() {
  markUserInteracted();
  updateSettingsUi();
  $('settingsPopup').classList.remove('hidden');
}
function closeSettings() { $('settingsPopup').classList.add('hidden'); }

function hasFreshRoundResult(nextState) {
  return !!(nextState?.lastRoundScore && (!previousState?.lastRoundScore || previousState.lastRoundScore.id !== nextState.lastRoundScore.id));
}

function notifyTurnIfNeeded(nextState, delayMs = 0) {
  if (!previousState) return;
  const becamePlayable = previousState.waiting && !nextState.waiting && nextState.turn === nextState.you;
  const changedToMe = previousState.turn !== nextState.turn && nextState.turn === nextState.you;
  const activeGame = !nextState.waiting && nextState.winner == null;
  if (!activeGame || hasFreshRoundResult(nextState) || !(becamePlayable || changedToMe)) return;

  clearTimeout(turnNotificationTimer);
  turnNotificationTimer = setTimeout(() => {
    if (!state || state.waiting || state.winner != null || state.turn !== state.you) return;
    if (!$('roundPopup').classList.contains('hidden') || !$('winnerPopup').classList.contains('hidden')) return;
    playNotificationSound();
    toast('ถึงตาคุณแล้ว');
    if (settings.turnPopupEnabled) $('turnPopup').classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  }, delayMs);
}

function notifyActionIfNeeded(nextState) {
  if (!nextState?.lastAction) return;
  if (nextState.lastAction.id === lastActionSoundId) return;
  if (!previousState) {
    lastActionSoundId = nextState.lastAction.id;
    return;
  }
  lastActionSoundId = nextState.lastAction.id;
  playActionSound(nextState.lastAction.type || pendingActionSound || 'takeOne');
  pendingActionSound = null;
  toast(nextState.lastAction.label || 'ทำรายการสำเร็จ');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    $('connectionText').textContent = 'เชื่อมต่อแล้ว';
    if (qs.get('room')) toast('พบรหัสห้องจากลิงก์ เปลี่ยนชื่อก่อนกด “เข้าห้องนี้” ได้');
  };
  ws.onclose = () => {
    if ($('connectionText')) $('connectionText').textContent = 'การเชื่อมต่อหลุด กำลังลองใหม่...';
    toast('การเชื่อมต่อหลุด กำลังเชื่อมต่อใหม่');
    setTimeout(connect, 1200);
  };
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'state') {
      const nextState = msg.state;
      previousState = state;
      const hasNewAction = !!(previousState && nextState?.lastAction && nextState.lastAction.id !== lastActionSoundId);
      state = nextState;
      selectedHand = [];
      selectedMarket = [];
      camelTradeCount = 0;
      render();
      notifyActionIfNeeded(nextState);
      showRoundOrGamePopupIfNeeded(nextState);
      notifyTurnIfNeeded(nextState, hasNewAction ? 350 : 0);
    }
    if (msg.type === 'error') {
      pendingActionSound = null;
      toast(msg.message || 'เกิดข้อผิดพลาด');
    }
  };
}

function send(payload, mark = true) {
  if (mark) markUserInteracted();
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('ยังไม่เชื่อมต่อเซิร์ฟเวอร์');
    return;
  }
  if (payload.type === 'action') pendingActionSound = payload.action?.type || null;
  ws.send(JSON.stringify({ ...payload, clientId, name: playerName(), origin: location.origin }));
}

function createRoom() {
  roundPopupShownFor = null;
  winnerPopupShownFor = null;
  send({ type: 'create' });
}

async function copyInviteLink() {
  if (!state) return toast('ยังไม่มีห้องให้คัดลอก');
  const url = `${location.origin}/?room=${state.room}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('คัดลอกลิงก์เข้าห้องแล้ว');
  } catch {
    prompt('คัดลอกลิงก์นี้ส่งให้เพื่อน', url);
  }
}

function action(a) {
  if ($('roundPopup') && !$('roundPopup').classList.contains('hidden')) return toast('กดเริ่มรอบต่อไปก่อน');
  if ($('winnerPopup') && !$('winnerPopup').classList.contains('hidden')) return toast('เกมจบแล้ว กดเริ่มใหม่ก่อน');
  send({ type: 'action', action: a });
}

function toggle(list, i) {
  const idx = list.indexOf(i);
  idx >= 0 ? list.splice(idx, 1) : list.push(i);
}

function marketSelectionHasOnlyCamels() {
  return selectedMarket.length && selectedMarket.every(i => state.market[i] === 'camel');
}
function selectedMarketHasCamel() {
  return selectedMarket.some(i => state.market[i] === 'camel');
}
function canUseCards() {
  return state && !state.waiting && state.winner == null && state.turn === state.you;
}

function cardElement(cardType, index, where) {
  const g = state.goods[cardType];
  const el = document.createElement('button');
  el.className = `card ${cardType}`;
  el.title = g.name;
  el.dataset.where = where;
  el.dataset.index = String(index);
  const selected = where === 'market' ? selectedMarket.includes(index) : selectedHand.includes(index);
  if (selected) el.classList.add('selected');
  if (!canUseCards()) el.disabled = true;
  const art = document.createElement('span');
  art.className = 'art';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = g.name || cardType;
  img.src = g.image || `/assets/cards/${cardType}.png`;
  img.onerror = () => {
    const fallback = `/assets/cards/${cardType}.png`;
    if (!img.dataset.fallbackTried && img.src !== new URL(fallback, location.origin).href) {
      img.dataset.fallbackTried = '1';
      img.src = fallback;
      return;
    }
    img.onerror = null;
    img.classList.add('broken-card-image');
    img.alt = `${g.name || cardType} image missing`;
  };
  art.appendChild(img);
  el.replaceChildren(art);
  el.onclick = () => {
    if (!canUseCards()) return;
    if (where === 'market') {
      if (cardType === 'camel') {
        playClickSound();
        const camelIdx = state.market.map((c, i) => c === 'camel' ? i : null).filter(i => i != null);
        selectedMarket = selectedMarket.length && selectedMarket.every(i => state.market[i] === 'camel') ? [] : camelIdx;
        selectedHand = [];
        camelTradeCount = 0;
        renderSelectionsOnly();
        return;
      }

      // หยิบสินค้า 1 ใบทันทีเมื่อแตะการ์ดตลาด โดยไม่ต้องกดปุ่มยืนยันซ้ำ
      if (selectedHand.length === 0 && selectedMarket.length === 0 && camelTradeCount === 0) {
        action({ type: 'takeOne', index });
        return;
      }

      playClickSound();
      toggle(selectedMarket, index);
    } else {
      playClickSound();
      toggle(selectedHand, index);
    }
    renderSelectionsOnly();
  };
  return el;
}

function setText(id, text) { $(id).textContent = text; }
function setHtml(id, html) { $(id).innerHTML = html; }

function bonusLabel(summary = {}) {
  const parts = [];
  if (summary['3']) parts.push(`ขาย 3 ใบ x ${summary['3']}`);
  if (summary['4']) parts.push(`ขาย 4 ใบ x ${summary['4']}`);
  if (summary['5']) parts.push(`ขาย 5+ ใบ x ${summary['5']}`);
  return parts.length ? parts.join(' · ') : 'ยังไม่มี';
}

function updateCardSelectionClasses() {
  document.querySelectorAll('#marketCards .card').forEach(el => {
    el.classList.toggle('selected', selectedMarket.includes(Number(el.dataset.index)));
  });
  document.querySelectorAll('#handCards .card').forEach(el => {
    el.classList.toggle('selected', selectedHand.includes(Number(el.dataset.index)));
  });
}
function renderSelectionsOnly() {
  updateCardSelectionClasses();
  updateActionPanel();
}
function renderCards() {
  $('marketCards').innerHTML = '';
  state.market.forEach((c, i) => $('marketCards').appendChild(cardElement(c, i, 'market')));
  $('handCards').innerHTML = '';
  state.yourHand.forEach((c, i) => $('handCards').appendChild(cardElement(c, i, 'hand')));
}

function updateActionPanel() {
  const playable = canUseCards();
  const selectedMarketCount = selectedMarket.length;
  const selectedHandCount = selectedHand.length;
  const takeOneCandidate = playable && selectedMarketCount === 1 && selectedHandCount === 0 && camelTradeCount === 0 && state.market[selectedMarket[0]] !== 'camel';
  const camelAvailable = playable && state.market.includes('camel');
  const tradeCandidate = playable && selectedMarketCount >= 2 && selectedMarketCount === selectedHandCount + camelTradeCount && !marketSelectionHasOnlyCamels() && !selectedMarketHasCamel();

  $('takeOneBtn').disabled = true;
  $('takeOneBtn').title = 'แตะการ์ดสินค้าในตลาดเพื่อหยิบ 1 ใบทันที';
  $('takeCamelsBtn').disabled = !camelAvailable;
  $('takeCamelsBtn').title = camelAvailable ? 'เก็บอูฐทั้งหมดจากตลาด' : 'ยังไม่มีอูฐในตลาด หรือยังไม่ถึงตาคุณ';
  $('tradeBtn').disabled = !tradeCandidate;
  $('tradeBtn').title = tradeCandidate ? 'แลกเปลี่ยนตามการเลือก' : 'เลือกตลาดและของที่จะจ่ายให้จำนวนเท่ากันอย่างน้อย 2 ใบ';
  $('clearBtn').disabled = !selectedMarketCount && !selectedHandCount && !camelTradeCount;
  $('minusCamel').disabled = !playable || camelTradeCount <= 0;
  $('plusCamel').disabled = !playable || camelTradeCount >= (state.players[state.you]?.herd || 0) || marketSelectionHasOnlyCamels();
  $('camelTradeCount').textContent = camelTradeCount;

  let hint = 'แตะการ์ดสินค้าในตลาดเพื่อหยิบทันที หรือเลือกไพ่ในมือก่อนเพื่อแลก';
  if (!playable) hint = state.waiting ? 'รอเพื่อนเข้าห้องก่อน' : state.winner != null ? 'เกมจบแล้ว' : 'ยังไม่ถึงตาคุณ';
  else if (marketSelectionHasOnlyCamels()) hint = 'เลือกอูฐแล้ว ให้กด “เก็บอูฐทั้งหมดในตลาด”';
  else if (takeOneCandidate) hint = 'แตะการ์ดสินค้าในตลาดเพื่อหยิบ 1 ใบทันที';
  else if (tradeCandidate) hint = 'พร้อมแลกเปลี่ยน';
  else if (selectedMarketCount || selectedHandCount || camelTradeCount) hint = `เลือกตลาด ${selectedMarketCount} ใบ / จ่ายไพ่ ${selectedHandCount} ใบ + อูฐ ${camelTradeCount} ใบ`;
  $('selectionHint').textContent = hint;
}

function tokenPriceClass(key, price) {
  if (!price) return 'price-empty';
  const maxPrice = { diamond: 7, gold: 6, silver: 5, cloth: 5, spice: 5, leather: 4 }[key] || price;
  if (price <= 1) return 'price-low';
  if (price < maxPrice) return 'price-mid';
  return 'price-high';
}

function roundDetailsHtml(result) {
  if (!result) return '';
  return result.details.map((d, i) => {
    const bonuses = d.bonusTokens.length
      ? d.bonusTokens.map(b => `<li>โบนัสขาย ${b.tier === '5' ? '5+' : b.tier} ใบ = ${b.value} แต้ม</li>`).join('')
      : '<li>ไม่มี bonus token</li>';
    return `<div class="score-detail-card"><h4>P${i + 1}: ${escapeHtml(d.name)}</h4><ul><li>คะแนนสินค้า = ${d.goodsScore}</li><li>คะแนนโบนัสขายหลายใบ = ${d.bonusScore}</li>${bonuses}<li>โบนัสอูฐ = ${d.camelBonus}</li><li><b>รวม = ${d.total}</b></li></ul></div>`;
  }).join('') + `<p class="muted"><b>เหตุผล:</b> ${escapeHtml(result.reason)}</p>`;
}

function showRoundOrGamePopupIfNeeded(s) {
  const r = s.lastRoundScore;
  if (!r) return;
  if (r.gameOver) {
    if (winnerPopupShownFor === r.id) return;
    winnerPopupShownFor = r.id;
    showWinnerPopup(s, r);
    playWinnerSound();
  } else {
    if (roundPopupShownFor === r.id) return;
    roundPopupShownFor = r.id;
    showRoundPopup(s, r);
    if (r.win === s.you) playEffect('roundWin');
  }
}

function showRoundPopup(s, r) {
  const myWin = r.win === s.you;
  const title = r.tie ? '🤝 รอบนี้เสมอ' : myWin ? '🎉 คุณชนะรอบนี้' : '😵 คุณแพ้รอบนี้';
  $('roundTitle').textContent = title;
  $('roundScoreText').textContent = `คะแนนรอบที่ ${r.round}: P1 ${r.totals[0]} - ${r.totals[1]} P2`;
  $('roundDetailText').textContent = r.tie ? 'ไม่มีผู้เล่นได้รับตราชัย' : `ผู้ชนะรอบ: P${r.win + 1}`;
  $('roundDetailsBody').innerHTML = roundDetailsHtml(r);
  $('roundDetails').open = false;
  $('roundPopup').classList.remove('hidden');
}

function showWinnerPopup(s, r) {
  const iWon = r.finalWinner === s.you;
  $('winnerIcon').textContent = iWon ? '🏆' : '🏳️';
  $('winnerTitle').textContent = iWon ? 'ยินดีด้วยคุณคือผู้ชนะ' : 'คุณเป็นฝ่ายพ่ายแพ้';
  $('winnerTitle').classList.toggle('win-text', iWon);
  $('winnerTitle').classList.toggle('lose-text', !iWon);
  $('winnerDetail').textContent = `ผู้ชนะเกม: P${r.finalWinner + 1} ${s.players[r.finalWinner].name}`;
  $('winnerScoreText').textContent = `ตราชัยสุดท้าย P1 ${r.seal[0]} - ${r.seal[1]} P2`;
  $('winnerRoundScoreText').textContent = `คะแนนรอบสุดท้าย: P1 ${r.totals[0]} - ${r.totals[1]} P2`;
  $('winnerDetailsBody').innerHTML = roundDetailsHtml(r);
  $('winnerDetails').open = false;
  $('winnerPopup').classList.remove('hidden');
}

function render() {
  if (!state) return;
  if (currentView !== 'guide') setScreen('game');
  updateBackgroundMusicState();

  setText('roomCode', state.room);
  setText('round', state.round);
  setText('deckCount', state.deck);

  const status = state.winner != null
    ? `🏆 เกมจบแล้ว ผู้ชนะคือ ${state.players[state.winner].name}`
    : state.waiting
      ? `ส่งลิงก์หรือรหัสห้อง ${state.room} ให้เพื่อนเข้ามาเล่น`
      : state.turn === state.you
        ? 'ถึงตาคุณแล้ว'
        : `รอ ${state.players[state.turn].name} เล่น`;
  $('statusBar').textContent = status;
  $('statusBar').classList.toggle('my-turn', !state.waiting && state.winner == null && state.turn === state.you);

  $('playersBox').innerHTML = '';
  state.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `player-card glass ${state.turn === i && !state.waiting && state.winner == null ? 'active' : ''}`;
    el.innerHTML = `
      <div class="player-head"><b>${i === state.you ? `คุณ (${escapeHtml(p.name)})` : escapeHtml(p.name)}</b><span>${p.connected ? 'ออนไลน์' : 'ออฟไลน์'}</span></div>
      <div class="seal">${'🏵️'.repeat(p.seals)}${p.seals === 0 ? 'ยังไม่มีตราชัย' : ''}</div>
      <div class="mini-grid"><span>สินค้า</span><b>${p.score}</b><span>โบนัสลับ</span><b>${p.bonusCount || 0}</b><span>มือ</span><b>${p.handCount}/7</b><span>อูฐ</span><b>${p.herd}</b></div>
      <p class="secret-bonus">${escapeHtml(bonusLabel(p.bonusSummary))}</p>
    `;
    $('playersBox').appendChild(el);
  });

  $('tokenStacks').innerHTML = '';
  Object.entries(state.tokens).forEach(([key, stack]) => {
    const g = state.goods[key];
    const price = stack[0] || 0;
    const el = document.createElement('div');
    el.className = `token-stack ${tokenPriceClass(key, price)}`;
    el.innerHTML = `<span>${escapeHtml(g.emoji)} ${escapeHtml(g.name)}</span><b class="token-price">${price}</b><small>${stack.length} เหรียญ</small>`;
    $('tokenStacks').appendChild(el);
  });

  renderCards();
  $('handCountText').textContent = `${state.yourHand.length}/7`;
  $('herdBox').innerHTML = `<b>ฝูงอูฐของคุณ</b><span>${'🐪'.repeat(Math.min(state.players[state.you].herd, 10))}</span><b>× ${state.players[state.you].herd}</b>`;

  $('sellBox').innerHTML = '';
  [...new Set(state.yourHand)].forEach(c => {
    const count = state.yourHand.filter(x => x === c).length;
    const g = state.goods[c];
    const row = document.createElement('div');
    row.className = 'sell-row';
    const min = g.premium ? 2 : 1;
    const disabled = !canUseCards() || count < min;
    const bonusHint = count >= 5 ? 'จะได้รับโบนัสลับ 1 เหรียญถ้าขาย 5+ ใบ' : count >= 4 ? 'จะได้รับโบนัสลับ 1 เหรียญถ้าขาย 4 ใบ' : count >= 3 ? 'จะได้รับโบนัสลับ 1 เหรียญถ้าขาย 3 ใบ' : '';
    row.innerHTML = `
      <span>${escapeHtml(g.emoji)} ${escapeHtml(g.name)} <small>${count < min ? `ต้องมีอย่างน้อย ${min}` : `มี ${count}${bonusHint ? ' · ' + bonusHint : ''}`}</small></span>
      <input type="number" min="${min}" max="${count}" value="${count}" ${disabled ? 'disabled' : ''}>
      <button class="primary mini" ${disabled ? 'disabled' : ''} title="${disabled ? 'จำนวนไม่พอหรือยังไม่ถึงตาคุณ' : 'ขายสินค้า'}">ขาย</button>
    `;
    row.querySelector('button').onclick = () => action({ type: 'sell', card: c, count: Number(row.querySelector('input').value) });
    $('sellBox').appendChild(row);
  });
  if (!$('sellBox').children.length) setHtml('sellBox', '<p class="muted">ยังไม่มีสินค้าที่ขายได้</p>');

  $('logBox').innerHTML = '';
  state.log.forEach(x => {
    const div = document.createElement('div');
    div.textContent = `• ${x}`;
    $('logBox').appendChild(div);
  });
  updateActionPanel();
}

$('createBtn').onclick = createRoom;
$('joinBtn').onclick = () => {
  const room = $('roomInput').value.trim().toUpperCase();
  if (!room) return toast('กรุณาใส่รหัสห้อง');
  send({ type: 'join', room });
};
$('roomInput').addEventListener('input', e => {
  const cursor = e.target.selectionStart;
  const next = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (e.target.value !== next) {
    e.target.value = next;
    try { e.target.setSelectionRange(cursor, cursor); } catch {}
  }
});
$('restartBtn').onclick = () => {
  if (confirm('เริ่มเกมใหม่ตั้งแต่รอบแรกใช่ไหม?')) {
    roundPopupShownFor = null;
    winnerPopupShownFor = null;
    send({ type: 'restart' });
  }
};
$('copyInviteBtn').onclick = copyInviteLink;
$('settingsBtn').onclick = openSettings;
$('settingsBtnLobby').onclick = openSettings;
$('closeSettingsBtn').onclick = closeSettings;
$('settingsBackGameBtn').onclick = closeSettings;
$('settingsCopyInviteBtn').onclick = copyInviteLink;
$('settingsHomeBtn').onclick = goHome;
$('masterVolume').oninput = saveSettings;
$('effectsVolume').oninput = saveSettings;
$('notificationVolume').oninput = saveSettings;
$('musicVolume').oninput = saveSettings;
$('masterSoundToggle').onchange = saveSettings;
$('effectsSoundToggle').onchange = saveSettings;
$('notificationSoundToggle').onchange = saveSettings;
$('musicSoundToggle').onchange = saveSettings;
$('turnPopupToggle').onchange = saveSettings;
$('testNotificationBtn').onclick = () => { markUserInteracted(); playNotificationSound(); };
$('guideBtnLobby').onclick = showGuide;
$('guideBtnGame').onclick = showGuide;
$('backFromGuideBtn').onclick = returnFromGuide;
$('homeFromGuideBtn').onclick = goHome;
$('homeBtn').onclick = goHome;
$('closeTurnPopupBtn').onclick = () => $('turnPopup').classList.add('hidden');
$('turnPopup').onclick = e => { if (e.target.id === 'turnPopup') $('turnPopup').classList.add('hidden'); };
$('roundNextBtn').onclick = () => $('roundPopup').classList.add('hidden');
$('winnerRestartBtn').onclick = () => {
  $('winnerPopup').classList.add('hidden');
  roundPopupShownFor = null;
  winnerPopupShownFor = null;
  send({ type: 'restart' });
};
$('winnerNewRoomBtn').onclick = () => {
  $('winnerPopup').classList.add('hidden');
  createRoom();
};
$('settingsPopup').onclick = e => { if (e.target.id === 'settingsPopup') closeSettings(); };
$('roundPopup').onclick = e => { if (e.target.id === 'roundPopup') $('roundPopup').classList.add('hidden'); };
$('takeOneBtn').onclick = () => {
  if (selectedMarket.length !== 1) return toast('เลือกสินค้าจากตลาด 1 ใบก่อน');
  action({ type: 'takeOne', index: selectedMarket[0] });
};
$('takeCamelsBtn').onclick = () => action({ type: 'takeCamels' });
$('clearBtn').onclick = () => {
  selectedHand = [];
  selectedMarket = [];
  camelTradeCount = 0;
  playClickSound();
  renderSelectionsOnly();
};
$('plusCamel').onclick = () => {
  if (!canUseCards()) return;
  const max = state?.players[state.you].herd || 0;
  if (camelTradeCount < max) camelTradeCount++;
  playClickSound();
  updateActionPanel();
};
$('minusCamel').onclick = () => {
  if (!canUseCards()) return;
  camelTradeCount = Math.max(0, camelTradeCount - 1);
  playClickSound();
  updateActionPanel();
};
$('tradeBtn').onclick = () => action({ type: 'trade', handIdx: selectedHand, takeIdx: selectedMarket, camelCount: camelTradeCount });

updateSettingsUi();
connect();
