-- POSTCHECK de la 313 (#126-A, F3) — UNA sola consulta de SOLO LECTURA (pegar completa en el editor SQL). No escribe nada.
with c as (
  select 1 o, 'public.registrar_abono_moneda(... , text) existe y es ejecutable SOLO por service_role (no por anon ni authenticated)' control,
         (select count(*)::int from pg_proc p where p.oid = to_regprocedure('public.registrar_abono_moneda(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid,text)')
             and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')) valor, 1 esperado
  union all select 2, 'la función no es SECURITY DEFINER y fija search_path vacío (corre con los permisos de quien la invoca)',
         (select count(*)::int from pg_proc p where p.oid = to_regprocedure('public.registrar_abono_moneda(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid,text)') and not p.prosecdef and 'search_path=""' = any(p.proconfig)), 1
  union all select 3, 'el disparador trg_f313_abonos_moneda existe en abonos (insert y update) y su función no es ejecutable por anon/authenticated',
         (select count(*)::int from pg_trigger t join pg_proc f on f.oid = t.tgfoid where t.tgname = 'trg_f313_abonos_moneda' and t.tgrelid = 'public.abonos'::regclass and not t.tgisinternal
             and not has_function_privilege('anon', f.oid, 'execute') and not has_function_privilege('authenticated', f.oid, 'execute')), 1
  union all select 4, 'public.registrar_abono (248/288) sigue existiendo: la 313 la envuelve, no la reemplaza',
         (to_regprocedure('public.registrar_abono(text,text,uuid,numeric,numeric,text,text,date,boolean,uuid)') is not null)::int, 1
)
select control, valor, esperado, case when valor = esperado then 'OK' else 'REVISAR' end estado from c
union all select 'INFO · abonos con moneda_pago registrada (solo pagos nuevos con el código nuevo)', (select count(*) from public.abonos where moneda_pago is not null), null, 'INFO'
union all select 'INFO · abonos sin moneda_pago (históricos o de contratos no cobrados en USD; se leen como pesos recibidos)', (select count(*) from public.abonos where moneda_pago is null), null, 'INFO'
order by 4, 1;
