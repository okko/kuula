#!/usr/bin/env bash
# Serve the static site at htdocs/ for local development.
# Usage: tools/serve.sh [port]
#   port defaults to 8000.
set -euo pipefail

PORT="${1:-8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)/htdocs"

cd "$ROOT"
echo "Serving $ROOT at http://localhost:$PORT (Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
