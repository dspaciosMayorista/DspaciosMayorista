-- PREFLIGHT de la 313 (#126-A, F3) — UNA sola consulta de SOLO LECTURA (pegar completa en el editor SQL). No escribe nada.
--   OK = listo · REVISAR = detener y revisar antes de aplicar · INFO = dato para decidir/avisar.
with c as (
  select 1 o, 'la 312 está aplicada (abonos.moneda_pago existe) — la 313 se aplica DESPUÉS de ella' control,
         (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'abonos' and column_name = 'moneda_pago') valor, 1 esperado
  union all select 2, 'public.registrar_abono(...) de la 248/288 existe (la 313 la envuelve, no la reemplaza)',
         (to_regprocedure('public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)') is not null)::int, 1
  union all select 3, 'public.contrato_verificar_identidad(text,boolean) existe (284)',
         (to_regprocedure('public.contrato_verificar_identidad(text,boolean)') is not null)::int, 1
  union all select 4, 'la 313 NO está aplicada todavía (no existe registrar_abono_moneda)',
         (to_regprocedure('public.registrar_abono_moneda(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid,text)') is not null)::int, 0
  union all select 5, 'el disparador trg_f313_abonos_moneda no existe todavía',
         (select count(*)::int from pg_trigger where tgname = 'trg_f313_abonos_moneda' and not tgisinternal), 0
  union all select 6, 'ningún abono tiene ya una moneda_pago fuera de COP/USD',
         (select count(*)::int from public.abonos where moneda_pago is not null and moneda_pago not in ('COP', 'USD')), 0
)
select control, valor, esperado, case when valor = esperado then 'OK' else 'REVISAR' end estado from c
union all select 'INFO · abonos con moneda_pago ya registrada (se conservan tal cual; la 313 no toca ningún abono existente)', (select count(*) from public.abonos where moneda_pago is not null), null, 'INFO'
order by 4, 1;
