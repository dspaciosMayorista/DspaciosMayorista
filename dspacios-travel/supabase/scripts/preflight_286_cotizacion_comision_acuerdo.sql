-- PREFLIGHT de la migración 286 (acuerdo de comisión de la cotización dinámica, #97). SOLO LECTURA: una consulta, un resultado.
-- Columnas: control | observado | esperado | estado.  estado: OK / FALLA (bloquea) / INFO (contexto, no bloquea).
-- Última fila: veredicto («LISTO PARA APLICAR» solo si no hay ninguna FALLA).
with v(orden, control, obs, esp, critico) as (
  values
    (1,  'tabla public.cotizaciones existe',        (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'cotizaciones'), '1', true),
    (2,  'cotizaciones: columnas que usa el acuerdo (10)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones'
            and column_name in ('id', 'tenant', 'tipo', 'modo', 'payload', 'precio_venta', 'moneda', 'economico_rev', 'cotizacion_origen_id', 'paquete_din_id')), '10', true),
    (3,  'cotizaciones.aliado_id existe (211)',      (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name = 'aliado_id'), '1', true),
    (4,  'tablas public.aliados, ventas, aliados_b2b, parametros_tributarios existen',
         (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name in ('aliados', 'ventas', 'aliados_b2b', 'parametros_tributarios')), '4', true),
    (5,  'aliados: columnas que lee el acuerdo (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'aliados'
            and column_name in ('id', 'nombre', 'nit', 'tipo', 'pct_comision', 'aplica_retencion', 'pct_retencion')), '7', true),
    (6,  'aliados_b2b: columnas que escribe la conversión (14)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b'
            and column_name in ('numero_contrato', 'tenant', 'aliado', 'nit', 'tipo_aliado', 'aliado_id', 'precio_venta', 'base_comision', 'base_explicita',
                                'pct_comision', 'comision_valor', 'recobro_total', 'pct_recobro_aliado', 'descontada_en_precio')), '14', true),
    (7,  'ventas: columnas que completa la conversión (aliado_id, tipo_asesor, moneda, precio_venta, tenant, updated_at)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ventas'
            and column_name in ('aliado_id', 'tipo_asesor', 'moneda', 'precio_venta', 'tenant', 'updated_at')), '6', true),
    (8,  'crear_cotizacion_manual(uuid, text, jsonb, jsonb) existe (216)',
         (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'crear_cotizacion_manual'
            and pg_get_function_identity_arguments(p.oid) = 'p_usuario_id uuid, p_tenant text, p_cabecera jsonb, p_servicios jsonb'), '1', true),
    (9,  'envoltura convertir_cotizacion_manual_controlada(bigint, uuid) existe',
         (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'convertir_cotizacion_manual_controlada'
            and pg_get_function_identity_arguments(p.oid) = 'p_cotizacion_id bigint, p_usuario_id uuid'), '1', true),
    (10, 'la envoltura vigente es la de la 242 (llama validar_conversion y completar_conversion, sin p97_priv todavía)',
         (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'convertir_cotizacion_manual_controlada'
            and p.prosrc like '%p50_priv.validar_conversion%' and p.prosrc like '%p50_priv.completar_conversion%' and p.prosrc like '%p40_exigir_cotizacion_vigente%'
            and p.prosrc not like '%p97_priv%'), '1', true),
    (11, 'p50_priv.validar_conversion y completar_conversion existen',
         (select count(*)::text from pg_proc p where p.pronamespace = 'p50_priv'::regnamespace and p.proname in ('validar_conversion', 'completar_conversion')), '2', true),
    (12, 'rol de base service_role existe', (select count(*)::text from pg_roles where rolname = 'service_role'), '1', true),
    (13, 'el esquema p97_priv NO existe todavía', (select count(*)::text from pg_namespace where nspname = 'p97_priv'), '0', true),
    (14, 'la tabla comision_plan NO existe todavía',
         (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'comision_plan'), '0', true),
    (15, 'la función crear_cotizacion_manual_con_acuerdo NO existe todavía',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'crear_cotizacion_manual_con_acuerdo'), '0', true),
    (16, 'INFO · mayor id de cotización hoy (la 286 NO fija corte al aplicar; el corte definitivo se fija en la fase 3 al activar)',
         (select coalesce(max(id), 0)::text from public.cotizaciones), 'informativo', false),
    (17, 'INFO · cotizaciones dinámicas B2B abiertas sin acuerdo (la 286 no las bloquea; quedarán históricas al activar)',
         (select count(*)::text from public.cotizaciones where tipo = 'manual' and modo = 'simple' and estado = 'abierta'
            and coalesce(payload ->> 'tipoAsesor', 'interno') in ('agencia', 'freelance')), 'informativo', false),
    (18, 'INFO · aliados sin porcentaje propio (usarán el parámetro general o el 12 % / 11 %)',
         (select count(*)::text from public.aliados where pct_comision is null), 'informativo', false),
    (19, 'INFO · parámetros COMISION_AGENCIA / COMISION_FREELANCE definidos',
         (select count(*)::text from public.parametros_tributarios where parametro in ('COMISION_AGENCIA', 'COMISION_FREELANCE')), 'informativo', false),
    (21, 'p50_priv.calcular existe (se reemplaza por la regla del recobro por participación monetaria)',
         (select count(*)::text from pg_proc where pronamespace = to_regnamespace('p50_priv') and proname = 'calcular'), '1', true),
    (20, 'INFO · aliados_b2b.pct_recobro_aliado (precisión,escala) antes: 5,4 → la migración la ensancha a 25,20',
         (select numeric_precision::text || ',' || numeric_scale::text from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b' and column_name = 'pct_recobro_aliado'), '5,4', false),
    -- ALTER TYPE falla si una vista/regla depende de la columna: se comprueba ANTES de aplicar (0 = el ensanchamiento no se bloquea).
    (22, 'ninguna vista/regla depende de aliados_b2b.pct_recobro_aliado (el ALTER TYPE no se bloquea)',
         (select count(*)::text from pg_depend d join pg_rewrite w on w.oid = d.objid join pg_class c on c.oid = w.ev_class
           where d.refobjid = 'public.aliados_b2b'::regclass
             and d.refobjsubid = (select attnum from pg_attribute where attrelid = 'public.aliados_b2b'::regclass and attname = 'pct_recobro_aliado')
             and c.oid <> 'public.aliados_b2b'::regclass), '0', true),
    (28, 'identidad de contrato de #75 (284): ventas.contrato_uid existe (el plan se liga por identidad, no por número ni por fecha)',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid'), '1', true),
    (29, 'INFO · gancho único de confirmación de #75 (288): presente o ausente. La 286 se aplica igual y deja el ciclo APAGADO; el ciclo solo se enciende con activar_286_ciclo_comision.sql (exige la 288)',
         (select (to_regprocedure('p75_priv.materializar_obligaciones(text)') is not null)::text), 'informativo', false),
    (25, 'la función materializar_comision_b2b NO existe todavía',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'materializar_comision_b2b'), '0', true),
    (26, 'la RPC registrar_comision_b2b_reserva vigente es la de la 205 (inserta la fila; aún sin plan)',
         (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_comision_b2b_reserva'
            and p.prosrc like '%insert into public.aliados_b2b%' and p.prosrc not like '%comision_plan%'), '1', true),
    (27, 'aliados_b2b.plan_id NO existe todavía',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b' and column_name = 'plan_id'), '0', true),
    (24, 'la función p97_regla_neto_activa NO existe todavía',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'p97_regla_neto_activa'), '0', true),
    -- Huella de CONSERVACIÓN: el mismo cálculo se repite en el postcheck (valor numérico sin ceros finales). Deben ser idénticas si nadie escribió entre medio.
    (23, 'INFO · filas con pct_recobro_aliado | huella md5 de (id:valor) — copiar y comparar con el postcheck',
         (select count(*) filter (where pct_recobro_aliado is not null)::text || ' | ' || coalesce(md5(string_agg(id::text || ':' || trim_scale(pct_recobro_aliado)::text, ',' order by id)), 'sin filas')
            from public.aliados_b2b where pct_recobro_aliado is not null), 'informativo', false)
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when not critico then 'INFO' when obs = esp then 'OK' else 'FALLA' end as estado
  from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO', (select count(*) from r where estado = 'FALLA')::text || ' falla(s)', '0 fallas',
       case when (select count(*) from r where estado = 'FALLA') = 0 then 'LISTO PARA APLICAR' else 'NO APLICAR' end
order by orden;
