#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# CARRERAS con DOS SESIONES REALES contra la 297 (#43/#60 entrega 3b). Solo Postgres LOCAL desechable.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_297_concurrencia.sh <contenedor> <plantilla>
# Antes de cada carrera se leen la huella (__H__), la versión de la calculadora (__V__) y la de las bases
# del grupo Semana (__B__), como quien abrió la revisión. A escribe y espera 3 s antes de confirmar; B
# escribe 1 s después con lo leído. Una tercera sesión comprueba que B quedó ESPERANDO un candado.
# Cubre a TODOS los escritores de hotel_calculadora: guardar la calculadora (W1), renombrar una vigencia
# (W2, update condicionado), la API directa y la RPC nueva.
# ─────────────────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t297c_$$"; FALLOS=0; TMP="$(mktemp -d)"
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || exit 2
for f in supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql supabase/scripts/fixture_293_vigencia_grupos_dias.sql \
         supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql \
         supabase/migrations/20260601000297_calculadora_grupos_dias.sql supabase/scripts/fixture_297_calculadora_grupos_dias.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done
COMO_OPER="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-4000-8000-000000009302\",\"session_id\":\"00000000-0000-4000-8000-00000000a302\",\"role\":\"authenticated\"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;"
G1="00000000-0000-4000-8000-0000000c0001"; G2="00000000-0000-4000-8000-0000000c0002"
FILA="'[{\"grupo_id\":\"$G1\",\"tipo_habitacion\":\"Estándar\",\"alimentacion\":\"PAM\",\"neto_doble\":111000}]'::jsonb"
BASES="'[{\"categoria\":\"Estándar\",\"precio\":111000}]'::jsonb"
lee() { $SQL -d "$DB" -At -c "$1"; }
# Bases iniciales de Semana (versión 1) para que exista la fila a comparar.
lee "$COMO_OPER select public.grupos_dias_guardar_calculadora(930101, public.grupos_dias_config(930101)->>'huella', '$G1', 'dubai',
     (select version from public.hotel_calculadora where hotel_id = 9301), null, $BASES, '[]'::jsonb)" >/dev/null || { echo "No se pudieron crear las bases"; exit 2; }

carrera() {
  id="$1"; a="$2"; b="$3"; esperado="$4"
  H="$(lee "select public._grupos_43_config(930101)->>'huella'")"
  V="$(lee "select version from public.hotel_calculadora where hotel_id = 9301")"
  B="$(lee "select version from public.hotel_calculadora_grupo_bases where grupo_id = '$G1' and tipo = 'dubai'")"
  a="$(printf '%s' "$a" | sed "s/__H__/$H/g; s/__V__/$V/g; s/__B__/$B/g")"
  b="$(printf '%s' "$b" | sed "s/__H__/$H/g; s/__V__/$V/g; s/__B__/$B/g")"
  printf 'set lock_timeout = %s;\nbegin;\n%s;\nselect pg_sleep(3);\ncommit;\n' "'20s'" "$a" | $SQL -d "$DB" >"$TMP/$id.a" 2>&1 &
  pa=$!
  printf '%s\nset lock_timeout = %s;\nselect pg_sleep(1);\n/* carreraB:%s */ %s;\n' "$COMO_OPER" "'20s'" "$id" "$b" | $SQL -d "$DB" >"$TMP/$id.b" 2>&1 &
  pb=$!
  espera="$($SQL -d "$DB" -At -c "select pg_sleep(2); select coalesce(string_agg(wait_event_type || '/' || wait_event, ','), 'NO ESPERABA') from pg_stat_activity where query like '%carreraB:$id %' and pid <> pg_backend_pid() and state = 'active'" | tail -1)"
  wait $pa; wait $pb
  if grep -q ERROR "$TMP/$id.a"; then fallo "$id: la sesión A falló: $(grep ERROR "$TMP/$id.a" | head -1)"; return; fi
  rb="$(grep -m1 ERROR "$TMP/$id.b" | sed 's/^.*ERROR: *//')"
  case "$espera" in Lock/*) : ;; *) fallo "$id: B no quedó esperando un candado ($espera)"; return ;; esac
  if [ -z "$esperado" ]; then [ -z "$rb" ] && ok "$id: B esperó ($espera) y pasó" || fallo "$id: B debía pasar y falló: $rb"
  else echo "$rb" | grep -Eqi "$esperado" && ok "$id: B esperó ($espera) y fue rechazada: ${rb%%.*}" || fallo "$id: B debía rechazarse; obtuvo: ${rb:-pasó sin error}"; fi
}
RPC_B="select public.grupos_dias_guardar_calculadora(930101, '__H__', '$G1', 'dubai', __V__, __B__, $BASES, $FILA)"
RPC_B_SOLO_BASES="select public.grupos_dias_guardar_calculadora(930101, '__H__', '$G1', 'dubai', __V__, __B__, $BASES, '[]'::jsonb)"
# Escritura condicionada a la versión leída (W1 «guardar calculadora» y W2 «renombrar vigencia» de la app).
W_COND="do \$\$ declare n int; begin update public.hotel_calculadora set params = params where hotel_id = 9301 and version = __V__; get diagnostics n = row_count; if n = 0 then raise exception 'CONFIG_DESACTUALIZADA: la calculadora cambió (0 filas)'; end if; end \$\$"

carrera K1 "update public.hotel_calculadora set params = params || '{\"x\":1}' where hotel_id = 9301" "$RPC_B" 'calculadora del hotel cambió'
carrera K2 "$COMO_OPER $W_COND" "$RPC_B" 'calculadora del hotel cambió'
carrera K3 "$COMO_OPER select public.grupos_dias_guardar_calculadora(930101, '__H__', '$G1', 'dubai', __V__, __B__, '[{\"categoria\":\"Estándar\",\"precio\":99000}]'::jsonb, '[]'::jsonb)" \
           "$RPC_B_SOLO_BASES" 'bases de este grupo cambiaron'
carrera K4 "$COMO_OPER $W_COND" "$W_COND" 'CONFIG_DESACTUALIZADA'
carrera K5 "$COMO_OPER select public.grupos_dias_borrar('$G2', '__H__')" "$RPC_B" 'CONFIG_DESACTUALIZADA'
# Controles: B debe ESPERAR pero PASAR.
#  K6: la RPC solo toma la fila de la calculadora en modo compartido; un guardado de la calculadora que llega
#      después espera y luego pasa (la versión no cambió: la RPC no escribe la calculadora).
carrera K6 "$COMO_OPER $RPC_B_SOLO_BASES" "$W_COND" ''
#  K7: guardar otro grupo de la misma vigencia (solo bases) no invalida la huella ni la versión del grupo Semana.
lee "insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias) values ('$G2', 930101, 'Fin de semana', array[5,6,7])" >/dev/null
carrera K7 "$COMO_OPER select public.grupos_dias_guardar_calculadora(930101, '__H__', '$G2', 'dubai', __V__, (select version from public.hotel_calculadora_grupo_bases where grupo_id = '$G2'), '[{\"categoria\":\"Estándar\",\"precio\":150000}]'::jsonb, '[]'::jsonb)" \
           "$RPC_B_SOLO_BASES" ''
#  K8: B revisó el borrado de Semana (huella y versión de sus bases) → A guarda bases nuevas de Semana → B confirma
#      el borrado antiguo: debe rechazarse SIN borrar nada (ni grupo, ni propuestas, ni bases).
lee "insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble) values ('$G1', 'Estándar', 'PAM', 100000)" >/dev/null
PROPS_ANTES="$(lee "select count(*) from public.hotel_grupo_tarifa_propuesta")"
carrera K8 "$COMO_OPER select public.grupos_dias_guardar_calculadora(930101, '__H__', '$G1', 'dubai', __V__, __B__, '[{\"categoria\":\"Estándar\",\"precio\":101000}]'::jsonb, '[]'::jsonb)" \
           "select public.grupos_dias_borrar_con_bases('$G1', '__H__', '[{\"tipo\":\"dubai\",\"version\":__B__}]'::jsonb)" 'bases de calculadora de este grupo cambiaron'
QUEDA="$(lee "select (select count(*) from public.hotel_temporada_grupos where id = '$G1') || '/' || (select count(*) from public.hotel_calculadora_grupo_bases where grupo_id = '$G1' and bases->0->>'precio' = '101000') || '/' || (select count(*) from public.hotel_grupo_tarifa_propuesta)")"
[ "$PROPS_ANTES" -ge 1 ] && [ "$QUEDA" = "1/1/$PROPS_ANTES" ] && ok "K8: tras el rechazo siguen el grupo, sus bases NUEVAS y todas las propuestas ($QUEDA)" || fallo "K8: se borró algo ($QUEDA; propuestas antes $PROPS_ANTES)"
#  K9 (control): guardar bases de OTRO grupo no invalida el borrado revisado de Semana: espera y pasa.
carrera K9 "$COMO_OPER select public.grupos_dias_guardar_calculadora(930101, '__H__', '$G2', 'dubai', __V__, (select version from public.hotel_calculadora_grupo_bases where grupo_id = '$G2'), '[{\"categoria\":\"Estándar\",\"precio\":151000}]'::jsonb, '[]'::jsonb)" \
           "select public.grupos_dias_borrar_con_bases('$G1', '__H__', '[{\"tipo\":\"dubai\",\"version\":__B__}]'::jsonb)" ''
[ "$(lee "select count(*) from public.hotel_calculadora_grupo_bases where grupo_id = '$G1'")" = 0 ] && ok "K9: el borrado confirmado se llevó el grupo y sus bases" || fallo "K9: quedaron bases de Semana"

echo "--- invariantes"
INV="$(lee "select (select count(*) from public.hotel_temporada_grupos where activo) + (select count(*) from public.tarifa_hotel where grupo_id is not null)")"
[ "$INV" = 0 ] && ok "ningún grupo activo ni tarifa por grupo tras las carreras" || fallo "invariantes violadas ($INV)"
echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
