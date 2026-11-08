#!/usr/bin/env bash
# Identity-edit fidelity harness (AUDIT-EDIT-FIDELITY.md). Re-run after fixes:
#   docs/superpowers/plans/2026-11-09-m5b-pemisahan-teks/harness/run.sh [OUT_DIR]
# Starts a private API on 127.0.0.1:19400 if none answers there (data in $OUT/.data), runs the web code path
# (vitest from apps/web, no Next server, no `next build`), bakes every editable paragraph of references/*.pdf
# unchanged, compares, classifies. Env: EDIT_MODE=typo for the one-character-edit variant; ONLY=<pdf substring>.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${EDITH_REPO:-$(cd "$HERE/../../../../.." && pwd)}"
OUT="${1:-/private/tmp/claude-501/audit3/out}"
PORT=19400
export EDITH_API="http://127.0.0.1:$PORT" OUT REFS="${REFS:-$REPO/references}"
mkdir -p "$OUT"
PY="$REPO/apps/api/.venv/bin/python"
if ! curl -sf "$EDITH_API/health" >/dev/null; then
  mkdir -p "$OUT/.data"
  (cd "$REPO/apps/api" && EDITH_DATA_DIR="$OUT/.data" EDITH_TTL_SECONDS=86400 \
     .venv/bin/uvicorn edith.main:app --host 127.0.0.1 --port $PORT >"$OUT/api.log" 2>&1 &)
  for _ in $(seq 1 50); do curl -sf "$EDITH_API/health" >/dev/null && break; sleep 0.2; done
fi
(cd "$REPO/apps/web" && npx vitest run --config "$HERE/vitest.config.mts")
"$PY" "$HERE/compare.py" "$OUT" "$REFS"
"$PY" "$HERE/classify.py" "$OUT"
"$PY" "$HERE/decor.py" "$OUT" "$REFS"
echo "results: $OUT/classified.json (per paragraph), $OUT/<pdf>/p<page>_<gid>.pdf|.op.json (exports)"
