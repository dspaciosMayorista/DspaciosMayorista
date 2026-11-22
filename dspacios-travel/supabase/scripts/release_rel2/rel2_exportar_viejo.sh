#!/usr/bin/env bash
# REL-2 · exporta el árbol de código VIEJO exacto (commit 312608a59 = merge de #449 = origin/main) a C:/tmp/old312 con `git archive` (sin metadatos git, sin tocar ningún worktree) y
# REL-3: refuses an existing destination (never deletes). Enlaza node_modules del worktree viejo retenido C:/tmp/base126 (mismas dependencias: package.json solo difiere en scripts de prueba). Deja constancia del commit en .release-source-commit.
set -eu
export MSYS_NO_PATHCONV=1
COMMIT=312608a5922d4424ac912153394f4aee99357cb2
SRC="${OLD_WORKTREE:-C:/tmp/base126}"   # clean worktree of the OLD commit (it supplies node_modules; the code is exported with git archive)
DEST="${OLD_EXPORT:-C:/tmp/old312}"
[ "$(git -C $SRC rev-parse HEAD)" = "$COMMIT" ] || { echo "base126 no está en $COMMIT"; exit 2; }
[ -z "$(git -C $SRC status --porcelain)" ] || { echo "base126 no está limpio"; exit 2; }
# REL-3: NON-destructive. The destination must be a path that does not exist yet; an existing file, directory, junction or symlink is refused and nothing is deleted or modified.
# (No recursive deletion anywhere in this script: the export holds a node_modules junction, so generic cleanup is unsafe. To redo an export, remove the old folder yourself and pass a fresh OLD_EXPORT.)
if [ -e "$DEST" ] || [ -L "$DEST" ]; then echo "REFUSED: destination already exists: $DEST - choose a fresh OLD_EXPORT path (nothing was changed)." >&2; exit 2; fi
mkdir -p "$(dirname "$DEST")"
mkdir "$DEST"   # atomic and non-recursive: fails if another process created it in the meantime
git -C $SRC archive "$COMMIT" dspacios-travel | tar -x -C "$DEST"
echo "$COMMIT" > "$DEST/dspacios-travel/.release-source-commit"
git -C $SRC rev-parse "$COMMIT^{tree}" > "$DEST/dspacios-travel/.release-source-tree"
cmd.exe /c "mklink /J $(cygpath -w "$DEST/dspacios-travel/node_modules") $(cygpath -w "$SRC/dspacios-travel/node_modules")" >/dev/null
echo "commit: $(cat $DEST/dspacios-travel/.release-source-commit)"; echo "tree:   $(cat $DEST/dspacios-travel/.release-source-tree)"
echo "archivos exportados: $(find $DEST/dspacios-travel -type f ! -path '*/node_modules/*' | wc -l)"
echo "node_modules enlazado: $(ls $DEST/dspacios-travel/node_modules | head -2 | tr '\n' ' ')"
# El export es idéntico al commit: sin diferencias contra el árbol del commit (comparación de la lista de archivos y de una muestra de SHA-256)
git -C $SRC -c core.quotepath=off ls-tree -r --name-only "$COMMIT" dspacios-travel | grep -v "^dspacios-travel/node_modules/" | sort > /tmp/old312_git.txt
(cd $DEST && find dspacios-travel -type f ! -path '*/node_modules/*' ! -name .release-source-commit ! -name .release-source-tree | sed 's#^\./##' | sort) > /tmp/old312_fs.txt
diff /tmp/old312_git.txt /tmp/old312_fs.txt >/dev/null && echo "lista de archivos idéntica al commit ($(wc -l < /tmp/old312_git.txt))" || { echo "LA LISTA DIFIERE"; exit 3; }
for f in dspacios-travel/app/\(dashboard\)/dashboard/contratos/actions.ts dspacios-travel/lib/reservar/computo.ts dspacios-travel/supabase/migrations/20260601000311_hoteles_edades_sin_default.sql dspacios-travel/pruebas/pagoUsdConversion2611.pg.ts; do
  a=$(git -C $SRC show "$COMMIT:$f" | sed 's/\x0d$//' | sha256sum | cut -c1-16); b=$(sed 's/\x0d$//' < "$DEST/$f" | sha256sum | cut -c1-16); [ "$a" = "$b" ] && echo "sha256 igual (sin CR; archive aplica autocrlf): $f" || { echo "SHA DIFIERE: $f"; exit 3; }
done
echo "ausentes en el árbol viejo (código/migraciones de este bloque):"
for f in dspacios-travel/lib/portal/origenCotizacion.ts dspacios-travel/lib/reservar/universoViajeros.ts "dspacios-travel/app/(auth)/recuperar" dspacios-travel/supabase/migrations/20260601000312_abono_moneda_pago.sql dspacios-travel/supabase/migrations/20260601000326_pasajeros_aliado_tope_universo.sql dspacios-travel/lib/tarifario/cierresHotel.ts; do [ -e "$DEST/$f" ] && echo "  PRESENTE (inesperado): $f" || echo "  ausente: $f"; done
