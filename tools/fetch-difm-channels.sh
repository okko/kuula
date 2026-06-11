#!/usr/bin/env bash
# Fetch the DI.FM channel directory once and write it to
# htdocs/channels_difm.json. The player reads this static file instead of
# calling the DI.FM API on every load — run this tool only when you want to
# refresh the channel list.
#
# Each entry keeps just the channel key and display name. The player builds
# the Ultra (320 kbit/s MP3) stream URL at runtime as
#   http://prem1.di.fm/<key>_hi?<listenKey>
# (hosts prem1/prem2/prem4.di.fm, per DI.FM's own premium_high .pls; HTTP
# only, no TLS) using the listen key the user saved in Settings (localStorage
# kuula.difmListenKey). These streams are CORS-opaque, so the player routes
# them through its plain (non-metered) audio element.
#
# Usage: tools/fetch-difm-channels.sh [output.json]
#   output defaults to htdocs/channels_difm.json
set -euo pipefail

API="https://api.audioaddict.com/v1/di/channels"

HERE="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$(cd "$HERE/.." && pwd)/htdocs/channels_difm.json}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Fetching DI.FM channels from $API ..." >&2
curl -fsS --max-time 30 -H 'User-Agent: Mozilla/5.0' "$API" -o "$tmp"

python3 - "$tmp" "$out" "$API" <<'PY'
import json, sys

raw_path, out_path, api = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(raw_path))

channels = [
    {"key": c["key"], "name": c["name"].strip()}
    for c in data
    if c.get("key") and c.get("name")
]
channels.sort(key=lambda c: c["name"].lower())

out = {
    "_comment": (
        "DI.FM channel directory, fetched from " + api + " by "
        "tools/fetch-difm-channels.sh . The player builds each Ultra "
        "(320 kbit/s MP3) stream URL as http://prem1.di.fm/{key}_hi?{listenKey} "
        "(HTTP-only premium hosts prem1/prem2/prem4.di.fm) using the listen "
        "key from Settings (localStorage kuula.difmListenKey). "
        "These streams are CORS-opaque, so they play via the plain audio "
        "element. Re-run the tool to refresh."
    ),
    "region": "DI.FM",
    "bitrate": 320,
    "channels": channels,
}

with open(out_path, "w") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
    f.write("\n")

print("Wrote %d channels to %s" % (len(channels), out_path), file=sys.stderr)
PY
