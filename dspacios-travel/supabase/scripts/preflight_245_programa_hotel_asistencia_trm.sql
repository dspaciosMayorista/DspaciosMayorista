-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT de la migración 245 (#88: asistencia con proveedor, TRM de costos y
-- modo hotel solo terrestre). SOLO LECTURA. Correr ANTES de aplicar la 245 y DESPUÉS
-- de la 244. Una sola consulta: todos los controles como filas (control · valor ·
-- esperado · estado). OK = cumple · REVISAR = no aplicar la 245 hasta entenderlo ·
-- INFO = dato. Compatible con el SQL Editor de Supabase (una sentencia).
-- ───────────────────────────────────────────────────────────────────────────
with
col as (
  select c.table_name, c.column_name from information_schema.columns c where c.table_schema = 'public'
),
nuevas as (
  select * from (values
    ('programas', 'proveedor_asistencia_id'),
    ('contrato_programa_estancia_costo', 'asistencia_total'),
    ('contrato_programa_estancia_costo', 'proveedor_asistencia_id'),
    ('contrato_programa_estancia_costo', 'trm_costo')
  ) as t(tabla, columna)
),
viejas as (
  select * from (values ('cxp_programa_id'), ('cxp_noches_id')) as t(columna)
),
chk as (
  select * from (values
    ('contrato_programa_estancia_costo_asistencia_check'),
    ('contrato_programa_estancia_costo_trm_check'),
    ('programas_modo_hotel_terrestre_chk')
  ) as t(nombre)
),
controles as (
  select 1 as orden, 'PostgreSQL >= 15'::text as control, current_setting('server_version_num') as valor, '>= 150000'::text as esperado,
         case when current_setting('server_version_num')::int >= 150000 then 'OK' else 'REVISAR' end as estado
  union all
  select 10, 'la 244 está aplicada (contrato_programa_estancia_costo existe)',
         case when to_regclass('public.contrato_programa_estancia_costo') is not null then 'existe' else 'falta' end, 'existe',
         case when to_regclass('public.contrato_programa_estancia_costo') is not null then 'OK' else 'REVISAR' end
  union all
  select 11, 'tabla public.proveedores', case when to_regclass('public.proveedores') is not null then 'existe' else 'falta' end, 'existe',
         case when to_regclass('public.proveedores') is not null then 'OK' else 'REVISAR' end
  union all
  select 12, 'programas.tipo_transporte e incluye_aereo existen (la restricción los usa)',
         (select count(*)::text from col where table_name = 'programas' and column_name in ('tipo_transporte', 'incluye_aereo')), '2',
         case when (select count(*) from col where table_name = 'programas' and column_name in ('tipo_transporte', 'incluye_aereo')) = 2 then 'OK' else 'REVISAR' end
  union all
  select 20 + row_number() over (order by n.tabla, n.columna), 'la columna ' || n.tabla || '.' || n.columna || ' aún NO existe',
         case when exists (select 1 from col c where c.table_name = n.tabla and c.column_name = n.columna) then 'ya existe' else 'no existe' end, 'no existe',
         case when exists (select 1 from col c where c.table_name = n.tabla and c.column_name = n.columna) then 'REVISAR' else 'OK' end
    from nuevas n
  union all
  select 40 + row_number() over (order by v.columna), 'la columna contrato_programa_estancia_costo.' || v.columna || ' existe (la 245 la retira)',
         case when exists (select 1 from col c where c.table_name = 'contrato_programa_estancia_costo' and c.column_name = v.columna) then 'existe' else 'no existe' end, 'existe',
         case when exists (select 1 from col c where c.table_name = 'contrato_programa_estancia_costo' and c.column_name = v.columna) then 'OK' else 'REVISAR' end
    from viejas v
  union all
  select 60 + row_number() over (order by k.nombre), 'la restricción ' || k.nombre || ' aún NO existe',
         case when exists (select 1 from pg_constraint p where p.conname = k.nombre) then 'ya existe' else 'no existe' end, 'no existe',
         case when exists (select 1 from pg_constraint p where p.conname = k.nombre) then 'REVISAR' else 'OK' end
    from chk k
  union all
  -- Si hay un programa por hotel con aéreo, la restricción nueva fallaría al crearse: hay que corregirlo ANTES.
  select 80, 'programas con modo_precio = hotel y transporte aéreo (impedirían la restricción)',
         case when to_regclass('public.programas') is null then 'n/d'
              else (select count(*)::text from public.programas where modo_precio = 'hotel' and (tipo_transporte = 'aereo' or incluye_aereo)) end, '0',
         case when to_regclass('public.programas') is not null
                   and (select count(*) from public.programas where modo_precio = 'hotel' and (tipo_transporte = 'aereo' or incluye_aereo)) = 0 then 'OK' else 'REVISAR' end
  union all
  select 81, 'INFO programas en modo hotel', (select count(*)::text from public.programas where modo_precio = 'hotel'), 'dato', 'INFO'
  union all
  select 82, 'INFO registros de costo de estancia (la 245 no los borra)',
         case when to_regclass('public.contrato_programa_estancia_costo') is null then 'n/d' else (select count(*)::text from public.contrato_programa_estancia_costo) end, 'dato', 'INFO'
  union all
  -- Las dos columnas retiradas: si alguna trae datos se pierden. La 244 aún no estaba en producción al escribirse la 245.
  select 83, 'registros de costo con cxp_programa_id / cxp_noches_id con valor (se perderían al retirar las columnas)',
         case when exists (select 1 from col c where c.table_name = 'contrato_programa_estancia_costo' and c.column_name = 'cxp_programa_id')
              then (select count(*)::text from public.contrato_programa_estancia_costo k where to_jsonb(k)->>'cxp_programa_id' is not null or to_jsonb(k)->>'cxp_noches_id' is not null) else 'n/d' end,
         '0 (las CxP se vinculan por numero_contrato)',
         case when exists (select 1 from col c where c.table_name = 'contrato_programa_estancia_costo' and c.column_name = 'cxp_programa_id')
                   and (select count(*) from public.contrato_programa_estancia_costo k where to_jsonb(k)->>'cxp_programa_id' is not null or to_jsonb(k)->>'cxp_noches_id' is not null) = 0 then 'OK' else 'REVISAR' end
)
select control, valor, esperado, estado from controles order by orden;
