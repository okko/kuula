#!/usr/bin/env bash
# Probe a radio stream URL: validate reachability and determine bitrate.
# Usage: tools/probe-stream.sh <url>
#
# Output: tab-separated  HTTP_CODE  CONTENT_TYPE  BITRATE_KBPS  SOURCE
# SOURCE explains where the bitrate came from:
#   icy-br      icecast/shoutcast Icy-Br header (needs WinampMPEG UA + Icy-MetaData: 1)
#   hls-master  highest BANDWIDTH= entry in an HLS master playlist
#   url-slug    derived from URL path (e.g. /256/variant.m3u8, _128.mp3, phr128-aac)
#   unknown     no reliable indicator
#
# Notes on icy-br:
#   - Many icecast/shoutcast servers only emit Icy-Br when the client
#     identifies itself as a streaming media player via a conventional
#     User-Agent (WinampMPEG/iTunes) AND advertises "Icy-MetaData: 1". HEAD
#     requests usually return no icy headers; this script always GETs a small
#     range. The UA is a protocol convention, not impersonation — icecast
#     uses it for content negotiation.
#   - Fastly/Akamai-fronted streams strip icy headers; for those, prefer HLS
#     BANDWIDTH instead.

# No `set -e`: many grep/awk steps may not match, which is expected.
set -uo pipefail

url="${1:-}"
if [ -z "$url" ]; then
  echo "Usage: $0 <url>" >&2
  exit 2
fi

UA="WinampMPEG/5.5"
hdr=$(mktemp)
body=$(mktemp)
cleanup() { rm -f "$hdr" "$body"; }
trap cleanup EXIT

# Pull headers + first ~2KB so we see icy headers and a manifest preview
curl -sL --max-time 6 -A "$UA" -H "Icy-MetaData: 1" -r 0-2048 \
  "$url" -D "$hdr" -o "$body" >/dev/null 2>&1 || true

# LC_ALL=C: icy-name often contains non-UTF-8 bytes; locale-aware tools choke
export LC_ALL=C

code=$(awk '/^HTTP\// {c=$2} END{print (c?c:"?")}' "$hdr")
ctype=$(grep -aiE '^content-type:' "$hdr" | tail -1 | sed -E 's/^[^:]+:[[:space:]]*//' | tr -d '\r\n')

br=""
src="unknown"

# 1) icy-br header (case-insensitive; -a treats binary headers as text)
icy=$(grep -aiE '^icy-br' "$hdr" | head -1 | sed -E 's/^[^:]+:[[:space:]]*//' | tr -d '\r\n ')
if [ -n "$icy" ]; then
  # icy-br may be "128" or "128,128" — take first numeric chunk
  br=$(echo "$icy" | grep -oE '[0-9]+' | head -1)
  src="icy-br"
fi

# 2) HLS master playlist
if [ -z "$br" ] && echo "$ctype" | grep -qiE 'mpegurl|m3u'; then
  full=$(curl -sL --max-time 6 -A "Mozilla/5.0" "$url" 2>/dev/null || true)
  bw=$(echo "$full" | grep -oE 'BANDWIDTH=[0-9]+' | grep -oE '[0-9]+' | sort -nr | head -1)
  if [ -n "$bw" ]; then
    br=$((bw / 1000))
    src="hls-master"
  fi
fi

# 3) URL slug hints (last resort)
if [ -z "$br" ]; then
  slug_br=""
  # /<NN>/variant.m3u8 (Yle)
  slug_br=$(echo "$url" | grep -oE '/(64|96|128|160|192|224|256|320)/(variant|index|playlist)' | grep -oE '[0-9]+' | head -1)
  # _NN.mp3 / _NN.aac (Bauer / radioplay.fi)
  if [ -z "$slug_br" ]; then
    slug_br=$(echo "$url" | grep -oE '_[0-9]+\.(mp3|aac)' | grep -oE '[0-9]+' | head -1)
  fi
  # NNN-aac / NNN-mp3 (Leviracloud)
  if [ -z "$slug_br" ]; then
    slug_br=$(echo "$url" | grep -oE '[a-zA-Z]([0-9]{2,3})-(aac|mp3)' | grep -oE '[0-9]+' | head -1)
  fi
  # playlist-NNN000.m3u8 (Nelonen Elemental)
  if [ -z "$slug_br" ]; then
    nelo=$(echo "$url" | grep -oE 'playlist-[0-9]+\.m3u8' | grep -oE '[0-9]+' | head -1)
    [ -n "$nelo" ] && slug_br=$((nelo / 1000))
  fi
  if [ -n "$slug_br" ]; then
    br="$slug_br"
    src="url-slug"
  fi
fi

printf "%s\t%s\t%s\t%s\n" "${code:-?}" "${ctype:-?}" "${br:-?}" "$src"
