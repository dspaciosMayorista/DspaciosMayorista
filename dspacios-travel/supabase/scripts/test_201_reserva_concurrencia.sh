#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# PRUEBA DE CONCURRENCIA · migración 201 — reserva frente a sillas precargadas.
# DOS SESIONES REALES. SOLO contra una base LOCAL DESECHABLE dentro de un
# contenedor Docker de Supabase local (nunca remota). Los datos de prueba se
# confirman (la otra sesión tiene que verlos): prefijo PQ* / DTM-77xx, y se
# borran al final, pase o falle.
#
# Uso:  sh test_201_reserva_concurrencia.sh <base_desechable> [contenedor]
#       (se niega a usar "postgres")
# Mismo mecanismo de orden que test_traslado_concurrencia.sh: una "puerta"
# (advisory lock) retiene a la 1.ª sesión con sus candados tomados y solo se
# abre cuando la base confirma que la 2.ª está esperando esos candados.
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

U='00000000-0000-0000-0000-0000000e2071'   # control_vuelo mayorista
OP='00000000-0000-0000-0000-0000000e2072'  # operaciones mayorista (actor de la reserva)

limpiar() {
  $PSQL <<'SQL' >/dev/null || echo "AVISO: la limpieza de datos PQ* falló; revísala a mano." >&2
begin;
set local app.eliminando_contrato = 'true';
do $$ begin
  if to_regclass('public.vuelos_firmas_antiguas_uso') is not null then
    delete from public.vuelos_firmas_antiguas_uso
     where actor_id in ('00000000-0000-0000-0000-0000000e2071', '00000000-0000-0000-0000-0000000e2072');
  end if;
end $$;
delete from public.contrato_pasajeros where numero_contrato like 'DTM-77%' and responsable_id is not null;
delete from public.contrato_pasajeros where numero_contrato like 'DTM-77%';
delete from public.sillas where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PQ%');
delete from public.ventas where numero_contrato like 'DTM-77%';
delete from public.bloqueo_cambios where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PQ%');
delete from public.bloqueos_vuelo where record like 'PQ%';
delete from public.destinos where nombre = 'PQ DESTINO';
delete from public.proveedores where nombre = 'PQ PROVEEDOR';
delete from public.usuarios where id in ('00000000-0000-0000-0000-0000000e2071', '00000000-0000-0000-0000-0000000e2072');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000e2071', '00000000-0000-0000-0000-0000000e2072');
commit;
SQL
  rm -rf "$TMP"
}
trap limpiar EXIT
limpiar; TMP="$(mktemp -d)"

# ── Fixtures confirmados ────────────────────────────────────────────────────
# PQA001: 4 sillas — #1 libre, #2 y #3 precargadas (sin contrato), #4 contrato ajeno.
# PQB001: 2 sillas libres (precarga contra reserva).
# PQC001: 1 silla libre (reserva primero, edición después).
# PQD001: 2 sillas libres (doble envío de la misma reserva).
$PSQL <<SQL >/dev/null
insert into auth.users (id, email) values ('$U', 'pq-1@local.test'), ('$OP', 'pq-2@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PQ Control' where id = '$U';
update public.usuarios set rol = 'operaciones', tenant = 'mayorista', activo = true, nombre = 'PQ Operaciones' where id = '$OP';
insert into public.destinos (nombre) values ('PQ DESTINO');
insert into public.proveedores (nombre) values ('PQ PROVEEDOR');
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total) values
  ('PQA001', (select id from public.destinos where nombre = 'PQ DESTINO'), (select id from public.proveedores where nombre = 'PQ PROVEEDOR'), current_date + 40, 300000, 4),
  ('PQB001', (select id from public.destinos where nombre = 'PQ DESTINO'), (select id from public.proveedores where nombre = 'PQ PROVEEDOR'), current_date + 40, 300000, 1),
  ('PQC001', (select id from public.destinos where nombre = 'PQ DESTINO'), (select id from public.proveedores where nombre = 'PQ PROVEEDOR'), current_date + 40, 300000, 1),
  ('PQD001', (select id from public.destinos where nombre = 'PQ DESTINO'), (select id from public.proveedores where nombre = 'PQ PROVEEDOR'), current_date + 40, 300000, 2);
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, b.cupos_total) g where b.record like 'PQ%';
update public.sillas set pasajero_nombres = 'PRECARGA DOS', numero_doc = '2'
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PQA001') and numero_silla = 2;
update public.sillas set tipo_doc = 'PA'
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PQA001') and numero_silla = 3;
insert into public.ventas (numero_contrato, cliente, tenant, bloqueo_ref_id) values
  ('DTM-7700', 'ajeno', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PQA001')),
  ('DTM-7701', 'pq a', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PQA001')),
  ('DTM-7702', 'pq b', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PQA001')),
  ('DTM-7703', 'pq c', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PQB001')),
  ('DTM-7704', 'pq d', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PQC001')),
  ('DTM-7705', 'pq e', 'mayorista', (select id from public.bloqueos_vuelo where record = 'PQD001'));
update public.sillas set numero_contrato = 'DTM-7700', estado = 'confirmada', pasajero_nombres = 'AJENO'
 where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PQA001') and numero_silla = 4;
SQL
A=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PQA001'")
B=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PQB001'")
C=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PQC001'")
D=$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PQD001'")
SB1=$($PSQL -c "select id from public.sillas where bloqueo_id = $B and numero_silla = 1")
SC1=$($PSQL -c "select id from public.sillas where bloqueo_id = $C and numero_silla = 1")
foto_a() { $PSQL -c "select md5(string_agg((to_jsonb(s) - 'updated_at')::text, '|' order by s.numero_silla)) from public.sillas s where s.bloqueo_id = $A and s.numero_silla in (2, 3, 4)"; }
FOTO_A0=$(foto_a)
pax() { echo "jsonb_build_array(jsonb_build_object('nombre', '$1', 'tipoId', 'CC', 'identificacion', '$2', 'fechaNacimiento', '1990-01-01'))"; }

PUERTA=420201
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
# rol: service (reserva/copia, como la app con service_role) o cv (control_vuelo con sesión).
prefijo() {
  if [ "$1" = service ]; then echo "set local role service_role;"
  else echo "set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '$U', 'role', 'authenticated')::text, true) is not null;"; fi
}
# sesion_retenida <rol> <sql> <archivo>: aplica y espera la puerta ANTES del commit.
sesion_retenida() {
  $PSQL >"$3" 2>&1 <<SQL || true
begin;
$(prefijo "$1")
select 'R:' || ($2)::text;
select pg_advisory_lock($PUERTA) is not null;
select pg_advisory_unlock($PUERTA);
commit;
SQL
}
sesion() {
  $PSQL >"$3" 2>&1 <<SQL || true
begin;
$(prefijo "$1")
select 'R:' || ($2)::text;
commit;
SQL
}
primera_en_puerta() {
  esperar "select count(*) from pg_locks where locktype = 'advisory' and objid = $PUERTA and not granted" \
    || fallo "la 1.ª sesión no llegó a la puerta (prueba no concluyente)"
}
segunda_bloqueada() {
  esperar "select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event <> 'advisory'" \
    || fallo "la 2.ª sesión no quedó esperando los candados de la 1.ª (prueba no concluyente)"
}
# La reserva como la hace la app (migración 201): reserva de sillas y copia del pasajero en UNA transacción.
reserva() { echo "(select count(*) from public.crear_pasajeros_contrato_con_sillas('$1', $(pax "$2" "$3"), 1, '$OP', jsonb_build_object('hotel', 'HQ'), jsonb_build_array(jsonb_build_object('pasajero_nombres', '$2'))))"; }

# ── 1. Dos reservas a la vez por la ÚNICA silla libre de PQA001 (#2/#3 precargadas) ──
cerrar_puerta
sesion_retenida service "$(reserva DTM-7701 'PQ UNO' 101)" "$TMP/a1" &
P1=$!
primera_en_puerta
sesion service "$(reserva DTM-7702 'PQ DOS' 102)" "$TMP/a2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:1' "$TMP/a1" && grep -q '0 disponibles, 1 requeridas' "$TMP/a2" \
  && ok "1. la 1.ª reserva gana; la 2.ª espera el candado y falla por cupo (las precargadas no cuentan)" \
  || { fallo "1. resultado de las dos reservas"; cat "$TMP/a1" "$TMP/a2"; }
[ "$($PSQL -c "select string_agg(numero_contrato || '#' || numero_silla, ',' order by numero_silla) from public.sillas where bloqueo_id = $A and numero_contrato like 'DTM-770_' and numero_contrato <> 'DTM-7700'")" = "DTM-7701#1" ] \
  && ok "1. solo DTM-7701 tiene silla, y es la #1 libre" || fallo "1. reparto de sillas en PQA001"
[ "$($PSQL -c "select count(*) from public.contrato_pasajeros where numero_contrato = 'DTM-7702'")" = 0 ] \
  && ok "1. la reserva perdedora no dejó pasajeros (sin cambios parciales)" || fallo "1. la perdedora dejó pasajeros"
[ "$(foto_a)" = "$FOTO_A0" ] && ok "1. precargadas #2/#3 y contrato ajeno #4 intactos" || fallo "1. se tocaron precargadas o el contrato ajeno"

# ── 2. Precarga primero, reserva después (PQB001: una sola silla, la precarga la retiene) ──
cerrar_puerta
sesion_retenida cv "public.editar_pasajero_silla($SB1, '{\"pasajero_nombres\":\"PRECARGA CONCURRENTE\",\"numero_doc\":\"77\",\"plazo\":\"2099-12-31\"}'::jsonb)" "$TMP/b1" &
P1=$!
primera_en_puerta
sesion service "$(reserva DTM-7703 'PQ TRES' 103)" "$TMP/b2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '0 disponibles, 1 requeridas' "$TMP/b2" \
  && ok "2. la reserva espera a la precarga y, al verla confirmada, ya no toma la silla" \
  || { fallo "2. la reserva no respetó la precarga concurrente"; cat "$TMP/b1" "$TMP/b2"; }
[ "$($PSQL -c "select coalesce(numero_contrato, '-') || '|' || pasajero_nombres from public.sillas where id = $SB1")" = "-|PRECARGA CONCURRENTE" ] \
  && ok "2. la silla conserva la precarga y sigue sin contrato" || fallo "2. la precarga se perdió o la silla tomó contrato"

# ── 3. Reserva primero; edición de la misma silla desde una pantalla que la veía libre ──
cerrar_puerta
sesion_retenida service "$(reserva DTM-7704 'PQ CUATRO' 104)" "$TMP/c1" &
P1=$!
primera_en_puerta
sesion cv "public.editar_pasajero_silla($SC1, '{\"pasajero_nombres\":\"PRECARGA TARDIA\",\"plazo\":\"2099-12-31\",\"esperado\":{\"numero_contrato\":null,\"contrato_manual\":null}}'::jsonb)" "$TMP/c2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:1' "$TMP/c1" && grep -q 'La silla cambió mientras la editabas: ahora es del contrato DTM-7704' "$TMP/c2" \
  && ok "3. la reserva gana; la edición, que esperó el candado, se rechaza con un mensaje claro" \
  || { fallo "3. reserva y edición concurrentes"; cat "$TMP/c1" "$TMP/c2"; }
[ "$($PSQL -c "select numero_contrato || '|' || pasajero_nombres from public.sillas where id = $SC1")" = "DTM-7704|PQ CUATRO" ] \
  && ok "3. la silla tiene el contrato con SUS datos (copiados en la misma transacción); nada de la edición" \
  || fallo "3. estado final de la silla: $($PSQL -c "select coalesce(numero_contrato, '-') || '|' || coalesce(pasajero_nombres, '-') from public.sillas where id = $SC1")"

# ── 4. Doble envío de la MISMA reserva (DTM-7705 en PQD001, 2 sillas libres) ──
cerrar_puerta
sesion_retenida service "$(reserva DTM-7705 'PQ CINCO' 105)" "$TMP/d1" &
P1=$!
primera_en_puerta
sesion service "$(reserva DTM-7705 'PQ CINCO BIS' 106)" "$TMP/d2" &
P2=$!
segunda_bloqueada
abrir_puerta
wait "$P1" "$P2"
grep -q '^R:1' "$TMP/d1" && ! grep -q '^R:' "$TMP/d2" \
  && ok "4. el 1.er envío se aplica; el 2.º espera y falla entero: $(grep -o 'ERROR:.*' "$TMP/d2" | head -1 | cut -c1-120)" \
  || { fallo "4. doble envío"; cat "$TMP/d1" "$TMP/d2"; }
[ "$($PSQL -c "select string_agg(numero_silla || ':' || pasajero_nombres, ',' order by numero_silla) from public.sillas where numero_contrato = 'DTM-7705'")" = "1:PQ CINCO" ] \
  && [ "$($PSQL -c "select string_agg(nombre, ',') from public.contrato_pasajeros where numero_contrato = 'DTM-7705'")" = "PQ CINCO" ] \
  && [ "$($PSQL -c "select count(*) from public.sillas where bloqueo_id = $D and public._silla_libre(sillas)")" = 1 ] \
  && ok "4. una sola silla tomada, con los datos del 1.er envío; la otra sigue libre" \
  || fallo "4. el doble envío dejó sillas o pasajeros de más, o pisó datos"
[ "$(foto_a)" = "$FOTO_A0" ] && ok "4. precargadas y contrato ajeno siguen intactos" || fallo "4. se tocaron precargadas o el contrato ajeno"

# ── Identidad ───────────────────────────────────────────────────────────────
DUP=$($PSQL -c "select count(*) from (select bloqueo_id, numero_silla from public.sillas where bloqueo_id in ($A, $B, $C, $D) group by 1, 2 having count(*) > 1) d")
TOT=$($PSQL -c "select count(*) from public.sillas where bloqueo_id in ($A, $B, $C, $D)")
[ "$DUP" = 0 ] && [ "$TOT" = 8 ] && ok "las 8 sillas siguen siendo las mismas, sin números repetidos" || fallo "identidad de sillas (dup=$DUP total=$TOT)"

echo
[ "$FALLOS" = 0 ] && echo "CONCURRENCIA 201: TODO OK (datos de prueba borrados)" || { echo "CONCURRENCIA 201: $FALLOS FALLO(S)"; exit 1; }
