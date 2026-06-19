const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
  extensions: ['html'],
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    const normalized = filePath.split(path.sep).join('/');
    if (normalized.includes('/public/assets/cards/') || normalized.includes('/public/assets/audio/effects/')) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const rooms = new Map();

const DISCONNECT_GRACE_MS = 1000 * 60 * 12;
const ROOM_TTL_MS = 1000 * 60 * 60 * 6;

const goods = {
  diamond: { name: 'เพชรฟ้า', emoji: '💎', image: '/assets/cards/diamond.webp', premium: true },
  gold: { name: 'ทองสุริยัน', emoji: '🏵️', image: '/assets/cards/gold.webp', premium: true },
  silver: { name: 'เงินจันทรา', emoji: '⚪', image: '/assets/cards/silver.webp', premium: true },
  cloth: { name: 'ผ้าไหม', emoji: '🧵', image: '/assets/cards/cloth.webp', premium: false },
  spice: { name: 'เครื่องเทศ', emoji: '🌶️', image: '/assets/cards/spice.webp', premium: false },
  leather: { name: 'เครื่องหนัง', emoji: '🟤', image: '/assets/cards/leather.webp', premium: false },
  camel: { name: 'อูฐ', emoji: '🐪', image: '/assets/cards/camel.webp', premium: false }
};

const counts = { diamond: 6, gold: 6, silver: 6, cloth: 8, spice: 8, leather: 10, camel: 11 };
const tokenVals = {
  diamond: [7, 7, 5, 5, 5],
  gold: [6, 6, 5, 5, 5],
  silver: [5, 5, 5, 5, 5],
  cloth: [5, 3, 3, 2, 2, 1, 1],
  spice: [5, 3, 3, 2, 2, 1, 1],
  leather: [4, 3, 2, 1, 1, 1, 1, 1, 1]
};
const bonusTokenVals = {
  3: [1, 1, 2, 2, 2, 3, 3],
  4: [4, 4, 5, 5, 6, 6],
  5: [8, 8, 9, 10, 10]
};
const goodsKeys = Object.keys(goods);
const sellableKeys = goodsKeys.filter(k => k !== 'camel');

function roomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function makeRoomId() {
  let id = roomId();
  while (rooms.has(id)) id = roomId();
  return id;
}

function safeName(name, fallback = 'ผู้เล่น') {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 18);
  return cleaned || fallback;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cloneStacks(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, [...v]]));
}

function freshTokens() {
  return cloneStacks(tokenVals);
}

function freshBonusStacks() {
  return Object.fromEntries(Object.entries(bonusTokenVals).map(([tier, stack]) => [tier, shuffle([...stack])]));
}

function draw(deck) {
  return deck.length ? deck.pop() : null;
}

function makePlayer() {
  return { hand: [], herd: 0, score: 0, tokensTaken: [], bonusTokens: [] };
}

function bonusTier(n) {
  if (n === 3) return '3';
  if (n === 4) return '4';
  if (n >= 5) return '5';
  return null;
}

function summarizeBonus(tokens = []) {
  return tokens.reduce((acc, t) => {
    const tier = String(t.tier);
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, { 3: 0, 4: 0, 5: 0 });
}

function startRound(seal = [0, 0], round = 1, roundResult = null, startingPlayer = 0) {
  const deck = [];
  Object.entries(counts).forEach(([k, n]) => {
    for (let i = 0; i < n; i++) deck.push(k);
  });
  shuffle(deck);

  const market = [];
  while (market.length < 5 && deck.length) market.push(draw(deck));

  const players = [makePlayer(), makePlayer()];
  for (const p of players) {
    for (let i = 0; i < 5; i++) {
      const c = draw(deck);
      if (!c) break;
      if (c === 'camel') p.herd++;
      else p.hand.push(c);
    }
  }

  const g = {
    deck,
    market,
    players,
    turn: [0, 1].includes(startingPlayer) ? startingPlayer : 0,
    tokens: freshTokens(),
    bonusStacks: freshBonusStacks(),
    round,
    log: [`เริ่มรอบที่ ${round} — สุ่มไพ่และกองโบนัสใหม่แล้ว`],
    winner: null,
    seal: [...seal],
    lastRoundScore: roundResult,
    lastAction: null,
    eventSeq: 0
  };
  validateGameState(g);
  return g;
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function refill(g) {
  while (g.market.length < 5 && g.deck.length) {
    const c = draw(g.deck);
    if (!c) break;
    g.market.push(c);
  }
}

function validateGameState(g) {
  if (!g || !Array.isArray(g.players) || g.players.length !== 2) throw new Error('Invalid game state: players');
  if (!Array.isArray(g.deck) || g.deck.length < 0) throw new Error('Invalid game state: deck');
  if (!Array.isArray(g.market) || g.market.length > 5) throw new Error('Invalid game state: market');
  if (![0, 1].includes(g.turn)) throw new Error('Invalid game state: turn');
  for (const c of [...g.deck, ...g.market]) {
    if (!goods[c]) throw new Error(`Invalid card in state: ${c}`);
  }
  for (const p of g.players) {
    if (!Array.isArray(p.hand) || p.hand.length > 7) throw new Error('Invalid game state: hand');
    if (!Number.isInteger(p.herd) || p.herd < 0) throw new Error('Invalid game state: herd');
    for (const c of p.hand) if (!goods[c] || c === 'camel') throw new Error(`Invalid hand card: ${c}`);
  }
  for (const key of sellableKeys) {
    if (!Array.isArray(g.tokens[key]) || g.tokens[key].length < 0) throw new Error(`Invalid token stack: ${key}`);
  }
  return true;
}

function camelBonusWinner(g) {
  if (g.players[0].herd === g.players[1].herd) return null;
  return g.players[0].herd > g.players[1].herd ? 0 : 1;
}

function roundDetails(g, room) {
  const camelWin = camelBonusWinner(g);
  return g.players.map((p, i) => {
    const bonusScore = p.bonusTokens.reduce((sum, b) => sum + b.value, 0);
    const camelBonus = camelWin === i ? 5 : 0;
    const total = p.score + bonusScore + camelBonus;
    return {
      name: safeName(room.players[i]?.name, `P${i + 1}`),
      goodsScore: p.score,
      bonusScore,
      bonusTokens: p.bonusTokens.map(b => ({ tier: String(b.tier), value: b.value })),
      camelBonus,
      total,
      bonusTokenCount: p.bonusTokens.length,
      goodsTokenCount: p.tokensTaken.length,
      herd: p.herd
    };
  });
}

function decideRoundWinner(details) {
  if (details[0].total !== details[1].total) {
    const win = details[0].total > details[1].total ? 0 : 1;
    return { win, reason: `คะแนนรวมมากกว่า (${details[win].total} แต้ม)` };
  }
  if (details[0].bonusTokenCount !== details[1].bonusTokenCount) {
    const win = details[0].bonusTokenCount > details[1].bonusTokenCount ? 0 : 1;
    return { win, reason: `คะแนนเท่ากัน แต่มี bonus token มากกว่า` };
  }
  if (details[0].goodsTokenCount !== details[1].goodsTokenCount) {
    const win = details[0].goodsTokenCount > details[1].goodsTokenCount ? 0 : 1;
    return { win, reason: `คะแนนและ bonus token เท่ากัน แต่มี goods token มากกว่า` };
  }
  return { win: null, reason: 'คะแนนรวม จำนวน bonus token และจำนวน goods token เท่ากัน จึงถือว่าเสมอ' };
}

function endRound(room) {
  const g = room.game;
  const details = roundDetails(g, room);
  const result = decideRoundWinner(details);
  const newSeal = [...g.seal];
  if (result.win != null) newSeal[result.win]++;
  const gameOver = result.win != null && newSeal[result.win] >= 2;
  const summary = {
    id: `${room.id}-${g.round}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    round: g.round,
    totals: [details[0].total, details[1].total],
    details,
    win: result.win,
    tie: result.win == null,
    reason: result.reason,
    seal: newSeal,
    gameOver,
    finalWinner: gameOver ? result.win : null
  };

  if (result.win == null) {
    g.log.push(`จบรอบที่ ${g.round}: เสมอ ${summary.totals[0]} - ${summary.totals[1]} | ไม่มีผู้เล่นได้รับตราชัย`);
  } else if (gameOver) {
    g.seal = newSeal;
    g.lastRoundScore = summary;
    g.winner = result.win;
    g.log.push(`จบรอบที่ ${g.round}: P1 ${summary.totals[0]} - P2 ${summary.totals[1]} | ผู้ชนะเกมคือ P${result.win + 1}`);
    validateGameState(g);
    return;
  } else {
    g.log.push(`จบรอบที่ ${g.round}: P1 ${summary.totals[0]} - P2 ${summary.totals[1]} | P${result.win + 1} ได้ตราชัย`);
  }

  const nextStarter = result.win == null ? 0 : 1 - result.win;
  const next = startRound(newSeal, g.round + 1, summary, nextStarter);
  next.log.unshift(result.win == null
    ? `รอบก่อนหน้าเสมอ ${summary.totals[0]} - ${summary.totals[1]} | ไม่มีผู้เล่นได้รับตราชัย`
    : `รอบก่อนหน้า: P1 ${summary.totals[0]} - P2 ${summary.totals[1]} | P${result.win + 1} ได้ตราชัย — รอบนี้ P${nextStarter + 1} ผู้แพ้รอบก่อนจะเริ่มก่อน`);
  Object.assign(g, next);
}

function checkEnd(room) {
  const g = room.game;
  refill(g);
  const emptyStacks = Object.values(g.tokens).filter(stack => stack.length === 0).length;
  const marketCannotRefill = g.market.length < 5 && g.deck.length === 0;
  if (emptyStacks >= 3 || g.deck.length === 0 || marketCannotRefill) {
    endRound(room);
    return true;
  }
  return false;
}

function publicState(room, pi) {
  const g = room.game;
  return {
    room: room.id,
    you: pi,
    yourName: room.players[pi]?.name || `P${pi + 1}`,
    shareUrl: room.publicUrl || null,
    players: g.players.map((p, i) => ({
      name: room.players[i]?.name || `P${i + 1}`,
      connected: Boolean(room.players[i]?.connected),
      joined: Boolean(room.players[i]),
      handCount: p.hand.length,
      herd: p.herd,
      score: p.score,
      bonusCount: p.bonusTokens.length,
      bonusSummary: summarizeBonus(p.bonusTokens),
      seals: g.seal[i]
    })),
    yourHand: g.players[pi]?.hand || [],
    market: g.market,
    turn: g.turn,
    deck: g.deck.length,
    tokens: g.tokens,
    bonusStacksCount: Object.fromEntries(Object.entries(g.bonusStacks).map(([k, v]) => [k, v.length])),
    round: g.round,
    log: g.log.slice(-12),
    winner: g.winner,
    lastRoundScore: g.lastRoundScore,
    lastAction: g.lastAction,
    goods,
    waiting: connectedCount(room) < 2
  };
}

function broadcastRoom(room) {
  room.players.forEach((player, i) => {
    if (player?.ws) send(player.ws, { type: 'state', state: publicState(room, i) });
  });
}

function getRoomOrThrow(id) {
  const room = rooms.get(String(id || '').trim().toUpperCase());
  if (!room) throw new Error('ไม่พบห้องนี้ กรุณาตรวจรหัสห้องอีกครั้ง');
  return room;
}

function findPlayerSlot(room, clientId) {
  return room.players.findIndex(p => p && p.clientId === clientId);
}

function connectedCount(room) {
  return room.players.filter(p => p && p.connected).length;
}

function occupiedCount(room) {
  return room.players.filter(Boolean).length;
}

function reusableSlot(room) {
  const now = Date.now();
  // Always check the two valid seats explicitly. Array.findIndex() would miss seat #2
  // when the array length is still 1 after room creation. That caused invite joins
  // to incorrectly report "room full" even though P2 was empty.
  for (let i = 0; i < 2; i++) {
    if (!room.players[i]) return i;
  }

  // If everyone left the room, let the next visitor reclaim P1 immediately instead
  // of keeping a dead room locked until the disconnect grace period expires.
  if (connectedCount(room) === 0) return 0;

  // If a disconnected player has been away long enough, free that seat.
  for (let i = 0; i < 2; i++) {
    const p = room.players[i];
    if (p && !p.connected && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS) return i;
  }
  return -1;
}

function setLastAction(g, type, label) {
  g.eventSeq = (g.eventSeq || 0) + 1;
  g.lastAction = { id: g.eventSeq, type, label };
}

function uniqueSortedNumbers(list, desc = true) {
  const nums = [...new Set([...(list || [])].map(Number))]
    .filter(n => Number.isInteger(n));
  nums.sort(desc ? (a, b) => b - a : (a, b) => a - b);
  return nums;
}

function action(room, pi, a) {
  const g = room.game;
  if (g.winner != null) throw new Error('เกมนี้จบแล้ว กดเริ่มเกมใหม่เพื่อเล่นต่อ');
  if (connectedCount(room) < 2) throw new Error('รอเพื่อนเข้าห้องก่อน');
  if (pi !== g.turn) throw new Error('ยังไม่ถึงตาคุณ');

  const p = g.players[pi];
  let ended = false;

  if (a.type === 'takeOne') {
    const idx = Number(a.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= g.market.length) throw new Error('เลือกการ์ดตลาดไม่ถูกต้อง');
    const c = g.market[idx];
    if (c === 'camel') throw new Error('ถ้าจะเอาอูฐ ให้กดปุ่มเก็บอูฐทั้งหมด');
    if (p.hand.length >= 7) throw new Error('ไพ่สินค้าในมือเต็ม 7 ใบแล้ว');
    p.hand.push(c);
    g.market.splice(idx, 1);
    refill(g);
    const label = `${safeName(room.players[pi].name)} หยิบสินค้า 1 ใบ`;
    g.log.push(label);
    setLastAction(g, 'takeOne', label);
    ended = checkEnd(room);
  }

  else if (a.type === 'takeCamels') {
    const n = g.market.filter(c => c === 'camel').length;
    if (!n) throw new Error('ตอนนี้ไม่มีอูฐในตลาด');
    g.market = g.market.filter(c => c !== 'camel');
    p.herd += n;
    refill(g);
    const label = `${safeName(room.players[pi].name)} เก็บอูฐ ${n} ใบ`;
    g.log.push(label);
    setLastAction(g, 'takeCamels', label);
    ended = checkEnd(room);
  }

  else if (a.type === 'trade') {
    const handIdx = uniqueSortedNumbers(a.handIdx, true);
    const takeIdx = uniqueSortedNumbers(a.takeIdx, true);
    const camelCount = Number(a.camelCount || 0);
    if (!Number.isInteger(camelCount) || camelCount < 0) throw new Error('จำนวนอูฐที่ใช้แลกไม่ถูกต้อง');
    const giveCount = handIdx.length + camelCount;
    if (giveCount !== takeIdx.length || giveCount < 2) throw new Error('การแลกต้องให้และรับจำนวนเท่ากัน อย่างน้อย 2 ใบ');
    if (camelCount > p.herd) throw new Error('อูฐของคุณไม่พอสำหรับแลก');

    const nextHand = [...p.hand];
    const nextMarket = [...g.market];
    const give = [];
    for (const idx of handIdx) {
      if (idx < 0 || idx >= nextHand.length) throw new Error('เลือกไพ่ในมือไม่ถูกต้อง');
      give.push(nextHand.splice(idx, 1)[0]);
    }
    for (const idx of takeIdx) {
      if (idx < 0 || idx >= g.market.length) throw new Error('เลือกไพ่ตลาดไม่ถูกต้อง');
    }
    const taking = takeIdx.map(idx => g.market[idx]);
    let nextHerd = p.herd - camelCount;
    for (let i = 0; i < camelCount; i++) give.push('camel');

    // Remove selected market cards only after all validation above has passed.
    for (const idx of takeIdx) nextMarket.splice(idx, 1);
    for (const c of taking) {
      if (c === 'camel') nextHerd++;
      else nextHand.push(c);
    }
    if (nextHand.length > 7) throw new Error('หลังแลกแล้ว ไพ่สินค้าในมือจะเกิน 7 ใบ');
    if (nextHerd < 0) throw new Error('อูฐของคุณไม่พอสำหรับแลก');
    nextMarket.push(...give);
    if (nextMarket.length !== 5) throw new Error('จำนวนไพ่ตลาดหลังแลกผิดปกติ');

    p.hand = nextHand;
    p.herd = nextHerd;
    g.market = nextMarket;
    const label = `${safeName(room.players[pi].name)} แลก ${give.length} ใบสำเร็จ`;
    g.log.push(label);
    setLastAction(g, 'trade', label);
    ended = checkEnd(room);
  }

  else if (a.type === 'sell') {
    const c = String(a.card || '');
    const n = Number(a.count || 0);
    if (!goods[c] || c === 'camel' || !Number.isInteger(n) || n < 1) throw new Error('ขายการ์ดนี้ไม่ได้');
    const have = p.hand.filter(x => x === c).length;
    if (have < n) throw new Error('คุณมีไพ่ชนิดนี้ไม่พอ');
    if (goods[c].premium && n < 2) throw new Error('สินค้าราคาแพงต้องขายอย่างน้อย 2 ใบ');

    for (let i = 0; i < n; i++) p.hand.splice(p.hand.indexOf(c), 1);
    let earned = 0;
    for (let i = 0; i < n; i++) {
      const val = g.tokens[c].shift() || 0;
      earned += val;
      if (val) p.tokensTaken.push({ c, val });
    }
    p.score += earned;
    const tier = bonusTier(n);
    let gotBonus = false;
    if (tier && g.bonusStacks[tier] && g.bonusStacks[tier].length) {
      const value = g.bonusStacks[tier].shift();
      p.bonusTokens.push({ tier, value });
      gotBonus = true;
    }
    const label = gotBonus
      ? `${safeName(room.players[pi].name)} ขาย ${goods[c].name} ${n} ใบ ได้ ${earned} แต้ม และได้รับโบนัสลับ 1 เหรียญ`
      : `${safeName(room.players[pi].name)} ขาย ${goods[c].name} ${n} ใบ ได้ ${earned} แต้ม`;
    g.log.push(label);
    setLastAction(g, 'sell', label);
    ended = checkEnd(room);
  }

  else {
    throw new Error('ไม่รู้จักคำสั่งนี้');
  }

  validateGameState(g);
  if (!ended && g.winner == null) g.turn = 1 - g.turn;
}

wss.on('connection', ws => {
  let room = null;
  let pi = null;

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      const clientId = String(msg.clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const name = safeName(msg.name, 'ผู้เล่น');

      if (msg.type === 'create') {
        const id = makeRoomId();
        room = { id, players: [null, null], game: startRound(), createdAt: Date.now(), publicUrl: null };
        rooms.set(id, room);
        pi = 0;
        room.players[0] = { ws, clientId, name, connected: true, disconnectedAt: null };
        room.publicUrl = msg.origin ? `${String(msg.origin).replace(/\/$/, '')}/?room=${id}` : null;
        send(ws, { type: 'state', state: publicState(room, pi) });
      }

      else if (msg.type === 'join') {
        room = getRoomOrThrow(msg.room);
        const existing = findPlayerSlot(room, clientId);
        if (existing >= 0) {
          pi = existing;
          const oldWs = room.players[pi]?.ws;
          if (oldWs && oldWs !== ws && oldWs.readyState === WebSocket.OPEN) {
            try { oldWs.close(4000, 'Reconnected from another tab/device'); } catch {}
          }
          room.players[pi] = { ...room.players[pi], ws, name: safeName(name, `P${pi + 1}`), connected: true, disconnectedAt: null };
          room.game.log.push(`${room.players[pi].name} reconnect สำเร็จ`);
        } else {
          const slot = reusableSlot(room);
          if (slot < 0) throw new Error('ห้องเต็มแล้ว: มีผู้เล่นออนไลน์ครบ 2 คนแล้ว');
          pi = slot;
          room.players[pi] = { ws, clientId, name: safeName(name, `P${pi + 1}`), connected: true, disconnectedAt: null };
          room.game.log.push(`${room.players[pi].name} เข้าห้องแล้ว`);
        }
        broadcastRoom(room);
      }

      else if (msg.type === 'leave') {
        if (room && pi != null && room.players[pi] && room.players[pi].ws === ws) {
          room.players[pi].connected = false;
          room.players[pi].disconnectedAt = Date.now();
          room.players[pi].ws = null;
          broadcastRoom(room);
          room = null;
          pi = null;
        }
      }

      else if (msg.type === 'restart') {
        if (!room || pi == null) throw new Error('ยังไม่ได้อยู่ในห้อง');
        room.game = startRound([0, 0], 1);
        room.game.log.push(`${safeName(room.players[pi].name)} เริ่มเกมใหม่`);
        broadcastRoom(room);
      }

      else if (msg.type === 'action') {
        if (!room || pi == null) throw new Error('ยังไม่ได้อยู่ในห้อง');
        action(room, pi, msg.action || {});
        broadcastRoom(room);
      }
    } catch (e) {
      send(ws, { type: 'error', message: e.message || 'เกิดข้อผิดพลาด' });
    }
  });

  ws.on('close', () => {
    if (room && pi != null && room.players[pi] && room.players[pi].ws === ws) {
      room.players[pi].connected = false;
      room.players[pi].disconnectedAt = Date.now();
      room.players[pi].ws = null;
      broadcastRoom(room);
    }
  });
});

function cleanupRooms() {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    room.players.forEach((p, i) => {
      if (p && !p.connected && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS) {
        room.players[i] = null;
      }
    });
    const noOneConnected = room.players.every(p => !p || !p.connected);
    if (noOneConnected && now - room.createdAt > ROOM_TTL_MS) rooms.delete(id);
  }
}

function startServer() {
  setInterval(cleanupRooms, 1000 * 60 * 3);
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Desert Bazaar Duel is running on port ${port}`);
  });
}

if (require.main === module) startServer();

module.exports = {
  app,
  server,
  rooms,
  goods,
  startRound,
  action,
  validateGameState,
  publicState,
  decideRoundWinner,
  summarizeBonus,
  safeName,
  cleanupRooms,
  __test: { tokenVals, bonusTokenVals, freshBonusStacks, roundDetails, endRound }
};
