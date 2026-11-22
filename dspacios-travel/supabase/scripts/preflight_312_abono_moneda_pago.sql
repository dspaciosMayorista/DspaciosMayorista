-- PREFLIGHT de la 312 (#126-A) — UNA sola consulta de SOLO LECTURA (pegar completa en el editor SQL). No escribe nada.
--   OK = listo · REVISAR = detener y revisar antes de aplicar · INFO = dato para decidir/avisar.
with c as (
  select 1 o, 'public.abonos existe con valor_abono, monto_cop y trm (la 312 añade moneda_pago junto a ellas)' control,
         (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'abonos' and column_name in ('valor_abono', 'monto_cop', 'trm')) valor, 3 esperado
  union all select 2, 'la 312 NO está aplicada todavía (no existe abonos.moneda_pago)',
         (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'abonos' and column_name = 'moneda_pago'), 0
  union all select 3, 'las migraciones 307–311 están aplicadas por OBJETO (contrato_minimo_acuerdo y contratos_pagados_completos de la 307)',
         (to_regclass('public.contrato_minimo_acuerdo') is not null and to_regprocedure('public.contratos_pagados_completos(text[])') is not null)::int, 1
  union all select 4, 'la restricción abonos_moneda_pago_check no existe todavía',
         (select count(*)::int from pg_constraint where conname = 'abonos_moneda_pago_check'), 0
)
select control, valor, esperado, case when valor = esperado then 'OK' else 'REVISAR' end estado from c
union all select 'INFO · abonos existentes que quedarán con moneda_pago NULL (se interpretan como pesos recibidos, igual que hoy)', (select count(*) from public.abonos), null, 'INFO'
order by 4, 1;
