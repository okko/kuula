#!/usr/bin/env bash
# Build htdocs/channels_fr.json from the curated French station table below.
# Stream URLs are fetched live from the French Radioplayer API
# (https://api.radioplayer.fr/v2), so re-running this tool refreshes any URL
# a broadcaster has changed. The player reads the static output file; it
# never calls the API itself.
#
# Auth: the API expects the same HTTP Basic credentials the radioplayer.fr
# website ships in its public JS bundle (static/js/main.*.js) — every browser
# visiting the site downloads them, so using them here is equivalent to using
# the official web player. (Unlike api.radioplayer.org, whose key is not
# exposed; see AGENTS.md "Finding a stream URL".)
#
# Per station this tool:
#   - GETs /v2/radios/<rpID>/streams
#   - keeps only https:// streams, preferring direct icecast over HLS,
#     then higher API-reported bitrate
#   - strips the query string (ad-insertion template placeholders such as
#     aw_0_1st.rpfr=~REQUEST_PREROLL~ — the bare URLs play fine without them)
#   - probes the real bitrate with tools/probe-stream.sh (the API's bitrate
#     field is unreliable), falling back to the API value with a warning
#
# Usage: tools/fetch-fr-channels.sh [output.json]
#   output defaults to htdocs/channels_fr.json
set -euo pipefail

API="https://api.radioplayer.fr/v2"
# Website credentials from radioplayer.fr's public JS bundle (see header).
BASIC_AUTH="siteweb:6Mh8Pc2nK"

# Curated station table: rpID|region|display name|cors
# cors: "false" routes the channel through the plain (non-metered) audio
# element; leave empty for CORS-clean streams. Verify in a real browser
# (AGENTS.md "CORS"), not with curl. Keep same-region rows contiguous —
# the player groups the indicator row by region.
STATIONS="
33|FR|NRJ|
149|FR MED|Kiss FM|
158|FR MED|Maritima|
188|FR MED|Radio Star|
160|FR MED|Mistral FM|
177|FR MED|Melody d'Azur|
39|FR MED|ici Azur|
73|FR MED|ici Provence|
1007|FR MED|Radio Monaco|
"

HERE="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$(cd "$HERE/.." && pwd)/htdocs/channels_fr.json}"

tsv="$(mktemp)"
raw="$(mktemp)"
trap 'rm -f "$tsv" "$raw"' EXIT

fail=0
while IFS='|' read -r rpid region name cors; do
  [ -z "$rpid" ] && continue
  echo "[$rpid] $name ..." >&2

  if ! curl -fsS --max-time 30 -u "$BASIC_AUTH" \
      "$API/radios/$rpid/streams" -o "$raw"; then
    echo "[$rpid] $name: API request failed — skipping" >&2
    fail=1
    continue
  fi

  # Pick the best stream: https only, icecast before hls, then highest
  # API-reported bitrate. Prints "url<TAB>api_kbps" or nothing.
  picked=$(python3 - "$raw" <<'PY'
import json, sys

data = json.load(open(sys.argv[1]))
streams = [
    s for s in data.get("streams", [])
    if isinstance(s.get("url"), str) and s["url"].startswith("https://")
    and s.get("quality") in ("icecast", "hls")
]
if not streams:
    sys.exit(0)
streams.sort(key=lambda s: (s["quality"] != "icecast",
                            -(s.get("bitrate") or 0)))
best = streams[0]
url = best["url"].split("?")[0]
kbps = round((best.get("bitrate") or 0) / 1000)
print("%s\t%s" % (url, kbps or ""))
PY
)
  if [ -z "$picked" ]; then
    echo "[$rpid] $name: no https icecast/hls stream offered — skipping" >&2
    fail=1
    continue
  fi
  url="${picked%%	*}"
  api_kbps="${picked#*	}"

  probe=$("$HERE/probe-stream.sh" "$url")
  code=$(echo "$probe" | cut -f1)
  kbps=$(echo "$probe" | cut -f3)
  case "$code" in
    2*) ;;
    *)
      echo "[$rpid] $name: stream probe failed (HTTP $code) for $url — skipping" >&2
      fail=1
      continue
      ;;
  esac
  if [ "$kbps" = "?" ]; then
    if [ -n "$api_kbps" ]; then
      echo "[$rpid] $name: bitrate not probeable; using API value ${api_kbps} kbps" >&2
      kbps="$api_kbps"
    else
      echo "[$rpid] $name: bitrate unknown (no icy/HLS/API hint); writing 128 — verify manually" >&2
      kbps=128
    fi
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' "$region" "$name" "$url" "$kbps" "$cors" >>"$tsv"
done <<<"$STATIONS"

python3 - "$tsv" "$out" <<'PY'
import json, sys

entries = []
for line in open(sys.argv[1]):
    region, name, url, kbps, cors = line.rstrip("\n").split("\t")
    entry = {"region": region, "name": name, "url": url, "bitrate": int(kbps)}
    if cors == "false":
        entry["cors"] = False
    entries.append(entry)

if not entries:
    print("No channels produced — refusing to write an empty file", file=sys.stderr)
    sys.exit(1)

with open(sys.argv[2], "w") as f:
    json.dump(entries, f, indent=2, ensure_ascii=False)
    f.write("\n")

print("Wrote %d channels to %s" % (len(entries), sys.argv[2]), file=sys.stderr)
PY

exit $fail
