-- PREFLIGHT de la migración 284 (identidad del contrato y guardas, #75 entrega 1). SOLO LECTURA. UNA consulta integral.
-- Pegar completa en el editor SQL de Supabase ANTES de aplicar la 284. Columnas: control · valor · esperado · estado.
-- estado: OK = cumple · REVISAR = detener y revisar antes de aplicar · INFO = dato para decidir/recordar.
with
conocidas(t) as (values
  ('ventas'),('sillas'),('movimientos_silla'),('cotizaciones'),('avisos'),('cxp_pagos'),('retenciones_cxp'),('comision_b2b_pagos'),('comision_b2b_revision'),('factura_items'),('_pasajeros_exentos_167'),
  ('abono_operaciones'),('abonos'),('abonos_anulados'),('aliados_b2b'),('conciliacion_sistema'),('contrato_adjuntos'),('contrato_alojamiento_bernalo'),('contrato_condiciones'),
  ('contrato_facturacion'),('contrato_financiero_pendiente'),('contrato_hoteles'),('contrato_items'),('contrato_pasajeros'),('contrato_programa_estancia'),
  ('contrato_programa_estancia_costo'),('contrato_servicios'),('contrato_soportes_pago'),('contrato_vuelo_control'),('contrato_vuelo_control_cambios'),('contrato_vuelos'),
  ('cuentas_por_pagar'),('cuotas'),('factura_revision_fuera_libros'),('facturacion'),('liquidacion_comisiones'),('liquidacion_descuentos'),('p63_aceptacion'),
  ('persona_capturas'),('rentabilidad'),('restriccion_overrides'),('vouchers')),
esc as (   -- tablas de contrato = columna numero_contrato / contrato_numero, FK hacia ventas, o ventas misma
  select distinct c.relname::text as tabla
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind in ('r','p') and (c.relname = 'ventas'
         or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero'))
         or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass)))
select * from (
  select 1 as o, 'La 281 (#86) está aplicada' as control,
         (to_regclass('public.contrato_soportes_pago') is not null and to_regclass('public.avisos') is not null)::text as valor, 'true' as esperado,
         case when to_regclass('public.contrato_soportes_pago') is not null and to_regclass('public.avisos') is not null then 'OK' else 'REVISAR' end as estado
  union all select 2, 'La 284 NO está aplicada (columnas, tabla de configuración y triggers ausentes)',
         (exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name in ('contrato_uid','nacio_de_reuso'))
           or to_regclass('public.contrato_guardas_config') is not null
           or exists (select 1 from pg_trigger where tgname in ('trg_contrato_guarda','trg_ventas_identidad_inmutable')))::text, 'false',
         case when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name in ('contrato_uid','nacio_de_reuso'))
               and to_regclass('public.contrato_guardas_config') is null
               and not exists (select 1 from pg_trigger where tgname in ('trg_contrato_guarda','trg_ventas_identidad_inmutable')) then 'OK' else 'REVISAR' end
  union all select 3, 'Tablas de contrato SIN clasificar en la 284 (si aparece alguna, la migración aborta nombrándola; clasifícala primero)',
         coalesce((select string_agg(tabla, ', ' order by tabla) from esc where tabla not in (select t from conocidas)), '(ninguna)'), '(ninguna)',
         case when not exists (select 1 from esc where tabla not in (select t from conocidas)) then 'OK' else 'REVISAR' end
  union all select 4, 'Funciones de las que depende la guarda existen (_resolver_contrato_manual, puede_ver_contrato, mi_rol, fn_renumerar_contrato)',
         (select count(distinct p.proname)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
           where p.proname in ('_resolver_contrato_manual','puede_ver_contrato','mi_rol','fn_renumerar_contrato')), '4',
         case when (select count(distinct p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
                     where p.proname in ('_resolver_contrato_manual','puede_ver_contrato','mi_rol','fn_renumerar_contrato')) = 4 then 'OK' else 'REVISAR' end
  union all select 5, 'fn_renumerar_contrato copia la fila de ventas por columnas dinámicas (así el contrato_uid se conserva al renumerar)',
         coalesce((select (p.prosrc like '%information_schema.columns%' and p.prosrc like '%insert into public.ventas select%')::text from pg_proc p where p.proname = 'fn_renumerar_contrato' limit 1), 'NO EXISTE'), 'true',
         case when (select p.prosrc like '%information_schema.columns%' and p.prosrc like '%insert into public.ventas select%' from pg_proc p where p.proname = 'fn_renumerar_contrato' limit 1) then 'OK' else 'REVISAR' end
  union all select 6, 'No hay transacciones abiertas inactivas en esta base (ALTER TABLE sobre ventas necesita un bloqueo breve)',
         (select count(*)::text from pg_stat_activity where state like 'idle in transaction%' and datname = current_database()), '0',
         case when (select count(*) from pg_stat_activity where state like 'idle in transaction%' and datname = current_database()) = 0 then 'OK' else 'REVISAR' end
  union all select 7, 'Filas en ventas (el ALTER TABLE la reescribe un instante: con pocas filas es inmediato)', (select count(*)::text from public.ventas), '(dato)', 'INFO'
  union all select 8, 'Tablas de contrato que recibirán trigger', (select count(*)::text from esc), '(dato)', 'INFO'
  union all select 9, 'Roles de Supabase presentes (anon, authenticated, service_role)', (select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role')), '3',
         case when (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) = 3 then 'OK' else 'REVISAR' end
) q order by o;
