#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# CARRERAS con DOS SESIONES REALES contra la 295 (#43/#60 incremento 3). Solo Postgres LOCAL desechable.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_295_concurrencia.sh <contenedor> <plantilla>
# En cada carrera la sesión B toma la huella ANTES de que empiece A (como quien abrió la vista previa);
# A cambia algo y espera 3 s antes de confirmar; B confirma 1 s después con esa huella. Una tercera
# sesión comprueba que B quedó ESPERANDO un candado. Esperado: B rechazada con PT409 («recarga»),
# salvo la carrera de control C8 (un cambio que no afecta a la vigencia), donde B espera y pasa.
# ─────────────────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t295c_$$"; FALLOS=0; TMP="$(mktemp -d)"
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || exit 2
for f in supabase/migrations/20260601000293_vigencia_grupos_dias_inactivos.sql supabase/scripts/fixture_293_vigencia_grupos_dias.sql \
         supabase/migrations/20260601000295_grupos_dias_propuesta.sql supabase/scripts/fixture_295_grupos_dias_propuesta.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done
# Estado inicial: dos grupos y una propuesta en ALTA (930101).
$SQL -d "$DB" >/dev/null <<'EOF'
insert into public.hotel_temporada_grupos (id, temporada_id, nombre, dias) values
  ('00000000-0000-4000-8000-0000000c0001', 930101, 'Semana', array[1,2,3,4]),
  ('00000000-0000-4000-8000-0000000c0002', 930101, 'Fin de semana', array[5,6,7]);
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble)
values ('00000000-0000-4000-8000-0000000c0001', 'Estándar', 'PAM', 100000);
EOF
COMO_OPER="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-4000-8000-000000009302\",\"session_id\":\"00000000-0000-4000-8000-00000000a302\",\"role\":\"authenticated\"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;"
FILA="'[{\"grupo_id\":\"00000000-0000-4000-8000-0000000c0002\",\"tipo_habitacion\":\"Estándar\",\"alimentacion\":\"PAM\",\"neto_doble\":180000}]'::jsonb"
huella() { $SQL -d "$DB" -At -c "select public._grupos_43_config(930101)->>'huella'"; }

# carrera <id> <sql A (como admin o con su propio rol)> <sql B con __H__ = huella previa> <patrón esperado; vacío = B pasa>
carrera() {
  id="$1"; a="$2"; b="$3"; esperado="$4"
  H="$(huella)"; b="$(printf '%s' "$b" | sed "s/__H__/$H/g")"
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
PROP="select public.grupos_dias_guardar_propuesta(930101, '__H__', 'actualizar', null, $FILA)"

carrera C1 "update public.tarifa_hotel set neto_doble = neto_doble + 1 where hotel_id = 9301 and temporada = 'ALTA'" "$PROP" CONFIG_DESACTUALIZADA
carrera C2 "update public.tarifa_hotel set neto_doble = neto_doble + 1 where hotel_id = 9301 and temporada_base = 'ALTA'" "$PROP" CONFIG_DESACTUALIZADA
carrera C3 "update public.hotel_temporadas set fecha_fin = '2027-01-30' where id = 930108" "$PROP" CONFIG_DESACTUALIZADA
carrera C4 "insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (9301, 'Superior', 'PC', 'ALTA', 200000)" "$PROP" CONFIG_DESACTUALIZADA
carrera C5 "$COMO_OPER select public.grupos_dias_guardar_propuesta(930101, (select public.grupos_dias_config(930101)->>'huella'), 'actualizar', null, '[{\"grupo_id\":\"00000000-0000-4000-8000-0000000c0001\",\"tipo_habitacion\":\"Estándar\",\"alimentacion\":\"PC\",\"neto_doble\":1}]'::jsonb)" "$PROP" CONFIG_DESACTUALIZADA
carrera C6 "update public.hotel_temporada_grupos set dias = array[5,6] where id = '00000000-0000-4000-8000-0000000c0002'" "$PROP" CONFIG_DESACTUALIZADA
carrera C7 "update public.hotel_temporadas set nombre = 'ALTA ENERO' where id = 930101" \
           "select public.grupos_dias_guardar(930101, '__H__', '[{\"nombre\":\"Otro\",\"dias\":[7]}]'::jsonb)" CONFIG_DESACTUALIZADA
# Control: un cambio de OTRA vigencia del mismo hotel espera el candado del hotel pero no invalida la huella.
carrera C8 "update public.tarifa_hotel set temporada = temporada where hotel_id = 9301 and temporada = 'BAJA'" "$PROP" ''
carrera C9 "$COMO_OPER select public.grupos_dias_borrar('00000000-0000-4000-8000-0000000c0001', (select public.grupos_dias_config(930101)->>'huella'))" "$PROP" CONFIG_DESACTUALIZADA

echo "--- invariantes"
INV="$($SQL -d "$DB" -At -c "select (select count(*) from public.hotel_temporada_grupos where activo) + (select count(*) from public.tarifa_hotel where grupo_id is not null)")"
[ "$INV" = 0 ] && ok "ningún grupo activo ni tarifa por grupo tras las carreras" || fallo "invariantes violadas ($INV)"
echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
