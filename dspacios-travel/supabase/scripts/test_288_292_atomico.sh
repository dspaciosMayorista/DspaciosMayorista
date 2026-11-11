#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBA del procedimiento de despliegue 288 + 292 (#75). SOLO Docker local; nunca remoto.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_288_292_atomico.sh <contenedor> <plantilla_hasta_287>
#   <plantilla_hasta_287>: base con el estado de PRODUCCIÓN antes de la 288 (… 283, 284, 285, 287). Solo se lee: cada caso usa una base NUEVA clonada.
# Casos:
#   W1 aplicación POR SEPARADO (288, COMMIT; luego 292): en el intervalo una sesión crea una prevista y borra su servicio → queda huérfana y la 292
#      se niega a aplicarse. Demuestra que «en la misma sesión» no protege.
#   W2 aplicación ATÓMICA (aplicar_288_292_atomico.sql) con una pausa de prueba ANTES del COMMIT: una sesión concurrente que registra el financiero de
#      un pendiente y borra el servicio, en los dos órdenes, nunca ve la 288 sin la 292: queda bloqueada hasta el COMMIT y luego rige la regla completa.
#   W3 fallo inyectado en la parte de la 292 → no queda NADA de la 288 (ni tabla de previstas, ni funciones, ni columnas).
#   W4 el archivo atómico corresponde EXACTAMENTE a las migraciones del repo (regenerado = versionado) y el esquema resultante tiene las mismas
#      definiciones que aplicar 288 y luego 292 (huella de funciones, triggers, columnas e índices).
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_288_292_atomico.sh <contenedor> <plantilla_hasta_287>}"; TPL="${2:?falta la plantilla}"
export MSYS_NO_PATHCONV=1
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIGS="$AQUI/../migrations"; ATOM="$AQUI/aplicar_288_292_atomico.sql"
PG() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1 "$@" 2>&1; }
S() { local db="$1"; shift; docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$db" "$@" 2>&1; }
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
expect() { if printf '%s' "$2" | tr '\n' ' ' | grep -Eq "$3"; then ok "$1"; else bad "$1" "esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-300)"; fi; }
nueva() { PG -d postgres -c "drop database if exists $1" -c "create database $1 template $TPL" >/dev/null; }
borrar() { PG -d postgres -c "drop database if exists $1" >/dev/null; }
# siembra <db>: proveedor, un tour del catálogo (9201) y un contrato PENDIENTE (DTM-92001) sin financiero registrado
siembra() { S "$1" -c "insert into public.proveedores (id, nombre) values (92900,'Prov W') on conflict do nothing;
  insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values (9201,'Tour W',92900,40000,'tour_traslado','COP','persona','paquete','tour'), (9202,'Tour W2',92900,40000,'tour_traslado','COP','persona','paquete','tour');
  insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,tipo_paquete,financiero_estado) values ('DTM-92001','mayorista','C','pendiente','A',1000000,'porcion','pendiente'), ('DTM-92002','mayorista','C','pendiente','A',1000000,'porcion','pendiente');" >/dev/null; }
REG() { echo "select public.registrar_financiero_contrato('$1','mayorista','{\"costo_receptivo\":80000}'::jsonb,'[{\"tipo_proveedor\":\"receptivo\",\"proveedor\":\"Prov W\",\"servicio\":\"Tour\",\"servicio_id\":$2,\"valor_total\":80000,\"moneda\":\"COP\"}]'::jsonb);"; }
huerfanas() { S "$1" -c "select count(*) from public.contrato_obligaciones_previstas p where p.materializada_en is null and nullif(p.payload->>'servicio_id','') is not null and not exists (select 1 from public.servicios_adicionales s where s.id = (p.payload->>'servicio_id')::bigint)"; }

echo "=== W4a) el archivo atómico versionado == regenerado desde las migraciones del repo"
TMP="$(mktemp)"; sh "$AQUI/generar_aplicar_288_292_atomico.sh" "$TMP" >/dev/null
expect "aplicar_288_292_atomico.sql está al día (byte a byte)" "$(cmp -s "$TMP" "$ATOM" && echo IGUAL || echo DISTINTO)" '^IGUAL$'
expect "un único BEGIN y un único COMMIT en el archivo" "$(grep -ciE '^[[:space:]]*begin;' "$ATOM")|$(grep -ciE '^[[:space:]]*commit;' "$ATOM")" '^1\|1$'
rm -f "$TMP"

echo "=== W1) POR SEPARADO: el intervalo entre el COMMIT de la 288 y la 292 deja crear una prevista huérfana"
DB=tw1_sep; nueva $DB; siembra $DB
S $DB < "$MIGS/20260601000288_obligaciones_al_confirmar.sql" >/dev/null
R1=$(S $DB -c "$(REG DTM-92001 9201)")
D1=$(S $DB -c "delete from public.servicios_adicionales where id=9201")
expect "en el intervalo: la prevista nace (pendiente sin CxP) y el servicio SE BORRA (nada lo protege todavía)" "$(S $DB -c "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='DTM-92001'")|$(S $DB -c "select count(*) from public.servicios_adicionales where id=9201")|$(huerfanas $DB)" '^1\|0\|1$'
expect "la 292 aplicada después se NIEGA (prevista huérfana) y no cambia nada" "$(S $DB < "$MIGS/20260601000292_servicio_obligaciones_previstas.sql")|$(S $DB -c "select count(*) from pg_trigger where tgname='servicio_con_previstas'")" 'ABORTADA SIN MODIFICAR NADA.*\|0$'
borrar $DB

echo "=== W2) ATÓMICA con pausa de prueba de 5 s antes del COMMIT: sesiones concurrentes"
DB=tw2_atom; nueva $DB; siembra $DB
PAUSADO="$(mktemp)"; PAUSA_PRUEBA=5 sh "$AQUI/generar_aplicar_288_292_atomico.sh" "$PAUSADO" >/dev/null
( S $DB < "$PAUSADO" > /tmp/tw2_a.log ) &
sleep 2
# B1: registra el financiero (se volvería prevista) y luego intenta borrar el servicio · B2: borra primero el otro servicio y luego registra sobre él
T0=$(date +%s)
( { REG DTM-92001 9201; echo "delete from public.servicios_adicionales where id=9201;"; } | S $DB > /tmp/tw2_b1.log ) &
( { echo "delete from public.servicios_adicionales where id=9202;"; REG DTM-92002 9202; } | S $DB > /tmp/tw2_b2.log ) &
wait; T1=$(date +%s)
expect "la transacción atómica terminó sin error" "$(grep -c 'ERROR' /tmp/tw2_a.log)" '^0$'
expect "las sesiones concurrentes quedaron EN ESPERA hasta el COMMIT (≥ 2 s)" "$((T1-T0))" '^([2-9]|[1-9][0-9]+)$'
# B1 empezó ANTES del COMMIT: corre entera con las definiciones previas a la 288 (un solo mundo, nunca 288 sin 292): CxP real, sin prevista; el borrado del
# servicio aplica el ON DELETE SET NULL de siempre sobre esa CxP (sin línea enlazada), igual que en producción hoy.
expect "B1 (empezó antes del COMMIT): CxP real como antes de la 288, ninguna prevista; la CxP conserva su valor y queda sin servicio (SET NULL de siempre)" "$(S $DB -c "select count(*)||'/'||coalesce(max(valor_total)::bigint,0)||'/'||coalesce(max(servicio_id)::text,'null') from public.cuentas_por_pagar where numero_contrato='DTM-92001'")|$(S $DB -c "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='DTM-92001'")" '^1/80000/null\|0$'
# B3 empieza DESPUÉS del COMMIT: rigen 288 y 292 juntas
S $DB -c "insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa, liquidacion, tipo_receptivo) values (9203,'Tour W3',92900,40000,'tour_traslado','COP','persona','paquete','tour');
  insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,tipo_paquete,financiero_estado) values ('DTM-92003','mayorista','C','pendiente','A',1000000,'porcion','pendiente')" >/dev/null
B3=$( { REG DTM-92003 9203; echo "delete from public.servicios_adicionales where id=9203;"; } | S $DB)
expect "B3 (después del COMMIT): prevista sin CxP (288) y borrado del servicio RECHAZADO (292)" "$B3|$(S $DB -c "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='DTM-92003'")|$(S $DB -c "select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-92003'")|$(S $DB -c "select count(*) from public.servicios_adicionales where id=9203")" 'obligaciones previstas.*no se puede eliminar.*\|1\|0\|1$'
expect "B2: borró su servicio libre y el registro posterior sobre él FALLÓ sin dejar prevista" "$(cat /tmp/tw2_b2.log)|$(S $DB -c "select count(*) from public.contrato_obligaciones_previstas where numero_contrato='DTM-92002'")|$(S $DB -c "select count(*) from public.servicios_adicionales where id=9202")" 'ERROR.*\|0\|0$'
expect "ninguna prevista huérfana en toda la base" "$(huerfanas $DB)" '^0$'
POST="$(S $DB -F'|' < "$AQUI/postcheck_292_servicio_obligaciones_previstas.sql" | tail -1)"; expect "postcheck_292 CORRECTA" "$POST" 'CORRECTA'
POST288="$(S $DB -F'|' < "$AQUI/postcheck_288_obligaciones_al_confirmar.sql" | grep -cE '\|(FALLA|REVISAR)$')"; expect "postcheck_288 sin FALLA" "$POST288" '^0$'
rm -f "$PAUSADO" /tmp/tw2_*.log; borrar $DB

echo "=== W3) ATÓMICA con fallo inyectado en la parte de la 292: no queda nada de la 288"
DB=tw3_falla; nueva $DB; siembra $DB
S $DB -c "comment on function public.tg_linea_enlazada_protegida() is 'x'; create or replace function public.tg_linea_enlazada_protegida() returns trigger language plpgsql security definer set search_path = public, pg_temp as \$f\$ begin return coalesce(new, old); end \$f\$;" >/dev/null
R3=$(S $DB < "$ATOM")
expect "la transacción falla en la comprobación de la 292" "$R3" '292 ABORTADA SIN MODIFICAR NADA.*no es la de la 265'
expect "nada de la 288 quedó aplicado (tabla de previstas, columna obligaciones_materializadas_en, esquema p75_priv)" "$(S $DB -c "select coalesce(to_regclass('public.contrato_obligaciones_previstas')::text,'-')||'|'||(select count(*) from information_schema.columns where table_name='ventas' and column_name='obligaciones_materializadas_en')||'|'||(select count(*) from pg_namespace where nspname='p75_priv')")" '^-\|0\|0$'
expect "y el contrato sigue registrando su financiero como antes (CxP real, sin previstas)" "$(S $DB -c "$(REG DTM-92001 9201)" >/dev/null; S $DB -c "select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-92001'")" '^1$'
borrar $DB

echo "=== W4b) el esquema resultante es el mismo por la vía atómica que aplicando 288 y luego 292"
huella() { S "$1" -c "select md5(string_agg(x, E'\n' order by x)) from (
  select 'f:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')='||md5(replace(p.prosrc, chr(13), ''))||'/'||p.prosecdef||'/'||coalesce(array_to_string(p.proconfig, ','), '')||'/'||coalesce(array_to_string(p.proacl::text[], ','), '') x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','p75_priv')
  union all select 't:'||c.relname||'.'||t.tgname||'='||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal
  union all select 'c:'||table_name||'.'||column_name||'='||data_type from information_schema.columns where table_schema = 'public'
  union all select 'i:'||indexname||'='||indexdef from pg_indexes where schemaname = 'public') q"; }
A=tw4_atom; B=tw4_sep; nueva $A; nueva $B
S $A < "$ATOM" >/dev/null; S $B < "$MIGS/20260601000288_obligaciones_al_confirmar.sql" >/dev/null; S $B < "$MIGS/20260601000292_servicio_obligaciones_previstas.sql" >/dev/null
expect "misma huella de funciones (cuerpo, SECURITY DEFINER, search_path, permisos), triggers, columnas e índices" "$(huella $A)|$(huella $B)" '^([0-9a-f]{32})\|\1$'
borrar $A; borrar $B

echo; echo "RESULTADO 288+292 atómico: $PASS pasan, $FAIL fallan"
[ "$FAIL" -eq 0 ]
