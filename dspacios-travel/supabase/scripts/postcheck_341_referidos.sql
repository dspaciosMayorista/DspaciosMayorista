-- POSTCHECK 341 (#76 referidos) — UNA sola consulta, SOLO LECTURA. Correr DESPUÉS de la 341.
with t as (
  select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('referidores', 'referidor_codigos', 'aliado_referidores', 'contrato_referidos') and c.relkind = 'r')::int as tablas,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('referidores', 'referidor_codigos', 'aliado_referidores', 'contrato_referidos') and c.relrowsecurity)::int as con_rls,
         (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('referidores', 'referidor_codigos', 'aliado_referidores', 'contrato_referidos'))::int as politicas,
         (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('referidores', 'referidor_codigos', 'aliado_referidores', 'contrato_referidos') and grantee in ('anon', 'authenticated', 'public'))::int as grants_ajenos,
         (select count(*) from pg_trigger where tgname in ('trg_f341_atribuir_ins', 'trg_f341_atribuir_upd', 'trg_f341_limpiar') and not tgisinternal)::int as triggers,
         (select count(*) from pg_trigger t2 join pg_class c on c.oid = t2.tgrelid where t2.tgname = 'trg_auditoria' and c.relname in ('referidores', 'referidor_codigos', 'aliado_referidores', 'contrato_referidos'))::int as auditoria,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('referidor_guardar', 'referidor_codigo_definir', 'referido_asignar', 'referido_aplicar_codigo', 'referido_quitar', 'referidos_contratos', 'referidos_catalogo') and p.prosecdef)::int as fns_definer,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('referidor_guardar', 'referidor_codigo_definir', 'referido_asignar', 'referido_aplicar_codigo', 'referido_quitar', 'referidos_contratos', 'referidos_catalogo') and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute'))::int as fns_solo_servicio,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'f341_priv' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))::int as priv_expuestas,
         (select count(*) from pg_constraint where conrelid = 'public.aliado_referidores'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%0.01%' and pg_get_constraintdef(oid) like '%0.02%')::int as check_pct,
         (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'aliado_referidores_vigente_uq')::int as uq_vigente,
         (select count(*) from public.referidores)::int + (select count(*) from public.aliado_referidores)::int + (select count(*) from public.contrato_referidos)::int as filas
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existen las 4 tablas' as control, tablas::text as observado, '4' as esperado, case when tablas = 4 then 'OK' else 'FALLO' end as estado from t
  union all select 2, 'RLS activa en las 4 y SIN políticas (solo service_role entra por las funciones)', con_rls::text || ' con RLS / ' || politicas::text || ' políticas', '4 / 0', case when con_rls = 4 and politicas = 0 then 'OK' else 'FALLO' end from t
  union all select 3, 'anon, authenticated y public SIN permisos sobre las tablas', grants_ajenos::text, '0', case when grants_ajenos = 0 then 'OK' else 'FALLO' end from t
  union all select 4, 'Los 3 triggers de atribución sobre ventas', triggers::text, '3', case when triggers = 3 then 'OK' else 'FALLO' end from t
  union all select 5, 'Auditoría genérica en las 4 tablas', auditoria::text, '4', case when auditoria = 4 then 'OK' else 'FALLO' end from t
  union all select 6, 'Las 7 funciones públicas son SECURITY DEFINER y solo service_role las ejecuta', fns_definer::text || ' definer / ' || fns_solo_servicio::text || ' solo servicio', '7 / 7', case when fns_definer = 7 and fns_solo_servicio = 7 then 'OK' else 'FALLO' end from t
  union all select 7, 'Las funciones del esquema privado no son ejecutables por anon ni authenticated', priv_expuestas::text, '0', case when priv_expuestas = 0 then 'OK' else 'FALLO' end from t
  union all select 8, 'La tarifa solo puede ser 1 % o 2 % (CHECK en la tabla de asignaciones)', check_pct::text, '1', case when check_pct >= 1 then 'OK' else 'FALLO' end from t
  union all select 9, 'Una sola asignación vigente por aliado y agencia (índice único parcial)', uq_vigente::text, '1', case when uq_vigente = 1 then 'OK' else 'FALLO' end from t
  union all select 10, 'Sin backfill: las tablas nacen vacías (hasta que gerencia asigne)', filas::text, '0 justo tras aplicar', case when filas = 0 then 'OK' else 'INFO' end from t
) r order by orden;
