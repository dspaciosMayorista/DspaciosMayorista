-- PREFLIGHT 342 (#76: código de referido en el registro B2B) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 342 (y después de 340 y 341).
with t as (
  select to_regprocedure('public.registro_b2b_completar(uuid,jsonb)') as fn_comp,
         to_regclass('public.b2b_solicitudes') as sol,
         to_regclass('public.referidor_codigos') as codigos,
         to_regprocedure('public.referido_asignar(uuid,bigint,bigint,numeric,text)') as fn_asignar,
         to_regprocedure('public.aprobar_solicitud_b2b(bigint,text,bigint)') as fn_aprobar,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'b2b_solicitudes' and column_name in ('codigo_referido', 'referido_estado', 'referido_decidido_por', 'referido_decidido_en'))::int as cols_nuevas,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('referido_decidir_solicitud', 'referidos_candidatos'))::int as fns_nuevas,
         (select prosecdef from pg_proc where oid = to_regprocedure('public.registro_b2b_completar(uuid,jsonb)')) as completar_definer,
         (select count(*) from public.b2b_solicitudes)::int as n_solicitudes,
         (select count(*) from public.b2b_solicitudes where estado = 'pendiente')::int as n_pendientes
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existe registro_b2b_completar (324) y es SECURITY DEFINER' as control, coalesce(fn_comp::text, 'no existe') || ' / definer=' || coalesce(completar_definer::text, '-') as observado, 'existe / definer=true' as esperado, case when fn_comp is not null and completar_definer is true then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existe b2b_solicitudes y aprobar_solicitud_b2b (193/237)', coalesce(sol::text, 'falta') || ' / ' || coalesce(fn_aprobar::text, 'falta'), 'ambas existen', case when sol is not null and fn_aprobar is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'La 341 está aplicada (referidor_codigos y referido_asignar existen) — van en este orden', coalesce(codigos::text, 'falta') || ' / ' || coalesce(fn_asignar::text, 'falta'), 'ambas existen', case when codigos is not null and fn_asignar is not null then 'OK' else 'REVISAR' end from t
  union all select 4, 'Aún NO existen las 4 columnas nuevas ni las 2 funciones nuevas', cols_nuevas::text || ' columnas / ' || fns_nuevas::text || ' funciones', '0 / 0', case when cols_nuevas = 0 and fns_nuevas = 0 then 'OK' else 'REVISAR' end from t
  union all select 5, 'INFO: registros existentes (quedarán «sin_codigo»; no hay backfill) / pendientes de aprobar', n_solicitudes::text || ' / ' || n_pendientes::text, 'n/a', 'INFO' from t
) r order by orden;
