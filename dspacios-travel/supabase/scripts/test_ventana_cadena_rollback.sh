#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBA de la recuperación de la ventana de mantenimiento (#75+#97). SOLO Docker local; nunca remoto.
# Ida:    aplicar_288_292_atomico → 286 → 289 → 290 → 291 (con preflights/postchecks) · un contrato de VALIDACIÓN (pendiente con previstas) que luego se elimina (289)
# Vuelta: rollback 291 → 290 → 289 → 286 → 292 → 288   y comparar la huella del esquema (funciones, triggers, columnas, índices, políticas) y los conteos con la foto inicial.
# Mide la duración de cada paso (base local con datos de prueba; en producción escala con el volumen de ventas/CxP).
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_ventana_cadena_rollback.sh <contenedor> <plantilla_hasta_287> <dspacios-travel del árbol con 286/290 de #97>
# ──────────────────────────────────────────────────────────────────
CT="${1:?contenedor}"; TPL="${2:?plantilla hasta 287}"; I97="${3:?árbol con las migraciones de #97}"
export MSYS_NO_PATHCONV=1
AQUI="$(cd "$(dirname "$0")" && pwd)"; M75="$AQUI/../migrations"; M97="$I97/supabase/migrations"; S97="$I97/supabase/scripts"
DB=tcadena_rb
PG() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -F'|' -v ON_ERROR_STOP=1 "$@" 2>&1; }
PASS=0; FAIL=0; ok() { PASS=$((PASS+1)); echo "PASS  $1"; }; bad() { FAIL=$((FAIL+1)); echo "FALLO $1 -> $2"; }
expect() { if printf '%s' "$2" | tr '\n' ' ' | grep -Eq "$3"; then ok "$1"; else bad "$1" "$(printf '%s' "$2" | tr '\n' ' ' | cut -c1-300)"; fi; }
ms() { echo $(( $(date +%s%N) / 1000000 )); }
paso() { local etiqueta="$1" f="$2" t0 t1 out; t0=$(ms); out="$(PG -d $DB < "$f")"; local st=$?; t1=$(ms); printf '  %-48s %6d ms\n' "$etiqueta" $((t1-t0)); [ $st -eq 0 ] || { bad "$etiqueta" "$(printf '%s' "$out" | grep -m2 -E 'ERROR|FATAL')"; return 1; }; }
veredicto() { PG -d $DB < "$1" | grep -i "VEREDICTO" | tail -1; }
lista() { PG -d $DB -c "select x from (
  select 'f:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')='||md5(replace(p.prosrc, chr(13), ''))||'/'||p.prosecdef||'/'||coalesce(array_to_string(p.proconfig, ','), '')||'/'||coalesce(array_to_string(p.proacl::text[], ','), '') x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%'
  union all select 't:'||c.relname||'.'||t.tgname||'='||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal
  union all select 'c:'||table_schema||'.'||table_name||'.'||column_name||'='||data_type||'/'||coalesce(column_default,'') from information_schema.columns where table_schema in ('public','storage')
  union all select 'i:'||schemaname||'.'||indexname||'='||indexdef from pg_indexes where schemaname in ('public','storage')
  union all select 'p:'||schemaname||'.'||tablename||'.'||policyname||'='||coalesce(qual,'')||'/'||coalesce(with_check,'')||'/'||array_to_string(roles, ',') from pg_policies
  union all select 'n:'||nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema') q order by x"; }
huella() { lista | md5sum | cut -c1-32; }
conteos() { PG -d $DB -c "select (select count(*) from public.ventas)||'/'||(select count(*) from public.cuentas_por_pagar)||'/'||(select count(*) from public.contrato_servicios)||'/'||(select count(*) from public.aliados_b2b)||'/'||(select count(*) from public.abonos)"; }

PG -d postgres -c "drop database if exists $DB" -c "create database $DB template $TPL" >/dev/null
L0="$(mktemp)"; lista > "$L0"; H0=$(huella); C0=$(conteos); echo "foto inicial: huella $H0 · ventas/cxp/líneas/aliados_b2b/abonos = $C0"
echo "== IDA (con tiempos)"
T0=$(ms)
expect "preflight_288 sin REVISAR" "$(PG -d $DB < "$AQUI/preflight_288_obligaciones_al_confirmar.sql" | grep -cE '\|(REVISAR|NO APLICAR|BLOQUEA)$')" '^0$'
paso "aplicar_288_292_atomico.sql" "$AQUI/aplicar_288_292_atomico.sql" || exit 1
expect "postcheck_292 CORRECTA" "$(veredicto "$AQUI/postcheck_292_servicio_obligaciones_previstas.sql")" 'CORRECTA'
expect "preflight_286 sin bloqueo" "$(PG -d $DB < "$S97/preflight_286_cotizacion_comision_acuerdo.sql" | tail -1)" 'APLICAR|OK|CORRECT'
paso "286 (#97)" "$M97/20260601000286_cotizacion_comision_acuerdo.sql" || exit 1
expect "postcheck_286" "$(veredicto "$S97/postcheck_286_cotizacion_comision_acuerdo.sql")" 'CORRECTA|OK'
paso "289" "$M75/20260601000289_elegibilidad_dtm_ampliada.sql" || exit 1
expect "postcheck_289 sin FALLA (no trae fila de veredicto)" "$(PG -d $DB < "$AQUI/postcheck_289_elegibilidad_dtm_ampliada.sql" | grep -cE "\|(FALLA|REVISAR)$")" "^0$"
paso "290 (#97)" "$M97/20260601000290_comision_manual_pendiente_y_duplicado.sql" || exit 1
expect "postcheck_290" "$(veredicto "$S97/postcheck_290_comision_manual.sql")" 'CORRECTA|OK'
paso "291" "$M75/20260601000291_reemision_neto_pendiente.sql" || exit 1
expect "postcheck_291" "$(veredicto "$AQUI/postcheck_291_reemision_neto.sql")" 'CORRECTA|OK'
echo "  IDA total: $(( $(ms) - T0 )) ms"
H1=$(huella); expect "el esquema cambió tras la ida (sanidad de la huella)" "$([ "$H1" != "$H0" ] && echo distinto)" "^distinto$"

echo "== contrato de VALIDACIÓN (pendiente con previstas) y su eliminación autorizada (289)"
PG -d $DB -c "insert into public.proveedores (id, nombre) values (92950,'Prov V') on conflict do nothing;
  insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,tipo_paquete,financiero_estado) values ('DTM-92950','mayorista','Validación','pendiente','A',1000000,'porcion','pendiente');" >/dev/null
PG -d $DB -c "select public.registrar_financiero_contrato('DTM-92950','mayorista','{\"costo_hotel\":500000}'::jsonb,'[{\"tipo_proveedor\":\"hotel\",\"proveedor\":\"Prov V\",\"servicio\":\"Hotel\",\"valor_total\":500000}]'::jsonb)" >/dev/null
expect "validación: pendiente con 1 prevista y 0 CxP" "$(PG -d $DB -c "select (select count(*) from public.contrato_obligaciones_previstas where numero_contrato='DTM-92950')||'|'||(select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-92950')")" '^1\|0$'
PG -d $DB -c "select public.eliminar_contrato('DTM-92950', false)" >/dev/null
PG -d $DB -c "delete from public.proveedores where id = 92950" >/dev/null
expect "validación eliminada sin restos (venta, previstas)" "$(PG -d $DB -c "select (select count(*) from public.ventas where numero_contrato='DTM-92950')||'|'||(select count(*) from public.contrato_obligaciones_previstas)")" '^0\|0$'
# 2.º contrato de validación CONFIRMADO (CxP materializadas) por un superadmin de prueba con sesión (confirmar_venta es INVOKER con la RLS de quien llama)
SU=aaaaaaaa-9295-4000-8000-000000000001; SID=5e550000-9295-4000-8000-000000000001
PG -d $DB -c "insert into auth.users (id, email) values ('$SU','su-validacion@x.test') on conflict do nothing;
  insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('$SU','su-validacion@x.test','SU Validación','superadmin',true,'mayorista') on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
  insert into auth.sessions (id, user_id) values ('$SID','$SU') on conflict do nothing;
  insert into public.sesion_agencia (session_id, user_id, tenant) values ('$SID','$SU','mayorista') on conflict do nothing;
  insert into public.proveedores (id, nombre) values (92951,'Prov V2') on conflict do nothing;
  insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,tipo_paquete,financiero_estado) values ('DTM-92951','mayorista','Validación 2','pendiente','A',1000000,'porcion','pendiente');" >/dev/null
PG -d $DB -c "select public.registrar_financiero_contrato('DTM-92951','mayorista','{\"costo_hotel\":500000}'::jsonb,'[{\"tipo_proveedor\":\"hotel\",\"proveedor\":\"Prov V2\",\"servicio\":\"Hotel\",\"valor_total\":500000}]'::jsonb)" >/dev/null
CONF=$( { echo "select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\",\"session_id\":\"$SID\"}',false), set_config('request.jwt.claim.sub','$SU',false);"; echo "set role authenticated; select public.confirmar_venta('DTM-92951'); reset role;"; } | docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -d $DB 2>&1)
echo "  confirmar_venta → $(printf "%s" "$CONF" | tr "
" " " | cut -c1-200)"
expect "validación 2 confirmada: 1 CxP materializada, 0 previstas pendientes" "$(PG -d $DB -c "select estado||'|'||(select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-92951')||'|'||(select count(*) from public.contrato_obligaciones_previstas where numero_contrato='DTM-92951' and materializada_en is null) from public.ventas where numero_contrato='DTM-92951'")" '^confirmado\|1\|0$'
PG -d $DB -c "select public.eliminar_contrato('DTM-92951', false)" >/dev/null
PG -d $DB -c "delete from public.proveedores where id = 92951; delete from public.sesion_agencia where session_id = '$SID'; delete from auth.sessions where id = '$SID'; delete from public.usuarios where id = '$SU'; delete from auth.users where id = '$SU';" >/dev/null
expect "validación 2 eliminada sin restos (venta, CxP, previstas, aliados_b2b)" "$(PG -d $DB -c "select (select count(*) from public.ventas where numero_contrato='DTM-92951')||'|'||(select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-92951')||'|'||(select count(*) from public.contrato_obligaciones_previstas)||'|'||(select count(*) from public.aliados_b2b where numero_contrato='DTM-92951')")" '^0\|0\|0\|0$'

echo "== VUELTA (rollback en orden inverso, con tiempos)"
T0=$(ms)
paso "rollback 291" "$AQUI/rollback_291_reemision_neto.sql" || exit 1
paso "rollback 290 (#97)" "$S97/rollback_290_comision_manual.sql" || exit 1
paso "rollback 289" "$AQUI/rollback_289_elegibilidad_dtm_ampliada.sql" || exit 1
paso "rollback 286 (#97)" "$S97/rollback_286_cotizacion_comision_acuerdo.sql" || exit 1
paso "rollback 292" "$AQUI/rollback_292_servicio_obligaciones_previstas.sql" || exit 1
paso "rollback 288" "$AQUI/rollback_288_obligaciones_al_confirmar.sql" || exit 1
echo "  VUELTA total: $(( $(ms) - T0 )) ms"
H2=$(huella); C2=$(conteos)
L2="$(mktemp)"; lista > "$L2"; DIF="$(diff "$L0" "$L2" | grep -E '^[<>]' | sort | tr '\n' ';')"; rm -f "$L0" "$L2"
[ -n "$DIF" ] && echo "  diferencias de esquema tras el rollback: $DIF" | cut -c1-400
# rollback_288 CONSERVA a propósito dos columnas nullable sin uso (regla del proyecto: no se borran columnas). Es la ÚNICA diferencia admitida.
expect "tras el rollback el esquema == foto inicial salvo las 2 columnas que rollback_288 conserva a propósito" "$DIF" '^> c:public\.cuentas_por_pagar\.clave_prevista=text/;> c:public\.ventas\.obligaciones_materializadas_en=timestamp with time zone/;$'
expect "conteos de negocio == foto inicial" "$C2|$C0" '^([0-9/]+)\|\1$'
expect "preflight_288 vuelve a dar todo OK (se puede reintentar la ventana)" "$(PG -d $DB < "$AQUI/preflight_288_obligaciones_al_confirmar.sql" | grep -cE '\|(REVISAR|NO APLICAR|BLOQUEA)$')" '^0$'
PG -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "CADENA ida/vuelta: $PASS pasan, $FAIL fallan"
[ "$FAIL" -eq 0 ]
