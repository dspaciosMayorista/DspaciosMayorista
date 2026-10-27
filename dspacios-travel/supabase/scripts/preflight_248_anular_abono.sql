-- ───────────────────────────────────────────────────────────────────────────
-- 248 · PREFLIGHT INTEGRAL (UNA sola consulta, SOLO LECTURA). Se corre ANTES de la 248. Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = hay que mirar antes de aplicar · INFO = dato (se compara con el postcheck).
-- No imprime filas de negocio: solo conteos y huellas.
-- ───────────────────────────────────────────────────────────────────────────
with
ab as (select id, numero_contrato, valor_abono, monto_cop from public.abonos),
h208 as (
  select to_regprocedure('f208_priv.abono_tiene_asiento(bigint)') is not null
     and to_regprocedure('f208_priv.actor(uuid,text[])') is not null as ok
),
h208b as (
  select to_regprocedure('f208_priv.bloquear_venta(text,text)') is not null
     and to_regprocedure('f208_priv.exigir_agencia(public.usuarios,text,text,text[])') is not null
     and to_regprocedure('f208_priv.factura_vigente_id(text)') is not null as ok
),
deps as (
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cotizacion_pagos_previos' and column_name = 'abono_id')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conciliacion_sistema' and column_name = 'ref') as ok
),
nueva as (
  select to_regclass('public.abonos_anulados') is null
     and to_regprocedure('public.anular_abono(bigint,text,text,uuid,text)') is null
     and to_regclass('public.abono_operaciones') is null
     and to_regprocedure('public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)') is null as ok
),
descuadre as (
  select count(*) as n from (select asiento_id from public.asiento_lineas group by asiento_id having sum(debe) <> sum(haber)) x
),
controles(orden, control, valor, esperado, estado) as (
  select 1, 'migracion_208_aplicada (guarda F4415 y helpers)', (select ok from h208)::text, 'true', case when (select ok from h208) then 'OK' else 'REVISAR' end
  union all
  select 2, 'helpers_208_que_usa_la_248 (bloquear_venta, exigir_agencia, factura_vigente_id)', (select ok from h208b)::text, 'true', case when (select ok from h208b) then 'OK' else 'REVISAR' end
  union all
  select 3, 'dependencias_presentes (cotizacion_pagos_previos.abono_id, conciliacion_sistema.ref)', (select ok from deps)::text, 'true', case when (select ok from deps) then 'OK' else 'REVISAR' end
  union all
  select 4, 'migracion_248_no_aplicada (sin abonos_anulados, abono_operaciones, anular_abono ni registrar_abono)', (select ok from nueva)::text, 'true', case when (select ok from nueva) then 'OK' else 'REVISAR' end
  union all
  select 5, 'abonos_total', (select count(*) from ab)::text, 'igual en el postcheck', 'INFO'
  union all
  select 6, 'abonos_con_asiento_propio (los que hoy no se pueden eliminar: F4415)',
         case when (select ok from h208) then (select count(*) from ab where f208_priv.abono_tiene_asiento(ab.id))::text else 'n/d' end, 'igual en el postcheck', 'INFO'
  union all
  select 7, 'asientos_origen_abono_total', (select count(*) from public.asientos_contables where origen = 'abono')::text, 'igual en el postcheck', 'INFO'
  union all
  select 8, 'libro_descuadrado_asientos (debe <> haber; debe ser 0)', (select n from descuadre)::text, '0', case when (select n from descuadre) = 0 then 'OK' else 'REVISAR' end
  union all
  select 9, 'huella_de_abonos_que_la_248_no_debe_tocar',
         md5(coalesce((select string_agg(id || ':' || numero_contrato || ':' || coalesce(valor_abono::text, '') || ':' || coalesce(monto_cop::text, ''), '|' order by id) from ab), '')),
         'igual en el postcheck', 'INFO'
)
select control, valor, esperado, estado from controles order by orden;
