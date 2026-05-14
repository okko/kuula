# raadio

A minimal-UI internet radio player for private, non-commercial personal use.
Two arrow buttons cycle channels; tap the display to play/pause. Built as a
static site — no backend, no build step.

The URLs in [`channels.json`](htdocs/channels.json) are public broadcast
endpoints the broadcasters publish for direct end-user playback. The app
does not re-host, proxy, transcode, strip ads, or redistribute audio —
your browser connects directly to the broadcaster, the same connection
the broadcaster's own web player would make. Please respect each
broadcaster's terms of service and any geographic or authentication
restrictions they enforce.

Style: 80s synthwave (neon magenta/cyan on black, scanlines, VT323 font).

## Layout

```
htdocs/         Deployable site (this is what you upload to a static host)
  index.html
  styles.css
  app.js
  channels.json

tools/          Dev utilities (not deployed)
  serve.sh           Start a local dev server
  probe-stream.sh    Validate one stream URL and detect bitrate
  check-channels.sh  Run probe-stream over every entry in channels.json
  find-stream-url.sh Find the stream URL a station's landing page publishes

AGENTS.md       Conventions for future Claude/AI agents working on this repo
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
  "name": "EE XFM",
  "url":  "https://stream1.rcast.net/73328",
  "bitrate": 224
}
```

- **`name`** — shown on the display. Prefix with a country/region tag
  (`EE`, `FI HEL`, …) so the list stays scannable.
- **`url`** — direct media URL: icecast/shoutcast (`.mp3`, `.aac`), or HLS
  (`.m3u8`). Use HTTPS — iOS Safari and modern Chrome block HTTP audio from
  HTTPS pages as mixed content.
- **`bitrate`** — integer kilobits/sec. Shown next to "NOW PLAYING".

Before committing a new channel: run `./tools/check-channels.sh` and confirm
each new entry shows `STATUS=ok`. See [`AGENTS.md`](AGENTS.md) for the full
conventions (how to find a stream URL, how to determine bitrate, browser
compatibility notes, etc).

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
