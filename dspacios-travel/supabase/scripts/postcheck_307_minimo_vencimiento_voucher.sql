-- POSTCHECK de la 307 (#53) — UNA sola consulta de SOLO LECTURA, para correr DESPUÉS de aplicar la migración (y antes de desplegar el código).
--   OK = correcto · REVISAR = no desplegar el código hasta resolverlo.
with c as (
  select 1 o, 'tabla contrato_minimo_acuerdo con RLS activada' control, (select c.relrowsecurity::int from pg_class c where c.oid = to_regclass('public.contrato_minimo_acuerdo')) valor, 1 esperado
  union all select 2, 'tabla: triggers de solo inserción y de auditoría',
         (select count(*)::int from pg_trigger t where t.tgrelid = to_regclass('public.contrato_minimo_acuerdo') and not t.tgisinternal and t.tgname in ('trg_minimo_acuerdo_solo_insercion','trg_auditoria')), 2
  union all select 3, 'tabla: anon y authenticated sin escritura (insert/update/delete)',
         (select count(*)::int from information_schema.role_table_grants g where g.table_schema='public' and g.table_name='contrato_minimo_acuerdo' and g.grantee in ('anon','authenticated') and g.privilege_type in ('INSERT','UPDATE','DELETE')), 0
  union all select 4, 'regla_confirmacion SIN rama NETO y con acuerdo',
         (position('neto_total' in pg_get_functiondef('p75_priv.regla_confirmacion(text)'::regprocedure)) = 0 and position('contrato_minimo_acuerdo' in pg_get_functiondef('p75_priv.regla_confirmacion(text)'::regprocedure)) > 0)::int, 1
  union all select 5, 'liberar_vencidas conserva los pendientes con pagos',
         (position('conservadas_con_pago' in pg_get_functiondef('public.liberar_vencidas(date)'::regprocedure)) > 0 and position('abonos' in pg_get_functiondef('public.liberar_vencidas(date)'::regprocedure)) > 0)::int, 1
  union all select 6, 'fijar_minimo_confirmacion: ejecutable por authenticated, no por anon; exige superadmin dentro de la función',
         (has_function_privilege('authenticated','public.fijar_minimo_confirmacion(text,text,numeric,text,text)','execute')
          and not has_function_privilege('anon','public.fijar_minimo_confirmacion(text,text,numeric,text,text)','execute')
          and position('superadmin' in pg_get_functiondef('public.fijar_minimo_confirmacion(text,text,numeric,text,text)'::regprocedure)) > 0)::int, 1
  union all select 7, 'contratos_pagados_completos / contrato_pagado_completo: SOLO service_role',
         (has_function_privilege('service_role','public.contratos_pagados_completos(text[])','execute') and has_function_privilege('service_role','public.contrato_pagado_completo(text)','execute')
          and not has_function_privilege('anon','public.contratos_pagados_completos(text[])','execute') and not has_function_privilege('authenticated','public.contratos_pagados_completos(text[])','execute')
          and not has_function_privilege('anon','public.contrato_pagado_completo(text)','execute') and not has_function_privilege('authenticated','public.contrato_pagado_completo(text)','execute'))::int, 1
  union all select 8, 'estado_confirmacion_pago devuelve detalle solo a roles internos que ven el contrato',
         (position('detalle' in pg_get_functiondef('public.estado_confirmacion_pago(text)'::regprocedure)) > 0 and position('puede_ver_contrato' in pg_get_functiondef('public.estado_confirmacion_pago(text)'::regprocedure)) > 0)::int, 1
  union all select 9, 'la 307 no escribió datos: cero acuerdos y ningún contrato cambió de estado por ella (acuerdos = 0 justo tras aplicar)',
         (select count(*)::int from public.contrato_minimo_acuerdo), 0
  union all select 10, 'tabla clasificada como ESTRICTA en contrato_guardas_config (284)', (select count(*)::int from public.contrato_guardas_config where tabla = 'contrato_minimo_acuerdo' and modo = 'estricto'), 1
  union all select 11, 'guarda de identidad (trg_contrato_guarda) INSTALADA en la tabla',
         (select count(*)::int from pg_trigger t where t.tgrelid = to_regclass('public.contrato_minimo_acuerdo') and t.tgname = 'trg_contrato_guarda' and not t.tgisinternal), 1
  union all select 12, 'dtm_reuso_bloqueos = la de la 304 + la tabla nueva en preparación (md5 752e9eee…) y la menciona',
         (md5(replace((select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure), chr(13), '')) = '752e9eee5987f51c6a92a8e46750b953'
          and position('contrato_minimo_acuerdo' in pg_get_functiondef('public.dtm_reuso_bloqueos(text,boolean)'::regprocedure)) > 0)::int, 1
  union all select 13, 'ninguna tabla de contrato SIN clasificar (contrato_instalar_guardas() no abortaría)',
         (select count(*)::int from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
            where c.relkind in ('r','p') and c.relname <> 'contrato_minimo_acuerdo'
              and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero'))
                   or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass) or c.relname = 'ventas')
              and not exists (select 1 from public.contrato_guardas_config g where g.tabla = c.relname::text)), 0
  union all select 14, 'dtm_reuso_bloqueos conserva SECURITY DEFINER y no es ejecutable por anon/authenticated',
         ((select p.prosecdef from pg_proc p where p.oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure)
          and not has_function_privilege('anon','public.dtm_reuso_bloqueos(text,boolean)','execute') and not has_function_privilege('authenticated','public.dtm_reuso_bloqueos(text,boolean)','execute'))::int, 1
  union all select 15, 'verificación de identidad en fijar_minimo_confirmacion',
         (position('contrato_verificar_identidad' in pg_get_functiondef('public.fijar_minimo_confirmacion(text,text,numeric,text,text)'::regprocedure)) > 0)::int, 1
)
select control, valor, esperado, case when valor = esperado then 'OK' else 'REVISAR' end estado from c
union all select 'INFO · ciclo de comisión #97 sigue como estaba (1 = activo; en Producción debe seguir en 0)', p97_priv.ciclo_activo()::int, null, 'INFO'
union all select 'INFO · reuso de consecutivos habilitado: debe ser el MISMO valor que mostró el preflight (la 307 no lo toca)', coalesce((select c.habilitado::int from public.dtm_reuso_config c limit 1), -1), null, 'INFO'
order by 4, 1;
