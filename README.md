# Kuula – Web Radio Player

A minimalist Internet radio player.
Two arrow buttons cycle channels; tap the display to play/pause. Built as a
static site — no backend, no build step.

The URLs in [`channels.json`](htdocs/channels.json) are public broadcast
endpoints the broadcasters publish for direct end-user playback. The app
does not re-host, proxy, transcode, strip ads, or redistribute audio —
your browser connects directly to the broadcaster, the same connection
the broadcaster's own web player would make. Please respect each
broadcaster's terms of service and any geographic or authentication
restrictions they enforce.

The look: 80s hi-fi tuner — matte charcoal panel with a single cyan accent,
faint scanline overlay, VT323 pixel font. A row of small position indicators
across the top of the panel shows how many channels there are and which one
is selected; region (`EE`, `FI HEL`) and bitrate sit in the info bar below.

## Layout

```
htdocs/         Deployable site (this is what you upload to a static host)
  index.html
  styles.css
  app.js
  channels.json
  channels_difm.json

tools/          Dev utilities (not deployed)
  serve.sh                Start a local dev server
  probe-stream.sh         Validate one stream URL and detect bitrate
  check-channels.sh       Run probe-stream over every entry in channels.json
  find-stream-url.sh      Find the stream URL a station's landing page publishes
  fetch-difm-channels.sh  Refresh channels_difm.json from the DI.FM API

AGENTS.md       Conventions for agentes working on this repo
```

## Develop

```sh
./tools/serve.sh           # http://localhost:8000
./tools/serve.sh 8080      # different port
```

Edit files under `htdocs/` and refresh. There's no build step.

## Deploy

The contents of `htdocs/` are pure static files. Drop them on any static host:

- GitHub Pages (point at `htdocs/`)
- Netlify / Cloudflare Pages / Vercel (publish dir = `htdocs`)
- S3 / GCS / Azure Static Web Apps
- Any nginx/apache document root

`channels.json` is fetched at runtime, so the deployment must serve over HTTP(S)
— double-clicking `index.html` won't work (browsers block `fetch` from `file://`).

## Channel list

Configured in [`htdocs/channels.json`](htdocs/channels.json). Each entry:

```json
{
  "region": "EE",
  "name":   "XFM",
  "url":    "https://stream1.rcast.net/73328",
  "bitrate": 224
}
```

- **`region`** — short country/region tag rendered as a cyan label in the
  info bar (e.g. `EE`, `FI HEL`). Channels sharing the same `region` are
  visually grouped in the indicator row; list them contiguously in the JSON.
- **`name`** — station name only, without the region prefix. Shown in the
  large channel-name slot (clamped to two lines).
- **`url`** — direct media URL: icecast/shoutcast (`.mp3`, `.aac`), or HLS
  (`.m3u8`). Use HTTPS — iOS Safari and modern Chrome block HTTP audio from
  HTTPS pages as mixed content.
- **`bitrate`** — integer kilobits/sec. Shown in the info bar on the right
  with a " KBPS" suffix.

### Channel sort order

Within each region, channels follow this fixed order:

**`FI HEL` (Finnish, Helsinki)**
1. Radio Helsinki — always first.
2. Yle channels — alphabetically by name: Yle Klassinen, Yle Radio 1,
   Yle Radio Suomi Helsinki, Yle Vega, Yle X3M, YleX.
3. All other Finnish channels — alphabetically by name. Finnish characters
   (Ä, Ö) sort after Z, matching Finnish alphabetical convention.

**`EE` (Estonian)**
All channels alphabetically by name. Estonian/Finnish special characters
(Ä, Ö, Õ) sort after Z.

Before committing a new channel: run `./tools/check-channels.sh` and confirm
each new entry shows `STATUS=ok`. See [`AGENTS.md`](AGENTS.md) for the full
conventions (how to find a stream URL, how to determine bitrate, browser
compatibility notes, etc).

## DI.FM channels (optional, HTTP origin only)

If you have a paid [DI.FM](https://www.di.fm) subscription, open Settings
(the gear button) and save your listen key (from
[di.fm/settings](https://www.di.fm/settings)). The player then appends every
channel from [`htdocs/channels_difm.json`](htdocs/channels_difm.json) as an
Ultra 320 kbit/s MP3 stream (`http://prem1.di.fm/<channel>_hi?<listenKey>`).
The key is stored only in your browser's `localStorage` and is sent only to
DI.FM as part of the stream URL.

**DI.FM is HTTP-only.** DI.FM's listen-key stream servers have no HTTPS
endpoint — none of their stream hosts speaks TLS on any port, and all of
their APIs hand out `http://` URLs only (this applies to the whole
AudioAddict network: RadioTunes, JazzRadio, RockRadio, ClassicalRadio,
ZenRadio; verified June 2026). Browsers block HTTP audio inside an HTTPS
page as mixed content, so:

- **HTTP origin** (e.g. `./tools/serve.sh` → `http://localhost:8000`, or any
  HTTP deploy): DI.FM channels work.
- **HTTPS deploy** (GitHub Pages, Netlify, …): DI.FM cannot work. The app
  hides the Settings button, ignores any saved key, and adds no DI.FM
  channels — everything else keeps working as before.

This is DI.FM's limitation, not the app's; there is no HTTPS stream URL to
switch to. See [`AGENTS.md`](AGENTS.md) for the verification details.

## Browser support

Targets desktop Chrome and Safari on iOS. Audio playback uses a single plain
`<audio>` element — both browsers handle HLS in `<audio>` natively as of 2024
(no hls.js needed), as well as all standard icecast/shoutcast formats.

First play must come from a user gesture (tap or click) — that's an iOS Safari
autoplay constraint. The display panel itself is the play/pause control.

## License

[MIT](LICENSE) © 2026 Oskari Okko Ojala. The license covers the code in this
repository. It does not grant any rights to the broadcast audio you connect
to via `channels.json` — that audio remains owned by the respective
broadcasters under their own terms.
