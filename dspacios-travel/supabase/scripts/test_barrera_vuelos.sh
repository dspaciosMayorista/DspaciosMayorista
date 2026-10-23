#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA · barrera_vuelos_c_e_lectura.sql (señales observables de las
# barreras B→C y previa a E). SOLO contra una base LOCAL DESECHABLE dentro del
# contenedor Docker de Supabase local, con 194–197 aplicadas y SIN la 199 ni
# la 200 (hay que poder imitar al código viejo escribiendo directo).
#
# A diferencia de los .sql de prueba, aquí cada paso se CONFIRMA en su propia
# transacción: la firma que busca la barrera (escrituras de una misma
# operación con el mismo `creado_en`) solo existe con transacciones reales.
# Los datos llevan prefijo PB* y se borran al final, pase o falle (la
# auditoría de esas filas queda en la base desechable).
#
# Uso:  sh test_barrera_vuelos.sh <base_desechable> [contenedor]
# ───────────────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-supabase_db_sbqvrckukbjzhtzqpyzg}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  BARRERA="$(cat "$(dirname "$0")/barrera_vuelos_c_e_lectura.sql")"
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 -e BARRERA="$BARRERA" "$CT" sh -s -- "$DB" "$CT" < "$0"
fi

PSQL="psql -h 127.0.0.1 -U postgres -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
U='00000000-0000-0000-0000-0000000b0001'
COMO="select set_config('request.jwt.claims', '{\"sub\":\"$U\",\"role\":\"authenticated\"}', false); set role authenticated;"

limpiar() {
  $PSQL <<'SQL' >/dev/null || echo "AVISO: la limpieza de datos PB* falló; revísala a mano." >&2
begin;
set local app.correccion_historial = 'on';
delete from public.movimientos_silla where bloqueo_origen_id in (select id from public.bloqueos_vuelo where record like 'PB%')
   or bloqueo_destino_id in (select id from public.bloqueos_vuelo where record like 'PB%');
delete from public.operaciones_vuelo where actor_id = '00000000-0000-0000-0000-0000000b0001';
delete from public.sillas where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PB%');
delete from public.bloqueo_cambios where bloqueo_id in (select id from public.bloqueos_vuelo where record like 'PB%');
delete from public.bloqueos_vuelo where record like 'PB%';
delete from public.destinos where nombre = 'PB DESTINO';
delete from public.proveedores where nombre = 'PB PROVEEDOR';
delete from public.usuarios where id = '00000000-0000-0000-0000-0000000b0001';
delete from auth.users where id = '00000000-0000-0000-0000-0000000b0001';
commit;
SQL
}
trap limpiar EXIT

if [ "$($PSQL -c "select to_regprocedure('public._sillas_guarda_escritura()') is null and to_regprocedure('public._historial_vuelos_inmutable()') is null")" != t ]; then
  echo "Esta prueba necesita la base SIN la 199 ni la 200 (imita al código viejo)." >&2; exit 2
fi

# Fixture en UNA transacción (no debe dejar señales).
$PSQL <<SQL >/dev/null
begin;
insert into auth.users (id, email) values ('$U', 'pb@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'PB CV' where id = '$U';
insert into public.destinos (nombre) values ('PB DESTINO');
insert into public.proveedores (nombre) values ('PB PROVEEDOR');
insert into public.bloqueos_vuelo (record, cupos_total, modalidad_emision, fecha_ida, tarifa_neta, destino_id, proveedor_id)
  select r, c, 'serie', current_date + 30, 100000, (select id from public.destinos where nombre = 'PB DESTINO'), (select id from public.proveedores where nombre = 'PB PROVEEDOR')
    from (values ('PBY001', 4), ('PBX001', 2)) v(r, c);
insert into public.sillas (bloqueo_id, numero_silla, estado)
  select b.id, g, 'disponible' from public.bloqueos_vuelo b, generate_series(1, b.cupos_total) g where b.record like 'PB%';
commit;
SQL
sleep 1
DESDE="$($PSQL -c "select now()")"
Y="$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PBY001'")"
X="$($PSQL -c "select id from public.bloqueos_vuelo where record = 'PBX001'")"
barrera() { echo "$BARRERA" | sed "s|timestamptz '2026-10-01 00:00:00-05'|timestamptz '$DESDE'|" | $PSQL -F'|'; }
senal() { barrera | awk -F'|' -v o="$1" '$1 == o { print $4 }'; }

# ── 1. Flujos de la fase B (funciones): ninguna señal ──────────────────────
$PSQL -c "$COMO select public.crear_bloqueo('{\"record\":\"PBNUEVO\",\"modalidad_emision\":\"serie\"}'::jsonb, 2);" >/dev/null
$PSQL -c "$COMO select public.trasladar_cupos($Y, $X, 1, 'prueba barrera', gen_random_uuid());" >/dev/null
$PSQL -c "$COMO select public.retirar_cupo((select s.id from public.sillas s where s.bloqueo_id = $Y and s.estado = 'disponible' and s.numero_contrato is null and s.contrato_manual is null and s.pasajero_nombres is null order by s.numero_silla limit 1), 'prueba barrera', gen_random_uuid());" >/dev/null
$PSQL -c "$COMO select public.cambiar_estado_silla((select s.id from public.sillas s where s.bloqueo_id = $Y and s.estado = 'disponible' and s.numero_contrato is null and s.contrato_manual is null and s.pasajero_nombres is null order by s.numero_silla limit 1), 'no_vendida', 'prueba barrera', false);" >/dev/null
$PSQL -c "$COMO select public.eliminar_bloqueo((select id from public.bloqueos_vuelo where record = 'PBNUEVO'));" >/dev/null
$PSQL -c "$COMO update public.sillas set pasajero_nombres = 'MASIVO' where id = (select s.id from public.sillas s where s.bloqueo_id = $Y and s.estado = 'disponible' and s.numero_contrato is null and s.contrato_manual is null and s.pasajero_nombres is null order by s.numero_silla limit 1);" >/dev/null
$PSQL -c "$COMO update public.bloqueos_vuelo set notas = 'pb' where id = $Y;" >/dev/null
TOTAL="$(barrera | awk -F'|' '$1 == 98 { print $4 }')"
[ "$TOTAL" = 0 ] && ok "flujos de la fase B (crear, trasladar, retirar, estado, eliminar, datos, record): 0 señales" \
  || { fallo "flujos de la fase B dejaron $TOTAL señal(es)"; barrera; }

# ── 2. Código viejo, una petición por sentencia: cada firma aparece ────────
$PSQL -c "$COMO insert into public.bloqueos_vuelo (record, cupos_total, modalidad_emision) values ('PBVIEJO', 2, 'serie');" >/dev/null
$PSQL -c "$COMO insert into public.sillas (bloqueo_id, numero_silla, estado) select id, g, 'disponible' from public.bloqueos_vuelo, generate_series(1, 2) g where record = 'PBVIEJO';" >/dev/null
$PSQL -c "$COMO update public.bloqueos_vuelo set cupos_total = cupos_total + 1 where id = $X;" >/dev/null
$PSQL -c "$COMO update public.sillas set bloqueo_id = $X where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PBVIEJO') and numero_silla = 1;" >/dev/null
$PSQL -c "$COMO delete from public.sillas where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'PBVIEJO') and numero_silla = 2;" >/dev/null
$PSQL -c "$COMO insert into public.movimientos_silla (silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo) values ((select id from public.sillas where bloqueo_id = $Y and numero_silla = 1), $Y, $X, 'viejo');" >/dev/null
$PSQL -c "$COMO update public.movimientos_silla set motivo = 'viejo editado' where motivo = 'viejo';" >/dev/null
$PSQL -c "$COMO delete from public.movimientos_silla where motivo = 'viejo editado';" >/dev/null
for esperado in "11:2:sillas creadas fuera de crear_bloqueo" "12:1:sillas borradas fuera de eliminar_bloqueo" \
                "13:1:record creado sin sus sillas" "14:1:cupos_total sin historial" "15:1:silla cambiada de record sin historial" \
                "20:1:movimiento sin operación" "21:1:historial borrado" "22:1:historial editado"; do
  o="${esperado%%:*}"; resto="${esperado#*:}"; n="${resto%%:*}"; txt="${resto#*:}"
  v="$(senal "$o")"
  [ "$v" = "$n" ] && ok "código viejo → señal $o ($txt) = $n" || fallo "señal $o ($txt): esperaba $n, dio '$v'"
done
[ "$(barrera | awk -F'|' '$1 == 98 { print $5 }')" = "NO ACTIVAR C" ] && ok "resumen B→C: NO ACTIVAR C" || fallo "resumen B→C"
[ "$(barrera | awk -F'|' '$1 == 99 { print $5 }')" = "NO ACTIVAR E" ] && ok "resumen previo a E: NO ACTIVAR E" || fallo "resumen E"

if [ "$FALLOS" -eq 0 ]; then echo "BARRERA: TODO OK (datos de prueba borrados)"; else echo "BARRERA: $FALLOS FALLO(S)"; exit 1; fi
