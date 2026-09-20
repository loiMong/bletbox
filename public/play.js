import { createSocket, qs, roomFromUrl } from '/app.js';

const room = roomFromUrl();
if (!room) location.replace('/');

const storageKey = `player:${room}`;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { saved = {}; }
let name = saved.name || '';
let resumeToken = saved.resumeToken || '';
let joined = false;
let currentState = null;
let locallyPressedRound = null;

qs('#player-room').textContent = room;
qs('#join-room').textContent = room;
qs('#player-name').value = name;

const socket = createSocket({
  onOpen(rawSocket) {
    if (name) join(rawSocket);
  },
  onMessage(message) {
    if (message.type === 'joined') {
      joined = true;
      resumeToken = message.resumeToken;
      name = message.name;
      localStorage.setItem(storageKey, JSON.stringify({ name, resumeToken }));
      qs('#join-view').classList.add('hidden');
      qs('#game-view').classList.remove('hidden');
      qs('#player-label').textContent = name;
    } else if (message.type === 'state') {
      currentState = message;
      render();
    } else if (message.type === 'press:result' && message.reason === 'NOT_ACTIVE') {
      locallyPressedRound = null;
    } else if (message.type === 'error') {
      handleError(message.code);
    }
  },
  onStatus(status) {
    const online = status === 'online';
    qs('#connection-dot').classList.toggle('online', online);
    if (!online && joined) qs('#state-text').textContent = 'Восстанавливаем связь…';
  },
});

function join(rawSocket) {
  rawSocket.send(JSON.stringify({ type: 'player:join', room, name, resumeToken }));
}

qs('#player-form').addEventListener('submit', (event) => {
  event.preventDefault();
  name = qs('#player-name').value.trim();
  if (!name) return;
  if (!socket.send({ type: 'player:join', room, name, resumeToken })) {
    qs('#join-error').textContent = 'Нет связи с сервером. Подождите секунду.';
  }
});

qs('#buzzer').addEventListener('pointerdown', (event) => {
  event.preventDefault();
  if (!currentState || locallyPressedRound === currentState.round) return;
  if (currentState.status !== 'active' && currentState.status !== 'armed') return;
  if (!socket.send({ type: 'player:press' })) {
    qs('#state-text').textContent = 'Нет связи — подключаемся…';
    return;
  }
  locallyPressedRound = currentState.round;
  if (navigator.vibrate) navigator.vibrate(currentState.status === 'active' ? 35 : [70, 50, 70]);
  const pressedRound = currentState.round;
  setTimeout(() => {
    if (locallyPressedRound === pressedRound
      && currentState?.round === pressedRound
      && !currentState.you?.place
      && !currentState.you?.falseStart) {
      locallyPressedRound = null;
    }
  }, 1200);
});

function render() {
  if (!currentState.you) return;
  if (currentState.round !== locallyPressedRound && !currentState.you.place && !currentState.you.falseStart) {
    locallyPressedRound = null;
  }

  const buzzer = qs('#buzzer');
  buzzer.className = 'buzzer';
  let word = 'ЖДИ';
  let sub = 'Ведущий скоро начнёт';
  let status = 'Ожидание ведущего';
  let activeDot = false;

  if (currentState.you.falseStart) {
    buzzer.classList.add('false-start');
    word = 'РАНО';
    sub = 'Фальстарт · этот раунд пропускаете';
    status = 'Фальстарт';
  } else if (currentState.you.place) {
    buzzer.classList.add(currentState.you.place === 1 ? 'winner' : 'pressed');
    word = `№${currentState.you.place}`;
    sub = currentState.you.place === 1 ? 'Вы первый!' : 'Нажатие принято';
    status = 'Ответ записан сервером';
  } else if (currentState.status === 'armed') {
    buzzer.classList.add('armed');
    word = 'ЖДИ';
    sub = 'Не нажимай раньше времени';
    status = 'Приготовились…';
  } else if (currentState.status === 'active') {
    buzzer.classList.add('active');
    word = 'ЖМИ!';
    sub = 'Раунд начался';
    status = 'Кнопка активна';
    activeDot = true;
  } else if (currentState.status === 'finished') {
    word = 'СТОП';
    sub = 'Раунд завершён';
    status = 'Ждём новый раунд';
  }

  qs('#buzzer-word').textContent = word;
  qs('#buzzer-sub').textContent = sub;
  qs('#state-text').textContent = status;
  qs('#state-dot').classList.toggle('online', activeDot);
}

function handleError(code) {
  if (code === 'ROOM_NOT_FOUND') {
    qs('#join-error').textContent = 'Комната не найдена. Проверьте код.';
    localStorage.removeItem(storageKey);
    name = '';
    resumeToken = '';
  } else if (code === 'NAME_REQUIRED') {
    qs('#join-error').textContent = 'Введите ник.';
  } else {
    qs('#join-error').textContent = 'Не удалось войти. Попробуйте снова.';
  }
}
