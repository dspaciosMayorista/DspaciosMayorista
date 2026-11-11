#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# CARRERAS con DOS SESIONES REALES contra la 293 (#43/#60). Solo Postgres LOCAL desechable.
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_293_concurrencia.sh <contenedor> <plantilla> [migración]
#   [migración] por defecto la del repo; se puede pasar otra versión para reproducir un defecto.
# Cada carrera: la sesión A abre una transacción, hace su cambio y espera 3 s antes de confirmar;
# la sesión B arranca 1 s después con la operación que compite. Una tercera sesión comprueba en
# pg_stat_activity que B quedó ESPERANDO un candado (prueba de que la carrera ocurrió de verdad).
# Al final, una consulta de invariantes debe dar 0 violaciones.
# ─────────────────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
MIG="${3:-supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql}"
DB="t293c_$$"; FALLOS=0; TMP="$(mktemp -d)"
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1; rm -rf "$TMP"' EXIT

$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || exit 2
docker cp "$MIG" "$CT:/tmp/m293c.sql" && docker cp supabase/scripts/fixture_293_concurrencia.sql "$CT:/tmp/fx293c.sql"
$SQL -d "$DB" -f /tmp/m293c.sql >/dev/null 2>&1 || { echo "No se pudo aplicar $MIG"; exit 2; }
$SQL -d "$DB" -f /tmp/fx293c.sql >/dev/null || exit 2
echo "migración: $MIG ($(md5sum "$MIG" | cut -c1-12))"

# carrera <id> <sql A> <sql B> <patrón de error esperado en B, vacío = B debe pasar>
carrera() {
  id="$1"; a="$2"; b="$3"; esperado="$4"
  printf 'set lock_timeout = %s;\nbegin;\n%s;\nselect pg_sleep(3);\ncommit;\n' "'20s'" "$a" | $SQL -d "$DB" >"$TMP/$id.a" 2>&1 &
  pa=$!
  printf 'set lock_timeout = %s;\nselect pg_sleep(1);\n/* carreraB:%s */ %s;\n' "'20s'" "$id" "$b" | $SQL -d "$DB" >"$TMP/$id.b" 2>&1 &
  pb=$!
  espera="$($SQL -d "$DB" -At -c "select pg_sleep(2); select coalesce(string_agg(wait_event_type || '/' || wait_event, ','), 'NO ESPERABA') from pg_stat_activity where query like '%carreraB:$id %' and pid <> pg_backend_pid() and state = 'active'" | tail -1)"
  wait $pa; wait $pb
  if grep -q ERROR "$TMP/$id.a"; then fallo "$id: la sesión A falló: $(grep ERROR "$TMP/$id.a" | head -1)"; return; fi
  rb="$(grep -m1 ERROR "$TMP/$id.b" | sed 's/^.*ERROR: *//')"
  case "$espera" in Lock/*) : ;; *) fallo "$id: B no quedó esperando un candado ($espera)"; return ;; esac
  if [ -z "$esperado" ]; then
    [ -z "$rb" ] && ok "$id: B esperó ($espera) y pasó, como corresponde" || fallo "$id: B debía pasar y falló: $rb"
  else
    echo "$rb" | grep -Eqi "$esperado" && ok "$id: B esperó ($espera) y fue rechazada: $rb" || fallo "$id: B debía rechazarse ($esperado); obtuvo: ${rb:-pasó sin error}"
  fi
}

G='insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values'
carrera R1 "update public.hotel_temporadas set nombre = 'BAJA' where id = 940101" \
           "$G (940101, 'Semana', array[1,2,3,4])" 'nombre repetido'
carrera R2 "update public.hotel_temporadas set hotel_id = 9400 where id = 940201" \
           "$G (940201, 'Semana', array[1,2,3,4])" 'modelo por unidad'
carrera R3 "update public.hoteles set modelo_tarifario = 'unidad' where id = 9403" \
           "$G (940301, 'Semana', array[1,2,3,4])" 'modelo por unidad'
carrera R4 "$G (940401, 'Semana', array[1,2,3,4])" \
           "update public.hoteles set modelo_tarifario = 'unidad' where id = 9404" 'tiene grupos'
carrera R5 "$G (940501, 'Fin de semana', array[5,6,7])" \
           "$G (940501, 'Sábado y domingo', array[6,7])" 'comparte días'
carrera R6 "$G (940601, 'Fin de semana', array[5,6,7])" \
           "$G (940601, 'Semana', array[1,2,3,4])" ''
carrera R7 "$G (940701, 'Semana', array[1,2,3,4])" \
           "update public.hotel_temporadas set nombre = 'ALTA' where id = 940702" 'con grupos'
carrera R8 "$G (940801, 'Semana', array[1,2,3,4])" \
           "update public.hotel_temporadas set hotel_id = 9409 where id = 940801" 'otro hotel'

carrera R9 "update public.hotel_temporadas set nombre = 'ALTA' where id = 941002" \
           "$G (941001, 'Semana', array[1,2,3,4])" 'nombre repetido'

echo "--- invariantes (deben ser 0)"
INV="$($SQL -d "$DB" -At -F '|' <<'EOF'
select 'grupos en vigencia de nombre repetido', count(*) from public.hotel_temporada_grupos g
  join public.hotel_temporadas t on t.id = g.temporada_id
  where exists (select 1 from public.hotel_temporadas o where o.hotel_id = t.hotel_id and o.id <> t.id and btrim(o.nombre) = btrim(t.nombre))
union all
select 'grupos en hoteles por unidad', count(*) from public.hotel_temporada_grupos g
  join public.hotel_temporadas t on t.id = g.temporada_id join public.hoteles h on h.id = t.hotel_id
  where h.modelo_tarifario = 'unidad'
union all
select 'pares de grupos con días solapados', count(*) from public.hotel_temporada_grupos a
  join public.hotel_temporada_grupos b on b.temporada_id = a.temporada_id and a.id < b.id and a.dias && b.dias
union all
select 'grupos activos', count(*) from public.hotel_temporada_grupos where activo;
EOF
)"
echo "$INV" | while IFS='|' read -r c n; do echo "  $c: $n"; done
[ "$(echo "$INV" | awk -F'|' '{s += $2} END {print s}')" = 0 ] && ok "invariantes en 0" || fallo "hay invariantes violadas"

echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
