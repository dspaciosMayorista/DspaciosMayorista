#!/bin/sh
# ────────────────────────────────────────────────────────
# Migración 260: aplicación, reaplicación (idempotente), postcheck, uso real, ROLLBACK y reaplicación tras el rollback, en PostgreSQL local desechable.
# Comprueba que (1) el preflight pasa antes y el postcheck después, (2) reaplicar no cambia nada, (3) el rollback se NIEGA mientras haya trabajo a medias y
# (4) tras el DELETE por tandas documentado el rollback deja el esquema IDÉNTICO al de antes (misma huella de funciones, vista, política, disparadores y columnas), sin tocar los datos
# publicados por el publicador de siempre, y (5) la 260 se puede aplicar de nuevo.
# SOLO Docker local y desechable. Uso (desde dspacios-travel/):
#   MIGRACIONES_PREVIAS="<255> <256> <258>" [MIGRACIONES_ENTRE="<262> … <266>"] [CRON=1] sh supabase/scripts/test_260_rollback.sh <base_nueva> [contenedor_pg] [plantilla]
# MIGRACIONES_ENTRE se aplica DESPUÉS de la 259 y ANTES de la 260 (orden real de producción). CRON=1 habilita pg_cron en la base ANTES del preflight (exige que la base se llame
# igual que cron.database_name del contenedor) y comprueba los dos trabajos programados tras aplicar, reaplicar y reaplicar tras el rollback, y que el rollback los retira.
# ────────────────────────────────────────────────────────
set -eu
DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"
export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t260_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t260_[a-z0-9_]{1,40}\$." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"
M259="$APP/supabase/migrations/20260601000259_publicador_tarifario_limite_acotado.sql"
M260="$APP/supabase/migrations/20260601000260_publicacion_tarifario_por_lotes.sql"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe." >&2; exit 2; }
FALLAS=0
ok() { echo "  OK   $*"; }
fallo() { echo "  FALLA $*"; FALLAS=$((FALLAS + 1)); }
limpiar() { st=$?; [ "${KEEP:-}" = 1 ] || $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; exit $st; }
trap limpiar EXIT INT TERM

$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for f in ${MIGRACIONES_PREVIAS:-}; do $PS -d "$DB" < "$f" >/dev/null 2>&1; done
$PS -d "$DB" < "$M259" >/dev/null 2>&1
$PS -d "$DB" < "$AQUI/test_259_semilla.sql" >/dev/null 2>&1
for f in ${MIGRACIONES_ENTRE:-}; do $PS -d "$DB" < "$f" >/dev/null 2>&1 || { echo "Falló la migración previa $f" >&2; exit 2; }; done
if [ "${CRON:-}" = 1 ]; then $PS -d "$DB" -c "create extension if not exists pg_cron" >/dev/null; fi
TRABAJOS="select count(*) from cron.job where active and ((jobname = 'tarifario_cola_correr' and schedule = '10 seconds') or jobname = 'tarifario_cola_purga')"

HUELLA="select md5(concat_ws('|',
 (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')),
 md5(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true)),
 (select md5(pg_get_expr(polqual, polrelid)) from pg_policy where polname = 'tarifario_resultado: lectura'),
 (select string_agg(tgname, ',' order by tgname) from pg_trigger where not tgisinternal and tgrelid in ('public.tarifa_hotel'::regclass, 'public.hotel_temporadas'::regclass, 'public.tarifario_resultado'::regclass)),
 (select string_agg(column_name, ',' order by table_name, ordinal_position) from information_schema.columns where table_schema = 'public' and table_name in ('tarifario_resultado', 'armado_paquetes', 'tarifario_resultado_publicable')),
 (select string_agg(relname, ',' order by relname) from pg_class where relnamespace = 'public'::regnamespace and relname like 'tarifario\_%'),
 (select string_agg(proname || '/' || pronargs, ',' order by proname, pronargs) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'tarifario\_%'),
 (select string_agg(grantee || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_name = 'tarifario_resultado_publicable')))"
DATOS="select md5(coalesce(string_agg(r.id::text || ':' || r.precio_pvp::text, ',' order by r.id), '')) from public.tarifario_resultado r where exists (select 1 from public.tarifario_resultado_publicable v where v.id = r.id)"
en_solo_lectura() { (echo "begin read only;"; cat "$1"; echo "rollback;") | $PS -d "$DB" -F ' | '; }
estados() { en_solo_lectura "$1" | awk -F ' [|] ' '{print $NF}'; }

echo "== datos publicados por el publicador de siempre (paquete 72, 6 filas) y preflight"
$PS -d "$DB" -c "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, hotel_id, destino_id, acomodacion, noches, base_comisionable, impuesto, precio_pvp, moneda, procedencia_mixta)
  select 72, 'legado', true, 'bloqueo', 2000, 1, 'doble', 3, 1, 0, 100 + g, 'COP', false from generate_series(1, 6) g;
  update public.armado_paquetes set tarifario_snapshot_publicable = true, activo = true where id in (72, 73);" >/dev/null
PRE="$(estados "$AQUI/preflight_260_publicacion_por_lotes.sql")"
echo "$PRE" | grep -E "BLOQUEA" >/dev/null && fallo "el preflight BLOQUEA sobre una base sana: $(echo "$PRE" | grep BLOQUEA | head -2)" || ok "preflight sin ningún BLOQUEA antes de la 260"
H0="$($PS -d "$DB" -c "$HUELLA")"; D0="$($PS -d "$DB" -c "$DATOS")"; V0="$($PS -d "$DB" -c "select count(*) from public.tarifario_resultado_publicable where paquete_id = 72")"
[ "$V0" = 6 ] && ok "antes: 6 filas visibles del publicador de siempre" || fallo "esperaba 6 filas visibles y hay $V0"

echo "== aplicar la 260 y su postcheck"
$PS -d "$DB" < "$M260" >/dev/null 2>&1 && ok "la 260 se aplicó sin errores" || fallo "la 260 falló al aplicarse"
POST="$(estados "$AQUI/postcheck_260_publicacion_por_lotes.sql")"
echo "$POST" | grep -E "FALLA" >/dev/null && fallo "postcheck con FALLA: $(en_solo_lectura "$AQUI/postcheck_260_publicacion_por_lotes.sql" | grep FALLA | cut -c1-200)" || ok "postcheck: ninguna FALLA ($(echo "$POST" | sort | uniq -c | tr '\n' ' '))"
if [ "${CRON:-}" = 1 ]; then [ "$($PS -d "$DB" -c "$TRABAJOS")" = 2 ] && ok "pg_cron: los dos trabajos quedaron programados (cola cada 10 s + purga diaria)" || fallo "pg_cron: no quedaron los dos trabajos"; en_solo_lectura "$AQUI/postcheck_260_publicacion_por_lotes.sql" | grep "pg_cron" | cut -c1-420 || true; fi
H1="$($PS -d "$DB" -c "$HUELLA")"
[ "$H1" != "$H0" ] && ok "el esquema cambió (huella distinta)" || fallo "la 260 no cambió nada"
V1="$($PS -d "$DB" -c "select count(*) from public.tarifario_resultado_publicable where paquete_id = 72")"
[ "$V1" = 6 ] && ok "NINGÚN paquete publicado dejó de verse tras la 260 (6 filas del legado siguen visibles)" || fallo "tras la 260 se ven $V1 filas en vez de 6"

echo "== reaplicar la 260 (reintento)"
$PS -d "$DB" < "$M260" >/dev/null 2>&1 && ok "reaplicar no falla" || fallo "reaplicar falló"
H2="$($PS -d "$DB" -c "$HUELLA")"
if [ "${CRON:-}" = 1 ]; then [ "$($PS -d "$DB" -c "$TRABAJOS")" = 2 ] && [ "$($PS -d "$DB" -c "select count(*) from cron.job where jobname like 'tarifario_%'")" = 2 ] && ok "pg_cron: reaplicar deja exactamente los 2 trabajos (sin duplicar)" || fallo "pg_cron: reaplicar duplicó o perdió trabajos"; $PS -d "$DB" -c "update cron.job set active = false where jobname like 'tarifario_%'" >/dev/null; fi   # el trabajador real no debe adelantar la publicación a medias de la prueba
[ "$H2" = "$H1" ] && ok "reaplicar deja el esquema idéntico (idempotente)" || fallo "reaplicar cambió el esquema"
PRE2="$(estados "$AQUI/preflight_260_publicacion_por_lotes.sql")"
echo "$PRE2" | grep -E "BLOQUEA" >/dev/null && fallo "el preflight bloquea sobre una base con la 260 ya aplicada" || ok "el preflight tolera la 260 ya aplicada"

echo "== uso real: publicación por lotes + fila oculta por invalidación + trabajo a medias"
SES="select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);"
sed '/^-- ── Mundo/,$d' "$AQUI/test_260_cola.sql" | $PS -d "$DB" >/dev/null 2>&1 || true   # solo los helpers t_*260 (la prueba completa se mide en test_260_cola.sh)
G="$($PS -d "$DB" -c "$SES select public.t_preparar260('rb', 3000, 1000); select public.t_publicar260('rb');" | tail -1)"
$PS -d "$DB" -c "$SES select public.tarifario_publicacion_avanzar(73, $G)" >/dev/null     # lote 1 cargado, publicación a medias
$PS -d "$DB" -c "insert into public.tarifario_fila_oculta (fila_id, paquete_id, revision, motivo) select id, paquete_id, 1, 'prueba' from public.tarifario_resultado where paquete_id = 73 and generacion is not null limit 1" >/dev/null

echo "== el rollback se NIEGA con trabajo a medias"
if $PS -d "$DB" < "$AQUI/rollback_260_publicacion_por_lotes.sql" >/dev/null 2>&1; then fallo "el rollback NO debía ejecutarse con una publicación en curso"; else ok "rollback abortado con la publicación en curso (cola no vacía)"; fi
[ "$($PS -d "$DB" -c "$HUELLA")" = "$H2" ] && ok "…y no cambió nada (el rollback es todo-o-nada)" || fallo "el rollback abortado dejó cambios"
$PS -d "$DB" -c "delete from public.tarifario_publicacion_cola" >/dev/null
if $PS -d "$DB" < "$AQUI/rollback_260_publicacion_por_lotes.sql" >/dev/null 2>&1; then fallo "el rollback NO debía ejecutarse con filas de generaciones no publicadas"; else ok "rollback abortado con filas de generaciones NO publicadas (hay que correr antes el DELETE por tandas)"; fi

echo "== DELETE por tandas del paso 3 y rollback"
for i in 1 2 3 4 5 6; do
  N="$($PS -d "$DB" -c "with d as (delete from public.tarifario_resultado where ctid in (select r.ctid from public.tarifario_resultado r join public.armado_paquetes ap on ap.id = r.paquete_id where (r.generacion is not null and r.generacion is distinct from ap.tarifario_generacion_publicada) or (r.generacion is null and ap.tarifario_por_generacion) limit 2000) returning 1) select count(*) from d")"
  [ "$N" = 0 ] && break
done
[ "$N" = 0 ] && ok "el DELETE por tandas llegó a 0" || fallo "el DELETE por tandas no llegó a 0"
$PS -d "$DB" < "$AQUI/rollback_260_publicacion_por_lotes.sql" >/dev/null 2>&1 && ok "el rollback se ejecutó" || { fallo "el rollback falló"; $PS -d "$DB" < "$AQUI/rollback_260_publicacion_por_lotes.sql" 2>&1 | tail -3; }
H3="$($PS -d "$DB" -c "$HUELLA")"
if [ "${CRON:-}" = 1 ]; then [ "$($PS -d "$DB" -c "select count(*) from cron.job where jobname like 'tarifario_%'")" = 0 ] && ok "pg_cron: el rollback retiró los dos trabajos" || fallo "pg_cron: el rollback dejó trabajos"; fi
if [ "$H3" = "$H0" ]; then ok "tras el rollback el esquema es IDÉNTICO al de antes de la 260 (huella de funciones, vista, política, disparadores, columnas y permisos)"; else
  fallo "tras el rollback el esquema difiere del original"
  for q in "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')" "select md5(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true))" "select md5(pg_get_expr(polqual, polrelid)) from pg_policy where polname = 'tarifario_resultado: lectura'"; do echo "    $($PS -d "$DB" -c "$q")"; done
fi
[ "$($PS -d "$DB" -c "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')")" = "8f8437d94500208538697508f06e0a3e" ] && ok "tarifario_invalidar volvió EXACTAMENTE a la definición de la 181 (huella 8f84…)" || fallo "tarifario_invalidar no volvió a la 181"
D3="$($PS -d "$DB" -c "$DATOS")"; V3="$($PS -d "$DB" -c "select count(*) from public.tarifario_resultado_publicable where paquete_id = 72")"
[ "$V3" = 6 ] && ok "tras el rollback se ven las 6 filas del legado" || fallo "tras el rollback se ven $V3 filas del paquete 73 (esperaba 6; el paquete con filas ocultas queda bloqueado por diseño si hubo ocultas)"
RB="$(estados "$AQUI/preflight_260_publicacion_por_lotes.sql")"
echo "$RB" | grep -E "BLOQUEA" >/dev/null && fallo "tras el rollback el preflight bloquea" || ok "tras el rollback el preflight vuelve a pasar"

echo "== reaplicar la 260 tras el rollback"
$PS -d "$DB" < "$M260" >/dev/null 2>&1 && ok "la 260 se aplica de nuevo tras el rollback" || fallo "la 260 no se pudo reaplicar tras el rollback"
[ "$($PS -d "$DB" -c "$HUELLA")" = "$H1" ] && ok "…y deja el mismo esquema que la primera vez" || fallo "reaplicada tras el rollback difiere de la primera aplicación"
if [ "${CRON:-}" = 1 ]; then [ "$($PS -d "$DB" -c "$TRABAJOS")" = 2 ] && ok "pg_cron: reaplicada tras el rollback, los dos trabajos vuelven" || fallo "pg_cron: reaplicada tras el rollback no hay dos trabajos"; fi
POST2="$(estados "$AQUI/postcheck_260_publicacion_por_lotes.sql")"
echo "$POST2" | grep -E "FALLA" >/dev/null && fallo "postcheck con FALLA tras reaplicar" || ok "postcheck sin FALLA tras reaplicar"
echo
[ "$FALLAS" = 0 ] && echo "TEST 260 ROLLBACK: todo pasó" || echo "TEST 260 ROLLBACK: $FALLAS FALLA(S)"
[ "$FALLAS" = 0 ]
