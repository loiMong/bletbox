import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function token(bytes = 18) {
  return randomBytes(bytes).toString('base64url');
}

function roomCode(length = 5) {
  let result = '';
  const bytes = randomBytes(length);
  for (let index = 0; index < length; index += 1) {
    result += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return result;
}

function cleanName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

export class RoomManager extends EventEmitter {
  constructor({ countdownMs = 1800, now = () => performance.now() } = {}) {
    super();
    this.rooms = new Map();
    this.countdownMs = countdownMs;
    this.now = now;
  }

  createRoom() {
    let code;
    do code = roomCode(); while (this.rooms.has(code));

    const room = {
      code,
      hostToken: token(),
      status: 'waiting',
      round: 0,
      players: new Map(),
      queue: [],
      falseStarts: [],
      answerIndex: null,
      createdAt: Date.now(),
      timer: null,
    };
    this.rooms.set(code, room);
    return { code, hostToken: room.hostToken };
  }

  getRoom(code) {
    return this.rooms.get(String(code ?? '').toUpperCase());
  }

  isHost(code, hostToken) {
    const room = this.getRoom(code);
    return Boolean(room && room.hostToken === hostToken);
  }

  joinPlayer(code, name, resumeToken) {
    const room = this.getRoom(code);
    if (!room) throw new Error('ROOM_NOT_FOUND');

    // Reconnecting players keep their seat even while a round is running.
    if (resumeToken) {
      const existing = [...room.players.values()].find((player) => player.resumeToken === resumeToken);
      if (existing) {
        existing.name = cleanName(name) || existing.name;
        existing.online = true;
        existing.lastSeenAt = Date.now();
        this.changed(room);
        return existing;
      }
    }

    // New identities must wait until the current round is over. Keeping this
    // check after resume-token recovery prevents a connection drop from
    // locking an existing player out of an active round.
    if (room.status === 'armed' || room.status === 'active') {
      throw new Error('ROUND_IN_PROGRESS');
    }

    const safeName = cleanName(name);
    if (!safeName) throw new Error('NAME_REQUIRED');
    const player = {
      id: token(9),
      resumeToken: token(),
      name: safeName,
      online: true,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      pressedRound: null,
      falseStartRound: null,
    };
    room.players.set(player.id, player);
    this.changed(room);
    return player;
  }

  setPlayerOnline(code, playerId, online) {
    const room = this.getRoom(code);
    const player = room?.players.get(playerId);
    if (!player) return;
    player.online = online;
    player.lastSeenAt = Date.now();
    this.changed(room);
  }

  startRound(code, hostToken) {
    const room = this.authorizeHost(code, hostToken);
    if (room.timer) clearTimeout(room.timer);
    room.round += 1;
    room.status = 'armed';
    room.queue = [];
    room.falseStarts = [];
    room.answerIndex = null;
    for (const player of room.players.values()) {
      player.pressedRound = null;
      player.falseStartRound = null;
    }
    this.changed(room);

    const round = room.round;
    room.timer = setTimeout(() => {
      if (room.round !== round || room.status !== 'armed') return;
      room.status = 'active';
      room.timer = null;
      this.changed(room);
    }, this.countdownMs);
    return room;
  }

  resetRound(code, hostToken) {
    const room = this.authorizeHost(code, hostToken);
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.status = 'waiting';
    room.queue = [];
    room.falseStarts = [];
    room.answerIndex = null;
    for (const player of room.players.values()) {
      player.pressedRound = null;
      player.falseStartRound = null;
    }
    this.changed(room);
    return room;
  }

  press(code, playerId) {
    const room = this.getRoom(code);
    const player = room?.players.get(playerId);
    if (!room || !player) throw new Error('PLAYER_NOT_FOUND');

    if (player.falseStartRound === room.round || player.pressedRound === room.round) {
      return { accepted: false, reason: 'DUPLICATE' };
    }

    if (room.status === 'armed') {
      player.falseStartRound = room.round;
      room.falseStarts.push({ playerId, receivedAt: this.now() });
      this.changed(room);
      return { accepted: false, reason: 'FALSE_START' };
    }

    if (room.status !== 'active') {
      return { accepted: false, reason: 'NOT_ACTIVE' };
    }

    player.pressedRound = room.round;
    const receivedAt = this.now();
    room.queue.push({ playerId, receivedAt });
    // If all earlier answers were rejected, the next arriving player
    // automatically becomes the current respondent.
    if (room.answerIndex === null) room.answerIndex = room.queue.length - 1;
    this.changed(room);
    return { accepted: true, place: room.queue.length };
  }

  finishRound(code, hostToken) {
    const room = this.authorizeHost(code, hostToken);
    if (room.status === 'active') {
      room.status = 'finished';
      this.changed(room);
    }
    return room;
  }

  judgeAnswer(code, hostToken, correct) {
    const room = this.authorizeHost(code, hostToken);
    if (room.answerIndex === null || !room.queue[room.answerIndex]) throw new Error('NO_ANSWER');

    if (correct) {
      room.status = 'finished';
      room.queue[room.answerIndex].verdict = 'correct';
    } else {
      room.queue[room.answerIndex].verdict = 'wrong';
      const nextIndex = room.queue.findIndex((entry, index) => index > room.answerIndex && !entry.verdict);
      room.answerIndex = nextIndex === -1 ? null : nextIndex;
    }
    this.changed(room);
    return room;
  }

  publicState(room, viewer = {}) {
    const firstAt = room.queue[0]?.receivedAt;
    const players = [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      online: player.online,
      falseStart: player.falseStartRound === room.round,
    }));
    const queue = room.queue.map((entry, index) => ({
      playerId: entry.playerId,
      name: room.players.get(entry.playerId)?.name ?? 'Игрок',
      place: index + 1,
      deltaMs: Math.max(0, Math.round(entry.receivedAt - firstAt)),
      verdict: entry.verdict ?? null,
      isAnswering: room.answerIndex === index,
    }));
    const falseStarts = room.falseStarts.map((entry) => ({
      playerId: entry.playerId,
      name: room.players.get(entry.playerId)?.name ?? 'Игрок',
    }));

    const ownEntry = viewer.playerId
      ? queue.find((entry) => entry.playerId === viewer.playerId)
      : null;
    const ownPlayer = viewer.playerId ? room.players.get(viewer.playerId) : null;

    return {
      type: 'state',
      room: room.code,
      status: room.status,
      round: room.round,
      players,
      queue,
      falseStarts,
      answerIndex: room.answerIndex,
      you: ownPlayer
        ? {
            id: ownPlayer.id,
            name: ownPlayer.name,
            place: ownEntry?.place ?? null,
            falseStart: ownPlayer.falseStartRound === room.round,
          }
        : null,
    };
  }

  authorizeHost(code, hostToken) {
    const room = this.getRoom(code);
    if (!room || room.hostToken !== hostToken) throw new Error('UNAUTHORIZED');
    return room;
  }

  changed(room) {
    this.emit('change', room.code);
  }
}
