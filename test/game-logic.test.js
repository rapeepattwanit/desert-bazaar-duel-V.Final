const test = require('node:test');
const assert = require('node:assert/strict');
const { startRound, action, publicState, decideRoundWinner, validateGameState } = require('../server');

function roomWithGame(game = startRound()) {
  return {
    id: 'TEST1',
    publicUrl: null,
    players: [
      { name: 'P1', clientId: 'a', connected: true },
      { name: 'P2', clientId: 'b', connected: true }
    ],
    game
  };
}

test('premium goods require at least 2 cards to sell', () => {
  const g = startRound();
  const room = roomWithGame(g);
  g.players[0].hand = ['diamond'];
  g.turn = 0;
  assert.throws(() => action(room, 0, { type: 'sell', card: 'diamond', count: 1 }), /อย่างน้อย 2/);
  assert.deepEqual(g.players[0].hand, ['diamond']);
});

test('invalid trade does not mutate state', () => {
  const g = startRound();
  const room = roomWithGame(g);
  g.market = ['diamond', 'gold', 'silver', 'cloth', 'spice'];
  g.players[0].hand = ['leather'];
  g.players[0].herd = 0;
  g.turn = 0;
  const before = JSON.stringify(g);
  assert.throws(() => action(room, 0, { type: 'trade', handIdx: [0], takeIdx: [0, 1], camelCount: 0 }), /เท่ากัน/);
  assert.equal(JSON.stringify(g), before);
});

test('bonus token values are hidden in public state during round', () => {
  const g = startRound();
  const room = roomWithGame(g);
  g.players[0].bonusTokens = [{ tier: '3', value: 3 }];
  const state = publicState(room, 0);
  assert.equal(state.players[0].bonusCount, 1);
  assert.deepEqual(state.players[0].bonusSummary, { 3: 1, 4: 0, 5: 0 });
  assert.equal(JSON.stringify(state).includes('"value":3'), false);
});

test('tie breaker returns tie when total, bonus token count, and goods token count are equal', () => {
  const result = decideRoundWinner([
    { total: 10, bonusTokenCount: 1, goodsTokenCount: 3 },
    { total: 10, bonusTokenCount: 1, goodsTokenCount: 3 }
  ]);
  assert.equal(result.win, null);
});

test('validateGameState catches oversized hand', () => {
  const g = startRound();
  g.players[0].hand = ['leather','leather','leather','leather','leather','leather','leather','leather'];
  assert.throws(() => validateGameState(g), /hand/);
});
