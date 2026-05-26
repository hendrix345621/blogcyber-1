// load Twemoji so flag/colour emoji render consistently (esp. on Windows)
(function () {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/twemoji@14/dist/twemoji.min.js';
  s.crossOrigin = 'anonymous';
  s.onload = () => twemoji.parse(document.body, { folder: 'svg', ext: '.svg' });
  document.head.appendChild(s);
})();


// shared helper: pace ticker scroll at a constant pixel-per-second
const setTickerSpeed = (track, pxPerSec = 40, minSec = 20) => {
  requestAnimationFrame(() => {
    const width = track.scrollWidth || 1;
    track.style.animationDuration = Math.max(minSec, Math.round(width / pxPerSec)) + 's';
  });
};

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// top ticker — pulls lines from /notices.txt
(function () {
  const track = document.querySelector('.ticker.notices .ticker-track');
  if (!track) return;
  fetch('/notices.txt')
    .then(r => r.text())
    .then(text => {
      const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
      if (!lines.length) return;
      const block = lines.map(l => `<span>${escapeHtml(l)}</span>`).join('');
      track.innerHTML = block + block + block + block;
      setTickerSpeed(track, 40);
    })
    .catch(() => {});
})();

// theme toggle — cycles light -> light-blue -> dark, persists across pages
(function () {
  const root = document.documentElement;
  const saved = localStorage.getItem('theme');
  if (saved) root.setAttribute('data-theme', saved);

  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const themes = ['light', 'light-blue', 'dark'];
  btn.addEventListener('click', () => {
    const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    const current = root.getAttribute('data-theme') || (sysDark ? 'dark' : 'light');
    const next = themes[(themes.indexOf(current) + 1) % themes.length];
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
})();

// homepage post search — title matches first, then body matches
(function () {
  const input = document.getElementById('search');
  if (!input) return;
  const container = document.querySelector('.posts');
  if (!container) return;
  const empty = document.getElementById('no-results');

  // snapshot original order so we can restore it when search clears
  const articles = Array.from(container.querySelectorAll('article'));
  articles.forEach(a => {
    const titleEl = a.querySelector('h1, h2, h3');
    a.dataset.title = (titleEl ? titleEl.textContent : '').toLowerCase();
    a.dataset.body = a.textContent.toLowerCase();
  });
  const originalOrder = articles.slice();

  const filter = () => {
    const q = input.value.trim().toLowerCase();

    if (!q) {
      originalOrder.forEach(a => { a.hidden = false; container.appendChild(a); });
      if (empty) empty.hidden = true;
      return;
    }

    const titleHits = [];
    const bodyHits = [];
    articles.forEach(a => {
      if (a.dataset.title.includes(q)) titleHits.push(a);
      else if (a.dataset.body.includes(q)) bodyHits.push(a);
      else a.hidden = true;
    });

    [...titleHits, ...bodyHits].forEach(a => {
      a.hidden = false;
      container.appendChild(a); // reorder: titles first, then body matches
    });

    if (empty) empty.hidden = (titleHits.length + bodyHits.length) !== 0;
  };

  input.addEventListener('input', filter);
})();
