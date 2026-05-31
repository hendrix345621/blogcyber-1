// Live animated ASCII background.
// Shows ONE footer sticker (gif) at a time as moving ASCII — decoded frame by
// frame, full motion, not a snapshot — and crossfades to the next every 10s.
// The conversion (luminance ramp + contrast) is the same as ascii.html.
//
// Sticker sources are read straight from the .stickers-footer <img> list and
// filtered to gifs, so the background stays in sync with the footer: add or
// remove a sticker patch and the background follows automatically.
//
// Requires #ascii-bg > #ascii-art in the page (see style.css for the styling).
// Must be served over http(s) — fetch is blocked on file://.
(() => {
  const bg = document.getElementById("ascii-bg");
  const art = document.getElementById("ascii-art");
  if (!bg || !art) return;

  // animated gifs only, taken from the footer (auto-syncs on add/remove)
  const FILES = [...document.querySelectorAll(".stickers-footer img")]
    .map((img) => img.src)
    .filter((u) => /\.gif(\?|#|$)/i.test(u));
  if (!FILES.length) return;
  for (let k = FILES.length - 1; k > 0; k--) {   // shuffle so each refresh varies
    const j = Math.floor(Math.random() * (k + 1));
    [FILES[k], FILES[j]] = [FILES[j], FILES[k]];
  }

  const RAMP = " .:-=+*#%@";
  const CHAR_ASPECT = 0.5;
  const L = RAMP.length;
  const CONTRAST = 65;           // higher = punchier (ascii.html formula)
  const cF = (259 * (CONTRAST + 255)) / (255 * (259 - CONTRAST));
  const CYCLE_MS = 10000;        // time each sticker is shown
  const FADE_MS = 600;           // must be >= the CSS opacity transition (.6s)

  const mimeOf = (u) =>
    /\.gif(\?|#|$)/i.test(u) ? "image/gif" :
    /\.png(\?|#|$)/i.test(u) ? "image/png" :
    /\.webp(\?|#|$)/i.test(u) ? "image/webp" : "image/jpeg";

  if (!("ImageDecoder" in window)) {
    console.warn("[ascii-bg] ImageDecoder unsupported; animated background disabled.");
    return;
  }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let cols = 220;
  const computeCols = () =>
    (cols = Math.min(320, Math.max(100, Math.round(window.innerWidth / 6))));
  const fitFont = () =>
    (art.style.fontSize = window.innerWidth / (cols * 0.6) + "px");

  // render one decoded frame to an ascii string (does NOT touch the DOM, so the
  // next sticker can be decoded off-screen while the current one is on screen)
  function frameToText(image) {
    const sw = image.displayWidth || image.codedWidth || 1;
    const sh = image.displayHeight || image.codedHeight || 1;
    const rows = Math.max(1, Math.round(cols * (sh / sw) * CHAR_ASPECT));
    canvas.width = cols;
    canvas.height = rows;
    ctx.clearRect(0, 0, cols, rows);
    ctx.drawImage(image, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;
    let out = "";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const a = data[i + 3] / 255;
        let lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lum = cF * (lum - 128) + 128;                  // boost contrast
        lum = (lum < 0 ? 0 : lum > 255 ? 255 : lum) * a;
        let idx = Math.round((lum / 255) * (L - 1));
        idx = idx < 0 ? 0 : idx > L - 1 ? L - 1 : idx;
        out += RAMP[idx];
      }
      out += "\n";
    }
    return out;
  }

  // decode frame k of a decoder -> { text, dur(ms) }
  async function renderIndex(dec, k) {
    const { image } = await dec.decode({ frameIndex: k });
    const text = frameToText(image);
    const dur = image.duration ? image.duration / 1000 : 100;
    image.close && image.close();
    return { text, dur };
  }

  // cache encoded bytes (keep only current + next to bound memory)
  const bufCache = new Map();
  function getBuffer(url) {
    if (!bufCache.has(url)) {
      bufCache.set(
        url,
        fetch(url).then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.arrayBuffer();
        })
      );
    }
    return bufCache.get(url);
  }

  // Build a player for a sticker: decode + render frame 0 up front (so the swap
  // is instant), and expose start()/stop(). Only ONE player ever drives
  // #ascii-art — the loop always stops the previous before starting the next,
  // so two gifs can never write to the screen at the same time.
  async function createPlayer(url) {
    const buf = await getBuffer(url);
    const dec = new ImageDecoder({ data: buf, type: mimeOf(url) });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = track ? track.frameCount : 1;
    const first = await renderIndex(dec, 0);   // frame 0 ready before we show it

    let stopped = false, timer = null, i = 0;
    async function tick() {
      if (stopped) return;
      i = (i + 1) % count;
      let frame;
      try { frame = await renderIndex(dec, i); }
      catch (e) { return; }                    // hold last good frame on error
      if (stopped) return;
      art.textContent = frame.text;
      timer = setTimeout(tick, Math.max(40, frame.dur));
    }

    return {
      firstText: first.text,
      start() {
        if (!reduce && count > 1 && !stopped)
          timer = setTimeout(tick, Math.max(40, first.dur));
      },
      stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
        try { dec.close && dec.close(); } catch (e) {}
      },
    };
  }

  let running = true;

  async function loop() {
    computeCols();
    fitFont();

    const prep = (i) =>
      createPlayer(FILES[i]).catch((e) => {
        console.warn("[ascii-bg]", FILES[i], "failed:", e.message || e);
        return null;
      });

    let idx = 0;
    let current = null;
    let next = await prep(idx);          // decode the first sticker before showing

    while (running) {
      if (next) {
        if (current) {                   // fade the old out, then swap (one writer)
          bg.classList.add("swapping");
          await sleep(FADE_MS);
          current.stop();
        }
        art.textContent = next.firstText;
        current = next;
        current.start();
        bg.classList.remove("swapping"); // fade the new one in
      }

      // decode the FOLLOWING sticker during the idle window so the next swap is
      // instant (no blank gap), then prune buffers we no longer need
      const nextIdx = (idx + 1) % FILES.length;
      const preparing = prep(nextIdx);
      const keep = new Set([FILES[idx], FILES[nextIdx]]);
      for (const k of [...bufCache.keys()]) if (!keep.has(k)) bufCache.delete(k);

      await sleep(CYCLE_MS);
      next = await preparing;
      idx = nextIdx;
    }
  }
  loop();

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => { computeCols(); fitFont(); }, 200);
  });
})();
