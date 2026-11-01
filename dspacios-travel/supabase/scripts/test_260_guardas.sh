#!/bin/sh
# ────────────────────────────────────────────────────────
# Guardas de la 260 por HUELLA EXACTA (sin respaldos LIKE). Un cambio AJENO que conserva las palabras que antes bastaban («tarifario_cambio_fuente», «tarifario_por_generacion»,
# «tarifario_fila_publicada») debe: (1) hacer que el preflight diga REVISAR, (2) abortar la migración (o el rollback) con «(REVISAR)» y (3) NO alterar ningún objeto (huella global
# idéntica antes y después, y sin crear nada de la 260). Controles: sin alteración la 260 se aplica y se reaplica.
# SOLO Docker local y desechable. Uso (desde dspacios-travel/):
#   MIGRACIONES_PREVIAS="<255> <256> <258>" sh supabase/scripts/test_260_guardas.sh <sufijo> [contenedor] [plantilla]     (sufijo ^[a-z0-9]{1,10}$)
# ────────────────────────────────────────────────────────
set -eu
SUF="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"
export MSYS_NO_PATHCONV=1
printf '%s' "$SUF" | grep -Eq '^[a-z0-9]{1,10}$' || { echo "Sufijo inválido." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"
M259="$APP/supabase/migrations/20260601000259_publicador_tarifario_limite_acotado.sql"
M260="$APP/supabase/migrations/20260601000260_publicacion_tarifario_por_lotes.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
BPRE="t260g_${SUF}_pre"; BPOST="t260g_${SUF}_post"; ESC="t260g_${SUF}_esc"
FALLAS=0
ok() { echo "  OK   $*"; }
fallo() { echo "  FALLA $*"; FALLAS=$((FALLAS + 1)); }
limpiar() { st=$?; for d in "$BPRE" "$BPOST" "$ESC"; do $PS -d postgres -c "drop database if exists $d with (force)" >/dev/null 2>&1 || true; done; exit $st; }
trap limpiar EXIT INT TERM

crear() { $PS -d postgres -c "create database $1 template $2" >/dev/null; }
HUELLA="select md5(concat_ws('|',
 (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tarifario\_%'),
 md5(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true)),
 (select md5(pg_get_expr(polqual, polrelid)) from pg_policy where polname = 'tarifario_resultado: lectura'),
 (select string_agg(tgname, ',' order by tgname) from pg_trigger where not tgisinternal and tgrelid in ('public.tarifa_hotel'::regclass, 'public.hotel_temporadas'::regclass, 'public.tarifario_resultado'::regclass, 'public.armado_paquetes'::regclass)),
 (select string_agg(column_name, ',' order by table_name, ordinal_position) from information_schema.columns where table_schema = 'public' and table_name in ('tarifario_resultado', 'armado_paquetes', 'tarifario_resultado_publicable')),
 (select string_agg(relname || ':' || relkind::text, ',' order by relname) from pg_class where relnamespace = 'public'::regnamespace and relname like 'tarifario\_%')))"
preflight() { (echo "begin read only;"; cat "$AQUI/preflight_260_publicacion_por_lotes.sql"; echo "rollback;") | $PS -d "$1" -F ' | '; }

# Plantillas: PRE = 255/256/258/259 (sin la 260) · POST = PRE + 260
crear "$BPRE" "$PLANTILLA"
for f in ${MIGRACIONES_PREVIAS:-}; do $PS -d "$BPRE" < "$f" >/dev/null 2>&1; done
$PS -d "$BPRE" < "$M259" >/dev/null 2>&1
crear "$BPOST" "$BPRE"
$PS -d "$BPOST" < "$M260" >/dev/null 2>&1 || { echo "La 260 no se aplicó sobre la base sana." >&2; exit 2; }

# escenario <nombre> <base> <SQL que introduce el cambio ajeno> <archivo a ejecutar: 260|rollback>
escenario() {
  nombre="$1"; base="$2"; tamper="$3"; que="$4"
  $PS -d postgres -c "drop database if exists $ESC with (force)" >/dev/null; crear "$ESC" "$base"
  printf '%s\n' "$tamper" | $PS -d "$ESC" >/dev/null 2>/tmp/t260g_err.txt || { fallo "$nombre: no se pudo introducir el cambio ajeno: $(tail -2 /tmp/t260g_err.txt)"; return; }
  antes="$($PS -d "$ESC" -c "$HUELLA")"
  if [ "$que" = rollback ]; then arch="$AQUI/rollback_260_publicacion_por_lotes.sql"; else arch="$M260"; fi
  if salida="$($PS -d "$ESC" < "$arch" 2>&1)"; then fallo "$nombre: el $que NO abortó ante un cambio ajeno"; else
    echo "$salida" | grep -q "(REVISAR)" && ok "$nombre: aborta con «(REVISAR)» — $(echo "$salida" | grep -o 'ABORTADO[^.]*\|ABORTADA[^.]*' | head -1 | cut -c1-110)" || fallo "$nombre: abortó pero sin «(REVISAR)»: $(echo "$salida" | tail -2 | cut -c1-160)"
  fi
  [ "$($PS -d "$ESC" -c "$HUELLA")" = "$antes" ] && ok "$nombre: NO alteró ningún objeto (huella global idéntica)" || fallo "$nombre: el $que alteró objetos pese a abortar"
  if [ "$que" = 260 ] && [ "$base" = "$BPRE" ]; then
    [ "$($PS -d "$ESC" -c "select count(*) from pg_class where relname in ('tarifario_manifiesto','tarifario_publicacion_cola','tarifario_resultado_neto')")" = 0 ] && ok "$nombre: no se creó ninguna tabla de la 260" || fallo "$nombre: se crearon tablas de la 260"
  fi
  if [ "$que" = 260 ]; then
    preflight "$ESC" | grep -q "REVISAR: cambio ajeno" && ok "$nombre: el preflight dice REVISAR" || fallo "$nombre: el preflight NO dijo REVISAR"
  fi
}

echo "== controles: sin cambio ajeno la 260 se aplica y se reaplica"
$PS -d postgres -c "drop database if exists $ESC with (force)" >/dev/null; crear "$ESC" "$BPRE"
preflight "$ESC" | grep -q "REVISAR: cambio ajeno" && fallo "el preflight dice REVISAR sobre la definición auditada" || ok "preflight limpio sobre las definiciones auditadas (181/256/182)"
$PS -d "$ESC" < "$M260" >/dev/null 2>&1 && ok "se aplica sobre las definiciones auditadas" || fallo "no se aplica sobre las definiciones auditadas"
$PS -d "$ESC" < "$M260" >/dev/null 2>&1 && ok "se reaplica sobre la propia 260 (huellas de la 260)" || fallo "no se reaplica"
preflight "$ESC" | grep -q "REVISAR: cambio ajeno" && fallo "el preflight dice REVISAR sobre la propia 260" || ok "preflight limpio sobre la propia 260"

echo "== cambios ajenos que CONSERVAN las palabras, antes de la 260"
escenario "A1 tarifario_invalidar (181 + comentario con «tarifario_cambio_fuente»)" "$BPRE" \
  "select replace(pg_get_functiondef('public.tarifario_invalidar(bigint[],boolean)'::regprocedure), 'begin', 'begin /* tarifario_cambio_fuente ajeno */') \\gexec" 260
escenario "A2 vista (256 + columna llamada «tarifario_por_generacion»)" "$BPRE" \
  "select format('create or replace view public.tarifario_resultado_publicable with (security_barrier = true, security_invoker = false) as %s', regexp_replace(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true), '\\sFROM', ', true AS tarifario_por_generacion FROM')) \\gexec" 260
escenario "A3 política (182 OR una función llamada «tarifario_fila_publicada»)" "$BPRE" \
  "create function public.tarifario_fila_publicada(bigint, bigint, bigint) returns boolean language sql as 'select true';
   drop policy \"tarifario_resultado: lectura\" on public.tarifario_resultado;
   create policy \"tarifario_resultado: lectura\" on public.tarifario_resultado for select using (coalesce(public.mi_rol()::text, '') in ('superadmin','gerencia','administracion','operaciones') or public.tarifario_paquete_publicable(paquete_id) or public.tarifario_fila_publicada(paquete_id, 0, id));" 260

echo "== cambios ajenos que conservan las palabras, sobre la 260 ya aplicada (reaplicar)"
escenario "B1 tarifario_invalidar (260 + instrucción ajena)" "$BPOST" \
  "select replace(pg_get_functiondef('public.tarifario_invalidar(bigint[],boolean)'::regprocedure), 'begin', 'begin perform 1; /* tarifario_cambio_fuente */') \\gexec" 260
escenario "B2 vista (260 + columna extra)" "$BPOST" \
  "select format('create or replace view public.tarifario_resultado_publicable with (security_barrier = true, security_invoker = false) as %s', regexp_replace(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true), '\\sFROM', ', 1 AS ajeno FROM')) \\gexec" 260
escenario "B3 política (260 OR true, conserva «tarifario_fila_publicada»)" "$BPOST" \
  "drop policy \"tarifario_resultado: lectura\" on public.tarifario_resultado;
   create policy \"tarifario_resultado: lectura\" on public.tarifario_resultado for select using (true or public.tarifario_fila_publicada(paquete_id, generacion, id));" 260

echo "== el rollback tampoco pisa un cambio ajeno"
escenario "R1 rollback con la vista alterada (260 + columna extra)" "$BPOST" \
  "select format('create or replace view public.tarifario_resultado_publicable with (security_barrier = true, security_invoker = false) as %s', regexp_replace(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true), '\\sFROM', ', 1 AS ajeno FROM')) \\gexec" rollback

echo "== el postcheck exige la 260 EXACTA"
$PS -d postgres -c "drop database if exists $ESC with (force)" >/dev/null; crear "$ESC" "$BPOST"
printf '%s\n' "select format('create or replace view public.tarifario_resultado_publicable with (security_barrier = true, security_invoker = false) as %s', regexp_replace(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true), '\\sFROM', ', 1 AS ajeno FROM')) \\gexec" | $PS -d "$ESC" >/dev/null
(echo "begin read only;"; cat "$AQUI/postcheck_260_publicacion_por_lotes.sql"; echo "rollback;") | $PS -d "$ESC" -F ' | ' | grep -q "FALLA" && ok "postcheck: FALLA ante la vista alterada que conserva la palabra" || fallo "postcheck no detectó la vista alterada"

echo
[ "$FALLAS" = 0 ] && echo "TEST 260 GUARDAS: todo pasó" || echo "TEST 260 GUARDAS: $FALLAS FALLA(S)"
[ "$FALLAS" = 0 ]
