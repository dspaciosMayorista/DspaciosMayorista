-- PREFLIGHT 267 · solo lectura · UNA consulta con columna `estado` (pegar tal cual en el editor SQL antes de correr la 267).
-- Debe dar OK en todas las filas de `requisito`; las de `informativo` no bloquean.
select 'requisito' as tipo, c.nombre,
       case when c.ok then 'OK' else 'BLOQUEA' end as estado, c.detalle
  from (values
    ('aliados_b2b trae las columnas que usa el trigger',
       (select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b'
          and column_name in ('aliado_id','recobro_total','base_explicita','pct_comision','comision_valor')), 'aliado_id, recobro_total, base_explicita, pct_comision, comision_valor'),
    ('ventas trae cotizacion_id, tipo_asesor y los nombres',
       (select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'ventas'
          and column_name in ('cotizacion_id','tipo_asesor','aliado_id','agencia_nombre','freelance_nombre')), 'cotizacion_id, tipo_asesor, aliado_id, agencia_nombre, freelance_nombre'),
    ('cotizaciones trae payload, estado y numero_contrato',
       (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones'
          and column_name in ('payload','estado','numero_contrato','aliado_id')), 'payload, estado, numero_contrato, aliado_id'),
    ('aliados trae nombre, nit y tipo',
       (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'aliados'
          and column_name in ('nombre','nit','tipo')), 'nombre, nit, tipo'),
    ('existe convertir_cotizacion_a_contrato (198/222)',
       to_regprocedure('public.convertir_cotizacion_a_contrato(bigint)') is not null
         or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'convertir_cotizacion_a_contrato'), 'la función que la 267 vigila sin reemplazar'),
    ('la 267 todavía NO está aplicada',
       not exists (select 1 from pg_trigger where tgname = 'trg_recobro_beneficiario_explicito')
         and not exists (select 1 from pg_proc where proname = 'fn_recobro_beneficiario_explicito'), 'sin trigger ni función (si ya están, la 267 es idempotente: no es un error)')
  ) as c(nombre, ok, detalle)
union all
select 'informativo', 'filas de aliados_b2b con la forma del recobro de la 198 sin ficha (la 267 NO las toca)', 'INFO',
       count(*)::text
  from public.aliados_b2b
 where aliado_id is null and coalesce(recobro_total, 0) > 0 and base_explicita is null
   and coalesce(pct_comision, 0) = 0 and comision_valor is null
order by 1, 2;
