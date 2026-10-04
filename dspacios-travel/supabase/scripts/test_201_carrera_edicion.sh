#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# REPRODUCCIÓN · migración 201 — carrera editar_pasajero_silla / reserva /
# copia de pasajeros / reversión. DOS SESIONES REALES, SOLO base LOCAL
# DESECHABLE dentro de un contenedor Docker (nunca remota). Datos con prefijo
# PE* / DTM-78xx, confirmados y borrados al final.
#
# Uso:  sh test_201_carrera_edicion.sh <base_desechable> [contenedor]
#
# Orden exacto que perdía datos con el borrador anterior de la 201:
#   1. A (app, service_role) reserva la única silla libre S y se retiene
#      antes del commit.
#   2. B (control_vuelo) edita S desde la pantalla, que la mostraba LIBRE;
#      espera el candado de A.
#   3. A confirma; B continúa sobre una silla que ya es del contrato.
#   4. La app copia los datos del pasajero de A; si la copia falla, revierte
#      el contrato (revertir_contrato_incompleto).
# Exigencia: o la edición de B se CONSERVA, o se RECHAZA con un mensaje
# claro; nunca "B guardó bien" y luego desaparece. Sin borrar datos ajenos ni
# dejar un contrato a medias.
# El script detecta la versión: con `crear_pasajeros_contrato_con_sillas`
# (201 corregida) la copia va dentro de la misma transacción de la reserva;
# sin ella reproduce el flujo del borrador anterior (reserva, copia aparte y
# reversión si la copia falla).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-supabase_db_sbqvrckukbjzhtzqpyzg}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" sh -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U postgres -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

U='00000000-0000-0000-0000-0000000e2081'   # control_vuelo mayorista (B)
OP='00000000-0000-0000-0000-0000000e2082'  # operaciones mayorista (actor de la reserva A)

limpiar() {
  $PSQL <<'SQL' >/dev/null || echo "AVISO: la limpieza de datos PE* falló; revísala a mano." >&2
begin;
set local app.eliminando_contrato = 'true';
delete from public.contrato_pasajeros where numero_contrato like 'DTM-78%' and responsable_id is not null;
delete from public.contrato_pasajeros where numero_contrato like 'DTM-78%';
delete from public.sillas where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PE%');
delete from public.ventas where numero_contrato like 'DTM-78%';
delete from public.bloqueo_cambios where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PE%');
delete from public.bloqueos_vuelo where record like 'PE%';
delete from public.destinos where nombre = 'PE DESTINO';
delete from public.proveedores where nombre = 'PE PROVEEDOR';
delete from public.usuarios where id in ('00000000-0000-0000-0000-0000000e2081', '00000000-0000-0000-0000-0000000e2082');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000e2081', '00000000-0000-0000-0000-0000000e2082');
commit;
SQL
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar; TMP="$(mktemp -d)"

# PEA001: #1 libre (la de la carrera), #2 precargada ajena, #3 contrato ajeno.
$PSQL <<SQL >/dev/null
insert into auth.users (id, email) values ('$U', 'pe-1@local.test'), ('$OP', 'pe-2@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PE Control' where id = '$U';
update public.usuarios set rol = 'operaciones', tenant = 'mayorista', activo = true, nombre = 'PE Operaciones' where id = '$OP';
insert into public.destinos (nombre) values ('PE DESTINO');
insert into public.proveedores (nombre) values ('PE PROVEEDOR');
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total) values
  ('PEA001', (select id from public.destinos where nombre = 'PE DESTINO'), (select id from public.proveedores where nombre = 'PE PROVEEDOR'), current_date + 40, 300000, 3);
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, 3) g where b.record = 'PEA001';
update public.sillas set pasajero_nombres = 'PRECARGA AJENA'
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PEA001') and numero_silla = 2;
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id) values
  ('DTM-7800', 'ajeno', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PEA001')),
  ('DTM-7801', 'reserva a', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PEA001'));
update public.sillas set numero_contrato = 'DTM-7800', estado = 'confirmada', pasajero_nombres = 'AJENO'
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PEA001') and numero_silla = 3;
SQL
A=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PEA001'")
S=$($PSQL -c "select id from public.sillas where bloqueo_id = $A and numero_silla = 1")
foto_ajenas() { $PSQL -c "select md5(string_agg((to_jsonb(s) - 'updated_at')::text, '|' order by s.numero_silla)) from public.sillas s where s.bloqueo_id = $A and s.numero_silla in (2, 3)"; }
AJENAS0=$(foto_ajenas)
CORREGIDA=$($PSQL -c "select to_regprocedure('public.crear_pasajeros_contrato_con_sillas(text,jsonb,integer,uuid,jsonb,jsonb)') is not null")
echo "Versión de la 201 en la base: $([ "$CORREGIDA" = t ] && echo 'corregida (copia en la misma transacción)' || echo 'borrador anterior (copia aparte)')"

PUERTA=420281
esperar() {
  for _ in $(seq 1 1200); do
    [ "$($PSQL -c "$1")" -ge 1 ] && return 0
    sleep 0.05
  done
  return 1
}
cerrar_puerta() {
  rm -f "$TMP/puerta"; mkfifo "$TMP/puerta"
  $PSQL < "$TMP/puerta" >/dev/null 2>&1 &
  PUERTA_PID=$!
  exec 3>"$TMP/puerta"
  echo "select pg_advisory_lock($PUERTA);" >&3
  esperar "select count(*) from pg_locks where locktype = 'advisory' and objid = $PUERTA and granted" \
    || fallo "no se pudo cerrar la puerta (prueba no concluyente)"
}
abrir_puerta() {
  echo "select pg_advisory_unlock($PUERTA);" >&3
  exec 3>&-
  wait "$PUERTA_PID" 2>/dev/null || true
}
PAX="jsonb_build_array(jsonb_build_object('nombre', 'RESERVA A', 'tipoId', 'CC', 'identificacion', '701', 'fechaNacimiento', '1990-01-01'))"
DATOS='[{"pasajero_nombres":"RESERVA","pasajero_apellidos":"A","tipo_doc":"CC","numero_doc":"701","nacimiento":"1990-01-01"}]'
COMUN='{"asesor":"ASESOR A","hotel":"HOTEL A","acomodacion":"DOBLE"}'
if [ "$CORREGIDA" = t ]; then
  RESERVA="(select count(*) from public.crear_pasajeros_contrato_con_sillas('DTM-7801', $PAX, 1, '$OP', '$COMUN'::jsonb, '$DATOS'::jsonb))"
else
  RESERVA="(select count(*) from public.crear_pasajeros_contrato('DTM-7801', $PAX, 1, '$OP'))"
fi
# B edita desde la pantalla, que mostraba la silla SIN contrato.
EDICION="public.editar_pasajero_silla($S, '{\"pasajero_nombres\":\"EDICION B\",\"numero_doc\":\"999\",\"plazo\":\"2099-12-31\",\"esperado\":{\"numero_contrato\":null,\"contrato_manual\":null}}'::jsonb)"

# ── 1-3. A reserva y se retiene; B edita y espera; A confirma ───────────────
cerrar_puerta
$PSQL >"$TMP/a" 2>&1 <<SQL || true &
begin;
set local role service_role;
select 'R:' || ($RESERVA)::text;
select pg_advisory_lock($PUERTA) is not null;
select pg_advisory_unlock($PUERTA);
commit;
SQL
P1=$!
esperar "select count(*) from pg_locks where locktype = 'advisory' and objid = $PUERTA and not granted" \
  || fallo "A no llegó a la puerta (prueba no concluyente)"
$PSQL >"$TMP/b" 2>&1 <<SQL || true &
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '$U', 'role', 'authenticated')::text, true) is not null;
select 'R:' || ($EDICION)::text;
commit;
SQL
P2=$!
esperar "select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event <> 'advisory'" \
  || fallo "B no quedó esperando el candado de A (prueba no concluyente)"
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:1' "$TMP/a" || { fallo "la reserva A no se creó"; cat "$TMP/a"; }
if grep -q '^R:' "$TMP/b"; then B_OK=1; echo "INFO  B: la base respondió OK a la edición"; else B_OK=0; echo "INFO  B: la base rechazó la edición → $(grep -o 'ERROR:.*' "$TMP/b" | head -1)"; fi

# ── 4. Lo que hace la app después del RPC de la reserva ─────────────────────
if [ "$CORREGIDA" != t ]; then
  $PSQL >"$TMP/c" 2>&1 <<SQL || true
begin; set local role service_role;
select 'R:' || public.copiar_datos_sillas_contrato('DTM-7801', $A, '$COMUN'::jsonb, '$DATOS'::jsonb)::text;
commit;
SQL
  if grep -q '^R:' "$TMP/c"; then echo "INFO  copia aparte: OK"
  else
    echo "INFO  copia aparte falló → la app revierte el contrato: $(grep -o 'ERROR:.*' "$TMP/c" | head -1)"
    $PSQL -c "set role service_role; select public.revertir_contrato_incompleto('DTM-7801', 'mayorista');" >/dev/null
  fi
fi

# ── 5. Resultado ────────────────────────────────────────────────────────────
FIN=$($PSQL -c "select coalesce(numero_contrato, '-') || '|' || coalesce(pasajero_nombres, '-') || '|' || coalesce(numero_doc, '-') from public.sillas where id = $S")
VENTA=$($PSQL -c "select count(*) from public.ventas where numero_contrato = 'DTM-7801'")
PAXN=$($PSQL -c "select count(*) from public.contrato_pasajeros where numero_contrato = 'DTM-7801'")
SILLAS_A=$($PSQL -c "select count(*) from public.sillas where numero_contrato = 'DTM-7801'")
echo "INFO  silla S al final: $FIN · contrato DTM-7801: venta=$VENTA pasajeros=$PAXN sillas=$SILLAS_A"

if [ "$B_OK" = 1 ]; then
  case "$FIN" in
    *"|EDICION B|999") ok "la edición de B, aceptada, se conserva en la silla" ;;
    *) fallo "B recibió OK pero su edición ya no está en la silla (dato perdido): $FIN" ;;
  esac
else
  grep -q 'cambió' "$TMP/b" && ok "la edición de B se rechazó con un mensaje claro" || { fallo "B falló sin un mensaje claro"; cat "$TMP/b"; }
  case "$FIN" in
    *EDICION*) fallo "B fue rechazada pero su dato quedó en la silla" ;;
    *) ok "nada de B quedó escrito tras el rechazo" ;;
  esac
fi
# Contrato: completo (venta + pasajero + silla con SUS datos) o inexistente del todo.
if [ "$VENTA" = 1 ] && [ "$PAXN" = 1 ] && [ "$SILLAS_A" = 1 ] && [ "$FIN" = "DTM-7801|RESERVA|701" ]; then
  ok "el contrato quedó completo: venta, pasajero y silla con los datos de la reserva"
elif [ "$VENTA" = 0 ] && [ "$PAXN" = 0 ] && [ "$SILLAS_A" = 0 ]; then
  ok "el contrato no quedó: ni venta, ni pasajeros, ni sillas"
else
  fallo "contrato a medias (venta=$VENTA pasajeros=$PAXN sillas=$SILLAS_A, silla=$FIN)"
fi
[ "$(foto_ajenas)" = "$AJENAS0" ] && ok "la precarga ajena (#2) y el contrato ajeno (#3) siguen intactos" || fallo "se tocaron datos ajenos"

echo
[ "$FALLOS" = 0 ] && echo "CARRERA EDICIÓN/RESERVA: TODO OK (datos de prueba borrados)" || { echo "CARRERA EDICIÓN/RESERVA: $FALLOS FALLO(S)"; exit 1; }
