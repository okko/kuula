(() => {
  const STORAGE_KEY = "kuula.channelIndex";

  const audio = document.getElementById("audio");
  const display = document.getElementById("display");
  const channelNameEl = document.getElementById("channel-name");
  const statusEl = document.getElementById("status");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");

  let channels = [];
  let currentIndex = 0;
  let userWantsPlay = false;

  const STATUS = {
    paused:   { text: "◼ PAUSED",      state: "paused" },
    loading:  { text: "⋯ TUNING",      state: "loading" },
    playing:  { text: "▸ NOW PLAYING", state: "playing" },
    error:    { text: "⚠ OFFLINE",     state: "error" },
    empty:    { text: "— NO CHANNELS —", state: "error" },
  };

  function setStatus(kind) {
    const s = STATUS[kind];
    let text = s.text;
    if (kind === "playing") {
      const ch = channels[currentIndex];
      const suffix = ch && ch.bitrate ? String(ch.bitrate) : null;
      if (suffix) text += " / " + suffix;
    }
    statusEl.textContent = text;
    statusEl.dataset.state = s.state;
  }

  function renderChannel() {
    if (!channels.length) {
      channelNameEl.textContent = "— — —";
      setStatus("empty");
      return;
    }
    channelNameEl.textContent = channels[currentIndex].name;
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
    tuneTo(currentIndex + delta, { play: userWantsPlay });
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

    audio.addEventListener("playing", () => setStatus("playing"));
    audio.addEventListener("waiting", () => {
      if (userWantsPlay) setStatus("loading");
    });
    audio.addEventListener("pause", () => {
      if (!userWantsPlay) setStatus("paused");
    });
    audio.addEventListener("error", () => setStatus("error"));
    audio.addEventListener("stalled", () => {
      if (userWantsPlay) setStatus("loading");
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
