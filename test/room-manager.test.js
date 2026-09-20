import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/room-manager.js';

function setup() {
  let clock = 1000;
  const manager = new RoomManager({ countdownMs: 5, now: () => clock });
  const auth = manager.createRoom();
  const alex = manager.joinPlayer(auth.code, 'Alex');
  const max = manager.joinPlayer(auth.code, 'Max');
  return { manager, auth, alex, max, setClock: (value) => { clock = value; } };
}

test('server orders presses using receive time and rejects duplicates', async () => {
  const { manager, auth, alex, max, setClock } = setup();
  manager.startRound(auth.code, auth.hostToken);
  await new Promise((resolve) => setTimeout(resolve, 10));

  setClock(2000);
  assert.deepEqual(manager.press(auth.code, max.id), { accepted: true, place: 1 });
  setClock(2086);
  assert.deepEqual(manager.press(auth.code, alex.id), { accepted: true, place: 2 });
  assert.deepEqual(manager.press(auth.code, alex.id), { accepted: false, reason: 'DUPLICATE' });

  const state = manager.publicState(manager.getRoom(auth.code));
  assert.equal(state.queue[0].name, 'Max');
  assert.equal(state.queue[1].deltaMs, 86);
});

test('false starter is excluded from current round', async () => {
  const { manager, auth, alex } = setup();
  manager.startRound(auth.code, auth.hostToken);
  assert.deepEqual(manager.press(auth.code, alex.id), { accepted: false, reason: 'FALSE_START' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(manager.press(auth.code, alex.id), { accepted: false, reason: 'DUPLICATE' });
  assert.equal(manager.publicState(manager.getRoom(auth.code), { playerId: alex.id }).you.falseStart, true);
});

test('wrong answer passes the right to the next player', async () => {
  const { manager, auth, alex, max, setClock } = setup();
  manager.startRound(auth.code, auth.hostToken);
  await new Promise((resolve) => setTimeout(resolve, 10));
  manager.press(auth.code, alex.id);
  setClock(1010);
  manager.press(auth.code, max.id);

  manager.judgeAnswer(auth.code, auth.hostToken, false);
  let state = manager.publicState(manager.getRoom(auth.code));
  assert.equal(state.queue[0].verdict, 'wrong');
  assert.equal(state.queue[1].isAnswering, true);

  manager.judgeAnswer(auth.code, auth.hostToken, true);
  state = manager.publicState(manager.getRoom(auth.code));
  assert.equal(state.status, 'finished');
  assert.equal(state.queue[1].verdict, 'correct');
});

test('a late press becomes the respondent after the only answer was rejected', async () => {
  const { manager, auth, alex, max, setClock } = setup();
  manager.startRound(auth.code, auth.hostToken);
  await new Promise((resolve) => setTimeout(resolve, 10));
  manager.press(auth.code, alex.id);
  manager.judgeAnswer(auth.code, auth.hostToken, false);

  let state = manager.publicState(manager.getRoom(auth.code));
  assert.equal(state.status, 'active');
  assert.equal(state.answerIndex, null);

  setClock(1300);
  manager.press(auth.code, max.id);
  state = manager.publicState(manager.getRoom(auth.code));
  assert.equal(state.queue[1].isAnswering, true);
});

test('resume token reuses the same player identity', () => {
  const { manager, auth, alex } = setup();
  manager.setPlayerOnline(auth.code, alex.id, false);
  const resumed = manager.joinPlayer(auth.code, 'Alex again', alex.resumeToken);
  assert.equal(resumed.id, alex.id);
  assert.equal(resumed.online, true);
  assert.equal(manager.getRoom(auth.code).players.size, 2);
});

test('new players cannot join an armed or active round', async () => {
  const { manager, auth } = setup();
  manager.startRound(auth.code, auth.hostToken);

  assert.throws(
    () => manager.joinPlayer(auth.code, 'Late player'),
    /ROUND_IN_PROGRESS/,
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.throws(
    () => manager.joinPlayer(auth.code, 'Later player'),
    /ROUND_IN_PROGRESS/,
  );
});

test('existing player can reconnect during an active round', async () => {
  const { manager, auth, alex } = setup();
  manager.startRound(auth.code, auth.hostToken);
  await new Promise((resolve) => setTimeout(resolve, 10));
  manager.setPlayerOnline(auth.code, alex.id, false);

  const resumed = manager.joinPlayer(auth.code, 'Alex', alex.resumeToken);
  assert.equal(resumed.id, alex.id);
  assert.equal(resumed.online, true);
});
