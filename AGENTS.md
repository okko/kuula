# AGENTS.md — conventions for agentes

Read this before editing anything in this repo. The conventions below were
hard-won during initial development; following them keeps results consistent
when adding channels or changing the player.

## Repo layout

```
htdocs/   The static site (deployable as-is). Edit here for app changes.
tools/    Bash dev utilities. Reuse these — don't ad-hoc reinvent.
```

When making app changes, edit files under `htdocs/`. Never put dev tooling,
test fixtures, or `node_modules` under `htdocs/` — that directory is the
publish artifact.

## Stack

Vanilla HTML + CSS + JS. **No build step. No dependencies. No frameworks.**
If you're tempted to add npm, a bundler, TypeScript, or a framework, the
answer is almost always no — this is a 200-line app with a JSON config, and
the lack of tooling is the feature. The user explicitly chose this.

## Channels (`htdocs/channels.json`)

The URLs in `channels.json` are **public broadcast endpoints** that
broadcasters publish for direct playback. This app plays them in-place
via the user's browser — it does not re-host, proxy, transcode, strip
ads, or redistribute the audio. The connection is the same one the
broadcaster's own web player would make. When adding channels, respect
any explicit no-aggregation or terms-of-service requests from the
broadcaster, and prefer URLs the broadcaster has chosen to publish for
end-user playback.

Schema for each entry:

```json
{ "region": "EE", "name": "XFM", "url": "https://…", "bitrate": 224 }
```

- **`region`** — short country/region tag rendered as a cyan label in the
  info bar (e.g. `EE`, `FI HEL`). Channels with the same `region` value are
  grouped together in the indicator row with a visible gap between groups,
  so list them contiguously in the JSON.
- **`name`** — station name only, without the region prefix. Shown in the
  large channel-name slot (clamped to two lines).
- **`url`** — direct media URL. Required to be **HTTPS** unless the user
  explicitly opts in to an HTTP-only stream (mixed content blocks iOS Safari
  and modern Chrome). Common types we support natively:
  - icecast / shoutcast: `.mp3`, `.aac`, no path / generic mount
  - HLS: `.m3u8` (both `master.m3u8` and a specific `variant.m3u8`)
- **`bitrate`** — integer kbps. Required. Shown in the info bar on the right
  as `<bitrate> KBPS` while a channel is selected. Determine it via
  `tools/probe-stream.sh` before committing.
- **`cors`** — optional boolean, default `true`. Set to `false` for streams
  whose server does **not** grant CORS to this origin. CORS-clean channels play
  through a Web-Audio-wired `<audio>` element so the VU meter can read real L/R
  levels; `"cors": false` channels play through a **separate plain element**
  (never wired to Web Audio) so they stay audible, with a simulated meter.
  This matters because once an element is wired to Web Audio it is permanently
  routed through the graph, which outputs **silence** for any CORS-opaque
  (tainted) media — so a `cors:true` stream that the browser can't actually
  CORS-fetch goes silent. Known `"cors": false` as of last testing: the four
  `icecast.err.ee` ERR streams and all 13 `stream-redirect.bauermedia.fi`
  (Bauer) streams.
  **Determining CORS is manual** — only a real browser is authoritative.
  `curl`/`tools/probe-stream.sh` are unreliable here: servers reflect the
  `Origin` header even when the browser blocks the request (notably across the
  Bauer 302 redirect, where CORS must pass on *every* hop). Test by loading the
  channel in the app from the deploy origin and confirming audio is audible; a
  CORS failure shows in the browser console as "No 'Access-Control-Allow-Origin'
  header". If a server changes its policy, flip this flag — there is no runtime
  auto-detection.

Order matters: channels are cycled with left/right arrows in array order.
Keep regional groups together (all `FI HEL` first, then `EE`, …) so cycling
within a region is easy. Current order in the repo: `FI HEL` first, then
`EE`. Within each region, follow the sort order documented in
[README.md § Channel sort order](README.md#channel-sort-order).

## Finding a stream URL

In rough order of effort:

1. **Try `tools/find-stream-url.sh <station-page-url>`.** Catches the easy
   cases: direct `.aac`/`.mp3`/`.m3u8` URLs in the HTML, known streaming
   host patterns (icecast, akamaized, leviracloud, nelonenmedia, …), and the
   WordPress radio-player plugin's base64-encoded config.

2. **Public directory: radio-browser.info.** For Finnish/Estonian stations
   especially:
   ```
   curl 'https://de1.api.radio-browser.info/json/stations/bycountry/Finland?limit=400'
   ```
   This often has multiple URLs per station; prefer the HTTPS one with the
   highest bitrate.

3. **Browser DevTools while playing on the broadcaster's site.** Open the
   station's landing page or `play.radioplayer.org` in Chrome, open
   DevTools → Network tab, filter `m3u8` or `Media`, click play, and read
   the audio URL the player connects to. This is the URL the broadcaster
   serves to end users; asking the user to do this for a list of stations
   is often the fastest path.

4. **Try known slug patterns** when an obvious one exists. The patterns
   below are observable from the broadcasters' own publicly published
   stream URLs — keep them up to date if a broadcaster changes their
   scheme:
   - Nelonen Media main brands: `https://aud-stream-<slug>.nm-elemental.nelonenmedia.fi/playlist-256000.m3u8`
   - Nelonen Media sub-brands: `https://ext-stream-pl<NN>.nm-elemental.nelonenmedia.fi/HE<X>/master.m3u8`
     (the `pl<NN>` is CDN-origin and is interchangeable; the `HE<X>` letter
     code identifies the channel)
   - Bauer / radioplay.fi: `https://streaming.radioplay.fi/<slug>/<slug>_128.mp3`
   - ERR icecast: `https://icecast.err.ee/<station>.mp3` — full list at
     `https://icecast.live.yle.fi/status.xsl` style endpoints if available
   - Yle Areena highest bitrate: `https://yleradiolive.akamaized.net/hls/live/<id>/in-<Name>/256/variant.m3u8`
     (always pin the explicit `/256/variant.m3u8` — `master.m3u8` is adaptive
     and may pick a lower variant)
   - Leviracloud (Estonia, TV3): `https://ice.leviracloud.eu/<slug>128-aac`
     or `…-mp3`. Slugs include `phr` (Power Hit Radio), `star`, `starFMEesti`,
     `aripaev`.

5. **Last resort: an authenticated API.** play.radioplayer.org loads stream
   URLs from `api.radioplayer.org` with a key not exposed in static JS, so
   calling it from outside the official client isn't a path we pursue.
   Ask the user to read the URL from DevTools on the broadcaster's site
   instead.

Always verify with `tools/probe-stream.sh <url>` before committing. A 200/206
response with an `audio/*` content type confirms the stream is reachable.

## Determining bitrate

Use `tools/probe-stream.sh`. Its strategy and quirks:

1. **`Icy-Br` header** — most icecast/shoutcast servers expose this *only*
   when the client looks like a media player. The script uses
   `User-Agent: WinampMPEG/5.5` and `Icy-MetaData: 1`. HEAD requests usually
   return no icy headers; the script does a small GET range.

2. **HLS `BANDWIDTH` in master.m3u8** — if the URL is a `.m3u8` master
   playlist, the highest `BANDWIDTH=…` STREAM-INF entry is taken as the
   stream's max bitrate.

3. **URL slug** — patterns like `_128.mp3`, `phr128-aac`, `/256/variant.m3u8`,
   `playlist-256000.m3u8` are parsed as last-resort hints.

4. **Unknown** — fall back to 128 (common default) and flag for manual check.
   Don't guess silently; the `tools/check-channels.sh` script will report
   "unknown" so you know to follow up.

**Do not** "measure" bitrate by timing a download — icecast servers send a
buffered burst on connect, inflating the apparent rate by 2-5×. Always prefer
headers or HLS metadata.

## App behavior (`htdocs/app.js`)

Things that look load-bearing and are:

- **`preload="none"` on `<audio>`** — without it, iOS Safari auto-loads the
  first channel and the user's first interaction may not register as a gesture.
- **Two `<audio>` elements** — `#audio` is wired into the Web Audio graph
  (`crossorigin="anonymous"`, set once) and plays CORS-clean channels for real
  metering; `#audio-plain` is never wired and plays `"cors": false` channels so
  they stay audible (with a simulated meter). `tuneTo()` selects the element by
  the channel's `cors` flag, pauses the other, and updates the `audio` pointer.
  This split is required because `createMediaElementSource` permanently routes
  its element through the graph, which silences CORS-opaque media — a single
  shared element would mute every `cors:false` stream. See the `cors` field
  under "Channels". There is no runtime CORS auto-detection (an earlier silence
  watchdog was removed — it couldn't un-taint audio, only the meter).
- **First `audio.play()` must come from a click/keydown handler** — iOS
  autoplay policy.
- **`localStorage` persistence of `currentIndex`** (`kuula.channelIndex`) —
  clamp to range on load in case channels.json shrank. The VU meter mode
  (`kuula.vuMode`: `off`/`led`/`needle`) is persisted under its own key.
- **Web Audio graph built once, from a user gesture.** `AudioContext` +
  `createMediaElementSource(#audio)` are created lazily inside `togglePlay`/
  `step` (iOS needs a gesture to start/resume the context).
  `createMediaElementSource` may be called **only once per element**, captures
  only the dedicated `#audio` element (never `#audio-plain`), and the source
  **must** `connect(audioCtx.destination)` or routing through Web Audio silences
  playback. The meter only runs `requestAnimationFrame` while playing and the
  mode isn't `off`; real vs simulated is decided by which element is active
  (`audio === audioWA`).
- **Bitrate suffix only shown for `▸ NOW PLAYING` state** — adding it to
  `◼ PAUSED` would be noise; the user explicitly asked for it under "now playing".

## Styling (`htdocs/styles.css`)

80s hi-fi tuner aesthetic. Cool charcoal matte panel
(`linear-gradient(180deg, #2a2c30 0%, #1c1d20 60%)`) with a single cyan
accent (`#00f0ff`); the display, arrow buttons, and active indicator all
draw from the same `--cyan*` variables. Subtle scanline overlay via body
`::before` `repeating-linear-gradient` at low opacity. VT323 font from
Google Fonts (Courier New fallback). Use `100dvh` not `100vh` for layout
height — iOS Safari's URL bar otherwise causes a jump. No magenta or
sunset gradient — those were dropped in favour of the matte-grey look.

## What not to add

- A backend, a database, a build tool, an npm install
- hls.js (Chrome and Safari now do HLS natively in `<audio>`)
- A framework or component library
- Documentation files unless the user asks (this file and README.md were
  explicitly requested)
- Emojis in code or UI unless the user asks

## Where the channel list came from

The initial list in `htdocs/channels.json` was compiled from two public
sources. When entries break and you need to refresh, start by re-checking
these:

- **Estonian (`EE …`)** — compiled from the public station index at
  <https://dabplus.ee/> ("Raadiojaamad" section), then each station's own
  landing page was visited to read the stream URL it publishes for
  listeners. See the patterns under "Finding a stream URL" above.
- **Helsinki, Finland (`FI HEL …`)** — the station list was read from the
  publicly displayed "Local Radio Helsinki" carousel on
  <https://play.radioplayer.org/en> (and `radioplayer.fi`). The carousel
  shows station names and Radioplayer station IDs (e.g. `246204`) but not
  stream URLs, so the URLs were looked up in radio-browser.info and, for
  Nelonen Media and Bauer/radioplay.fi stations, via the publicly
  observable URL patterns (`aud-stream-*` / `ext-stream-pl0X/HE*` /
  `_128.mp3`). For a handful (POPfm, Kaupunkiradio, the Nelonen sub-brand
  HLS URLs) the stream URL was read from the browser's network log while
  playing the station on the broadcaster's own web player — i.e. the same
  URL the broadcaster serves to anyone using the official site.

When adding more regions/countries, prefer this rough order:

1. Find a public station directory or DAB+ portal for the region.
2. Cross-reference each station with radio-browser.info for stream URLs.
3. For stations not in radio-browser, visit the station's own page (or
   use `tools/find-stream-url.sh`) and read the URL the broadcaster
   publishes for end-user playback.
4. For everything else, ask the user to grab the URL from DevTools.

## Verifying changes

Before reporting work done:

1. `./tools/check-channels.sh` — confirm every channel still reaches and the
   configured bitrate matches what's probed (`STATUS=ok`).
2. `./tools/serve.sh` and load the app in a browser — confirm the new
   channel(s) appear and at least one plays.
3. If you changed `app.js` behavior, test play/pause, arrow cycling, and the
   "now playing / N" indicator in at least one browser.

## Decisions and gotchas

Why the code looks how it does — the *why* behind things you might be tempted
to "simplify":

- **No `hls.js`.** Both desktop Chrome (since around M124, mid-2024) and
  Safari on iOS now play HLS in a plain `<audio>` element natively. Confirmed
  empirically by the user listening to Yle's HLS streams in Chrome. Adding
  `hls.js` would be ~50KB of dead weight.
- **Yle URLs use `/256/variant.m3u8`, not `master.m3u8`.** `master.m3u8` is
  adaptive — on a flaky network the player can drop to 64kbps. The user
  explicitly asked for "highest bitrate for Yle channels", so we pin the
  256kbps variant directly. Cost: no graceful degradation on poor networks.
- **Nelonen `ext-stream-pl0X/HE<X>/master.m3u8`** — `pl01`–`pl10` are
  interchangeable CDN origins; the `HE<X>` letter code identifies the
  channel. So `pl09/HEH` and `pl05/HEH` serve identical content. We keep
  whichever `pl0X` the broadcaster's player used — no value in normalizing.
- **Two audio elements, not `crossorigin` on one.** The VU meter needs a
  CORS-clean element to read samples, but wiring the single `<audio>` to Web
  Audio silences every CORS-opaque stream (the graph outputs zeros for tainted
  media). So there are two elements: `#audio` (Web-Audio-wired, CORS-clean
  channels, real meter) and `#audio-plain` (everything `"cors": false`, audible,
  simulated meter). CORS support is tracked **manually** per channel — `curl`
  can't tell, because servers reflect `Origin` even when the browser blocks the
  fetch (e.g. the Bauer `stream-redirect` 302, where every redirect hop must
  pass CORS). Known no-CORS: the four `icecast.err.ee` streams and all 13
  `stream-redirect.bauermedia.fi` streams. No runtime auto-detection — flip the
  `cors` flag when a server's policy changes.
- **`preload="none"`.** iOS Safari otherwise eagerly fetches the first
  channel, which can desynchronise the autoplay-gesture requirement on first
  load.
- **Bitrate suffix shown only during `▸ NOW PLAYING`.** Adding it to
  `◼ PAUSED` is noise; the user asked for it specifically under "now playing".
- **`EE Duo Party` URL anomaly.** The URL currently published on
  `duoparty.pleier.ee` serves MyHits Rock content rather than Duo Party
  programming; we use `duodance.aac` (verified by the user as the correct
  Duo Party feed). Don't "correct" it back to what the publisher's page
  shows until they update it.
- **`FI HEL Kiekkokierros` intentionally omitted.** It's a rebrand of
  `Classic Hits` — same stream. Adding it would just duplicate a channel.
- **Radio Dei uses `/radioplayer/helsinki`**, not the older
  `isojako.radiodei.fi:8000/helsinki` URL. Both exist; the former is HTTPS,
  the latter HTTP-only and blocked as mixed content on iOS/Chrome.
- **`localStorage` index clamp.** If the channel list shrinks (e.g. a
  station is removed), a saved `currentIndex` past the new end would crash
  the lookup — `loadIndex(maxLen)` clamps to `0..maxLen-1`.
- **Why no playlist UI / favorites / search?** Out of scope by design.
  Two buttons, retro aesthetic, that's the product. Don't add features the
  user didn't ask for.
