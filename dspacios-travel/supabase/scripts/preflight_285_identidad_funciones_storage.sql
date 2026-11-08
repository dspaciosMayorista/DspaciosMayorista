-- PREFLIGHT de la migración 285 (identidad: funciones, pendiente financiero y Storage, #75 entrega 2). SOLO LECTURA. UNA consulta integral.
-- Pegar completa en el editor SQL de Supabase ANTES de aplicar la 285. Columnas: control · valor · esperado · estado.
-- estado: OK = cumple · REVISAR = detener y revisar antes de aplicar · INFO = dato para decidir/recordar.
-- Los md5 son del texto (sin CR) de las funciones tal como las deja la cadena de migraciones hasta la 281/283; si difieren, alguien las cambió y la 285 las REEMPLAZA:
-- revisa el cambio antes de aplicar.
with
f as (select p.proname, md5(replace(p.prosrc, chr(13), '')) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       where p.proname in ('soporte_registrar','soporte_reemplazar','soporte_retirar','liberar_vencidas','acceso_archivo_contratos')),
vd as (select pg_get_viewdef('public.ventas_basica'::regclass, true) as d)
select * from (
  select 1 as o, 'La 284 (identidad y guardas) está aplicada' as control,
         (to_regclass('public.contrato_guardas_config') is not null and to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is not null
           and exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='contrato_uid'))::text as valor, 'true' as esperado,
         case when to_regclass('public.contrato_guardas_config') is not null and to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is not null
               and exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='contrato_uid') then 'OK' else 'REVISAR' end as estado
  union all select 2, 'La 281 (soportes) está aplicada', (to_regclass('public.contrato_soportes_pago') is not null)::text, 'true',
         case when to_regclass('public.contrato_soportes_pago') is not null then 'OK' else 'REVISAR' end
  union all select 3, 'La 285 NO está aplicada (sin soporte_verificar_identidad, sin columna en el pendiente, sin trigger)',
         (to_regprocedure('public.soporte_verificar_identidad(text)') is not null
           or exists (select 1 from information_schema.columns where table_schema='public' and table_name='contrato_financiero_pendiente' and column_name='contrato_uid')
           or exists (select 1 from pg_trigger where tgname='trg_financiero_pendiente_identidad'))::text, 'false',
         case when to_regprocedure('public.soporte_verificar_identidad(text)') is null
               and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='contrato_financiero_pendiente' and column_name='contrato_uid')
               and not exists (select 1 from pg_trigger where tgname='trg_financiero_pendiente_identidad') then 'OK' else 'REVISAR' end
  union all select 4, 'soporte_registrar es la versión de la 281 (md5)', coalesce((select m from f where proname='soporte_registrar'), 'NO EXISTE'), '4d8e4af568f9a6df82916c9339af7145',
         case when (select m from f where proname='soporte_registrar') = '4d8e4af568f9a6df82916c9339af7145' then 'OK' else 'REVISAR' end
  union all select 5, 'soporte_reemplazar es la versión de la 281 (md5)', coalesce((select m from f where proname='soporte_reemplazar'), 'NO EXISTE'), '0d76b0640cd75249537816b990a1546c',
         case when (select m from f where proname='soporte_reemplazar') = '0d76b0640cd75249537816b990a1546c' then 'OK' else 'REVISAR' end
  union all select 6, 'soporte_retirar es la versión de la 281 (md5)', coalesce((select m from f where proname='soporte_retirar'), 'NO EXISTE'), '0fae1322d31f2f4fec1a48754ece1d52',
         case when (select m from f where proname='soporte_retirar') = '0fae1322d31f2f4fec1a48754ece1d52' then 'OK' else 'REVISAR' end
  union all select 7, 'liberar_vencidas es la versión vigente (md5)', coalesce((select m from f where proname='liberar_vencidas'), 'NO EXISTE'), '0b12c63266b2f1a87b75124eedf71245',
         case when (select m from f where proname='liberar_vencidas') = '0b12c63266b2f1a87b75124eedf71245' then 'OK' else 'REVISAR' end
  union all select 8, 'Las cuatro políticas del bucket «contratos» existen y usan acceso_archivo_contratos',
         (select count(*)::text from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'contratos files:%' and (coalesce(qual,'')||coalesce(with_check,'')) like '%acceso_archivo_contratos%'), '4',
         case when (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'contratos files:%' and (coalesce(qual,'')||coalesce(with_check,'')) like '%acceso_archivo_contratos%') = 4 then 'OK' else 'REVISAR' end
  union all select 9, 'acceso_archivo_contratos es la versión de la 150 (md5; la 285 NO la modifica, solo añade una precondición)', coalesce((select m from f where proname='acceso_archivo_contratos'), 'NO EXISTE'), '2812dfd8f8c09ea6546e2666e90b6755',
         case when (select m from f where proname='acceso_archivo_contratos') = '2812dfd8f8c09ea6546e2666e90b6755' then 'OK' else 'REVISAR' end
  union all select 10, 'ventas_basica termina en «FROM ventas v» y no tiene aún contrato_uid (la 285 le añade la columna al final)',
         (select (d ~ E'\\n\\s+FROM ventas v\\n' and d !~ 'contrato_uid')::text from vd), 'true',
         case when (select d ~ E'\\n\\s+FROM ventas v\\n' and d !~ 'contrato_uid' from vd) then 'OK' else 'REVISAR' end
  union all select 11, 'Registros pendientes del financiero (el backfill de contrato_uid los completa desde ventas)', (select count(*)::text from public.contrato_financiero_pendiente), '(dato)', 'INFO'
  union all select 12, 'Pendientes sin contrato en ventas (quedarían con contrato_uid null)',
         (select count(*)::text from public.contrato_financiero_pendiente p where not exists (select 1 from public.ventas v where v.numero_contrato = p.numero_contrato)), '0',
         case when not exists (select 1 from public.contrato_financiero_pendiente p where not exists (select 1 from public.ventas v where v.numero_contrato = p.numero_contrato)) then 'OK' else 'REVISAR' end
  union all select 13, 'Ningún contrato ha nacido de reuso todavía', (select count(*)::text from public.ventas where nacio_de_reuso), '0',
         case when not exists (select 1 from public.ventas where nacio_de_reuso) then 'OK' else 'INFO' end
  union all select 14, 'ventas_vuelo_sistema y contrato_vuelos_editor tienen el FROM esperado y aún no tienen contrato_uid',
         (select count(*)::text from (values ('public.ventas_vuelo_sistema', '\n\s+FROM ventas v\n'), ('public.contrato_vuelos_editor', '\n\s+FROM contrato_vuelos cv\n')) t(v, pat)
           where pg_get_viewdef(t.v::regclass, true) ~ t.pat and pg_get_viewdef(t.v::regclass, true) !~ 'contrato_uid') || ' de 2', '2 de 2',
         case when (select count(*) from (values ('public.ventas_vuelo_sistema', '\n\s+FROM ventas v\n'), ('public.contrato_vuelos_editor', '\n\s+FROM contrato_vuelos cv\n')) t(v, pat)
           where pg_get_viewdef(t.v::regclass, true) ~ t.pat and pg_get_viewdef(t.v::regclass, true) !~ 'contrato_uid') = 2 then 'OK' else 'REVISAR' end
) q order by o;
