-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 210 · cierre de K15. SOLO LECTURA (catálogo; ROLLBACK).
-- Correr DESPUÉS de aplicar la 210. Cada fila: código | ok | detalle. Todas deben ser true.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
reg as (select 'public.registrar_financiero_contrato(text,text,jsonb,jsonb)'::regprocedure as p),
rev as (select 'public.revertir_contrato_incompleto(text,text)'::regprocedure as p),
c as (
  select 'C1' as codigo,
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_registrado_en' and data_type = 'timestamp with time zone') as ok,
         'ventas.financiero_registrado_en existe (timestamptz)' as detalle
  union all
  select 'C2', to_regclass('public.asientos_contables_cxp_referencia_uk') is not null
               and (select indisunique from pg_index where indexrelid = 'public.asientos_contables_cxp_referencia_uk'::regclass),
         'Índice único asientos_contables_cxp_referencia_uk presente (un asiento por CxP)'
  union all
  select 'C3', (select format_type(prorettype, null) = 'jsonb' from pg_proc, reg where oid = reg.p)
               and (select format_type(prorettype, null) = 'jsonb' from pg_proc, rev where oid = rev.p),
         'Las dos RPC devuelven jsonb (revertir cambió de void)'
  union all
  select 'C4', (select prosrc ~ 'ya_completo' and prosrc ~ 'financiero_registrado_en' from pg_proc, reg where oid = reg.p)
               and (select prosrc ~ 'ya_completo' and prosrc ~ 'financiero_registrado_en' from pg_proc, rev where oid = rev.p),
         'Las definiciones contienen la guarda de la 210 (ya_completo / financiero_registrado_en)'
  union all
  select 'C5', bool_and(has_function_privilege('service_role', x.p, 'execute')
                        and not has_function_privilege('authenticated', x.p, 'execute')
                        and not has_function_privilege('anon', x.p, 'execute')
                        and not has_function_privilege('public', x.p, 'execute')),
         'ACL efectivo de las dos RPC: solo service_role'
    from (select p from reg union all select p from rev) x
  union all
  select 'C6', bool_and(prosecdef and proconfig::text ~ 'pg_temp'),
         'Las dos RPC son SECURITY DEFINER con search_path que incluye pg_temp (al final)'
    from pg_proc where oid in (select p from reg union all select p from rev)
  union all
  select 'C7', exists (select 1 from pg_trigger g where g.tgname = 'trg_contrato_financiero_pendiente_guarda' and g.tgrelid = 'public.contrato_financiero_pendiente'::regclass and g.tgenabled = 'O' and (g.tgtype & 2) = 2 and (g.tgtype & 4) = 4)
               and (select not prosecdef from pg_proc where oid = 'public.contrato_financiero_pendiente_guarda()'::regprocedure),
         'Guarda del pendiente: trigger BEFORE INSERT habilitado y función SECURITY INVOKER (anon/authenticated reciben el 42501 de RLS)'
  union all
  select 'C8', not has_function_privilege('anon', 'public.contrato_financiero_pendiente_guarda()', 'execute')
               and not has_function_privilege('authenticated', 'public.contrato_financiero_pendiente_guarda()', 'execute'),
         'La función de la guarda no es invocable por la API'
  union all
  select 'C9', (select relrowsecurity from pg_class where oid = 'public.contrato_financiero_pendiente'::regclass)
               and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'contrato_financiero_pendiente'),
         'contrato_financiero_pendiente: RLS activa y sin policies (solo service_role)'
  union all
  select 'C10', not exists (select 1 from public.contrato_financiero_pendiente p join public.ventas v on v.numero_contrato = p.numero_contrato where v.financiero_estado = 'completo' and v.financiero_registrado_en is not null),
         'Ningún contrato completado por la RPC conserva fila en contrato_financiero_pendiente (residuo)'
)
select codigo, ok, detalle from (
  select codigo, ok, detalle, 0 as o from c
  union all
  select 'VEREDICTO', bool_and(ok), case when bool_and(ok) then 'POSTCHECK 210: OK' else 'POSTCHECK 210: HAY FALLAS' end, 1 from c
) z order by o, length(codigo), codigo;

rollback;
