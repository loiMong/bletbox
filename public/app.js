export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

export function roomFromUrl() {
  return new URLSearchParams(location.search).get('room')?.trim().toUpperCase() || '';
}

export function createSocket({ onOpen, onMessage, onStatus }) {
  let socket;
  let retry;
  let closed = false;

  function connect() {
    onStatus?.('connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    socket.addEventListener('open', () => {
      onStatus?.('online');
      onOpen?.(socket);
    });
    socket.addEventListener('message', (event) => {
      try { onMessage?.(JSON.parse(event.data)); } catch { /* ignore invalid frames */ }
    });
    socket.addEventListener('close', () => {
      onStatus?.('offline');
      if (!closed) retry = setTimeout(connect, 900);
    });
  }

  connect();
  return {
    send(payload) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
        return true;
      }
      return false;
    },
    close() {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    },
  };
}
