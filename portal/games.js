document.querySelector('#year').textContent = new Date().getFullYear();

// Every card intentionally points to a different origin. Update only these
// URLs when a game moves; the hub and other games keep working independently.
const gameUrls = {
  bunker: 'https://bunker.bletbox.com',
  'who-first': 'https://first.bletbox.com',
};

for (const card of document.querySelectorAll('[data-game]')) {
  const url = gameUrls[card.dataset.game];
  if (url) card.href = url;
}
