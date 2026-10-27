-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 245 (#88: asistencia con proveedor, TRM de costos y
-- modo hotel solo terrestre). SOLO LECTURA. Correr DESPUÉS de aplicar la 245. Una
-- sola consulta (control · valor · esperado · estado OK/REVISAR/INFO). Si la 245 NO
-- está aplicada marca REVISAR (no falla).
-- ───────────────────────────────────────────────────────────────────────────
with
col as (
  select c.table_name, c.column_name, c.data_type, c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default
    from information_schema.columns c where c.table_schema = 'public'
),
esperadas as (
  select * from (values
    ('programas', 'proveedor_asistencia_id', 'bigint', null::int, null::int, 'YES'),
    ('contrato_programa_estancia_costo', 'asistencia_total', 'numeric', 15, 2, 'NO'),
    ('contrato_programa_estancia_costo', 'proveedor_asistencia_id', 'bigint', null, null, 'YES'),
    ('contrato_programa_estancia_costo', 'trm_costo', 'numeric', 15, 4, 'YES')
  ) as t(tabla, columna, tipo, precision_, escala, nulo)
),
retiradas as (
  select * from (values ('cxp_programa_id'), ('cxp_noches_id')) as t(columna)
),
restricciones as (
  select c.conname, c.conrelid::regclass::text as tabla, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
   where c.conname in ('contrato_programa_estancia_costo_asistencia_check', 'contrato_programa_estancia_costo_trm_check', 'programas_modo_hotel_terrestre_chk')
),
fk_prov as (
  select c.confdeltype, c.confrelid::regclass::text as destino
    from pg_constraint c
   where c.conrelid = 'public.programas'::regclass and c.contype = 'f'
     and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['proveedor_asistencia_id']
),
controles as (
  select 10 + row_number() over (order by e.tabla, e.columna) as orden,
         'columna ' || e.tabla || '.' || e.columna as control,
         coalesce((select c.data_type || case when c.data_type = 'numeric' then '(' || c.numeric_precision || ',' || c.numeric_scale || ')' else '' end || ' null=' || c.is_nullable
                     from col c where c.table_name = e.tabla and c.column_name = e.columna), 'falta') as valor,
         e.tipo || coalesce('(' || e.precision_ || ',' || e.escala || ')', '') || ' null=' || e.nulo as esperado,
         case when exists (select 1 from col c where c.table_name = e.tabla and c.column_name = e.columna and c.data_type = e.tipo
                              and (c.data_type <> 'numeric' or (c.numeric_precision = e.precision_ and c.numeric_scale = e.escala)) and c.is_nullable = e.nulo)
              then 'OK' else 'REVISAR' end as estado
    from esperadas e
  union all
  select 30 + row_number() over (order by r.columna), 'columna retirada contrato_programa_estancia_costo.' || r.columna,
         case when exists (select 1 from col c where c.table_name = 'contrato_programa_estancia_costo' and c.column_name = r.columna) then 'sigue' else 'retirada' end, 'retirada',
         case when exists (select 1 from col c where c.table_name = 'contrato_programa_estancia_costo' and c.column_name = r.columna) then 'REVISAR' else 'OK' end
    from retiradas r
  union all
  select 40, 'asistencia_total tiene valor por defecto 0',
         coalesce((select column_default from col where table_name = 'contrato_programa_estancia_costo' and column_name = 'asistencia_total'), 'n/d'), '0',
         case when (select column_default from col where table_name = 'contrato_programa_estancia_costo' and column_name = 'asistencia_total') like '0%' then 'OK' else 'REVISAR' end
  union all
  select 50, 'restricciones de la 245 presentes', (select count(*)::text from restricciones), '3', case when (select count(*) from restricciones) = 3 then 'OK' else 'REVISAR' end
  union all
  select 51, 'asistencia_check: total >= 0 y total >= asistencia de las noches',
         coalesce((select def from restricciones where conname = 'contrato_programa_estancia_costo_asistencia_check'), 'falta'), 'asistencia_total >= 0 y >= asistencia_noches',
         case when (select def from restricciones where conname = 'contrato_programa_estancia_costo_asistencia_check') like '%asistencia_total >= (0)%'
                   and (select def from restricciones where conname = 'contrato_programa_estancia_costo_asistencia_check') like '%asistencia_total >= asistencia_noches%' then 'OK' else 'REVISAR' end
  union all
  select 52, 'trm_check: solo USD, 0 < trm < 1e11',
         coalesce((select def from restricciones where conname = 'contrato_programa_estancia_costo_trm_check'), 'falta'), 'trm null, o moneda USD y 0 < trm < 1e11',
         case when (select def from restricciones where conname = 'contrato_programa_estancia_costo_trm_check') like '%trm_costo IS NULL%'
                   and (select def from restricciones where conname = 'contrato_programa_estancia_costo_trm_check') like '%USD%' then 'OK' else 'REVISAR' end
  union all
  select 53, 'modo hotel solo terrestre (sin tipo_transporte aéreo ni incluye_aereo)',
         coalesce((select def from restricciones where conname = 'programas_modo_hotel_terrestre_chk'), 'falta'), 'modo_precio <> hotel o (tipo_transporte <> aereo y no incluye_aereo)',
         case when (select def from restricciones where conname = 'programas_modo_hotel_terrestre_chk') like '%aereo%'
                   and (select def from restricciones where conname = 'programas_modo_hotel_terrestre_chk') like '%incluye_aereo%' then 'OK' else 'REVISAR' end
  union all
  select 60, 'programas.proveedor_asistencia_id → proveedores, ON DELETE SET NULL',
         coalesce((select destino || ' ' || case confdeltype when 'n' then 'set null' else confdeltype::text end from fk_prov), 'sin FK'), 'public.proveedores set null',
         case when (select destino from fk_prov) = 'proveedores' and (select confdeltype from fk_prov) = 'n' then 'OK' else 'REVISAR' end
  union all
  select 70, 'INFO programas en modo hotel', (select count(*)::text from public.programas where modo_precio = 'hotel'), 'dato', 'INFO'
  union all
  select 71, 'programas en modo hotel y aéreo (debe ser 0)', (select count(*)::text from public.programas where modo_precio = 'hotel' and (tipo_transporte = 'aereo' or incluye_aereo)), '0',
         case when (select count(*) from public.programas where modo_precio = 'hotel' and (tipo_transporte = 'aereo' or incluye_aereo)) = 0 then 'OK' else 'REVISAR' end
  union all
  select 72, 'INFO programas por hotel sin proveedor de asistencia (deberán fijarlo si su asistencia diaria es > 0)',
         (select count(*)::text from public.programas where modo_precio = 'hotel' and proveedor_asistencia_id is null and coalesce(asistencia_medica_dia, 0) > 0), 'dato', 'INFO'
  union all
  select 73, 'INFO registros de costo con TRM congelada', (select count(*)::text from public.contrato_programa_estancia_costo where trm_costo is not null), 'dato', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
