#!/usr/bin/env bash
# Find the stream URL that a station's landing page publishes for end-user
# playback (icecast/HLS endpoints, embedded player configs, etc.).
# Usage: tools/find-stream-url.sh <page-url>
#
# Strategy (in order):
#   1. Direct media URLs in the HTML (href/src ending in .aac/.mp3/.m3u8/.pls).
#   2. Streaming hosts referenced in the HTML (icecast.*, *.akamaized.net,
#      *.leviracloud.eu, *.nelonenmedia.fi, *.radioplay.fi, etc).
#   3. WordPress "radio-player" plugin: decode the base64 `data-data` attribute
#      and read the `stream` field. Used by sites like bigfm.ee and xfm.ee.
#   4. Linked JS chunks (Next.js _app/_index) — grep for stream-like URLs.
#
# Not a silver bullet — many sites only load the URL on user interaction with
# their own player. For those, read the audio URL from your browser's
# DevTools Network tab (filter "m3u8" or "Media") while the broadcaster's
# site is playing the stream.
set -euo pipefail

page="${1:-}"
if [ -z "$page" ]; then
  echo "Usage: $0 <page-url>" >&2
  exit 2
fi

html=$(curl -sL --max-time 10 -A "Mozilla/5.0" "$page")

# 1) Direct media URLs
direct=$(printf '%s' "$html" | grep -oE 'https?://[^"'"'"' <>]+\.(aac|mp3|m3u8|m3u|pls)[^"'"'"' <>]*' | sort -u)
if [ -n "$direct" ]; then
  echo "# direct media URLs:"
  echo "$direct"
  echo
fi

# 2) Known streaming host patterns
hosts=$(printf '%s' "$html" | grep -oE 'https?://[^"'"'"' <>]*(icecast|akamaized|leviracloud|nelonenmedia|radioplay\.fi|euddn|rcast|flamebox|radiotaajuus|fastly|revma)[^"'"'"' <>]*' | grep -ivE '\.(jpg|png|svg|webp|ico|woff|ttf|css|js|html)' | sort -u)
if [ -n "$hosts" ]; then
  echo "# streaming hosts referenced in HTML:"
  echo "$hosts"
  echo
fi

# 3) radio-player WordPress plugin: data-data is base64-encoded JSON with a "stream" field
b64=$(printf '%s' "$html" | grep -oE 'data-data="[A-Za-z0-9+/=]{40,}"' | head -1 | sed 's/data-data="//;s/"$//')
if [ -n "$b64" ]; then
  decoded=$(printf '%s' "$b64" | base64 -d 2>/dev/null || true)
  if [ -n "$decoded" ]; then
    echo "# decoded data-data (radio-player WP plugin):"
    printf '%s' "$decoded" | python3 -m json.tool 2>/dev/null | grep -iE '"(title|stream)"' || printf '%s\n' "$decoded"
    echo
  fi
fi

# 4) Linked JS chunks (Next.js / generic SPA)
chunks=$(printf '%s' "$html" | grep -oE '/_next/static/chunks/[a-zA-Z0-9._/-]+\.js' | sort -u)
if [ -n "$chunks" ]; then
  origin=$(printf '%s' "$page" | grep -oE 'https?://[^/]+')
  echo "# scanning Next.js chunks for stream-like URLs:"
  for c in $chunks; do
    found=$(curl -sL --max-time 6 -A "Mozilla/5.0" "${origin}${c}" 2>/dev/null | \
      grep -oE 'https?://[^"'"'"' \\]+\.(aac|mp3|m3u8|m3u|pls)[^"'"'"' \\]*' | sort -u || true)
    if [ -n "$found" ]; then
      echo "  via $c:"
      echo "$found" | sed 's/^/    /'
    fi
  done
fi
