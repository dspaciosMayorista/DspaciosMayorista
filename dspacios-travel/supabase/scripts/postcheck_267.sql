-- POSTCHECK 267 · solo lectura · UNA consulta con columna `estado` (pegar tal cual tras correr la 267). Todo debe dar OK.
select c.nombre, case when c.ok then 'OK' else 'FALLA' end as estado, c.detalle
  from (values
    ('existe el trigger de restricción DIFERIDO sobre aliados_b2b',
       (select count(*) = 1 from pg_trigger t where t.tgname = 'trg_recobro_beneficiario_explicito' and t.tgrelid = 'public.aliados_b2b'::regclass
          and t.tgdeferrable and t.tginitdeferred and t.tgenabled = 'O' and t.tgconstraint <> 0), 'after insert, deferrable initially deferred, habilitado'),
    ('la función existe, es SECURITY DEFINER y fija search_path',
       (select count(*) = 1 from pg_proc p where p.proname = 'fn_recobro_beneficiario_explicito' and p.pronamespace = 'public'::regnamespace
          and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=public, pg_temp%'), 'search_path = public, pg_temp'),
    ('anon, authenticated y public NO ejecutan la función',
       coalesce(not has_function_privilege('anon', to_regprocedure('public.fn_recobro_beneficiario_explicito()')::oid, 'execute'), false)
         and coalesce(not has_function_privilege('authenticated', to_regprocedure('public.fn_recobro_beneficiario_explicito()')::oid, 'execute'), false), 'revoke all aplicado'),
    ('convertir_cotizacion_a_contrato sigue existiendo (la 267 no la reemplaza)',
       exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'convertir_cotizacion_a_contrato'), 'sin cambios en la función vigilada')
  ) as c(nombre, ok, detalle)
order by 1;
