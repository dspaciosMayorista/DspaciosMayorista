-- POSTCHECK de la 312 (#126-A) — UNA sola consulta de SOLO LECTURA (pegar completa en el editor SQL). No escribe nada.
with c as (
  select 1 o, 'abonos.moneda_pago existe (text, nullable, sin default)' control,
         (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'abonos' and column_name = 'moneda_pago' and data_type = 'text' and is_nullable = 'YES' and column_default is null) valor, 1 esperado
  union all select 2, 'la restricción abonos_moneda_pago_check existe y solo admite COP, USD o NULL',
         (select count(*)::int from pg_constraint where conname = 'abonos_moneda_pago_check' and conrelid = 'public.abonos'::regclass and pg_get_constraintdef(oid) like '%COP%' and pg_get_constraintdef(oid) like '%USD%'), 1
  union all select 3, 'ningún valor fuera de COP/USD (la restricción lo impide)',
         (select count(*)::int from public.abonos where moneda_pago is not null and moneda_pago not in ('COP', 'USD')), 0
)
select control, valor, esperado, case when valor = esperado then 'OK' else 'REVISAR' end estado from c
union all select 'INFO · abonos con moneda_pago ya registrada (0 antes de desplegar el código nuevo; después, solo pagos nuevos; ningún abono previo se modifica)', (select count(*) from public.abonos where moneda_pago is not null), null, 'INFO'
order by 4, 1;
