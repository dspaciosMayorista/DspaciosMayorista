#!/bin/sh
# Verifica que un número de migración no esté tomado por otra rama/ref/worktree antes de integrar. SOLO LECTURA.
# Uso (desde cualquier carpeta del repo):  sh supabase/scripts/verificar_numeracion_migracion.sh 279 [nombre-de-archivo-propio]
# Imprime cada ref/worktree que contiene una migración con ese número. Si el único hallazgo es el archivo propio, el número está libre.
# Ejemplo #82: la 278 es de #90 (claude/90-promos-hotel-v2, hotel_reglas_descuento); #82 usa la 279. Repetir el chequeo al hacer el merge.
set -eu
n="${1:?uso: verificar_numeracion_migracion.sh <numero> [archivo-propio]}"
propio="${2:-}"
pat="supabase/migrations/20260601000${n}_"
hay=0
for b in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do
  git ls-tree -r --name-only "$b" 2>/dev/null | grep -F "$pat" | while read -r f; do
    case "$(basename "$f")" in "$propio") ;; *) echo "REF  $b  $f" ;; esac
  done
done | sort -u > .num.$$ || true
git worktree list | awk '{print $1}' | while read -r w; do
  for d in "$w/dspacios-travel/supabase/migrations" "$w/supabase/migrations"; do
    [ -d "$d" ] && ls "$d" | grep -F "20260601000${n}_" | while read -r f; do
      [ "$f" = "$propio" ] || echo "WORKTREE  $(basename "$w")  $f"
    done
  done
done | sort -u >> .num.$$ || true
if [ -s .num.$$ ]; then cat .num.$$; hay=1; fi
rm -f .num.$$
if [ "$hay" -eq 0 ]; then echo "OK: el número $n no está tomado por otra migración."; else echo "COLISIÓN POSIBLE con el número $n: renumerar o coordinar antes de integrar."; exit 1; fi
