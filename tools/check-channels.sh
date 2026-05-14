#!/usr/bin/env bash
# Validate every channel in channels.json: confirm the URL is reachable and
# compare the configured bitrate against what we can probe.
# Usage: tools/check-channels.sh [path/to/channels.json]
#
# Output is a tab-separated table:
#   NAME  HTTP  CONTENT-TYPE  CONFIG_KBPS  PROBED_KBPS  SOURCE  STATUS
# STATUS is "ok" if HTTP 2xx/206 and probed bitrate matches config (or is
# unknown). "MISMATCH" if probed bitrate differs by more than 10%. "FAIL"
# if the stream is unreachable.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
json="${1:-$(cd "$HERE/.." && pwd)/htdocs/channels.json}"

if [ ! -f "$json" ]; then
  echo "channels.json not found: $json" >&2
  exit 1
fi

probe="$HERE/probe-stream.sh"
chmod +x "$probe" 2>/dev/null || true

# Header
printf "%-44s %-5s %-30s %-7s %-7s %-11s %s\n" \
  "NAME" "HTTP" "CONTENT-TYPE" "CONFIG" "PROBED" "SOURCE" "STATUS"

python3 -c "
import json, sys
for c in json.load(open(sys.argv[1])):
    print('\t'.join([c['name'], c['url'], str(c.get('bitrate',''))]))
" "$json" |
while IFS=$'\t' read -r name url config_br; do
  line=$("$probe" "$url" 2>/dev/null || echo $'?\t?\t?\tunknown')
  IFS=$'\t' read -r code ctype probed_br src <<<"$line"

  status="ok"
  case "$code" in
    2*|206) ;;
    *) status="FAIL" ;;
  esac

  if [ "$status" = "ok" ] && [ -n "$config_br" ] && [ "$probed_br" != "?" ]; then
    # >10% difference flagged
    diff=$(python3 -c "
c=$config_br
p=$probed_br
print('mismatch' if c and p and abs(c-p)/max(c,p) > 0.10 else 'ok')
" 2>/dev/null || echo "ok")
    [ "$diff" = "mismatch" ] && status="MISMATCH"
  fi

  printf "%-44s %-5s %-30s %-7s %-7s %-11s %s\n" \
    "$name" "${code:-?}" "${ctype:0:30}" "${config_br:-?}" "${probed_br:-?}" "${src:-?}" "$status"
done
