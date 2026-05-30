(() => {
  const STORAGE_KEY = "kuula.channelIndex";
  const VU_MODE_KEY = "kuula.vuMode";

  const audio = document.getElementById("audio");
  const display = document.getElementById("display");
  const channelNameEl = document.getElementById("channel-name");
  const statusEl = document.getElementById("status");
  const regionEl = document.getElementById("region");
  const bitrateEl = document.getElementById("bitrate");
  const indicatorsEl = document.getElementById("indicators");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const vuEl = document.getElementById("vu");
  const vuLedEl = vuEl.querySelector(".vu-led");
  const vuBarL = document.getElementById("vu-bar-l");
  const vuBarR = document.getElementById("vu-bar-r");
  const vuCanvas = document.getElementById("vu-canvas");

  let channels = [];
  let currentIndex = 0;
  let userWantsPlay = false;
  // Debounce for spurious "waiting"/"stalled" events that fire during normal
  // HLS segment fetching even though audible playback is uninterrupted.
  let pendingLoadingTimer = null;
  const LOADING_DEBOUNCE_MS = 2000;

  function clearPendingLoading() {
    if (pendingLoadingTimer != null) {
      clearTimeout(pendingLoadingTimer);
      pendingLoadingTimer = null;
    }
  }

  function scheduleLoading() {
    if (pendingLoadingTimer != null) return; // already armed; don't reset
    pendingLoadingTimer = setTimeout(() => {
      pendingLoadingTimer = null;
      if (userWantsPlay && audio.readyState < 3) setStatus("loading");
    }, LOADING_DEBOUNCE_MS);
  }

  const STATUS = {
    paused:   { text: "◼ PAUSED",      state: "paused",  titleLabel: "Paused"  },
    loading:  { text: "⋯ TUNING",      state: "loading", titleLabel: "Tuning"  },
    playing:  { text: "▸ NOW PLAYING", state: "playing", titleLabel: null      },
    error:    { text: "⚠ OFFLINE",     state: "error",   titleLabel: "Offline" },
    empty:    { text: "— NO CHANNELS —", state: "error", titleLabel: null     },
  };

  const TITLE_BASE = "Kuula";
  const TITLE_SUFFIX = "Web Radio Player";
  const DEFAULT_TITLE = `${TITLE_BASE} ${TITLE_SUFFIX}`;

  function updateTitle(kind) {
    if (!channels.length) {
      document.title = DEFAULT_TITLE;
      return;
    }
    const s = STATUS[kind];
    const middle = (kind === "playing" && channels[currentIndex])
      ? channels[currentIndex].name
      : (s && s.titleLabel) || "Paused";
    document.title = `${TITLE_BASE} (${channels.length} channels) - ${middle} - ${TITLE_SUFFIX}`;
  }

  function setStatus(kind) {
    const s = STATUS[kind];
    statusEl.textContent = s.text;
    statusEl.dataset.state = s.state;
    updateTitle(kind);
  }

  function renderIndicators() {
    indicatorsEl.textContent = "";
    let prevRegion = null;
    for (let i = 0; i < channels.length; i++) {
      const dot = document.createElement("span");
      dot.className = "channel-indicator";
      if (i === currentIndex) dot.classList.add("active");
      const region = channels[i].region || "";
      if (region !== prevRegion) dot.dataset.groupStart = "true";
      prevRegion = region;
      indicatorsEl.appendChild(dot);
    }
  }

  function renderChannel() {
    if (!channels.length) {
      channelNameEl.textContent = "— — —";
      regionEl.textContent = "";
      bitrateEl.textContent = "";
      indicatorsEl.textContent = "";
      setStatus("empty");
      return;
    }
    const ch = channels[currentIndex];
    regionEl.textContent = ch.region || "";
    bitrateEl.textContent = ch.bitrate != null ? String(ch.bitrate) : "";
    channelNameEl.textContent = ch.name;
    renderIndicators();
  }

  function persistIndex() {
    try {
      localStorage.setItem(STORAGE_KEY, String(currentIndex));
    } catch {
      /* private mode etc — ignore */
    }
  }

  function loadIndex(maxLen) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return 0;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0 || n >= maxLen) return 0;
      return n;
    } catch {
      return 0;
    }
  }

  function tuneTo(index, { play }) {
    currentIndex = (index + channels.length) % channels.length;
    persistIndex();
    renderChannel();

    const ch = channels[currentIndex];
    const url = ch.url;
    clearPendingLoading();
    resetSilenceWatchdog();
    audio.pause();
    // CORS: request anonymous so the Web Audio API can read samples for the VU
    // meter. Must be set BEFORE src/load() to take effect on this load. Streams
    // whose server lacks CORS headers ("cors": false) keep crossorigin unset —
    // setting it would taint/break them — and fall back to a simulated meter.
    if (ch.cors === false) {
      audio.removeAttribute("crossorigin");
    } else {
      audio.crossOrigin = "anonymous";
    }
    audio.src = url;
    // load() forces the browser to apply the new src and discard buffer
    try { audio.load(); } catch { /* ignore */ }

    if (play) {
      setStatus("loading");
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.catch(() => setStatus("error"));
      }
    } else {
      setStatus("paused");
    }
  }

  function togglePlay() {
    if (!channels.length) return;
    if (audio.paused) {
      userWantsPlay = true;
      // Build/resume the audio graph from within this gesture (iOS requirement).
      ensureAudioGraph();
      resumeAudioCtx();
      if (!audio.src) {
        tuneTo(currentIndex, { play: true });
        return;
      }
      setStatus("loading");
      const p = audio.play();
      if (p && typeof p.then === "function") {
        p.catch(() => setStatus("error"));
      }
    } else {
      userWantsPlay = false;
      audio.pause();
      setStatus("paused");
    }
  }

  function step(delta) {
    if (!channels.length) return;
    // Arrow press is a user gesture — start playing even from a paused state.
    userWantsPlay = true;
    // Build/resume the audio graph from within this gesture (iOS requirement).
    ensureAudioGraph();
    resumeAudioCtx();
    tuneTo(currentIndex + delta, { play: true });
  }

  function wireEvents() {
    prevBtn.addEventListener("click", () => step(-1));
    nextBtn.addEventListener("click", () => step(+1));

    display.addEventListener("click", togglePlay);
    display.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        togglePlay();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(+1);
      }
    });

    audio.addEventListener("playing", () => {
      clearPendingLoading();
      setStatus("playing");
      armSilenceWatchdog();
      startMeterLoop();
    });
    audio.addEventListener("waiting", () => {
      if (userWantsPlay) scheduleLoading();
    });
    audio.addEventListener("stalled", () => {
      if (userWantsPlay) scheduleLoading();
    });
    audio.addEventListener("pause", () => {
      clearPendingLoading();
      stopMeterLoop();
      if (!userWantsPlay) setStatus("paused");
    });
    audio.addEventListener("error", () => {
      clearPendingLoading();
      stopMeterLoop();
      setStatus("error");
    });

    // VU meter is its own click target inside the display (which is the
    // play/pause button) — stop events from bubbling so cycling the meter
    // doesn't toggle playback.
    vuEl.addEventListener("click", (e) => {
      e.stopPropagation();
      cycleMode();
    });
    vuEl.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        cycleMode();
      }
    });

    window.addEventListener("resize", () => {
      if (vuMode === "needle") sizeCanvas();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !audio.paused) {
        resumeAudioCtx();
        startMeterLoop();
      }
    });
  }

  // ---- VU meter ---------------------------------------------------------

  const VU_MODES = ["off", "led", "needle"];
  let vuMode = "off";

  // Web Audio graph (built once, lazily, from a user gesture).
  let audioCtx = null;
  let sourceNode = null; // MediaElementAudioSourceNode — created ONCE per element
  let analyserL = null, analyserR = null;
  let timeBufL = null, timeBufR = null;
  let webAudioReady = false;
  let webAudioBroken = false;

  // Channels whose real metering turned out tainted/silent this session.
  const simulatedChannels = new Set();

  function ensureAudioGraph() {
    if (webAudioReady || webAudioBroken) return webAudioReady;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { webAudioBroken = true; return false; }
    try {
      audioCtx = new AC();
      // createMediaElementSource may be called only ONCE per element.
      sourceNode = audioCtx.createMediaElementSource(audio);
      const splitter = audioCtx.createChannelSplitter(2);
      analyserL = audioCtx.createAnalyser();
      analyserR = audioCtx.createAnalyser();
      for (const a of [analyserL, analyserR]) {
        a.fftSize = 1024;
        a.smoothingTimeConstant = 0; // we apply our own ballistics
      }
      sourceNode.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      // CRITICAL: route to speakers, or rerouting through Web Audio silences it.
      sourceNode.connect(audioCtx.destination);
      timeBufL = new Float32Array(analyserL.fftSize);
      timeBufR = new Float32Array(analyserR.fftSize);
      webAudioReady = true;
      return true;
    } catch (err) {
      console.warn("Web Audio unavailable; using simulated VU meter", err);
      webAudioBroken = true;
      webAudioReady = false;
      return false;
    }
  }

  function resumeAudioCtx() {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  }

  function readChannelLevel(analyser, buf) {
    let peak = 0, sumSq = 0;
    if (analyser.getFloatTimeDomainData) {
      analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) {
        const s = buf[i];
        sumSq += s * s;
        const a = s < 0 ? -s : s;
        if (a > peak) peak = a;
      }
    } else {
      // Older Safari: byte time-domain centred at 128.
      const bytes = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(bytes);
      for (let i = 0; i < bytes.length; i++) {
        const s = (bytes[i] - 128) / 128;
        sumSq += s * s;
        const a = s < 0 ? -s : s;
        if (a > peak) peak = a;
      }
    }
    const rms = Math.sqrt(sumSq / buf.length);
    // Broadcast audio sits well below full-scale; gentle gain + soft ceiling.
    return { level: Math.min(1, rms * 2.2), peak: Math.min(1, peak) };
  }

  // Silence watchdog: a CORS-enabled stream that reads pure silence for ~2s
  // after 'playing' fired is tainted — fall back to simulated for it.
  let silenceArmed = false;
  let lastNonSilentAt = 0;
  const SILENCE_MS = 2000;

  function armSilenceWatchdog() {
    silenceArmed = true;
    lastNonSilentAt = performance.now();
  }
  function resetSilenceWatchdog() {
    silenceArmed = false;
    lastNonSilentAt = 0;
  }
  function noteAnalyserActivity(level) {
    if (!silenceArmed) return;
    const now = performance.now();
    if (level > 0.002) { lastNonSilentAt = now; return; }
    if (now - lastNonSilentAt > SILENCE_MS) {
      simulatedChannels.add(currentIndex);
      silenceArmed = false;
    }
  }

  function realMeteringActive() {
    const ch = channels[currentIndex];
    return !!(webAudioReady && ch && ch.cors !== false &&
              !simulatedChannels.has(currentIndex));
  }

  // Simulated levels: believable "music" wiggle for non-CORS / no-Web-Audio.
  function simulatedLevels(now) {
    const t = now / 1000;
    const l = 0.45 + 0.22 * Math.sin(t * 2.3) + 0.12 * Math.sin(t * 5.7 + 1);
    const r = 0.45 + 0.22 * Math.sin(t * 2.1 + 0.6) + 0.12 * Math.sin(t * 6.1);
    return {
      l: Math.max(0, Math.min(1, l)),
      r: Math.max(0, Math.min(1, r)),
    };
  }

  // Ballistics: fast attack, slow decay, with peak-hold-and-fall.
  const bal = {
    l: { lvl: 0, peak: 0, peakAt: 0 },
    r: { lvl: 0, peak: 0, peakAt: 0 },
  };
  const ATTACK = 0.5;
  const DECAY = 0.08;
  const PEAK_HOLD_MS = 900;
  const PEAK_FALL = 0.04;

  function applyBallistics(side, target, peak, now) {
    const k = target > side.lvl ? ATTACK : DECAY;
    side.lvl += (target - side.lvl) * k;
    if (peak >= side.peak) {
      side.peak = peak;
      side.peakAt = now;
    } else if (now - side.peakAt > PEAK_HOLD_MS) {
      side.peak = Math.max(side.lvl, side.peak - PEAK_FALL);
    }
  }

  // --- renderers ---
  const SEGMENTS = 24;

  function drawLed(l, r) {
    setBar(vuBarL, l);
    setBar(vuBarR, r);
  }
  function setBar(el, side) {
    const lit = Math.round(side.lvl * SEGMENTS) / SEGMENTS;
    el.style.setProperty("--fill", (lit * 100).toFixed(2) + "%");
    el.style.setProperty("--peak", (side.peak * 100).toFixed(2) + "%");
  }

  let cyanColor = "#00f0ff";
  let cyanDimColor = "rgba(0,240,255,0.18)";

  // Dial x-centres (canvas-relative CSS px), aligned to the arrow buttons
  // below. null until measured; recomputed on size/orientation changes.
  let dialLX = null, dialRX = null;

  function measureDials() {
    dialLX = dialRX = null;
    const cr = vuCanvas.getBoundingClientRect();
    if (!cr.width) return;
    const pr = prevBtn.getBoundingClientRect();
    const nr = nextBtn.getBoundingClientRect();
    const lx = pr.left + pr.width / 2 - cr.left;
    const rx = nr.left + nr.width / 2 - cr.left;
    // Only align when the buttons sit below the canvas (portrait/column
    // layout) and their centres fall within it. In landscape the controls are
    // beside the display, so we keep the default 0.25/0.75 spread instead.
    if (nr.top >= cr.bottom - 1 && lx > 0 && rx < cr.width && lx < rx) {
      dialLX = lx;
      dialRX = rx;
    }
  }

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = vuCanvas.clientWidth;
    const h = vuCanvas.clientHeight;
    if (!w || !h) return;
    vuCanvas.width = Math.round(w * dpr);
    vuCanvas.height = Math.round(h * dpr);
    const ctx = vuCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measureDials();
  }

  function drawNeedle(l, r) {
    const ctx = vuCanvas.getContext("2d");
    const w = vuCanvas.clientWidth;
    const h = vuCanvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const cy = h - 26;
    const lx = dialLX != null ? dialLX : w * 0.25;
    const rx = dialRX != null ? dialRX : w * 0.75;
    // keep dials from overlapping or spilling off the canvas
    const radius = Math.min(w * 0.22, cy - 4, (rx - lx) / 2 - 6, lx, w - rx);
    const labelY = h - 5;
    drawDial(ctx, lx, cy, radius, l, "L", labelY);
    drawDial(ctx, rx, cy, radius, r, "R", labelY);
  }

  function drawDial(ctx, cx, cy, radius, side, label, labelY) {
    const start = Math.PI * 1.25; // -135deg
    const end = Math.PI * 1.75;   //  -45deg (sweep across the top)
    // arc face
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = cyanDimColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();
    // ticks
    ctx.strokeStyle = cyanColor;
    for (let i = 0; i <= 8; i++) {
      const a = start + (end - start) * (i / 8);
      const r0 = radius - (i >= 6 ? 8 : 5);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.stroke();
    }
    // needle
    const a = start + (end - start) * side.lvl;
    ctx.save();
    ctx.shadowColor = cyanColor;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = cyanColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (radius - 4), cy + Math.sin(a) * (radius - 4));
    ctx.stroke();
    ctx.restore();
    // label — below the pivot, clear of the needle sweep
    ctx.fillStyle = cyanColor;
    ctx.font = "14px 'VT323', monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, cx, labelY);
  }

  // --- loop ---
  let rafId = 0;

  function frame() {
    rafId = 0;
    if (vuMode === "off" || audio.paused) return;
    const now = performance.now();

    let lT = 0, rT = 0, lP = 0, rP = 0;
    if (realMeteringActive()) {
      const L = readChannelLevel(analyserL, timeBufL);
      const R = readChannelLevel(analyserR, timeBufR);
      lT = L.level; rT = R.level; lP = L.peak; rP = R.peak;
      // mono streams: mirror L to a flat R
      if (rT < 0.0005 && lT > 0.01) { rT = lT; rP = lP; }
      noteAnalyserActivity(Math.max(lT, rT));
    } else {
      const sim = simulatedLevels(now);
      lT = sim.l; rT = sim.r; lP = lT; rP = rT;
    }

    applyBallistics(bal.l, lT, lP, now);
    applyBallistics(bal.r, rT, rP, now);

    if (vuMode === "led") drawLed(bal.l, bal.r);
    else drawNeedle(bal.l, bal.r);

    rafId = requestAnimationFrame(frame);
  }

  function startMeterLoop() {
    if (!rafId && vuMode !== "off" && !audio.paused) {
      rafId = requestAnimationFrame(frame);
    }
  }
  function stopMeterLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function loadVuMode() {
    try {
      const m = localStorage.getItem(VU_MODE_KEY);
      return VU_MODES.includes(m) ? m : "off";
    } catch {
      return "off";
    }
  }
  function persistVuMode() {
    try {
      localStorage.setItem(VU_MODE_KEY, vuMode);
    } catch {
      /* private mode etc — ignore */
    }
  }

  function applyVuMode() {
    vuEl.dataset.mode = vuMode;
    vuLedEl.hidden = vuMode !== "led";
    vuCanvas.hidden = vuMode !== "needle";
    if (vuMode === "needle") sizeCanvas();
    if (vuMode === "off") stopMeterLoop();
    else startMeterLoop();
  }

  function cycleMode() {
    vuMode = VU_MODES[(VU_MODES.indexOf(vuMode) + 1) % VU_MODES.length];
    persistVuMode();
    applyVuMode();
  }

  function initVuMeter() {
    const cs = getComputedStyle(document.documentElement);
    cyanColor = (cs.getPropertyValue("--cyan") || "#00f0ff").trim();
    cyanDimColor = (cs.getPropertyValue("--cyan-dim") || cyanDimColor).trim();
    vuMode = loadVuMode();
    applyVuMode();
  }

  async function init() {
    wireEvents();
    initVuMeter();
    try {
      const res = await fetch("channels.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        channels = [];
        renderChannel();
        return;
      }
      channels = data.filter(
        (c) => c && typeof c.name === "string" && typeof c.url === "string"
      );
      currentIndex = loadIndex(channels.length);
      renderChannel();
      setStatus("paused");
    } catch (err) {
      console.error("Failed to load channels.json", err);
      channelNameEl.textContent = "CONFIG ERROR";
      setStatus("error");
    }
  }

  init();
})();
