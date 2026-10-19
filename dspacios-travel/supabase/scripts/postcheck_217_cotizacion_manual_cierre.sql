-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 217 · #39 cierre de la frontera (B). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 217. UNA sola fila (FALLA si la 217 o la 216 no están):
--   veredicto|ok|fallos|chequeos(=12)|fallidos|resumen(C1=t;…;C12=t)|filas|detalle
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
hay as (
  select to_regprocedure('p39_priv.frontera_activa()') is not null
         and to_regprocedure('public.edicion_cotizaciones_habilitada()') is not null
         and to_regclass('p39_priv.suspension_edicion') is not null as si
),
dyn(k, q) as (
  values ('frontera', 'select p39_priv.frontera_activa()::text as v'),
         ('habilitada', 'select public.edicion_cotizaciones_habilitada()::text as v'),
         ('suspendida', 'select coalesce(bool_and(suspendida), true)::text as v from p39_priv.suspension_edicion')
),
ev as (
  select d.k, case when (select si from hay) then (xpath('/row/v/text()', query_to_xml(d.q, false, true, '')))[1]::text end as v
    from dyn d
),
trg as (
  select t.tgname, t.tgenabled from pg_trigger t
   where not t.tgisinternal and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39')
),
md5_198 as (
  select string_agg(coalesce(md5(replace(p.prosrc, chr(13), '')), 'falta'), ',' order by f.n) as h
    from (values (1, 'public.anular_pago_previo(bigint,uuid,text)'), (2, 'public.convertir_cotizacion_a_contrato(bigint,uuid)'),
                 (3, 'public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)'),
                 (4, 'public.transferir_pagos_previos_a_abonos(bigint,text,uuid)')) f(n, sig)
    left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
c0(n, comprobacion, ok) as (
  select 1, 'frontera_activa() verdadera (disparadores, permisos y réplica de sesión normal)',
         (select v from ev where k = 'frontera') = 'true'
  union all select 2, 'disparador de frontera en cotizaciones habilitado',
         exists (select 1 from trg where tgname = 'trg_cot_frontera_39' and tgenabled in ('O', 'A'))
  union all select 3, 'disparador de frontera en pagos previos habilitado',
         exists (select 1 from trg where tgname = 'trg_cot_pagos_frontera_39' and tgenabled in ('O', 'A'))
  union all select 4, 'disparador de frontera en condiciones habilitado',
         exists (select 1 from trg where tgname = 'trg_cot_condiciones_frontera_39' and tgenabled in ('O', 'A'))
  union all select 5, 'cotizacion_servicios: ni anon, ni authenticated, ni service_role escriben',
         not has_table_privilege('anon', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('authenticated', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('service_role', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
  union all select 6, 'pagos previos: anon/authenticated sin escritura; service_role sin DELETE/TRUNCATE y con INSERT/UPDATE',
         not has_table_privilege('anon', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('authenticated', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('service_role', 'public.cotizacion_pagos_previos', 'DELETE,TRUNCATE')
         and has_table_privilege('service_role', 'public.cotizacion_pagos_previos', 'INSERT')
         and has_table_privilege('service_role', 'public.cotizacion_pagos_previos', 'UPDATE')
  union all select 7, 'condiciones: anon/authenticated sin escritura; service_role sin TRUNCATE y con INSERT/DELETE',
         not has_table_privilege('anon', 'public.cotizacion_condiciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('authenticated', 'public.cotizacion_condiciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
         and not has_table_privilege('service_role', 'public.cotizacion_condiciones', 'TRUNCATE')
         and has_table_privilege('service_role', 'public.cotizacion_condiciones', 'INSERT')
         and has_table_privilege('service_role', 'public.cotizacion_condiciones', 'DELETE')
  union all select 8, 'la lectura de servicios sigue (authenticated y service_role SELECT)',
         has_table_privilege('authenticated', 'public.cotizacion_servicios', 'SELECT')
         and has_table_privilege('service_role', 'public.cotizacion_servicios', 'SELECT')
  union all select 9, 'la edición queda habilitada salvo suspensión explícita',
         (select v from ev where k = 'habilitada') = (((select v from ev where k = 'suspendida') = 'false') and ((select v from ev where k = 'frontera') = 'true'))::text
  union all select 10, 'la 216 (wrappers y RPC) está aplicada',
         to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)') is not null
         and to_regprocedure('public.anular_pago_previo_controlado(bigint,uuid,text)') is not null
         and to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is not null
         and to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)') is not null
  union all select 11, 'las 4 RPC de dinero de la 198 sin cambios (md5 de main)',
         (select h from md5_198) = '49bb1f21f071141d30926ad426f87369,edc9975010746e53e4af6a75ad9763dc,146d0275f5a97b9ecd6a52e11161b248,4814691695eb7587c18628ede17f266f'
  union all select 12, 'cotizaciones conserva UPDATE para authenticated (vigencia, titular, incluye y descartar siguen)',
         has_table_privilege('authenticated', 'public.cotizaciones', 'UPDATE') and has_table_privilege('authenticated', 'public.cotizaciones', 'SELECT')
),
c as (
  select n, comprobacion, coalesce(ok, false) as ok from c0
)
select case when count(*) filter (where not ok) = 0 then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where ok)::int as ok,
       count(*) filter (where not ok)::int as fallos,
       count(*)::int as chequeos,
       coalesce(string_agg('C' || n, ',' order by n) filter (where not ok), 'ninguno') as fallidos,
       string_agg('C' || n || '=' || case when ok then 't' else 'f' end, ';' order by n) as resumen,
       'Filas: frontera=' || coalesce((select v from ev where k = 'frontera'), 'n/a')
         || ' · habilitada=' || coalesce((select v from ev where k = 'habilitada'), 'n/a')
         || ' · suspendida=' || coalesce((select v from ev where k = 'suspendida'), 'n/a') as filas,
       jsonb_agg(jsonb_build_object('codigo', 'C' || n, 'ok', ok, 'comprobacion', comprobacion) order by n) as detalle
  from c;

rollback;
