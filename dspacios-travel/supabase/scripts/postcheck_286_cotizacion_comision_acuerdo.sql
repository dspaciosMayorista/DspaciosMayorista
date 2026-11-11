-- POSTCHECK de la migración 286 (acuerdo de comisión de la cotización dinámica, #97). Una consulta, un resultado, SIN ESCRIBIR NADA.
-- Columnas: control | observado | esperado | estado.  Última fila: VEREDICTO («CORRECTA» solo si no hay ninguna FALLA).
with fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig
  from pg_proc p
  where p.pronamespace = to_regnamespace('p97_priv')
     or (p.pronamespace = 'public'::regnamespace and p.proname in ('crear_cotizacion_manual_con_acuerdo', 'p97_regla_neto_activa', 'materializar_comision_b2b', 'p97_ciclo_comision_activo', 'p97_dependencias_comision_faltantes'))
),
v(orden, control, obs, esp, critico) as (
  values
    (1,  'tabla comision_plan existe con RLS activa',
         (select coalesce(bool_and(relrowsecurity), false)::text from pg_class where oid = to_regclass('public.comision_plan')), 'true', true),
    (2,  'columnas del plan (21: id, numero_contrato y contrato_uid incluidos)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'comision_plan'), '21', true),
    (3,  'restricciones CHECK de coherencia (bnc, base, ordinaria, total)',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.comision_plan') and contype = 'c'
            and conname in ('acuerdo97_bnc', 'acuerdo97_base', 'acuerdo97_ordinaria', 'acuerdo97_total')), '4', true),
    (4,  'anon y authenticated sin ningún privilegio sobre la tabla',
         (select (has_table_privilege('anon', 'public.comision_plan', 'select,insert,update,delete')
               or has_table_privilege('authenticated', 'public.comision_plan', 'select,insert,update,delete'))::text), 'false', true),
    (5,  'service_role solo lee (select sí; insert/update/delete no)',
         (select (has_table_privilege('service_role', 'public.comision_plan', 'select')
               and not has_table_privilege('service_role', 'public.comision_plan', 'insert,update,delete'))::text), 'true', true),
    (6,  'trigger de solo inserción en el acuerdo',
         (select count(*)::text from pg_trigger where tgrelid = to_regclass('public.comision_plan') and tgname = 'trg_acuerdo97_inmutable' and not tgisinternal), '1', true),
    (7,  'trigger de nueva versión en cotizaciones',
         (select count(*)::text from pg_trigger where tgrelid = 'public.cotizaciones'::regclass and tgname = 'trg_cot_acuerdo97' and not tgisinternal), '1', true),
    (8,  'funciones nuevas: 8 en p97_priv (importes, insertar_version, validar, aplicar, tg_nueva_version, tg_solo_insercion, es_posterior_al_corte, exige_acuerdo) + crear_cotizacion_manual_con_acuerdo + p97_regla_neto_activa + materializar_comision_b2b + p97_ciclo_comision_activo + p97_dependencias_comision_faltantes (17: p97_priv tiene 12, con materializar, ciclo_activo, dependencias_ciclo y exigir_dependencias)',
         (select count(*)::text from fn), '17', true),
    (9,  'SECURITY DEFINER con search_path fijo (public, pg_temp) en las 16 que leen o escriben datos (todas salvo tg_solo_insercion)',
         (select count(*)::text from fn where proname <> 'tg_solo_insercion' and prosecdef and proconfig @> array['search_path=public, pg_temp']), '16', true),
    (10, 'anon no ejecuta ninguna; authenticated solo materializar_comision_b2b (la llama la confirmación de #75 con la sesión de quien confirma)',
         (select coalesce(bool_or(has_function_privilege('anon', oid, 'execute') or (proname <> 'materializar_comision_b2b' and has_function_privilege('authenticated', oid, 'execute'))), false)::text from fn), 'false', true),
    (11, 'service_role ejecuta crear_cotizacion_manual_con_acuerdo, validar, aplicar, p97_regla_neto_activa, materializar_comision_b2b, p97_ciclo_comision_activo y p97_dependencias_comision_faltantes',
         (select count(*)::text from fn where proname in ('crear_cotizacion_manual_con_acuerdo', 'validar', 'aplicar', 'p97_regla_neto_activa', 'materializar_comision_b2b', 'p97_ciclo_comision_activo', 'p97_dependencias_comision_faltantes') and has_function_privilege('service_role', oid, 'execute')), '7', true),
    (12, 'service_role puede usar el esquema p97_priv', (select has_schema_privilege('service_role', 'p97_priv', 'usage')::text), 'true', true),
    (13, 'la envoltura de conversión llama validar y aplicar UNA vez cada una, y conserva las guardas de la 242',
         (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'convertir_cotizacion_manual_controlada'
            and (length(p.prosrc) - length(replace(p.prosrc, 'p97_priv.validar', ''))) = length('p97_priv.validar')
            and (length(p.prosrc) - length(replace(p.prosrc, 'p97_priv.aplicar', ''))) = length('p97_priv.aplicar')
            and p.prosrc like '%p40_exigir_cotizacion_vigente%' and p.prosrc like '%p50_priv.validar_conversion%' and p.prosrc like '%p50_priv.completar_conversion%'), '1', true),
    (14, 'la envoltura sigue siendo solo de service_role',
         (select (has_function_privilege('service_role', 'public.convertir_cotizacion_manual_controlada(bigint, uuid)', 'execute')
               and not has_function_privilege('authenticated', 'public.convertir_cotizacion_manual_controlada(bigint, uuid)', 'execute')
               and not has_function_privilege('anon', 'public.convertir_cotizacion_manual_controlada(bigint, uuid)', 'execute'))::text), 'true', true),
    (15, 'FASE 1 compatible: una sola fila de corte, exigencia APAGADA y corte aún sin fijar (nada exige acuerdo; el código viejo sigue convirtiendo)',
         (select (count(*) = 1 and bool_and(not exigir) and bool_and(cotizacion_id_max is null))::text from p97_priv.corte), 'true', true),
    -- Humo SIN escribir: ejecuta validar sobre una cotización inexistente (no hay acuerdo ni B2B que validar: sale sin error) y comprueba que importes exige la BNC.
    (16, 'humo · validar(-1) sale sin error',
         (select (xpath('//ok/text()', query_to_xml($q$select true as ok from (select p97_priv.validar(-1)) x$q$, false, true, '')))[1]::text), 'true', true),
    (17, 'importes exige la BNC explícita y aplica la regla del recobro (marcadores en el cuerpo)',
         (select (position('indica la base no comisionable' in p.prosrc) > 0 and position('v_rec_ali > 0' in p.prosrc) > 0)::text from pg_proc p
           where p.pronamespace = to_regnamespace('p97_priv') and p.proname = 'importes'), 'true', true),
    (18, 'aliados_b2b.pct_recobro_aliado ensanchada a numeric(25,20) (participación exacta en todo el rango monetario)',
         (select numeric_precision::text || ',' || numeric_scale::text from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b' and column_name = 'pct_recobro_aliado'), '25,20', true),
    (19, 'p50_priv.calcular (NETO) trae la regla del recobro por participación monetaria y el corte',
         (select (position('v_excl' in p.prosrc) > 0 and position('es_posterior_al_corte' in p.prosrc) > 0)::text from pg_proc p
           where p.pronamespace = to_regnamespace('p50_priv') and p.proname = 'calcular'), 'true', true),
    (20, 'INFO · acuerdos sellados hasta ahora (antes del primer uso deben ser 0)',
         (select count(*)::text from public.comision_plan), '0 antes del primer uso', false),
    (22, 'aplicar (conversión) LIGA el plan al contrato y no deja comisión exigible (retira la fila del recobro de esa conversión); la fila nace al confirmar',
         (select (position('insert into public.comision_plan' in p.prosrc) > 0 and position('delete from public.aliados_b2b' in p.prosrc) > 0 and position('comision_valor' in p.prosrc) = 0)::text from pg_proc p
           where p.pronamespace = to_regnamespace('p97_priv') and p.proname = 'aplicar'), 'true', true),
    (27, 'INFO · ciclo de vida de la comisión (interruptor explícito): un PENDIENTE es siempre plan + materialización al confirmar; el interruptor solo cambia lo ya confirmado/activo al nacer',
         (select case when p97_priv.ciclo_activo() then 'ENCENDIDO' else 'apagado' end), 'informativo', false),
    (28, 'FASE 1: el ciclo queda APAGADO al aplicar (se enciende solo con activar_286_ciclo_comision.sql, que exige las dependencias)',
         (select coalesce((select c.activo from p97_priv.ciclo c limit 1), true)::text), 'false', true),
    (29, 'INFO · dependencias del ciclo cumplidas / total (identidad 284, guarda sobre comision_plan, gancho 288)',
         (select count(*) filter (where cumplida)::text || ' / ' || count(*)::text from p97_priv.dependencias_ciclo()), 'informativo', false),
    (23, 'aliados_b2b.plan_id y su índice único (idempotencia de la materialización)',
         (select (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b' and column_name = 'plan_id')
              and to_regclass('public.aliados_b2b_plan_uq') is not null and to_regclass('public.plan97_cadena_uq') is not null)::text), 'true', true),
    (24, 'registrar_comision_b2b_reserva: PVP/comisionable registra el PLAN (no la fila exigible) y conserva la modalidad NETA descontada',
         (select (position('insert into public.comision_plan' in p.prosrc) > 0 and position($q$then 'pagada'$q$ in p.prosrc) > 0)::text from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_comision_b2b_reserva'), 'true', true),
    (25, 'materializar_comision_b2b: solo con contrato confirmado, sin duplicar (plan_id / mismo aliado) y verifica al centavo',
         (select (position($q$not in ('confirmado', 'activo')$q$ in p.prosrc) > 0 and position('plan_id is not null' in p.prosrc) > 0 and position('0.005' in p.prosrc) > 0 and position('contrato_uid = v.contrato_uid' in p.prosrc) > 0 and position('creado_en' in p.prosrc) = 0)::text from pg_proc p
           where p.pronamespace = to_regnamespace('p97_priv') and p.proname = 'materializar'), 'true', true),
    -- Misma huella que el preflight (fila 23): si coincide, la ampliación a numeric(25,20) no cambió NINGÚN valor existente. Solo válida si nadie escribió entre medio.
    (21, 'INFO · filas con pct_recobro_aliado | huella md5 de (id:valor) — debe ser IDÉNTICA a la del preflight',
         (select count(*) filter (where pct_recobro_aliado is not null)::text || ' | ' || coalesce(md5(string_agg(id::text || ':' || trim_scale(pct_recobro_aliado)::text, ',' order by id)), 'sin filas')
            from public.aliados_b2b where pct_recobro_aliado is not null), 'igual al preflight', false)
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when not critico then 'INFO' when obs is not distinct from esp then 'OK' else 'FALLA' end as estado
  from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'CORRECTA' else 'REVISAR / REVERTIR' end
order by orden;
