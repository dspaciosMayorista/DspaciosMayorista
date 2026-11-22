#!/usr/bin/env bash
# REL-3 test: rel2_exportar_viejo.sh must be non-destructive. Refusal cases use sentinel directories/files created by THIS test (plus, read-only, the retained old export if it exists);
# the only deletion is of the temporary folder this test itself created (never through the exporter), after unlinking its node_modules junction.
# Usage (Git Bash):  bash supabase/scripts/release_rel2/test_rel2_exportar_viejo.sh
set -u
export MSYS_NO_PATHCONV=1
AQUI="$(cd "$(dirname "$0")" && pwd)"
EXP="$AQUI/rel2_exportar_viejo.sh"
FALLAS=0; TOTAL=0
ok() { TOTAL=$((TOTAL+1)); if [ "$1" = 0 ]; then echo "  ok   $2"; else echo "  FAIL $2"; FALLAS=$((FALLAS+1)); fi; }
snap() { ( cd "$1" && find . -path ./node_modules -prune -o -print -printf '%p %y %s %T@\n' 2>/dev/null | sort; find . -type f -not -path './node_modules/*' -exec sha256sum {} + 2>/dev/null | sort ) | sha256sum | cut -c1-24; }

echo "== static: the exporter contains no deletion command"
grep -nE '(^|[^A-Za-z_])(rm|rmdir|unlink)([[:space:]]|$)|mklink /D|find .* -delete' "$EXP" >/dev/null; ok $((1 - $? )) "no rm/rmdir/unlink/-delete in rel2_exportar_viejo.sh"

BASE="$(mktemp -d "${TMPDIR:-/tmp}/rel3-XXXXXX")"
case "$BASE" in */rel3-??????) ;; *) echo "unexpected mktemp result: $BASE"; exit 2;; esac

echo "== refusal: existing sentinel DIRECTORY (with a nested file and a subfolder)"
S="$BASE/sentinel"; mkdir -p "$S/sub/deeper"; echo "precious" > "$S/keep.txt"; echo "nested" > "$S/sub/deeper/note.txt"
A="$(snap "$S")"
OLD_EXPORT="$S" bash "$EXP" >"$BASE/o1.txt" 2>&1; rc=$?
ok $([ "$rc" = 2 ] && echo 0 || echo 1) "exit code 2 (got $rc)"
ok $(grep -q "REFUSED: destination already exists" "$BASE/o1.txt" && echo 0 || echo 1) "message says REFUSED"
ok $([ "$(snap "$S")" = "$A" ] && [ "$(cat "$S/keep.txt")" = precious ] && [ -f "$S/sub/deeper/note.txt" ] && echo 0 || echo 1) "sentinel byte-identical afterwards (listing, sizes, mtimes, SHA-256)"
ok $([ ! -e "$S/dspacios-travel" ] && echo 0 || echo 1) "nothing was extracted into the sentinel"

echo "== refusal: existing EMPTY directory"
mkdir "$BASE/empty"; OLD_EXPORT="$BASE/empty" bash "$EXP" >"$BASE/o2.txt" 2>&1; rc=$?
ok $([ "$rc" = 2 ] && [ -z "$(ls -A "$BASE/empty")" ] && echo 0 || echo 1) "empty directory refused and still empty (rc=$rc)"

echo "== refusal: existing regular FILE"
echo "x" > "$BASE/afile"; OLD_EXPORT="$BASE/afile" bash "$EXP" >"$BASE/o3.txt" 2>&1; rc=$?
ok $([ "$rc" = 2 ] && [ "$(cat "$BASE/afile")" = x ] && echo 0 || echo 1) "file refused and unchanged (rc=$rc)"

echo "== refusal: a JUNCTION pointing at the sentinel (the exporter must not follow it)"
cmd.exe /c "mklink /J $(cygpath -w "$BASE/link") $(cygpath -w "$S")" >/dev/null
OLD_EXPORT="$BASE/link" bash "$EXP" >"$BASE/o4.txt" 2>&1; rc=$?
ok $([ "$rc" = 2 ] && [ "$(snap "$S")" = "$A" ] && echo 0 || echo 1) "junction refused; sentinel behind it unchanged (rc=$rc)"
cmd.exe /c "rmdir $(cygpath -w "$BASE/link")" >/dev/null   # removes ONLY the link, not the target

echo "== refusal: the retained old export itself (read-only check of the real default destination, if present)"
RET="${RETAINED_EXPORT:-C:/tmp/old312}"
if [ -d "$RET" ]; then
  R0="$(snap "$RET")"
  OLD_EXPORT="$RET" bash "$EXP" >"$BASE/o5.txt" 2>&1; rc=$?
  ok $([ "$rc" = 2 ] && [ "$(snap "$RET")" = "$R0" ] && [ -f "$RET/dspacios-travel/.release-source-commit" ] && echo 0 || echo 1) "retained export refused and unchanged (rc=$rc)"
  OLD_EXPORT="" bash "$EXP" >"$BASE/o6.txt" 2>&1; rc=$?   # empty override falls back to the default C:/tmp/old312 (:- syntax)
  ok $([ "$rc" = 2 ] && [ "$(snap "$RET")" = "$R0" ] && echo 0 || echo 1) "default destination (no override) also refused when it exists (rc=$rc)"
else echo "  (skipped: $RET not present)"; fi

echo "== fresh destination: the export works (path that does not exist yet)"
F="$BASE/fresh/old"
OLD_EXPORT="$F" bash "$EXP" >"$BASE/o7.txt" 2>&1; rc=$?
ok $([ "$rc" = 0 ] && echo 0 || echo 1) "fresh export exit 0 (rc=$rc)"
ok $([ "$(cat "$F/dspacios-travel/.release-source-commit" 2>/dev/null)" = 312608a5922d4424ac912153394f4aee99357cb2 ] && echo 0 || echo 1) "commit marker written"
ok $(grep -q "lista de archivos idéntica al commit" "$BASE/o7.txt" && echo 0 || echo 1) "file list identical to the commit"
ok $([ -d "$F/dspacios-travel/node_modules" ] && echo 0 || echo 1) "node_modules junction present"

# cleanup of what THIS test created: unlink the junction first (removing only the link), then delete the test-owned temp folder
if [ -d "$F/dspacios-travel/node_modules" ]; then cmd.exe /c "rmdir $(cygpath -w "$F/dspacios-travel/node_modules")" >/dev/null; fi
if [ -d "$BASE/fresh/old/dspacios-travel/node_modules" ]; then echo "  WARNING: junction still present; leaving $BASE in place"; else rm -rf "$BASE"; fi
echo; echo "checks: $TOTAL, failures: $FALLAS"; [ "$FALLAS" = 0 ] && echo "ALL TESTS PASSED" || exit 1
