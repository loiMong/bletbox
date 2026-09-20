import { createSocket, escapeHtml, qs, roomFromUrl } from '/app.js';

const params = new URLSearchParams(location.search);
const room = roomFromUrl();
const hostToken = params.get('token') || sessionStorage.getItem(`host:${room}`) || '';
if (hostToken) sessionStorage.setItem(`host:${room}`, hostToken);

if (!room || !hostToken) location.replace('/');

qs('#room-code').textContent = room;
qs('#qr-code').src = `/api/qr?room=${encodeURIComponent(room)}`;
const joinUrl = `${location.origin}/play?room=${encodeURIComponent(room)}`;
qs('#join-link').textContent = joinUrl;

let state = null;
const socket = createSocket({
  onOpen(rawSocket) {
    rawSocket.send(JSON.stringify({ type: 'host:connect', room, hostToken }));
  },
  onMessage(message) {
    if (message.type === 'state') {
      state = message;
      render();
    } else if (message.type === 'error') {
      if (message.code === 'UNAUTHORIZED') location.replace('/');
      else showToast(message.code === 'NO_ANSWER' ? 'Очередь ответов пуста' : 'Команда не выполнена');
    }
  },
  onStatus(status) {
    qs('#connection-dot').classList.toggle('online', status === 'online');
    qs('#connection-text').textContent = status === 'online' ? 'В сети' : status === 'connecting' ? 'Подключаемся…' : 'Переподключаемся…';
  },
});

function command(type, extra = {}) {
  socket.send({ type, hostToken, ...extra });
}

qs('#start-round').addEventListener('click', () => command('round:start'));
qs('#reset-round').addEventListener('click', () => command('round:reset'));
qs('#answer-correct').addEventListener('click', () => command('answer:judge', { correct: true }));
qs('#answer-wrong').addEventListener('click', () => command('answer:judge', { correct: false }));

function plural(value, one, few, many) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  return `${value} ${mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many}`;
}

function render() {
  const online = state.players.filter((player) => player.online).length;
  qs('#player-count').textContent = `${online} онлайн · ${state.players.length} всего`;
  qs('#players').innerHTML = state.players.length
    ? state.players.map((player) => `
      <div class="player-row">
        <span class="dot ${player.online ? 'online' : ''}"></span>
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="player-status">${player.falseStart ? 'фальстарт' : player.online ? 'online' : 'offline'}</span>
      </div>`).join('')
    : '<p class="empty">Пока никого.<br>Покажите игрокам QR-код.</p>';

  const copy = {
    waiting: ['Ожидание', 'Все готовы?', 'Игроки могут подключаться в любой момент. Когда будете готовы — запускайте.'],
    armed: ['Приготовились', 'Не нажимать!', 'Кнопка станет активной автоматически. Раннее нажатие — фальстарт.'],
    active: ['Раунд идёт', state.queue.length ? 'Есть нажатия' : 'Ждём нажатий…', 'Порядок фиксируется сервером в момент получения каждого события.'],
    finished: ['Завершён', 'Раунд завершён', 'Нажмите «Сброс / новый», чтобы очистить очередь, не отключая игроков.'],
  }[state.status];
  qs('#status-pill').textContent = copy[0];
  qs('#status-pill').className = `status-pill ${state.status}`;
  qs('#round-label').textContent = state.round ? `Раунд ${state.round}` : 'Раунд ещё не запускали';
  qs('#round-title').textContent = copy[1];
  qs('#round-hint').textContent = copy[2];
  qs('#start-round').disabled = state.status === 'armed' || state.status === 'active';

  qs('#press-count').textContent = plural(state.queue.length, 'ответ', 'ответа', 'ответов');
  qs('#ranking').innerHTML = state.queue.length
    ? state.queue.map((entry) => `
      <div class="rank-row ${entry.isAnswering ? 'answering' : ''} ${entry.verdict === 'wrong' ? 'wrong' : ''}">
        <span class="rank-position">${entry.place}</span>
        <span class="rank-name">${escapeHtml(entry.name)}${entry.verdict === 'correct' ? ' ✓' : ''}</span>
        <span class="rank-time">${entry.deltaMs ? `+${entry.deltaMs}` : '0'} ms</span>
      </div>`).join('')
    : '<p class="empty">Здесь появится рейтинг текущего раунда.</p>';

  const falseStarts = qs('#false-starts');
  falseStarts.classList.toggle('hidden', !state.falseStarts.length);
  falseStarts.innerHTML = state.falseStarts.length
    ? `⚠ Фальстарт: ${state.falseStarts.map((entry) => escapeHtml(entry.name)).join(', ')}`
    : '';

  const canJudge = state.answerIndex !== null && state.queue.some((entry) => entry.isAnswering) && state.status !== 'finished';
  qs('#judge-actions').classList.toggle('hidden', !canJudge);
}

function showToast(text) {
  const hint = qs('#round-hint');
  const original = hint.textContent;
  hint.textContent = text;
  setTimeout(() => { if (hint.textContent === text) hint.textContent = original; }, 2200);
}
