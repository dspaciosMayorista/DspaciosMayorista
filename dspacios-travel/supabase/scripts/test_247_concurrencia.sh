#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PR #409 · Concurrencia REAL (commits reales, tres sesiones psql) de la comprobación diferida del itinerario de un programa PUBLICADO (migración 247).
# Lo invoca test_247_programa_blackout_alcance.sh sobre la base desechable ya migrada; también se puede correr suelto:
#   sh supabase/scripts/test_247_concurrencia.sh <contenedor_pg> <base_con_la_246>
#
# Barrera determinista: una sesión coordinadora retiene un candado consultivo (246,1); las dos sesiones de la prueba ESCRIBEN y luego piden ese
# candado (quedan en espera); cuando el coordinador ve las dos esperando las libera y ambas confirman a la vez. Así las dos ya escribieron antes
# de que cualquiera confirme: es exactamente la carrera que el candado por programa debe serializar.
#   S1  dos eliminaciones simultáneas (días repetidos heredados: cada una por sí sola deja el programa completo; juntas lo dejarían sin el día 3)
#   S2  publicar mientras otra transacción borra un día (borrador: cada una por sí sola es válida)
#   S3  dos intercambios de días entre dos publicados (sentidos opuestos): ambos deben confirmar, sin deadlock
#   Control negativo: con el candado reemplazado por una espera sin exclusión, S1 SÍ deja el programa incompleto (la prueba detecta el defecto).
# Solo Docker local y desechable. Deja la base como la encontró (fixtures __t246_cc_*) y restaura la función original aunque falle.
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"; DB="${2:-}"
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
printf '%s' "$DB" | grep -Eq '^t24[0-9a-z]*_[a-z0-9_]{1,40}$' || { echo "Base inválida (solo bases t24*_ desechables)." >&2; exit 2; }
export MSYS_NO_PATHCONV=1
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -d $DB"
T="$(mktemp -d)"
DEF_ORIGINAL=""

q() { $PS -v ON_ERROR_STOP=1 -c "$1"; }
fallo() { echo "FALLO: $1" >&2; exit 1; }
ok() { echo "OK  $1"; }
compara() { [ "$2" = "$3" ] && ok "$1 = $2" || fallo "$1 = $2 (esperado $3)"; }

limpiar() {
  st=$?
  if [ -n "$DEF_ORIGINAL" ]; then printf '%s\n' "$DEF_ORIGINAL" | $PS -v ON_ERROR_STOP=1 >/dev/null 2>&1 || echo "AVISO: restaura a mano public.bloquear_itinerario_programa en $DB" >&2; fi
  $PS -c "delete from public.programas where nombre like '\_\_t246\_cc\_%'" >/dev/null 2>&1 || true
  rm -rf "$T"
  exit "$st"
}
trap limpiar EXIT

[ "$(q "select count(*) from pg_proc where proname = 'bloquear_itinerario_programa'")" = 1 ] || fallo "la 247 (con el candado por programa) no está aplicada en $DB"
q "delete from public.programas where nombre like '\_\_t246\_cc\_%'" >/dev/null

# Programa publicado con días 1..3 (y opcionalmente un día 3 repetido heredado). Con session_replication_role = replica no corren los triggers
# diferidos: así se reproduce un estado HEREDADO que la base ya no deja crear.
nuevo_programa() { # nombre publicado(true|false) lista_de_dias
  q "insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado) values ('$1', 3, 2, 'USD', 'categoria', 'ninguno', false)" >/dev/null
  id="$(q "select id from public.programas where nombre = '$1'")"
  for d in $3; do q "insert into public.programa_dias (programa_id, dia, titulo) values ($id, $d, 'D$d')" >/dev/null; done
  if [ "$2" = true ]; then
    printf '%s\n' "set session_replication_role = replica;" "update public.programas set publicado = true where id = $id;" | $PS -v ON_ERROR_STOP=1 >/dev/null
  fi
  echo "$id"
}

# carrera <sql_A> <sql_B>: A y B escriben, esperan la barrera y confirman a la vez. Salidas en $T/a.out y $T/b.out.
carrera() {
  printf '%s\n' "begin;" "$1" "select pg_advisory_lock_shared(246, 1);" "commit;" > "$T/a.sql"
  printf '%s\n' "begin;" "$2" "select pg_advisory_lock_shared(246, 1);" "commit;" > "$T/b.sql"
  cat > "$T/c.sql" <<'SQL'
select pg_advisory_lock(246, 1);
do $$
declare v_t timestamptz := clock_timestamp();
begin
  loop
    exit when (select count(*) from pg_locks where locktype = 'advisory' and classid = 246 and objid = 1 and not granted) >= 2;
    if clock_timestamp() - v_t > interval '60 seconds' then raise exception 'barrera: las dos sesiones no llegaron'; end if;
    perform pg_sleep(0.05);
  end loop;
end $$;
select pg_advisory_unlock(246, 1);
SQL
  rm -f "$T/a.out" "$T/b.out" "$T/c.out"
  $PS -v ON_ERROR_STOP=1 < "$T/c.sql" > "$T/c.out" 2>&1 &
  pc=$!
  i=0
  while [ "$(q "select count(*) from pg_locks where locktype = 'advisory' and classid = 246 and objid = 1 and granted")" != 1 ]; do
    i=$((i + 1)); [ "$i" -lt 200 ] || fallo "el coordinador no tomó la barrera"; sleep 0.1
  done
  $PS < "$T/a.sql" > "$T/a.out" 2>&1 &
  pa=$!
  $PS < "$T/b.sql" > "$T/b.out" 2>&1 &
  pb=$!
  wait "$pc" || fallo "el coordinador falló: $(cat "$T/c.out")"
  wait "$pa" || true
  wait "$pb" || true
}
errores() { # cuenta cuántas de las dos sesiones terminaron con ERROR
  n=0
  for f in "$T/a.out" "$T/b.out"; do if grep -q 'ERROR:' "$f"; then n=$((n + 1)); fi; done
  echo "$n"
}
mensajes() { cat "$T/a.out" "$T/b.out" | grep 'ERROR:' | cut -c1-200 || true; }

echo "=== S1 dos eliminaciones simultáneas (días 3 repetidos heredados) ==="
s1() {
  q "delete from public.programas where nombre = '__t246_cc_s1__'" >/dev/null
  P1="$(nuevo_programa __t246_cc_s1__ false '1 2 3 3')"
  printf '%s\n' "set session_replication_role = replica;" "update public.programas set publicado = true where id = $P1;" | $PS -v ON_ERROR_STOP=1 >/dev/null
  R1="$(q "select id from public.programa_dias where programa_id = $P1 and dia = 3 order by id limit 1")"
  R2="$(q "select id from public.programa_dias where programa_id = $P1 and dia = 3 order by id desc limit 1")"
  compara "estado heredado: publicado con el día 3 repetido" "$(q "select publicado || ':' || (select count(*) from public.programa_dias where programa_id = $P1 and dia = 3) from public.programas where id = $P1")" "true:2"
  carrera "delete from public.programa_dias where id = $R1;" "delete from public.programa_dias where id = $R2;"
}
s1
compara "S1: exactamente UNA eliminación se rechazó" "$(errores)" 1
mensajes | grep -q "quedaría incompleto (faltan los días 3)" && ok "S1: la rechazada dice qué falta (día 3)" || fallo "S1: mensaje inesperado: $(mensajes)"
compara "S1: el programa queda con el día 3 una sola vez (completo)" "$(q "select count(*) from public.programa_dias where programa_id = $P1 and dia = 3")" 1
compara "S1: el programa publicado sigue sin problema de itinerario" "$(q "select coalesce(public.itinerario_programa_problema(id, dias), 'completo') from public.programas where id = $P1")" completo

echo "=== S2 publicar mientras otra transacción borra un día ==="
P2="$(nuevo_programa __t246_cc_s2__ false '1 2 3')"
carrera "update public.programas set publicado = true where id = $P2;" "delete from public.programa_dias where programa_id = $P2 and dia = 2;"
compara "S2: exactamente UNA de las dos se rechazó" "$(errores)" 1
mensajes | grep -q "quedaría incompleto" && ok "S2: el rechazo explica el itinerario incompleto" || fallo "S2: mensaje inesperado: $(mensajes)"
compara "S2: invariante — nunca queda publicado e incompleto" "$(q "select (publicado and public.itinerario_programa_problema(id, dias) is not null)::text from public.programas where id = $P2")" false

echo "=== S3 dos intercambios de días entre dos publicados (sentidos opuestos, sin deadlock) ==="
P3A="$(nuevo_programa __t246_cc_s3a__ true '1 2 3')"
P3B="$(nuevo_programa __t246_cc_s3b__ true '1 2 3')"
carrera "update public.programa_dias set programa_id = case programa_id when $P3A then $P3B else $P3A end where programa_id in ($P3A, $P3B) and dia = 3;" \
        "update public.programa_dias set programa_id = case programa_id when $P3B then $P3A else $P3B end where programa_id in ($P3A, $P3B) and dia = 2;"
compara "S3: ninguna de las dos se rechazó" "$(errores)" 0
grep -qi deadlock "$T/a.out" "$T/b.out" && fallo "S3: hubo deadlock" || ok "S3: sin deadlock"
compara "S3: ambos publicados siguen completos" "$(q "select count(*) from public.programas where id in ($P3A, $P3B) and public.itinerario_programa_problema(id, dias) is null")" 2

echo "=== Control negativo: sin candado, S1 SÍ rompe el itinerario ==="
DEF_ORIGINAL="$(q "select pg_get_functiondef('public.bloquear_itinerario_programa(bigint)'::regprocedure) || ';'")"
q "create or replace function public.bloquear_itinerario_programa(p_programa_id bigint) returns void language sql security invoker set search_path = public, pg_temp as \$\$ select pg_sleep(1) \$\$" >/dev/null
s1
compara "control: sin exclusión ambas eliminaciones confirman" "$(errores)" 0
compara "control: el publicado quedó SIN el día 3 (el defecto que el candado evita)" "$(q "select count(*) from public.programa_dias where programa_id = $P1 and dia = 3")" 0
printf '%s\n' "$DEF_ORIGINAL" | $PS -v ON_ERROR_STOP=1 >/dev/null
DEF_ORIGINAL=""
compara "función original restaurada (candado real)" "$(q "select (prosrc like '%pg_advisory_xact_lock%')::text from pg_proc where proname = 'bloquear_itinerario_programa'")" true

q "delete from public.programas where nombre like '\_\_t246\_cc\_%'" >/dev/null
compara "fixtures retirados" "$(q "select count(*) from public.programas where nombre like '\_\_t246\_cc\_%'")" 0
echo "CONCURRENCIA OK"
