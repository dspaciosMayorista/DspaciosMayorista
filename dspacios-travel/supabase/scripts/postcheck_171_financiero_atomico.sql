-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK de la migración 171 (escritura financiera atómica del contrato).
-- SOLO LECTURA. Correr DESPUÉS de aplicar la 171.
--
-- Verifica lo que la migración PROMETE, no solo que "no falló":
--   A) las dos funciones existen con la firma exacta que llama la app;
--   B) son SECURITY DEFINER con `search_path` fijo y `pg_temp` al final;
--   C) los permisos: revocadas de public/anon/authenticated, otorgadas SOLO
--      a service_role (las invoca el servidor con el cliente admin);
--   D) la marca de CxP automática coincide EXACTAMENTE con la que escribe la
--      app (`observaciones`) — si divergen, un reintento no reemplazaría
--      nada y duplicaría las cuentas por pagar;
--   E) la 171 no tocó datos al aplicarse (no es una migración de backfill).
-- ───────────────────────────────────────────────────────────────────────────

\echo '=== A) firmas exactas ==='
select
  to_regprocedure('public.registrar_financiero_contrato(text, text, jsonb, jsonb)') is not null as registrar_ok,
  to_regprocedure('public.revertir_contrato_incompleto(text, text)')                is not null as revertir_ok,
  to_regprocedure('public.marca_cxp_automatica()')                                  is not null as marca_ok;
\echo 'esperado: t | t | t'

\echo '=== B) SECURITY DEFINER + search_path fijo ==='
select
  p.proname,
  p.prosecdef                                   as security_definer,
  array_to_string(p.proconfig, ', ')            as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('registrar_financiero_contrato','revertir_contrato_incompleto')
order by p.proname;
\echo 'esperado: las dos con security_definer = t y config = search_path=public, pg_temp'

\echo '=== C) permisos: solo service_role ejecuta ==='
select
  p.proname,
  has_function_privilege('anon',          p.oid, 'execute') as anon,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
  has_function_privilege('service_role',  p.oid, 'execute') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('registrar_financiero_contrato','revertir_contrato_incompleto')
order by p.proname;
\echo 'esperado: anon = f | authenticated = f | service_role = t (en las dos)'

\echo '=== D) la marca de CxP automática es la misma que escribe la app ==='
select
  public.marca_cxp_automatica() as marca,
  public.marca_cxp_automatica() = 'Generado automáticamente desde el tarifario' as coincide_con_la_app;
\echo 'esperado: coincide_con_la_app = t (constante OBS_AUTO en reservar/actions.ts)'

\echo '=== E) la migración no tocó datos ==='
select
  (select count(*) from public.ventas)             as ventas,
  (select count(*) from public.cuentas_por_pagar)  as cuentas_por_pagar;
\echo 'esperado: los mismos conteos que antes de aplicarla (la 171 solo crea funciones)'
