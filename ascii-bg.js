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

  // animated gifs only, taken from the footer (auto-syncs on add/remove).
  // a footer <img data-no-bg> stays in the footer but is skipped in the rotation.
  const FILES = [...document.querySelectorAll(".stickers-footer img")]
    .filter((img) => !img.hasAttribute("data-no-bg") && /\.gif(\?|#|$)/i.test(img.src))
    .map((img) => img.src);
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
  const MAX_FRAMES = 48;         // cap frames per gif (sampled) to bound work
  const MIN_FRAME_MS = 66;       // throttle playback to ~15fps to stay smooth

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

  let cols = 160;
  const computeCols = () =>
    (cols = Math.min(200, Math.max(90, Math.round(window.innerWidth / 8))));
  const fitFont = () =>
    (art.style.fontSize = window.innerWidth / (cols * 0.6) + "px");

  // render one decoded frame to an ascii string (pure — does not touch the DOM)
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


  // de-dupe in-flight fetches; entries are removed once a player consumes them
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

  // Build a player for a sticker. ALL the heavy work — decode + canvas + ascii
  // conversion — happens here, ONCE, ahead of time (during the idle window), so
  // playback is just swapping a pre-built string into #ascii-art. The decoder is
  // closed immediately, so nothing decodes on the hot path. Only one player ever
  // drives the screen (the loop stops the old before starting the new).
  async function createPlayer(url) {
    const buf = await getBuffer(url);
    const dec = new ImageDecoder({ data: buf, type: mimeOf(url) });
    let frames;
    try {
      await dec.tracks.ready;
      const track = dec.tracks.selectedTrack;
      const count = track ? track.frameCount : 1;
      const step = count > MAX_FRAMES ? Math.ceil(count / MAX_FRAMES) : 1;
      frames = [];
      for (let k = 0; k < count; k += step) {
        const { image } = await dec.decode({ frameIndex: k }); // await yields each frame
        const text = frameToText(image);
        const dur = (image.duration ? image.duration / 1000 : 100) * step;
        image.close && image.close();
        frames.push({ text, dur });
      }
    } finally {
      try { dec.close && dec.close(); } catch (e) {}
      bufCache.delete(url);                    // bytes no longer needed
    }
    if (!frames.length) throw new Error("no frames");

    let stopped = false, timer = null, i = 0;
    function tick() {
      if (stopped) return;
      i = (i + 1) % frames.length;
      art.textContent = frames[i].text;
      timer = setTimeout(tick, Math.max(MIN_FRAME_MS, frames[i].dur));
    }

    return {
      firstText: frames[0].text,
      start() {
        if (!reduce && frames.length > 1 && !stopped)
          timer = setTimeout(tick, Math.max(MIN_FRAME_MS, frames[0].dur));
      },
      stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  // ---- on/off, persisted and wired to #bg-toggle (next to the theme switch) ----
  const root = document.documentElement;
  const STORE = "ascii-bg";
  let enabled = localStorage.getItem(STORE) === "on";   // default OFF until opted in
  let activePlayer = null;             // the one currently animating (for instant stop)
  let wakeUp = null;                   // resolver that un-parks the loop when re-enabled

  const waitUntilEnabled = () =>
    enabled ? Promise.resolve() : new Promise((r) => (wakeUp = r));

  function setEnabled(on) {
    if (on === enabled) return;
    enabled = on;
    root.setAttribute("data-ascii-bg", on ? "on" : "off");
    if (on) {
      const w = wakeUp; wakeUp = null; if (w) w();   // resume the parked loop
    } else if (activePlayer) {
      activePlayer.stop();                            // halt animation immediately
      activePlayer = null;
    }
  }

  // ONE loop runs for the page lifetime. When disabled it tears down and parks
  // on waitUntilEnabled(), so there is never more than one loop / one player.
  async function loop() {
    const prep = (i) =>
      createPlayer(FILES[i]).catch((e) => {
        console.warn("[ascii-bg]", FILES[i], "failed:", e.message || e);
        return null;
      });

    let idx = 0, current = null, next = null;

    while (true) {
      if (!enabled) {                  // teardown + park until toggled back on
        if (current) { current.stop(); current = null; }
        activePlayer = null;
        next = null;
        art.textContent = "";
        await waitUntilEnabled();
        computeCols();
        fitFont();
      }

      if (!next) next = await prep(idx);
      if (!enabled) continue;          // toggled off during decode

      if (next) {
        if (current) {                 // fade the old out, then swap (one writer)
          bg.classList.add("swapping");
          await sleep(FADE_MS);
          current.stop();
        }
        art.textContent = next.firstText;
        current = next;
        activePlayer = next;
        current.start();
        bg.classList.remove("swapping"); // fade the new one in
      }

      // pre-render the FOLLOWING sticker during the idle window so the next swap
      // is instant (createPlayer frees its own buffer + decoder when done)
      const nextIdx = (idx + 1) % FILES.length;
      const preparing = prep(nextIdx);

      await sleep(CYCLE_MS);
      if (!enabled) continue;          // teardown handled at loop top
      next = await preparing;
      idx = nextIdx;
    }
  }

  root.setAttribute("data-ascii-bg", enabled ? "on" : "off");
  computeCols();
  fitFont();

  const btn = document.getElementById("bg-toggle");
  if (btn) {
    const sync = () => {
      btn.classList.toggle("off", !enabled);
      btn.setAttribute("aria-pressed", String(enabled));
      btn.title = enabled ? "hide ascii background" : "show ascii background";
    };
    sync();
    btn.addEventListener("click", () => {
      setEnabled(!enabled);
      localStorage.setItem(STORE, enabled ? "on" : "off");
      sync();
    });
  }

  loop();

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => { computeCols(); fitFont(); }, 200);
  });
})();
