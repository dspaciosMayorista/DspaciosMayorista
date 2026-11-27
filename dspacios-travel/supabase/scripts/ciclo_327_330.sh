#!/bin/sh
# #103 — migration LIFECYCLE (327 → 328 → 329 → 330) on a DISPOSABLE copy of a template: preflight → apply 327 → 328 → 329 → 330 → postcheck → re-apply (idempotent) → populate → guarded rollbacks (refuse with data, accept with confirmation, refuse wrong order)
# → compare the SCHEMA SIGNATURE (supabase/scripts/firma_esquema_103.sql) before / after / re-applied. NEVER against a real database.
# Uso (desde dspacios-travel/):  sh supabase/scripts/ciclo_327_330.sh <contenedor_pg> <plantilla>      Ej.: sh supabase/scripts/ciclo_327_330.sh pg127 plantilla127
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
DB="cyc103b_$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
M=supabase/migrations; S=supabase/scripts
limpiar() { $PS -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap limpiar EXIT
FALLAS=0
ok() { echo "OK    $1"; }
mal() { echo "FALLA $1"; FALLAS=$((FALLAS + 1)); }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
run() { $PS -d "$DB" < "$1" >/dev/null; }
firma() { $PS -d "$DB" < $S/firma_esquema_103.sql; }
control() {   # a pre/postcheck prints one row per control: every state must be OK
  salida=$($PS -d "$DB" < "$1"); malos=$(printf '%s\n' "$salida" | grep -c '|FALLA' || true)
  [ "$malos" = 0 ] && ok "$1 (todos los controles OK)" || { printf '%s\n' "$salida" | grep '|FALLA'; mal "$1: $malos control(es) en FALLA"; }
}
rechaza() { desc="$1"; shift; if "$@" >/dev/null 2>&1; then mal "$desc: se ejecutó y debía ser rechazado"; else ok "$desc: rechazado"; fi; }

S0=$(firma)
control $S/preflight_327_conjuntos_fechas.sql
run $M/20260601000327_conjuntos_fechas.sql; control $S/postcheck_327_conjuntos_fechas.sql
control $S/preflight_328_solicitudes_proveedor.sql
run $M/20260601000328_solicitudes_proveedor.sql; control $S/postcheck_328_solicitudes_proveedor.sql
control $S/preflight_329_pago_proveedor_soportes.sql
run $M/20260601000329_pago_proveedor_soportes.sql; control $S/postcheck_329_pago_proveedor_soportes.sql
control $S/preflight_330_hostinger_entrada_estado.sql
run $M/20260601000330_hostinger_entrada_estado.sql; control $S/postcheck_330_hostinger_entrada_estado.sql
S1=$(firma)
[ "$S0" != "$S1" ] && ok "aplicar 327+328+329+330 cambia el esquema" || mal "aplicar no cambió nada"
# idempotent re-application
run $M/20260601000327_conjuntos_fechas.sql; run $M/20260601000328_solicitudes_proveedor.sql; run $M/20260601000329_pago_proveedor_soportes.sql; run $M/20260601000330_hostinger_entrada_estado.sql
[ "$(firma)" = "$S1" ] && ok "re-aplicar 327/328/329/330 es idempotente (misma firma de esquema)" || { mal "re-aplicar cambió el esquema"; }

# populate: contract + request + code + evidence + notice↔payment link + date set
$PS -d "$DB" >/dev/null <<'SQL'
begin;
insert into public.ventas (numero_contrato, cliente, tenant) values ('DTM-9101', 'Cliente Ciclo', 'mayorista');
commit;
insert into public.destinos (nombre) values ('DESTINO CICLO');
insert into public.hoteles (destino_id, nombre) select id, 'Hotel Ciclo' from public.destinos where nombre = 'DESTINO CICLO';
insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin) select id, 'Promo Ciclo', '2027-03-01', '2027-03-31' from public.hoteles where nombre = 'Hotel Ciclo';
insert into public.hotel_codigos_promocion (hotel_id, vigencia_id, codigo) select h.id, t.id, 'CICLO-1' from public.hoteles h join public.hotel_temporadas t on t.hotel_id = h.id where h.nombre = 'Hotel Ciclo';
insert into public.solicitudes_proveedor (numero_contrato, contrato_uid, destinatarios, asunto, token_respuesta, clave_envio) values ('DTM-9101', (select contrato_uid from public.ventas where numero_contrato = 'DTM-9101'), array['p@x.test'], 'a', repeat('c', 32), 'ciclo-1');
insert into public.solicitudes_proveedor (tipo, tenant, proveedor, destinatarios, asunto, token_respuesta, clave_envio) values ('pago', 'mayorista', 'Prov Ciclo', array['p@x.test'], 'b', repeat('d', 32), 'ciclo-2');
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tenant, valor_total) values ('DTM-9101', 'Prov Ciclo', 'mayorista', 100);
insert into public.cxp_pagos (cuenta_por_pagar_id, valor, tenant) select id, 50, 'mayorista' from public.cuentas_por_pagar where proveedor = 'Prov Ciclo';
insert into public.cxp_pago_soportes (cxp_pago_id, tenant, nombre, path, content_type, size_bytes, sha256) select id, 'mayorista', 'c.pdf', 'mayorista/prov/c.pdf', 'application/pdf', 10, repeat('a', 64) from public.cxp_pagos where tenant = 'mayorista' order by id desc limit 1;
insert into public.solicitud_proveedor_pagos (solicitud_id, cxp_pago_id) select (select s.id from public.solicitudes_proveedor s where s.clave_envio = 'ciclo-2') as solicitud, p.id from public.cxp_pagos p order by p.id desc limit 1;
insert into public.hostinger_estado_buzon (buzon_id, uid_cubierto) values ('AC1ciclo0000test', 10);
insert into public.hostinger_respuestas_pendientes (buzon_id, uid, dedupe) values ('AC1ciclo0000test', 7, 'hostinger:AC1ciclo0000test:<m7@x>');
SQL
ok "datos de prueba cargados (solicitud, aviso de pago, código, soporte, vínculo)"

# guarded rollbacks (330 first: nothing depends on it)
rechaza "rollback 330 con respuestas pendientes y SIN confirmar" $PS -d "$DB" -f - < $S/rollback_330_hostinger_entrada_estado.sql
[ "$(firma)" = "$S1" ] && ok "el rollback 330 rechazado no cambió nada" || mal "el rollback 330 rechazado alteró el esquema"
{ echo "select set_config('app.confirmar_perdida_330', 'si', false);"; cat $S/rollback_330_hostinger_entrada_estado.sql; } | $PS -d "$DB" >/dev/null && ok "rollback 330 con confirmación" || mal "rollback 330 confirmado falló"
S1P=$(firma)   # schema after the (legitimate) 330 rollback: the refused 328/329 rollbacks below must not change THIS
rechaza "rollback 328 con la 329 aplicada (orden equivocado)" $PS -d "$DB" -f - < $S/rollback_328_solicitudes_proveedor.sql
rechaza "rollback 329 con datos y SIN confirmar" $PS -d "$DB" -f - < $S/rollback_329_pago_proveedor_soportes.sql
[ "$(firma)" = "$S1P" ] && ok "los rollbacks rechazados no cambiaron nada" || mal "un rollback rechazado alteró el esquema"
{ echo "select set_config('app.confirmar_perdida_329', 'si', false);"; cat $S/rollback_329_pago_proveedor_soportes.sql; } | $PS -d "$DB" >/dev/null && ok "rollback 329 con confirmación" || mal "rollback 329 confirmado falló"
rechaza "rollback 328 con datos y SIN confirmar" $PS -d "$DB" -f - < $S/rollback_328_solicitudes_proveedor.sql
{ echo "select set_config('app.confirmar_perdida_328', 'si', false);"; cat $S/rollback_328_solicitudes_proveedor.sql; } | $PS -d "$DB" >/dev/null && ok "rollback 328 con confirmación" || mal "rollback 328 confirmado falló"
run $S/rollback_327_conjuntos_fechas.sql && ok "rollback 327"
S2=$(firma)
if [ "$S2" = "$S0" ]; then ok "tras revertir 330→329→328→327 la firma de esquema es IDÉNTICA a la inicial (incluye guardas de identidad y objetos nuevos)"; else mal "el esquema revertido difiere del inicial"; printf '%s\n--- vs ---\n%s\n' "$S0" "$S2"; fi
# the identity installer must still succeed after the rollback (no orphan classification) and again after re-applying
$PS -d "$DB" -c "select public.contrato_instalar_guardas()" >/dev/null && ok "instalador de guardas de identidad OK tras el rollback" || mal "instalador de guardas falló tras el rollback"
run $M/20260601000327_conjuntos_fechas.sql; run $M/20260601000328_solicitudes_proveedor.sql; run $M/20260601000329_pago_proveedor_soportes.sql; run $M/20260601000330_hostinger_entrada_estado.sql
[ "$(firma)" = "$S1" ] && ok "re-aplicar tras el rollback reproduce la firma de esquema" || mal "re-aplicación tras rollback difiere"
control $S/postcheck_328_solicitudes_proveedor.sql; control $S/postcheck_329_pago_proveedor_soportes.sql; control $S/postcheck_330_hostinger_entrada_estado.sql
if [ "$FALLAS" = 0 ]; then echo "CICLO COMPLETO: 0 fallas"; else echo "CICLO: $FALLAS falla(s)"; exit 1; fi
