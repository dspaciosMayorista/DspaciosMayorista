-- PREFLIGHT de la migración 287 (reutilización de consecutivos DTM, #75). SOLO LECTURA. UNA consulta integral.
-- Pegar completa en el editor SQL de Supabase ANTES de aplicar la 287. Columnas: control · valor · esperado · estado.
-- estado: OK = cumple · REVISAR = detener y revisar antes de aplicar · INFO = dato para decidir/recordar.
with
esc as (   -- tablas que el escaneo dinámico de elegibilidad revisará (columna numero_contrato/contrato_numero o FK hacia ventas)
  select distinct c.oid, c.relname::text as tabla
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind in ('r','p') and c.relname <> 'ventas' and (
         exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero'))
      or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass))),
md as (select p.proname, md5(replace(p.prosrc, chr(13), '')) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname in ('eliminar_contrato','siguiente_numero_contrato_para_tenant','fn_renumerar_contrato'))
select * from (
  select 1 as o, 'La 281 (#86) está aplicada' as control,
         (to_regclass('public.contrato_soportes_pago') is not null and to_regclass('public.avisos') is not null)::text as valor, 'true' as esperado,
         case when to_regclass('public.contrato_soportes_pago') is not null and to_regclass('public.avisos') is not null then 'OK' else 'REVISAR' end as estado
  union all select 2, 'La 287 NO está aplicada (pool, columna, trigger y funciones ausentes)',
         (to_regclass('public.numeros_dtm_liberados') is not null
           or exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='reserva_token')
           or exists (select 1 from pg_trigger where tgname='trg_ventas_reserva_dtm')
           or to_regprocedure('public.reservar_numero_contrato(text)') is not null)::text, 'false',
         case when to_regclass('public.numeros_dtm_liberados') is null
               and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='reserva_token')
               and not exists (select 1 from pg_trigger where tgname='trg_ventas_reserva_dtm')
               and to_regprocedure('public.reservar_numero_contrato(text)') is null then 'OK' else 'REVISAR' end
  union all select 3, 'eliminar_contrato es la versión de la 196 (md5 del cuerpo; la 287 la reemplaza)',
         coalesce((select m from md where proname='eliminar_contrato'), 'NO EXISTE'), 'dcb90b8387d26b522d916c9ca8cfe685',
         case when (select m from md where proname='eliminar_contrato') = 'dcb90b8387d26b522d916c9ca8cfe685' then 'OK' else 'REVISAR' end
  union all select 4, 'siguiente_numero_contrato_para_tenant existe y contrato_seq_mayorista existe (159)',
         (to_regprocedure('public.siguiente_numero_contrato_para_tenant(text)') is not null and to_regclass('public.contrato_seq_mayorista') is not null)::text, 'true',
         case when to_regprocedure('public.siguiente_numero_contrato_para_tenant(text)') is not null and to_regclass('public.contrato_seq_mayorista') is not null then 'OK' else 'REVISAR' end
  union all select 5, 'fn_renumerar_contrato es la versión de la 281 (la 287 NO la toca)',
         (select (p.prosrc like '%f281%')::text from pg_proc p where p.proname='fn_renumerar_contrato' limit 1), 'true',
         case when (select p.prosrc like '%f281%' from pg_proc p where p.proname='fn_renumerar_contrato' limit 1) then 'OK' else 'REVISAR' end
  union all select 6, 'CHECK de formato por tenant en ventas (160) presente',
         (exists (select 1 from pg_constraint where conname='ventas_numero_contrato_formato_por_tenant'))::text, 'true',
         case when exists (select 1 from pg_constraint where conname='ventas_numero_contrato_formato_por_tenant') then 'OK' else 'REVISAR' end
  union all select 7, 'Roles de Supabase presentes (anon, authenticated, service_role)',
         (select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role')), '3',
         case when (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) = 3 then 'OK' else 'REVISAR' end
  union all select 8, 'mi_rol() y storage.objects existen (los usa la elegibilidad)',
         (to_regprocedure('public.mi_rol()') is not null and to_regclass('storage.objects') is not null)::text, 'true',
         case when to_regprocedure('public.mi_rol()') is not null and to_regclass('storage.objects') is not null then 'OK' else 'REVISAR' end
  union all select 9, 'Tablas que revisará el escaneo dinámico de relaciones (cantidad)',
         (select count(*)::text from esc), '>= 20', case when (select count(*) from esc) >= 20 then 'OK' else 'REVISAR' end
  union all select 10, 'Tablas escaneadas con más de 200.000 filas estimadas (costo del escaneo; sin índice por número puede tardar)',
         coalesce((select string_agg(e.tabla || '=' || s.n_live_tup, ', ' order by e.tabla) from esc e join pg_stat_user_tables s on s.relid = e.oid where s.n_live_tup > 200000), 'ninguna'), 'ninguna',
         case when exists (select 1 from esc e join pg_stat_user_tables s on s.relid = e.oid where s.n_live_tup > 200000) then 'REVISAR' else 'OK' end
  union all select 11, 'Contratos mayorista por estado (hoy)',
         coalesce((select string_agg(coalesce(estado,'NULL') || '=' || n, ', ' order by estado) from (select estado, count(*) n from public.ventas where tenant='mayorista' group by estado) x), 'ninguno'), '(informativo)', 'INFO'
  union all select 12, 'Contratos mayorista pendientes SIN evento de creación en auditoría (quedarán bloqueados: evidencia insuficiente)',
         (select count(*)::text from public.ventas v where v.tenant='mayorista' and v.estado='pendiente'
             and not exists (select 1 from public.auditoria a where a.tabla='ventas' and a.accion='INSERT' and a.registro_id = v.numero_contrato)), '0 (informativo)', 'INFO'
  union all select 13, 'Contratos mayorista cuyo número no es DTM-#### (el CHECK de la 160 lo impide)',
         (select count(*)::text from public.ventas where tenant='mayorista' and numero_contrato !~ '^DTM-[0-9]{4,}$'), '0',
         case when (select count(*) from public.ventas where tenant='mayorista' and numero_contrato !~ '^DTM-[0-9]{4,}$') = 0 then 'OK' else 'REVISAR' end
  union all select 14, 'Pool de Minorista (numeros_contrato_liberados): filas (no lo toca la 287)',
         (select count(*)::text from public.numeros_contrato_liberados), '(informativo)', 'INFO'
  union all select 15, 'Auditoría: filas totales (no se modifica)', (select count(*)::text from public.auditoria), '(informativo)', 'INFO'
  union all select 16, 'La 284 y la 285 (identidad del contrato) están aplicadas: el reuso NO se aplica sin ellas', (to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is not null and to_regprocedure('public.soporte_verificar_identidad(text)') is not null and to_regprocedure('public._resolver_contrato_manual(text)') is not null and to_regprocedure('public.sillas_identidades(bigint)') is not null)::text, 'true',
         case when to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is not null and to_regprocedure('public.soporte_verificar_identidad(text)') is not null and to_regprocedure('public._resolver_contrato_manual(text)') is not null and to_regprocedure('public.sillas_identidades(bigint)') is not null then 'OK' else 'REVISAR' end
) q order by o;
