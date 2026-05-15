(() => {
  const STORAGE_KEY = "kuula.channelIndex";

  const audio = document.getElementById("audio");
  const display = document.getElementById("display");
  const channelNameEl = document.getElementById("channel-name");
  const statusEl = document.getElementById("status");
  const regionEl = document.getElementById("region");
  const bitrateEl = document.getElementById("bitrate");
  const indicatorsEl = document.getElementById("indicators");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");

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

    const url = channels[currentIndex].url;
    clearPendingLoading();
    audio.pause();
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
    });
    audio.addEventListener("waiting", () => {
      if (userWantsPlay) scheduleLoading();
    });
    audio.addEventListener("stalled", () => {
      if (userWantsPlay) scheduleLoading();
    });
    audio.addEventListener("pause", () => {
      clearPendingLoading();
      if (!userWantsPlay) setStatus("paused");
    });
    audio.addEventListener("error", () => {
      clearPendingLoading();
      setStatus("error");
    });
  }

  async function init() {
    wireEvents();
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
