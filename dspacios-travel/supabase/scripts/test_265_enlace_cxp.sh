#!/bin/sh
# 265: enlace CxP <-> línea de servicio por CLAVE ESTABLE. (1) ACTUALIZACIÓN desde un estado con la 264 y datos legados (sin clave): la 265 deja todo intacto y no infiere enlaces;
# (2) pruebas SQL + PostgREST/HTTP (pruebas/enlace265.pg.mjs); (3) ciclo rollback 265 -> reaplicar con datos. SOLO Docker local y desechable.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_265_enlace_cxp.sh <base_nueva> [contenedor_pg] [plantilla]    (base: ^t262f_[a-z0-9_]{1,30}$)
set -eu
PREFIJO=t262f; DB="${1:-}"; CT="${2:-pg255local}"; PLANTILLA="${3:-plantilla255}"
PG262_HASTA=264; export PG262_HASTA   # el entorno se detiene en la 264: la 265 se aplica aquí, sobre datos
. "$(dirname "$0")/entorno_262_local.sh"
cd "$APP"
F=0; fallo() { echo "  FALLA $1"; F=$((F+1)); }; okk() { echo "  OK    $1"; }
Q() { $PS -d "$DB" -c "$1"; }
recargar() { docker kill -s SIGUSR1 "$REST" >/dev/null; sleep 3; }   # PostgREST recarga su caché de esquema (nuevas funciones)

echo "== A. actualización desde la 264 con datos legados =="
Q "insert into public.proveedores (id, nombre) values (26599,'Legado') on conflict do nothing; insert into public.servicios_adicionales (id, nombre, proveedor_id, precio_persona, categoria, moneda, tipo_tarifa) values (26599,'Traslado legado',26599,0,'tour_traslado','COP','persona') on conflict do nothing;
 insert into public.ventas (numero_contrato, cliente, tenant) values ('DTM-9501','L1','mayorista'),('DTM-9502','L2','mayorista'),('DTM-9503','L3','mayorista');
 insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo, servicio_id, alcance_traslado) values ('DTM-9501','traslado','Legado · llegada',10,26599,'llegada'),('DTM-9501','traslado','Legado · llegada',20,26599,'llegada'),('DTM-9502','traslado','Legado · salida',30,26599,'salida'),('DTM-9503','otro','Manual',5,null,null);" >/dev/null
# CxP escritas bajo la 264 (el trigger por descripción enlaza la primera de DTM-9501; la segunda idéntica queda sin enlace; DTM-9502 no coincide)
Q "insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id, valor_total) values ('DTM-9501','mayorista','P','receptivo','Legado · llegada',26599,10),('DTM-9501','mayorista','P','receptivo','Legado · llegada',26599,20),('DTM-9502','mayorista','P','receptivo','Otro texto',26599,30),('DTM-9503','mayorista','P','otro','Manual',null,5)" >/dev/null
FOTO="select md5(coalesce((select string_agg(id||':'||numero_contrato||':'||coalesce(servicio_id::text,'-')||':'||coalesce(alcance_traslado,'-')||':'||descripcion||':'||costo, '|' order by id) from public.contrato_servicios),'')) || '/' || md5(coalesce((select string_agg(id||':'||numero_contrato||':'||coalesce(contrato_servicio_id::text,'-')||':'||coalesce(alcance_traslado,'-')||':'||valor_total||':'||coalesce(observaciones,'-'), '|' order by id) from public.cuentas_por_pagar),''))"
ENLACES_ANTES="$(Q "select count(*) from public.cuentas_por_pagar where contrato_servicio_id is not null")"; FOTO_ANTES="$(Q "$FOTO")"
echo "  estado 264: $(Q "select count(*) from public.contrato_servicios") líneas, $(Q "select count(*) from public.cuentas_por_pagar") CxP, $ENLACES_ANTES enlazada(s) por la 264"
aplicar265 > /tmp/f265.$TOKEN.out 2>&1 && okk "265 aplicada sobre la 264 con datos (preflight, migración, postcheck con huellas de las RPC financieras)" || { cat /tmp/f265.$TOKEN.out; fallo "la 265 falló sobre datos"; }
cat /tmp/f265.$TOKEN.out
[ "$(Q "select count(*) from public.cuentas_por_pagar where contrato_servicio_id is not null")" = "$ENLACES_ANTES" ] && okk "no se creó ningún enlace nuevo por inferencia (siguen $ENLACES_ANTES)" || fallo "cambió el número de enlaces"
[ "$(Q "select count(*) from public.contrato_servicios where clave_enlace is not null")" = "0" ] && okk "ninguna línea legada recibió clave" || fallo "líneas con clave inesperada"
[ "$(Q "$FOTO")" = "$FOTO_ANTES" ] && okk "líneas y CxP idénticas byte a byte (huella md5) tras la 265" || fallo "la 265 alteró datos"
Q "update public.contrato_servicios set costo = costo where id in (select id from public.contrato_servicios)" >/dev/null 2>&1 && okk "(informativo) las líneas legadas siguen editables" || fallo "legadas no editables"
recargar

echo "== A2. reaplicar 262 a 265 en bloque (idempotente: ni datos ni definiciones cambian) =="
FOTO2="$(Q "$FOTO")"; DEF_ANTES="$(Q "select md5(string_agg(replace(pg_get_functiondef(p.oid), chr(13), ''), '' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'tg_cxp_enlace%' or p.proname in ('corregir_enlace_cxp_alcance','tg_linea_enlazada_protegida','tg_ventas_completo_exige_enlaces','tg_servicio_precio_alcance_solape','tg_servicio_suplementos_franja_solape','registrar_financiero_contrato','p63_registrar_financiero'))")"
for m in 262_servicio_tipo_alcance_rangos_suplemento 263_reemplazar_precios_alcance 265_enlace_cxp_clave_estable; do $PS -d "$DB" < "$MIGS/20260601000$m.sql" >/dev/null 2>/tmp/f265.$TOKEN.err && okk "reaplicada la ${m%%_*}" || { cat /tmp/f265.$TOKEN.err; fallo "reaplicar la ${m%%_*}"; }; done
[ "$(Q "$FOTO")" = "$FOTO2" ] && okk "datos idénticos tras reaplicar 262/263/265" || fallo "la reaplicación cambió datos"
[ "$(Q "select md5(string_agg(replace(pg_get_functiondef(p.oid), chr(13), ''), '' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'tg_cxp_enlace%' or p.proname in ('corregir_enlace_cxp_alcance','tg_linea_enlazada_protegida','tg_ventas_completo_exige_enlaces','tg_servicio_precio_alcance_solape','tg_servicio_suplementos_franja_solape','registrar_financiero_contrato','p63_registrar_financiero'))")" = "$DEF_ANTES" ] && okk "definiciones de funciones idénticas (md5) tras reaplicar" || fallo "cambiaron definiciones"
verif265 && okk "verificación 265 tras reaplicar en bloque" || fallo "verificación tras reaplicar"
MALAS="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
POSTMALO="$(sed "s#PEGAR_HUELLAS_ANTES#$MALAS#" "$APP/supabase/scripts/postcheck_265_enlace_cxp_clave.sql" | $PS -d "$DB" -F '|')"
echo "$POSTMALO" | grep -aq "^9[|].*[|]FALLA$" && echo "$POSTMALO" | grep -aq "^99[|].*[|]FALLA$" && okk "control negativo: con unas huellas de referencia distintas el postcheck 265 da FALLA (fila 9 y veredicto global)" || fallo "el postcheck no detecta unas RPC financieras distintas"
echo "== B. pruebas SQL + HTTP de la 265 =="
PG262_BASE="$DB" PG262_CONTENEDOR="$CT" PG262_POSTGREST="$REST_URL" PG262_JWT_SECRET="$SECRETO" node pruebas/enlace265.pg.mjs || F=$((F+1))

echo "== C. ciclo rollback 265 -> reaplicar (con datos) =="
CXP_N="$(Q "select count(*) from public.cuentas_por_pagar")"; CS_N="$(Q "select count(*) from public.contrato_servicios")"; ENL_N="$(Q "select count(*) from public.cuentas_por_pagar where contrato_servicio_id is not null")"
$PS -d "$DB" < "$APP/supabase/scripts/rollback_265_enlace_cxp_clave_estable.sql" >/dev/null 2>/tmp/f265.$TOKEN.err && okk "rollback 265 aplicado con datos" || { cat /tmp/f265.$TOKEN.err; fallo "rollback 265"; }
[ "$(Q "select (select count(*) from pg_trigger where tgname in ('cxp_enlace_por_clave','cxp_enlace_inmutable','linea_enlazada_protegida','ventas_completo_exige_enlaces'))||'/'||(select count(*) from information_schema.columns where table_schema='public' and column_name='clave_enlace')||'/'||(select count(*) from pg_proc where proname in ('corregir_enlace_cxp_alcance','tg_cxp_enlace_por_clave','tg_cxp_enlace_inmutable','tg_linea_enlazada_protegida','tg_ventas_completo_exige_enlaces'))")" = "0/0/0" ] && okk "rollback retiró triggers, funciones y clave_enlace" || fallo "el rollback dejó objetos"
[ "$(Q "select count(*) from public.cuentas_por_pagar")/$(Q "select count(*) from public.contrato_servicios")/$(Q "select count(*) from public.cuentas_por_pagar where contrato_servicio_id is not null")" = "$CXP_N/$CS_N/$ENL_N" ] && okk "el rollback conservó $CXP_N CxP, $CS_N líneas y $ENL_N vínculos" || fallo "el rollback cambió filas o vínculos"
$PS -d "$DB" < "$APP/supabase/scripts/rollback_265_enlace_cxp_clave_estable.sql" >/dev/null 2>&1 && okk "rollback idempotente" || fallo "rollback no idempotente"
for pasada in 1 2; do $PS -d "$DB" < "$MIGS/20260601000265_enlace_cxp_clave_estable.sql" >/dev/null 2>/tmp/f265.$TOKEN.err && okk "reaplicación $pasada de la 265" || { cat /tmp/f265.$TOKEN.err; fallo "reaplicar 265 (pasada $pasada)"; }; done
verif265 && okk "verificación 265 tras reaplicar" || fallo "verificación tras reaplicar"
aplicar265 > /tmp/f265.$TOKEN.out 2>&1 && okk "preflight (YA APLICADA) + migración + postcheck 265 tras el ciclo" || { cat /tmp/f265.$TOKEN.out; fallo "postcheck tras el ciclo"; }
grep -aE "^99[|]" /tmp/f265.$TOKEN.out
[ "$(Q "select count(*) from public.cuentas_por_pagar")/$(Q "select count(*) from public.contrato_servicios")/$(Q "select count(*) from public.cuentas_por_pagar where contrato_servicio_id is not null")" = "$CXP_N/$CS_N/$ENL_N" ] && okk "reaplicar no tocó datos" || fallo "reaplicar cambió datos"
CL="$(Q "select gen_random_uuid()")"
Q "insert into public.ventas (numero_contrato, cliente, tenant) values ('DTM-9598','S','mayorista'); insert into public.contrato_servicios (numero_contrato, tipo, descripcion, costo, servicio_id, alcance_traslado, clave_enlace) values ('DTM-9598','traslado','S · llegada',1,26599,'llegada','$CL'); insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id, valor_total, observaciones) values ('DTM-9598','mayorista','P','receptivo','S · llegada',26599,1,'Generado · enlace:$CL')" >/dev/null 2>&1 && [ "$(Q "select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-9598' and contrato_servicio_id is not null and alcance_traslado='llegada'")" = "1" ] && okk "tras reaplicar el enlace por clave vuelve a funcionar" || fallo "enlace por clave tras reaplicar"
rm -f /tmp/f265.$TOKEN.err
printf '\nRESULTADO test_265 (fases A y C): %s fallas (la fase B imprime su propio RESULTADO y suma 1 si falla)\n' "$F"
[ "$F" -eq 0 ]
