-- PREFLIGHT 343 (#11 presencia reciente + #13 avisos de compra en la campana) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 343 (y DESPUÉS de la 340 del bloque CRM si esa se aplica).
with t as (
  select to_regclass('public.auditoria') as aud,
         to_regclass('public.usuarios') as usr,
         to_regclass('public.avisos') as avi,
         to_regclass('public.config_notificaciones') as cfg,
         to_regprocedure('public.mi_rol()') as mirol,
         to_regprocedure('public.fecha_negocio(timestamp with time zone)') as fneg,
         to_regclass('auth.users') as authu,
         to_regclass('public.presencia_usuario') as pres,
         to_regprocedure('public.registrar_presencia()') as fn_pres,
         to_regprocedure('public.generar_avisos_compra(date,integer)') as fn_gen,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name in ('ventana_tipo', 'ventana_id', 'ventana_ref', 'ventana_titulo', 'compra_fin'))::int as cols_ventana,
         (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check') as chk,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'usuarios' and column_name in ('id', 'nombre', 'email', 'rol', 'tenant', 'activo', 'aliado_id'))::int as cols_usr,
         (select count(*) from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'last_sign_in_at')::int as cols_auth,
         (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'auditoria' and indexname = 'idx_auditoria_creado_en')::int as idx_aud,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         (select count(*) from public.avisos)::int as n_avisos,
         (select count(*) from public.usuarios where activo is true and rol::text = 'superadmin')::int as n_super
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Existen auditoria (087), usuarios, avisos (281), config_notificaciones (062) y auth.users' as control, coalesce(aud::text, 'falta auditoria') || ' / ' || coalesce(usr::text, 'falta usuarios') || ' / ' || coalesce(avi::text, 'falta avisos') || ' / ' || coalesce(cfg::text, 'falta config') || ' / ' || coalesce(authu::text, 'falta auth.users') as observado, 'las cinco existen' as esperado, case when aud is not null and usr is not null and avi is not null and cfg is not null and authu is not null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'Existen public.mi_rol() y public.fecha_negocio() (198)', coalesce(mirol::text, 'falta mi_rol') || ' / ' || coalesce(fneg::text, 'falta fecha_negocio'), 'ambas existen', case when mirol is not null and fneg is not null then 'OK' else 'REVISAR' end from t
  union all select 3, 'Aún NO existen presencia_usuario, registrar_presencia ni generar_avisos_compra (existen si la 343 ya se corrió)', coalesce(pres::text, '-') || ' / ' || coalesce(fn_pres::text, '-') || ' / ' || coalesce(fn_gen::text, '-'), 'ninguna existe antes de la 343', case when pres is null and fn_pres is null and fn_gen is null then 'OK' else 'REVISAR' end from t
  union all select 4, 'avisos aún NO tiene las 5 columnas de ventana de compra', cols_ventana::text, '0', case when cols_ventana = 0 then 'OK' else 'REVISAR' end from t
  union all select 5, 'El CHECK avisos_tipo_check existe y aún NO admite compra_por_vencer (la 343 lo amplía conservando los tipos actuales)', coalesce(chk, 'no existe'), 'existe sin compra_por_vencer', case when chk is not null and chk not like '%compra_por_vencer%' then 'OK' else 'REVISAR' end from t
  union all select 6, 'usuarios tiene las 7 columnas que lee la función', cols_usr::text, '7', case when cols_usr = 7 then 'OK' else 'REVISAR' end from t
  union all select 7, 'auth.users tiene last_sign_in_at', cols_auth::text, '1', case when cols_auth = 1 then 'OK' else 'REVISAR' end from t
  union all select 8, 'Existe el índice idx_auditoria_creado_en (la lectura por ventana lo usa)', idx_aud::text, '1', case when idx_aud = 1 then 'OK' else 'REVISAR' end from t
  union all select 9, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
  union all select 10, 'INFO: avisos existentes (no se tocan) / superadmin activos que verán la presencia', n_avisos::text || ' / ' || n_super::text, 'n/a', 'INFO' from t
) r order by orden;
