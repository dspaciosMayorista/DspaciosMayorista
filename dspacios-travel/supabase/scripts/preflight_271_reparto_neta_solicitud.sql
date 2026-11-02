-- PREFLIGHT 271 (#120) · SOLO LECTURA · UNA consulta integral: n · control · observado · esperado · estado. Pegar COMPLETA en el editor SQL (sin begin/rollback).
-- Última fila (n = 99) = VEREDICTO GLOBAL: «LISTA PARA APLICAR» solo si ninguna fila es FALLA. REVISAR = decisión humana. Requiere la 270 aplicada (postcheck 270 = «270 CORRECTA»).
with
c as (
  select
    (to_regclass('public.cotizacion_tarifa_solicitud') is not null) as tabla,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cotizacion_tarifa_solicitud' and column_name in ('modo', 'adultos', 'ninos', 'infantes', 'neta_adulto', 'neta_nino', 'neta_infante')) as cols,
    (to_regprocedure('public.cargar_neta_solicitud(bigint,text,numeric,text,numeric,numeric,jsonb,date)') is not null) as rpc8,
    (to_regprocedure('public.cargar_neta_solicitud(bigint,text,numeric,text,numeric,numeric,jsonb,date,text,integer,integer,integer,numeric,numeric,numeric)') is not null) as rpc15,
    case when to_regclass('public.cotizacion_tarifa_solicitud') is not null then (select count(*) from public.cotizacion_tarifa_solicitud) else 0 end as filas,
    (select count(*) from public.hoteles where tarifa_bajo_solicitud) as marcados
),
filas as (
  select 1 as n, '270 aplicada: cotizacion_tarifa_solicitud presente' as control, tabla::text as observado, 'true' as esperado, tabla as ok, null::text as nivel from c
  union all select 2, '270 aplicada: columna hoteles.tarifa_bajo_solicitud presente',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'tarifa_bajo_solicitud')::text, '1',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hoteles' and column_name = 'tarifa_bajo_solicitud') = 1, null
  union all select 3, 'RPC cargar_neta_solicitud presente en UNA sola versión (8 args de la 270 = primera vez · 15 args = reaplicación)',
    'rpc8=' || rpc8::text || ' · rpc15=' || rpc15::text, 'rpc8 xor rpc15', (rpc8 <> rpc15), null from c
  union all select 4, 'columnas del reparto ya presentes (0 = primera vez · 7 = reaplicación idempotente)', cols::text, '0 o 7', cols in (0, 7), null from c
  union all select 5, 'coherencia: columnas y RPC van juntas (0 cols ↔ rpc8; 7 cols ↔ rpc15)', 'cols=' || cols::text || ' · rpc8=' || rpc8::text || ' · rpc15=' || rpc15::text, '0 cols con rpc8, o 7 cols con rpc15',
    ((cols = 0 and rpc8 and not rpc15) or (cols = 7 and rpc15 and not rpc8)), null from c
  union all select 6, 'netas ya cargadas: las filas anteriores a la 271 quedan con modo «adultos», 1 adulto y 0 niños/infantes (no representan una elección real). Esperado 0 en una base sin solicitudes valoradas',
    filas::text, '0', filas = 0, 'REVISAR' from c
  union all select 7, 'hoteles marcados bajo solicitud (informativo)', marcados::text, 'cualquiera', true, null from c
  union all select 8, 'transacciones abiertas sin actividad > 1 min (retendrían el candado del ALTER TABLE)',
    (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute')::text, '0',
    (select count(*) from pg_stat_activity where state = 'idle in transaction' and now() - state_change > interval '1 minute') = 0, 'REVISAR'
)
select n, control, observado, esperado, case when ok then 'OK' else coalesce(nivel, 'FALLA') end as estado from filas
union all
select 99, 'VEREDICTO GLOBAL', case when count(*) filter (where not ok and nivel is null) = 0 then 'LISTA PARA APLICAR' else 'NO APLICAR' end, 'LISTA PARA APLICAR',
       case when count(*) filter (where not ok and nivel is null) = 0 then 'OK' else 'FALLA' end from filas
order by n;
