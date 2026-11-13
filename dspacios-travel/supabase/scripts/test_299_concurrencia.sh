#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# CARRERAS con DOS SESIONES REALES contra la 299 (#43/#60 entrega 3c). Solo Postgres LOCAL desechable.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_299_concurrencia.sh <contenedor> <plantilla>
#   <plantilla>: con la 293 y sin la 295 (p. ej. local4360_base en pg4360).
# R1–R3, R5–R7: la sesión B toma la huella ANTES de que empiece A; A cambia algo y espera 3 s antes de
# confirmar; B confirma 1 s después con esa huella. Una tercera sesión comprueba que B quedó ESPERANDO un
# candado. Esperado: B rechazada con PT409 («recarga»), sin aplicar nada dos veces; R7 es el control (otra
# vigencia: B espera y pasa).
# R4 (empates, sin huella): dos cambios VÁLIDOS POR SEPARADO que JUNTOS crean un empate, confirmados a la vez
# en dos sesiones. Esperado: exactamente uno confirma; el otro se rechaza con EMPATE_PRIORIDAD.
# ─────────────────────────────────────────────────────────────────────────────
set -u
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; DB="t299c_$$"; FALLOS=0; TMP="$(mktemp -d)"
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
trap '$SQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
$SQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$SQL -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || exit 2
for f in supabase/scripts/fixture_293_vigencia_grupos_dias.sql supabase/migrations/20260601000295_grupos_dias_propuesta.sql \
         supabase/scripts/fixture_295_grupos_dias_propuesta.sql supabase/migrations/20260601000297_calculadora_grupos_dias.sql \
         supabase/scripts/fixture_297_calculadora_grupos_dias.sql supabase/migrations/20260601000299_grupos_dias_activacion.sql \
         supabase/scripts/fixture_299_grupos_dias_activacion.sql; do
  $SQL -d "$DB" < "$f" >/dev/null 2>&1 || { echo "No se pudo cargar $f"; exit 2; }
done
# Estado: propuesta de la Semana (solo doble, misma regla de edad que el Fin de semana); PUENTE con prioridad 2.
$SQL -d "$DB" >/dev/null <<'EOF'
insert into public.hotel_grupo_tarifa_propuesta (grupo_id, tipo_habitacion, alimentacion, neto_doble,
  edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
values ('00000000-0000-4000-8000-0000000c0001', 'Estándar', 'PAM', 95000, 0, 1, 2, 11);
update public.hotel_temporadas set prioridad = 2 where id = 930106;
EOF
COMO_OPER="select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-4000-8000-000000009302\",\"session_id\":\"00000000-0000-4000-8000-00000000a302\",\"role\":\"authenticated\"}', false), set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;"
huella() { $SQL -d "$DB" -At -c "select public._grupos_43_config(930101)->>'huella'"; }
HCFG="(select public.grupos_dias_config(930101)->>'huella')"

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
  case "$espera" in Lock/*|Lock*) : ;; *) fallo "$id: B no quedó esperando un candado ($espera)"; return ;; esac
  if [ -z "$esperado" ]; then [ -z "$rb" ] && ok "$id: B esperó ($espera) y pasó" || fallo "$id: B debía pasar y falló: $rb"
  else echo "$rb" | grep -Eqi "$esperado" && ok "$id: B esperó ($espera) y fue rechazada: ${rb%%.*}" || fallo "$id: B debía rechazarse; obtuvo: ${rb:-pasó sin error}"; fi
}
ACT="select public.grupos_dias_activar(930101, '__H__', '[]'::jsonb)"
n() { $SQL -d "$DB" -At -c "$1"; }

carrera R1 "update public.tarifa_hotel set neto_doble = neto_doble + 1 where hotel_id = 9301 and temporada = 'ALTA' and grupo_id is null" "$ACT" CONFIG_DESACTUALIZADA
carrera R2 "$COMO_OPER select public.grupos_dias_guardar_propuesta(930101, $HCFG, 'actualizar', null, '[{\"grupo_id\":\"00000000-0000-4000-8000-0000000c0001\",\"tipo_habitacion\":\"Estándar\",\"alimentacion\":\"PAM\",\"neto_doble\":96000}]'::jsonb)" "$ACT" CONFIG_DESACTUALIZADA
# R3: dos personas aplican a la vez con la misma revisión ⇒ se aplica UNA vez.
carrera R3 "$COMO_OPER select public.grupos_dias_activar(930101, $HCFG, '[]'::jsonb)" "$ACT" CONFIG_DESACTUALIZADA
[ "$(n "select count(*) from public.tarifa_hotel where hotel_id = 9301 and temporada = 'ALTA' and grupo_id is not null")" = 2 ] \
  && [ "$(n "select count(*) from public.tarifa_hotel_historial where hotel_id = 9301 and motivo = 'grupos_aplicar'")" = 2 ] \
  && ok "R3: aplicado una sola vez (2 tarifas por grupo; 2 filas «todos los días» en el historial)" || fallo "R3: aplicación duplicada o incompleta"

# R4: escritura sesgada de empates. OTRA (20–22 ene) con solo sencilla y prioridad 2: no compite.
#     A: OTRA pasa a prioridad 1 (sola: OTRA no vende doble ⇒ sin empate).
#     B: OTRA agrega precio de doble (sola: prioridad 2 ⇒ gana sin empate). Juntas: empate con ALTA en doble.
$SQL -d "$DB" >/dev/null <<'EOF'
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (930107, 9301, 'OTRA', '2027-01-20', '2027-01-22', 2, 'tarifa');
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla) values (9301, 'Estándar', 'PAM', 'OTRA', 70000);
EOF
printf 'begin;\nupdate public.hotel_temporadas set prioridad = 1 where id = 930107;\nselect pg_sleep(2);\ncommit;\n' | $SQL -d "$DB" >"$TMP/R4.a" 2>&1 &
pa=$!
printf 'begin;\nupdate public.tarifa_hotel set neto_doble = 71000 where hotel_id = 9301 and temporada = %s;\nselect pg_sleep(2);\ncommit;\n' "'OTRA'" | $SQL -d "$DB" >"$TMP/R4.b" 2>&1 &
pb=$!
wait $pa; wait $pb
ea="$(grep -c EMPATE_PRIORIDAD "$TMP/R4.a")"; eb="$(grep -c EMPATE_PRIORIDAD "$TMP/R4.b")"
CONF="$(n "select jsonb_array_length(public._grupos_43_empates(9301, null))")"
if [ $((ea + eb)) -eq 1 ] && [ "$CONF" = 0 ]; then ok "R4: de dos cambios que juntos empatan, confirmó uno y el otro se rechazó (A=$ea, B=$eb); sin empate guardado"
else fallo "R4: A=$ea B=$eb rechazos, empates guardados=$CONF ($(cat "$TMP/R4.a" "$TMP/R4.b" | grep ERROR | head -2))"; fi
$SQL -d "$DB" >/dev/null <<'EOF'
delete from public.tarifa_hotel where hotel_id = 9301 and temporada = 'OTRA';
delete from public.hotel_temporadas where id = 930107;
EOF

# R5: la calculadora por grupo cambia el borrador mientras otra persona descarta con la revisión vieja.
CALC="$COMO_OPER select public.grupos_dias_guardar_calculadora(930101, $HCFG, '00000000-0000-4000-8000-0000000c0002', 'dubai', (select version from public.hotel_calculadora where hotel_id = 9301), null, '[{\"categoria\":\"Estándar\",\"precio\":120000}]'::jsonb, '[{\"grupo_id\":\"00000000-0000-4000-8000-0000000c0002\",\"tipo_habitacion\":\"Estándar\",\"alimentacion\":\"PAM\",\"neto_doble\":135000}]'::jsonb)"
carrera R5 "$CALC" "select public.grupos_dias_descartar(930101, '__H__')" CONFIG_DESACTUALIZADA
# R6: se aplica el cambio mientras otra persona borra el grupo con la revisión vieja.
carrera R6 "$COMO_OPER select public.grupos_dias_activar(930101, $HCFG, '[]'::jsonb)" \
  "select public.grupos_dias_borrar_con_bases('00000000-0000-4000-8000-0000000c0002', '__H__', (select jsonb_agg(jsonb_build_object('tipo', tipo, 'version', version)) from public.hotel_calculadora_grupo_bases where grupo_id = '00000000-0000-4000-8000-0000000c0002'))" CONFIG_DESACTUALIZADA
R6V="$(n "select coalesce(string_agg(neto_doble::text, ','), 'ninguna') from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0002'")"
[ "$(n "select coalesce(bool_and(neto_doble = 135000) and count(*) = 1, false) from public.tarifa_hotel where grupo_id = '00000000-0000-4000-8000-0000000c0002'")" = t ] \
  && ok "R6: el grupo sigue y vende lo aplicado (135.000)" || fallo "R6: estado inesperado del Fin de semana (doble: $R6V)"
# R7 (control): cambio en OTRA vigencia del hotel: B espera el candado del hotel, la huella no cambia, pasa.
carrera R7 "update public.tarifa_hotel set temporada = temporada where hotel_id = 9301 and temporada = 'BAJA'" \
  "select public.grupos_dias_guardar_propuesta(930101, '__H__', 'actualizar', null, '[{\"grupo_id\":\"00000000-0000-4000-8000-0000000c0001\",\"tipo_habitacion\":\"Estándar\",\"alimentacion\":\"PAM\",\"neto_doble\":99000}]'::jsonb)" ''

echo "--- invariantes"
MEZCLA="$(n "select count(*) from public.hotel_temporadas t where exists (select 1 from public.tarifa_hotel a where a.hotel_id = t.hotel_id and a.temporada = t.nombre and a.grupo_id is null) and exists (select 1 from public.tarifa_hotel b where b.hotel_id = t.hotel_id and b.temporada = t.nombre and b.grupo_id is not null)")"
[ "$MEZCLA" = 0 ] && ok "ninguna vigencia mezcla tarifas «todos los días» y por grupo" || fallo "vigencias con mezcla: $MEZCLA"
INACT="$(n "select count(*) from public.tarifa_hotel t join public.hotel_temporada_grupos g on g.id = t.grupo_id where not g.activo")"
[ "$INACT" = 0 ] && ok "ninguna tarifa a la venta apunta a un grupo inactivo" || fallo "tarifas con grupo inactivo: $INACT"
EMP="$(n "select count(*) from (select distinct hotel_id from public.hotel_temporadas) h where jsonb_array_length(public._grupos_43_empates(h.hotel_id, null)) > 0")"
[ "$EMP" = 0 ] && ok "ningún hotel quedó con empates" || fallo "hoteles con empate: $EMP"
echo "=== $FALLOS fallo(s)"
[ "$FALLOS" -eq 0 ]
