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
  const FADE_MS = 550;           // crossfade duration (matches CSS .6s)

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

  function renderFrame(image) {
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
    art.textContent = out;
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

  // Decode + start playing a sticker. Returns a stop() fn. The first frame is
  // rendered before resolving so the caller can crossfade onto real art.
  async function makePlayer(url) {
    const buf = await getBuffer(url);
    const dec = new ImageDecoder({ data: buf, type: mimeOf(url) });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = track ? track.frameCount : 1;
    let i = 0, stopped = false, timer = null;

    async function draw(k) {
      const { image } = await dec.decode({ frameIndex: k });
      if (stopped) { image.close && image.close(); return 100; }
      renderFrame(image);
      const dur = image.duration ? image.duration / 1000 : 100;
      image.close && image.close();
      return dur;
    }
    const schedule = (dur) => {
      if (!reduce && count > 1 && !stopped)
        timer = setTimeout(tick, Math.max(40, dur));
    };
    async function tick() {
      if (stopped) return;
      i = (i + 1) % count;
      schedule(await draw(i));
    }

    schedule(await draw(0));   // render frame 0 now, then animate
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try { dec.close && dec.close(); } catch (e) {}
    };
  }

  let idx = 0, stopCurrent = null, running = true;

  async function loop() {
    computeCols();
    fitFont();
    while (running) {
      let nextStop = null;
      try {
        nextStop = await makePlayer(FILES[idx]); // old keeps playing meanwhile
      } catch (e) {
        console.warn("[ascii-bg]", FILES[idx], "failed:", e.message || e);
      }
      if (nextStop) {
        if (stopCurrent) stopCurrent();
        stopCurrent = nextStop;
        bg.classList.remove("swapping");          // fade the new one in
      }

      // warm the next buffer; drop ones we no longer need
      const nextFile = FILES[(idx + 1) % FILES.length];
      getBuffer(nextFile).catch(() => {});
      const keep = new Set([FILES[idx], nextFile]);
      for (const k of [...bufCache.keys()]) if (!keep.has(k)) bufCache.delete(k);

      await sleep(CYCLE_MS);
      bg.classList.add("swapping");               // fade out before swap
      await sleep(FADE_MS);
      idx = (idx + 1) % FILES.length;
    }
  }
  loop();

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => { computeCols(); fitFont(); }, 200);
  });
})();
