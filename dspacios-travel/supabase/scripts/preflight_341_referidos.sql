-- PREFLIGHT 341 (#76 referidos) — UNA sola consulta, SOLO LECTURA. Correr ANTES de la 341 (y después de la 340).
with t as (
  select to_regclass('public.referidores') as referidores,
         to_regclass('public.aliado_referidores') as asign,
         to_regclass('public.contrato_referidos') as foto,
         to_regclass('public.aliados') as aliados,
         to_regclass('public.usuarios') as usuarios,
         to_regclass('public.ventas') as ventas,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name in ('contrato_uid', 'aliado_id', 'b2b_usuario_id', 'precio_venta', 'impuesto', 'moneda', 'estado', 'comision_estado', 'tenant', 'created_at'))::int as cols_ventas,
         to_regprocedure('public.contratos_pagados_completos(text[])') as fn_pagado,
         to_regprocedure('public.fn_auditoria()') as fn_aud,
         to_regprocedure('public.avisos_recientes(uuid,integer)') as fn_340,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('referidor_guardar', 'referidor_codigo_definir', 'referido_asignar', 'referido_aplicar_codigo', 'referido_quitar', 'referidos_contratos', 'referidos_catalogo'))::int as fns_nuevas,
         (select count(*) from pg_trigger where tgname like 'trg_f341_%')::int as triggers_nuevos,
         (select count(*) from pg_namespace where nspname = 'f341_priv')::int as esquema_priv,
         (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))::int as roles,
         (select count(*) from public.ventas where contrato_uid is null)::int as ventas_sin_uid,
         (select count(*) from public.usuarios where activo and rol in ('superadmin', 'gerencia'))::int as gestores
)
select orden, control, observado, esperado, estado from (
  select 1 as orden, 'Ninguna tabla de la 341 existe todavía' as control, coalesce(referidores::text, '-') || ' / ' || coalesce(asign::text, '-') || ' / ' || coalesce(foto::text, '-') as observado, 'ninguna existe' as esperado, case when referidores is null and asign is null and foto is null then 'OK' else 'REVISAR' end as estado from t
  union all select 2, 'No existen las funciones, triggers ni el esquema privado de la 341', fns_nuevas::text || ' funciones / ' || triggers_nuevos::text || ' triggers / ' || esquema_priv::text || ' esquema', '0 / 0 / 0', case when fns_nuevas = 0 and triggers_nuevos = 0 and esquema_priv = 0 then 'OK' else 'REVISAR' end from t
  union all select 3, 'Existen aliados, usuarios y ventas', coalesce(aliados::text, 'falta') || ' / ' || coalesce(usuarios::text, 'falta') || ' / ' || coalesce(ventas::text, 'falta'), 'las tres existen', case when aliados is not null and usuarios is not null and ventas is not null then 'OK' else 'REVISAR' end from t
  union all select 4, 'ventas tiene las 10 columnas que usa la atribución', cols_ventas::text, '10', case when cols_ventas = 10 then 'OK' else 'REVISAR' end from t
  union all select 5, 'Existen contratos_pagados_completos (307) y fn_auditoria (087)', coalesce(fn_pagado::text, 'falta') || ' / ' || coalesce(fn_aud::text, 'falta'), 'ambas existen', case when fn_pagado is not null and fn_aud is not null then 'OK' else 'REVISAR' end from t
  union all select 6, 'La 340 ya está aplicada (avisos_recientes existe) — van en este orden', coalesce(fn_340::text, 'no existe'), 'existe', case when fn_340 is not null then 'OK' else 'REVISAR' end from t
  union all select 7, 'Existen los roles anon, authenticated y service_role', roles::text, '3', case when roles = 3 then 'OK' else 'REVISAR' end from t
  union all select 8, 'Todas las ventas tienen contrato_uid (la foto de atribución se identifica por él)', ventas_sin_uid::text, '0', case when ventas_sin_uid = 0 then 'OK' else 'REVISAR' end from t
  union all select 9, 'INFO: usuarios activos que podrán gestionar referidos (superadmin y gerencia)', gestores::text, 'n/a', 'INFO' from t
) r order by orden;
