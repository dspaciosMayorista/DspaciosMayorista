#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# MIGRACIÓN 213 · destino fijo de programas — prueba de punta a punta en una base LOCAL
# DESECHABLE (contenedor Docker propio; nunca remota, nunca Preview/Producción).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_213_migracion.sh <base_nueva> <contenedor> [plantilla]
#     base_nueva  ^t213_[a-z0-9_]{1,40}$ que NO exista (se crea desde la plantilla y se BORRA
#                 al final; KEEP=1 la conserva).
#     contenedor  postgres local (obligatorio).
#     plantilla   base con el esquema vigente 001–212 y SIN la 213 y SIN la 211 (por defecto
#                 plantilla213). Solo se lee y no debe tener conexiones abiertas.
#
#   M1  históricos publicados/borrador/inactivo sembrados ANTES de la 213
#   M2  preflight antes: sin bloqueantes; H1 (visibilidad pública, 62) y N1 (inventario de TODOS los sin destino, 64:
#       publicados, borrador e inactivo) COMPLETOS, sin recorte
#   M3  213 aplicada dos veces (idempotente) y postcheck 12/12
#   M4  históricos intactos: ninguno recibe destino solo y sus datos no cambian
#   M5  prueba SQL de permisos / duplicados / asignación / RESTRICT
#   C1  dos altas simultáneas del mismo nombre → una entra, la otra 23505
#   C2  asignar (sostiene) ‖ borrar el destino → el borrado falla 23503; nada queda huérfano
#   C3  borrar (sostiene) ‖ asignar → la asignación falla 23503; el programa queda sin destino
#   M6  plantilla del destino PROVISIONAL con el inventario N1V: rechaza ids duplicados/inexistentes/contradictorios,
#       listas sin un publicado (H1) y listas sin borradores/inactivos (inventario); vista previa sin persistir,
#       commit, idempotente, sin leer la Ruta; H1 = N1 = 0 al final
#   RB  rollback → postcheck en rojo → preflight limpio → 213 de nuevo → postcheck en verde
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-}"
PLANTILLA="${3:-plantilla213}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t213_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t213_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PGPW="${PGPASSWORD_213:-postgres}"
PSA="docker exec -i -e PGPASSWORD=$PGPW $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
PS="$PSA -d $DB -t -A"
SES="docker exec -i -e PGPASSWORD=$PGPW $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v VERBOSITY=verbose"
TMP="$(mktemp -d)"
MARCA="test_213 $(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
FALLOS=0
BASE_PROPIA=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  st=$?
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    m="$($PSA -d postgres -t -A -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$m" = "$MARCA" ]; then
      for i in 1 2 3 4 5; do $PSA -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
    else echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2; fi
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
[ "$($PSA -d "$PLANTILLA" -t -A -c "select (to_regclass('public.programa_destinos_fijos') is null)::int + (to_regprocedure('public.clave_ciudad_ruta(text)') is not null)::int")" = 2 ] || { echo "La plantilla debe tener la 212 y NO la 213." >&2; exit 2; }
# La 211 NO debe estar: se demuestra que la 213 no la necesita.
[ "$($PSA -d "$PLANTILLA" -t -A -c "select count(*) from pg_class where relname like 'cotizacion%compar%' or relname = 'cotizacion_grupos'")" = 0 ] || echo "AVISO: parece haber objetos de la 211 en la plantilla." >&2
$PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
echo "Base $DB: esquema vigente (001–212, sin 211, sin 213)."

# M1 · históricos ANTES de la 213.
$PS >/dev/null <<'SQL'
insert into public.programas (id, nombre, publicado, activo) values
  (7001, 'Hist publicado A', true, true), (7002, 'Hist publicado B', true, true),
  (7003, 'Hist borrador', false, true), (7004, 'Hist publicado inactivo', true, false);
insert into public.programa_ciudades (programa_id, orden, nombre) values
  (7001, 0, 'RIO DE JANEIRO'), (7001, 1, 'MANAUS'), (7002, 0, 'PARIS'), (7002, 1, 'ROMA'), (7003, 0, 'LIMA');
-- 60 publicados activos más (7101..7160): H1 debe listarlos TODOS (antes se recortaba a 40).
insert into public.programas (id, nombre, publicado, activo) select 7100 + i, 'Hist masivo ' || i, true, true from generate_series(1, 60) i;
SQL
SNAP="select md5(string_agg((to_jsonb(p) - 'destino_fijo_id' - 'updated_at')::text, '|' order by id)) from public.programas p where id between 7001 and 7004"
ANTES="$($PS -c "$SNAP")"
ok "M1 sembrados 4 programas históricos + 60 publicados activos (62 publicados activos, 1 borrador, 1 publicado inactivo)"

# M2 · preflight antes.
$PSA -d "$DB" -t -A -F'|' < "$AQUI/preflight_213_programa_destino_fijo.sql" >"$TMP/pre1.txt" 2>&1 || true
H1="$(grep '^H1|' "$TMP/pre1.txt" | cut -d'|' -f3)"
H2="$(grep '^H2|' "$TMP/pre1.txt" | cut -d'|' -f3)"
N1="$(grep '^N1|' "$TMP/pre1.txt" | cut -d'|' -f3)"
H1L="$(grep -c '^H1L|' "$TMP/pre1.txt" || true)"
N1L="$(grep -c '^N1L|' "$TMP/pre1.txt" || true)"
IDS_H1_M2="$(grep '^H1V|' "$TMP/pre1.txt" | cut -d'|' -f4)"
IDS_N1_M2="$(grep '^N1V|' "$TMP/pre1.txt" | cut -d'|' -f4)"
cuenta_ids() { printf '%s' "$1" | tr ',' '\n' | grep -c '^([0-9]*)$' || true; }
FALTA=""
for i in $(seq 7101 7160) 7001 7002; do
  printf '%s' "$IDS_H1_M2" | grep -q "($i)" || FALTA="$FALTA H1V:$i"
  grep '^H1L|' "$TMP/pre1.txt" | grep -q "|$i " || FALTA="$FALTA H1L:$i"
done
for i in $(seq 7101 7160) 7001 7002 7003 7004; do
  printf '%s' "$IDS_N1_M2" | grep -q "($i)" || FALTA="$FALTA N1V:$i"
  grep '^N1L|' "$TMP/pre1.txt" | grep -q "|$i \[" || FALTA="$FALTA N1L:$i"
done
for i in 7003 7004; do printf '%s' "$IDS_H1_M2" | grep -q "($i)" && FALTA="$FALTA H1_no_debe:$i"; done
grep -q '^N1L|INFO|7003|7003 \[borrador\]' "$TMP/pre1.txt" || FALTA="$FALTA etiqueta7003"
grep -q '^N1L|INFO|7004|7004 \[inactivo\]' "$TMP/pre1.txt" || FALTA="$FALTA etiqueta7004"
if [ "$H1" = 62 ] && [ "$H2" = 63 ] && [ "$N1" = 64 ] && [ "$H1L" = 62 ] && [ "$N1L" = 64 ] \
   && [ "$(cuenta_ids "$IDS_H1_M2")" = 62 ] && [ "$(cuenta_ids "$IDS_N1_M2")" = 64 ] && [ -z "$FALTA" ] && grep -q "sin bloqueantes" "$TMP/pre1.txt"; then
  ok "M2 preflight: sin bloqueantes; H1=62 (62 filas H1L, 62 ids H1V) y N1=64 con borrador e inactivo (64 filas N1L, 64 ids N1V), sin recorte"
else fallo "M2 H1=$H1 H2=$H2 N1=$N1 H1L=$H1L N1L=$N1L faltan=[$FALTA]"; fi

# M3 · 213 dos veces + postcheck.
$PSA -d "$DB" < "$APP/supabase/migrations/20260601000213_programa_destino_fijo.sql" >/dev/null || { echo "La 213 falló." >&2; exit 1; }
$PSA -d "$DB" < "$APP/supabase/migrations/20260601000213_programa_destino_fijo.sql" >/dev/null 2>&1 && ok "M3a la 213 se aplica una segunda vez sin error (idempotente)" || fallo "M3a segunda aplicación"
$PSA -d "$DB" -t -A -F'|' < "$AQUI/postcheck_213_programa_destino_fijo.sql" >"$TMP/post1.txt" 2>&1 || true
NT="$(grep -c '|t|' "$TMP/post1.txt" || true)"; NF="$(grep -c '|f|' "$TMP/post1.txt" || true)"
[ "$NT" = 14 ] && [ "$NF" = 0 ] && ok "M3b postcheck 14/14" || fallo "M3b postcheck t=$NT f=$NF: $(cat "$TMP/post1.txt" | cut -c1-200)"
$PSA -d "$DB" -t -A -F'|' < "$AQUI/preflight_213_programa_destino_fijo.sql" >"$TMP/pre2.txt" 2>&1 || true
grep -q '^P2|REVISAR' "$TMP/pre2.txt" && ok "M3c preflight tras aplicar marca P2 'ya aplicada' (REVISAR), sin bloqueantes" || fallo "M3c $(cat "$TMP/pre2.txt" | cut -c1-200)"

# M4 · históricos intactos.
DESPUES="$($PS -c "$SNAP")"
SIN="$($PS -c "select count(*) from public.programas where id between 7001 and 7004 and destino_fijo_id is null")"
LISTA="$($PS -c "select count(*) from public.programa_destinos_fijos")"
[ "$ANTES" = "$DESPUES" ] && [ "$SIN" = 4 ] && [ "$LISTA" = 0 ] && ok "M4 históricos intactos: 4 de 4 (y los 60 masivos) sin destino, lista vacía, datos idénticos (md5)" || fallo "M4 antes=$ANTES despues=$DESPUES sin=$SIN lista=$LISTA"

# M5 · prueba SQL.
cd "$AQUI"
if $PSA -d "$DB" < "$AQUI/test_213_programa_destino_fijo.sql" >"$TMP/sql.txt" 2>&1 && grep -q "TEST 213 SQL: TODO OK" "$TMP/sql.txt"; then
  ok "M5 prueba SQL: $(grep -c 'NOTICE:  OK' "$TMP/sql.txt") verificaciones OK"
else fallo "M5 $(grep -E 'FALLO|ERROR' "$TMP/sql.txt" | head -3)"; fi

# Carreras.
$PS >/dev/null <<'SQL'
insert into public.programa_destinos_fijos (id, nombre) values (8801, 'Destino C2'), (8802, 'Destino C3');
insert into public.programas (id, nombre) values (8801, 'prog c2'), (8802, 'prog c3');
SQL
t0() { date +%s%N | cut -c1-13; }
ms() { echo $(( $(t0) - $1 )); }
carrera() { # $1=nombre $2=sqlA $3=sqlB $4=retraso
  ( $SES -c "$2" >"$TMP/$1.a" 2>&1 || true ) &
  sleep "${4:-1}"
  ini=$(t0)
  $SES -c "$3" >"$TMP/$1.b" 2>&1 || true
  echo "$(ms "$ini")" >"$TMP/$1.ms"
  wait
}
err() { grep -o 'ERROR:  [A-Z0-9]\{5\}' "$1" | head -1 | sed 's/ERROR:  //'; }

carrera c1 "begin; insert into public.programa_destinos_fijos (nombre) values ('Mar Caribe'); select pg_sleep(3); commit;" \
           "insert into public.programa_destinos_fijos (nombre) values ('MAR  CARIBE');" 1
N="$($PS -c "select count(*) from public.programa_destinos_fijos where public.clave_ciudad_ruta(nombre) = 'mar caribe'")"
if ! grep -q ERROR "$TMP/c1.a" && [ "$(err "$TMP/c1.b")" = 23505 ] && [ "$(cat "$TMP/c1.ms")" -ge 1000 ] && [ "$N" = 1 ]; then
  ok "C1 alta simultánea del mismo nombre: B esperó $(cat "$TMP/c1.ms") ms y falló 23505; una sola fila"
else fallo "C1 a=$(cat "$TMP/c1.a") b=$(cat "$TMP/c1.b") ms=$(cat "$TMP/c1.ms") n=$N"; fi

carrera c2 "begin; update public.programas set destino_fijo_id = 8801 where id = 8801; select pg_sleep(3); commit;" \
           "delete from public.programa_destinos_fijos where id = 8801;" 1
F="$($PS -c "select (select count(*) from public.programa_destinos_fijos where id = 8801) || '/' || (select destino_fijo_id from public.programas where id = 8801)")"
if ! grep -q ERROR "$TMP/c2.a" && [ "$(err "$TMP/c2.b")" = 23503 ] && [ "$(cat "$TMP/c2.ms")" -ge 1000 ] && [ "$F" = "1/8801" ]; then
  ok "C2 asignar ‖ borrar: el borrado esperó $(cat "$TMP/c2.ms") ms y falló 23503; destino y asignación intactos [$F]"
else fallo "C2 a=$(cat "$TMP/c2.a") b=$(cat "$TMP/c2.b") ms=$(cat "$TMP/c2.ms") [$F]"; fi

carrera c3 "begin; delete from public.programa_destinos_fijos where id = 8802; select pg_sleep(3); commit;" \
           "update public.programas set destino_fijo_id = 8802 where id = 8802;" 1
F="$($PS -c "select (select count(*) from public.programa_destinos_fijos where id = 8802) || '/' || coalesce((select destino_fijo_id::text from public.programas where id = 8802), 'null')")"
if ! grep -q ERROR "$TMP/c3.a" && [ "$(err "$TMP/c3.b")" = 23503 ] && [ "$(cat "$TMP/c3.ms")" -ge 1000 ] && [ "$F" = "0/null" ]; then
  ok "C3 borrar ‖ asignar: la asignación esperó $(cat "$TMP/c3.ms") ms y falló 23503; el programa quedó sin destino, sin huérfanos [$F]"
else fallo "C3 a=$(cat "$TMP/c3.a") b=$(cat "$TMP/c3.b") ms=$(cat "$TMP/c3.ms") [$F]"; fi

# M6 · plantilla del destino PROVISIONAL (plantilla_asignacion_213.sql), alimentada con el INVENTARIO N1V.
PLANTILLA_SQL="$AQUI/plantilla_asignacion_213.sql"
# Rellena el INSERT de ids y, con "commit", cambia el rollback final.
rellenar() { # $1 = salida; $2 = valores "(id),(id)"; $3 = "commit" | ""
  printf 'insert into _ids (programa_id) values %s;\n' "$2" > "$TMP/ids_insert.sql"
  sed -e "/^-- insert into _ids/{r $TMP/ids_insert.sql" -e "d}" "$PLANTILLA_SQL" > "$1"
  if [ "${3:-}" = commit ]; then sed -i 's/^rollback;$/commit;/' "$1"; fi
  return 0
}
estado() { $PS -c "select (select count(*) from public.programa_destinos_fijos where es_provisional) || '/' || (select count(*) from public.programas p join public.programa_destinos_fijos d on d.id = p.destino_fijo_id where d.es_provisional)"; }
correr() { $PSA -d "$DB" < "$1" >"$2" 2>&1 || true; }
quitar() { printf '%s' "$1" | tr ',' '\n' | grep -v "^($2)$" | paste -sd, -; }

# Inventario fresco (como hará el usuario): ahora incluye además el borrador 8802 que dejó la carrera C3.
$PSA -d "$DB" -t -A -F'|' < "$AQUI/preflight_213_programa_destino_fijo.sql" >"$TMP/pre_m6.txt" 2>&1 || true
IDS_H1="$(grep '^H1V|' "$TMP/pre_m6.txt" | cut -d'|' -f4)"
IDS="$(grep '^N1V|' "$TMP/pre_m6.txt" | cut -d'|' -f4)"
NTODOS="$(grep '^N1|' "$TMP/pre_m6.txt" | cut -d'|' -f3)"
if [ "$NTODOS" = 65 ] && printf '%s' "$IDS" | grep -q "(8802)" && [ "$(cuenta_ids "$IDS_H1")" = 62 ]; then ok "M6 inventario: N1=65 (62 publicados + borrador 7003 + inactivo 7004 + borrador 8802); H1=62"; else fallo "M6 inventario N1=$NTODOS"; fi

# Sin inferencia por la Ruta: el código de la plantilla (sin comentarios) no menciona programa_ciudades.
if [ "$(grep -v '^[[:space:]]*--' "$PLANTILLA_SQL" | grep -ci 'programa_ciudades')" = 0 ]; then ok "M6a la plantilla no lee la Ruta (programa_ciudades) en su código: no deduce destinos"; else fallo "M6a la plantilla menciona programa_ciudades"; fi

# Lista vacía: 62 publicados activos quedarían sin destino -> la verificación H1 ABORTA y no deja nada.
sed -e "/^-- insert into _ids/d" "$PLANTILLA_SQL" | sed 's/^rollback;$/commit;/' > "$TMP/pl_vacia.sql"
correr "$TMP/pl_vacia.sql" "$TMP/pl0.txt"
if grep -q "VERIFICACIÓN FALLIDA: quedarían 62" "$TMP/pl0.txt" && [ "$(estado)" = "0/0" ]; then ok "M6b lista vacía + commit: la verificación H1 aborta (quedarían 62 publicados sin destino) y no persiste nada"; else fallo "M6b $(estado) $(grep -m1 ERROR "$TMP/pl0.txt")"; fi

# Falta un PUBLICADO (7160): aborta la verificación H1 nombrándolo.
rellenar "$TMP/pl_inc.sql" "$(quitar "$IDS" 7160)" commit
correr "$TMP/pl_inc.sql" "$TMP/pl1.txt"
if grep -q "VERIFICACIÓN FALLIDA: quedarían 1 programa" "$TMP/pl1.txt" && grep -q "7160 Hist masivo 60" "$TMP/pl1.txt" && [ "$(estado)" = "0/0" ]; then ok "M6c falta un publicado (7160) + commit: aborta la verificación H1 y lo nombra; nada queda aplicado"; else fallo "M6c $(estado) $(grep -m1 ERROR "$TMP/pl1.txt")"; fi

# Solo H1 (sin borradores ni inactivos): la verificación de INVENTARIO aborta y nombra 7003, 7004 y 8802.
rellenar "$TMP/pl_soloh1.sql" "$IDS_H1" commit
correr "$TMP/pl_soloh1.sql" "$TMP/pl1b.txt"
if grep -q "VERIFICACIÓN DE INVENTARIO FALLIDA: quedarían 3 programa" "$TMP/pl1b.txt" && grep -q "7003 \[borrador\]" "$TMP/pl1b.txt" \
   && grep -q "7004 \[inactivo\]" "$TMP/pl1b.txt" && grep -q "8802 \[borrador\]" "$TMP/pl1b.txt" && [ "$(estado)" = "0/0" ]; then
  ok "M6c2 lista con solo H1: el inventario aborta y nombra el borrador 7003, el inactivo 7004 y el borrador 8802; nada queda aplicado"
else fallo "M6c2 $(estado) $(grep -m1 ERROR "$TMP/pl1b.txt")"; fi

# Falta solo el INACTIVO (7004): también aborta (inventario), aunque H1 esté completo.
rellenar "$TMP/pl_sininact.sql" "$(quitar "$IDS" 7004)" commit
correr "$TMP/pl_sininact.sql" "$TMP/pl1c.txt"
if grep -q "VERIFICACIÓN DE INVENTARIO FALLIDA: quedarían 1 programa" "$TMP/pl1c.txt" && grep -q "7004 \[inactivo\]" "$TMP/pl1c.txt" && ! grep -q "7003 \[" "$TMP/pl1c.txt" && [ "$(estado)" = "0/0" ]; then
  ok "M6c3 falta solo el inactivo 7004: el inventario aborta y lo nombra solo a él; nada queda aplicado"
else fallo "M6c3 $(estado) $(grep -m1 ERROR "$TMP/pl1c.txt")"; fi

# Falta solo un BORRADOR (7003): igual.
rellenar "$TMP/pl_sinborr.sql" "$(quitar "$IDS" 7003)" commit
correr "$TMP/pl_sinborr.sql" "$TMP/pl1d.txt"
if grep -q "VERIFICACIÓN DE INVENTARIO FALLIDA: quedarían 1 programa" "$TMP/pl1d.txt" && grep -q "7003 \[borrador\]" "$TMP/pl1d.txt" && [ "$(estado)" = "0/0" ]; then
  ok "M6c4 falta solo el borrador 7003: el inventario aborta y lo nombra; nada queda aplicado"
else fallo "M6c4 $(estado) $(grep -m1 ERROR "$TMP/pl1d.txt")"; fi

# Duplicados.
rellenar "$TMP/pl_dup.sql" "$IDS,(7001)" commit
correr "$TMP/pl_dup.sql" "$TMP/pl2.txt"
if grep -q "ids DUPLICADOS en la lista: 7001" "$TMP/pl2.txt" && [ "$(estado)" = "0/0" ]; then ok "M6d ids duplicados: rechazados (7001) sin dejar nada"; else fallo "M6d $(estado) $(grep -m1 ERROR "$TMP/pl2.txt")"; fi

# Inexistente.
rellenar "$TMP/pl_inex.sql" "$IDS,(99999)" commit
correr "$TMP/pl_inex.sql" "$TMP/pl3.txt"
if grep -q "NO existen en programas: 99999" "$TMP/pl3.txt" && [ "$(estado)" = "0/0" ]; then ok "M6e id inexistente: rechazado (99999) sin dejar nada"; else fallo "M6e $(estado) $(grep -m1 ERROR "$TMP/pl3.txt")"; fi

# Contradictorio: el borrador 7003 ya tiene un destino REAL y sigue en la lista.
$PS >/dev/null <<'SQL'
insert into public.programa_destinos_fijos (id, nombre) values (8810, 'Real Contradictorio');
update public.programas set destino_fijo_id = 8810 where id = 7003;
SQL
rellenar "$TMP/pl_contra.sql" "$IDS" commit
correr "$TMP/pl_contra.sql" "$TMP/pl4.txt"
if grep -q "CONTRADICTORIOS" "$TMP/pl4.txt" && grep -q "7003 (ya tiene el destino real" "$TMP/pl4.txt" && [ "$(estado)" = "0/0" ] && [ "$($PS -c "select destino_fijo_id from public.programas where id = 7003")" = 8810 ]; then
  ok "M6f id con destino real: rechazado como contradictorio y su destino NO se pisa"
else fallo "M6f $(estado) $(grep -m1 ERROR "$TMP/pl4.txt")"; fi
$PS >/dev/null <<'SQL'
update public.programas set destino_fijo_id = null where id = 7003;
delete from public.programa_destinos_fijos where id = 8810;
SQL

# Un destino REAL llamado «Por clasificar» bloquea crear el provisional.
$PS >/dev/null <<'SQL'
insert into public.programa_destinos_fijos (id, nombre) values (8811, 'Por clasificar');
SQL
rellenar "$TMP/pl_nombre.sql" "$IDS" commit
correr "$TMP/pl_nombre.sql" "$TMP/pl5.txt"
if grep -q "ya existe un destino REAL llamado" "$TMP/pl5.txt" && [ "$(estado)" = "0/0" ]; then ok "M6g un destino real con el nombre del provisional bloquea la plantilla (no se confunde por nombre)"; else fallo "M6g $(estado) $(grep -m1 ERROR "$TMP/pl5.txt")"; fi
$PS >/dev/null <<'SQL'
delete from public.programa_destinos_fijos where id = 8811;
SQL

# Inventario completo, ROLLBACK (vista previa): muestra todo y no persiste.
rellenar "$TMP/pl_seco.sql" "$IDS"
correr "$TMP/pl_seco.sql" "$TMP/pl6.txt"
if grep -q "DESTINO PROVISIONAL" "$TMP/pl6.txt" && grep -q "publicados y activos SIN destino = 0" "$TMP/pl6.txt" && grep -q "programas SIN destino (cualquier estado) = 0" "$TMP/pl6.txt" \
   && grep -q "borrador: no es público" "$TMP/pl6.txt" && grep -q "inactivo: no es público" "$TMP/pl6.txt" && [ "$(estado)" = "0/0" ]; then
  ok "M6h inventario completo con ROLLBACK: vista previa (incluye borradores e inactivos) con ambas verificaciones en 0 y no persiste nada"
else fallo "M6h $(estado) $(head -c 300 "$TMP/pl6.txt")"; fi

# Inventario completo, COMMIT.
rellenar "$TMP/pl_commit.sql" "$IDS" commit
correr "$TMP/pl_commit.sql" "$TMP/pl7.txt"
SIN_DEST="$($PS -c "select count(*) from public.programas where destino_fijo_id is null")"
D8801="$($PS -c "select destino_fijo_id from public.programas where id = 8801")"
BORR_INACT="$($PS -c "select string_agg(p.id::text, ',' order by p.id) from public.programas p join public.programa_destinos_fijos d on d.id = p.destino_fijo_id where d.es_provisional and p.id in (7003, 7004, 8802)")"
if [ "$(estado)" = "1/$NTODOS" ] && [ "$SIN_DEST" = 0 ] && [ "$D8801" = 8801 ] && [ "$BORR_INACT" = "7003,7004,8802" ]; then
  ok "M6i commit: 1 provisional con los $NTODOS del inventario (borradores 7003/8802 e inactivo 7004 incluidos); 0 programas sin destino; 8801 conserva su destino real"
else fallo "M6i estado=$(estado) sin_destino=$SIN_DEST 8801=$D8801 borr_inact=[$BORR_INACT]"; fi

# Idempotente.
correr "$TMP/pl_commit.sql" "$TMP/pl8.txt"
if [ "$(estado)" = "1/$NTODOS" ] && ! grep -q ERROR "$TMP/pl8.txt"; then ok "M6j re-ejecutar es idempotente (sigue 1 provisional con $NTODOS; sin error)"; else fallo "M6j $(estado) $(grep -m1 ERROR "$TMP/pl8.txt")"; fi

# Preflight y postcheck después: H1 = N1 = 0 y la 213 sigue 14/14.
$PSA -d "$DB" -t -A -F'|' < "$AQUI/preflight_213_programa_destino_fijo.sql" >"$TMP/pre3.txt" 2>&1 || true
$PSA -d "$DB" -t -A -F'|' < "$AQUI/postcheck_213_programa_destino_fijo.sql" >"$TMP/post4.txt" 2>&1 || true
if [ "$(grep '^H1|' "$TMP/pre3.txt" | cut -d'|' -f3)" = 0 ] && grep -q '^H1V|INFO|0|(ninguno)' "$TMP/pre3.txt" \
   && [ "$(grep '^N1|' "$TMP/pre3.txt" | cut -d'|' -f3)" = 0 ] && grep -q '^N1V|INFO|0|(ninguno)' "$TMP/pre3.txt" && [ "$(grep -c '|t|' "$TMP/post4.txt")" = 14 ]; then
  ok "M6k tras la plantilla: preflight H1=0 y N1=0 (ninguno) y postcheck 14/14"
else fallo "M6k $(grep -E '^(H1|N1)[|V]' "$TMP/pre3.txt" | cut -c1-80)"; fi

# Flujo provisional -> destino real (lo que hará la app): reasignar un programa al destino real.
$PS >/dev/null <<'SQL'
insert into public.programa_destinos_fijos (id, nombre) values (8820, 'Destino Real T');
update public.programas set destino_fijo_id = 8820 where id = 7001;
SQL
if [ "$(estado)" = "1/$((NTODOS - 1))" ] && [ "$($PS -c "select count(*) from public.programas where destino_fijo_id is null")" = 0 ]; then ok "M6l provisional -> real: el programa reasignado sale del provisional ($((NTODOS - 1)) quedan) y nadie queda sin destino"; else fallo "M6l $(estado)"; fi

# RB · rollback y reaplicación.
$PSA -d "$DB" -1 < "$AQUI/rollback_213_programa_destino_fijo.sql" >/dev/null 2>&1 || { fallo "RB rollback falló"; }
$PSA -d "$DB" -t -A -F'|' < "$AQUI/postcheck_213_programa_destino_fijo.sql" >"$TMP/post2.txt" 2>&1 || true
NF2="$(grep -c '|f|' "$TMP/post2.txt" || true)"
HISTORICOS="$($PS -c "select count(*) from public.programas where id between 7001 and 7004")"
[ "$NF2" -ge 8 ] && [ "$HISTORICOS" = 4 ] && ok "RB tras el rollback el postcheck da $NF2 filas en rojo y los programas siguen (4)" || fallo "RB f=$NF2 hist=$HISTORICOS"
$PSA -d "$DB" < "$APP/supabase/migrations/20260601000213_programa_destino_fijo.sql" >/dev/null 2>&1 || fallo "RB reaplicar 213"
$PSA -d "$DB" -t -A -F'|' < "$AQUI/postcheck_213_programa_destino_fijo.sql" >"$TMP/post3.txt" 2>&1 || true
[ "$(grep -c '|t|' "$TMP/post3.txt")" = 14 ] && ok "RB reaplicada la 213: postcheck 14/14" || fallo "RB postcheck final: $(cat "$TMP/post3.txt" | cut -c1-200)"

echo "------------------------------------------------------------"
if [ "$FALLOS" = 0 ]; then echo "TEST 213 MIGRACIÓN: TODO OK"; else echo "TEST 213 MIGRACIÓN: $FALLOS FALLO(S)"; exit 1; fi
