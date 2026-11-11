-- PREFLIGHT de la migración 290 (#97). SOLO LECTURA: una consulta, un resultado. Columnas: orden | control | observado | esperado | estado.
-- estado: OK · FALLA (no aplicar) · REVISAR (detiene: lo decide una persona) · INFO. Última fila: VEREDICTO.
-- Diagnostica los duplicados HISTÓRICOS (mismo contrato + mismo aliado_id) sin tocarlos: la 290 no borra, consolida ni valida filas existentes.
with fn as (
  select p.oid, md5(replace(p.prosrc, chr(13), '')) as huella, obj_description(p.oid, 'pg_proc') as nota   -- sin CR: igual con checkout CRLF o LF
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'registrar_comision_b2b_manual'
     and pg_get_function_identity_arguments(p.oid) = 'p_numero text, p_aliado text, p_nit text, p_tipo_aliado text, p_aliado_id bigint, p_pct numeric, p_recobro numeric, p_pct_recobro numeric, p_aplica_retencion boolean, p_pct_retencion numeric'
),
con as (   -- conceptos por fila: mismas reglas que tg_aliados_b2b_sin_duplicado_aliado (290)
  select b.id, b.numero_contrato, b.aliado_id, coalesce(b.descontada_en_precio, false) as descontada,
         (coalesce(b.comision_valor, 0) > 0 or coalesce(b.pct_comision, 0) > 0 or coalesce(b.descontada_en_precio, false)) as ord,
         (coalesce(b.recobro_total, 0) > 0 and coalesce(b.pct_recobro_aliado, 0.5) > 0) as rec
    from public.aliados_b2b b where b.aliado_id is not null
),
grupos as ( -- (contrato, aliado) con más de una fila; «choque» = dos filas que comparten concepto (lo que la 290 impediría hoy)
  select c.numero_contrato, c.aliado_id, count(*) as filas, count(*) filter (where not c.descontada) as exigibles,
         (select count(*) from public.comision_b2b_pagos g where g.aliado_b2b_id = any(array_agg(c.id))) as pagos,
         string_agg(c.id::text, ',' order by c.id) as ids,
         exists (select 1 from con x join con y on y.numero_contrato = x.numero_contrato and y.aliado_id = x.aliado_id and y.id > x.id
                  where x.numero_contrato = c.numero_contrato and x.aliado_id = c.aliado_id and ((x.ord and y.ord) or (x.rec and y.rec))) as choque
    from con c
   group by c.numero_contrato, c.aliado_id
  having count(*) > 1
),
dup as (select * from grupos where choque),
sep as (select * from grupos where not choque),
pend as (  -- contratos pendientes que YA tienen una comisión exigible (histórico, no lo toca la 290)
  select b.numero_contrato, count(*) as n
    from public.aliados_b2b b join public.ventas v on v.numero_contrato = b.numero_contrato
   where v.estado = 'pendiente' and not coalesce(b.descontada_en_precio, false)
   group by b.numero_contrato
),
v(orden, control, obs, esp, nivel) as (
  values
    (1,  'existe registrar_comision_b2b_manual con la firma de la 205', (select count(*)::text from fn), '1', 'critico'),
    (2,  'su cuerpo es EXACTAMENTE el de la 205 (md5 sin CR = dc89361b…; con CRLF = 871d2946…) o ya es la 290',
         coalesce((select case when huella = 'dc89361bdfd6fb12a822b2e093174d28' then '205'
                               when nota like 'MANUAL_V290%' then 'YA_290' else 'OTRO:' || huella end from fn), 'sin función'), '205', 'critico'),
    (3,  'trigger trg_aliados_b2b_sin_duplicado_aliado aún no existe',
         (select count(*)::text from pg_trigger where tgrelid = 'public.aliados_b2b'::regclass and tgname = 'trg_aliados_b2b_sin_duplicado_aliado'), '0', 'critico'),
    (4,  'guarda NETO de la 205 presente (trg_aliados_b2b_neto_sin_segunda)',
         (select count(*)::text from pg_trigger where tgrelid = 'public.aliados_b2b'::regclass and tgname = 'trg_aliados_b2b_neto_sin_segunda' and tgenabled <> 'D'), '1', 'critico'),
    (10, 'DUPLICADOS HISTÓRICOS (contrato+aliado con dos filas del MISMO concepto: ordinaria o recobro): grupos', (select count(*)::text from dup), '0', 'revisar'),
    (13, 'INFO · mismo aliado con conceptos SEPARADOS (p. ej. ordinaria + recobro en filas distintas): no es duplicado', (select count(*)::text from sep), 'informativo', 'info'),
    (11, 'duplicados históricos: detalle contrato/aliado → filas (exigibles) · pagos · ids',
         coalesce((select string_agg(numero_contrato || '/' || aliado_id || ' → ' || filas || ' (' || exigibles || ') · pagos ' || pagos || ' · ' || ids, ' ; ' order by numero_contrato)
                     from (select * from dup order by numero_contrato limit 50) d), 'ninguno'), 'ninguno', 'revisar'),
    (12, 'duplicados históricos CON pagos (no se consolidan: contabilidad decide)', (select count(*)::text from dup where pagos > 0), '0', 'revisar'),
    (20, 'INFO · contratos PENDIENTES con comisión exigible ya registrada (histórico; la 290 solo impide NUEVAS)', (select count(*)::text from pend), 'informativo', 'info'),
    (21, 'INFO · detalle (máx. 50)', coalesce((select string_agg(numero_contrato || ':' || n, ', ' order by numero_contrato) from (select * from pend order by numero_contrato limit 50) p), 'ninguno'), 'informativo', 'info'),
    (22, 'INFO · filas de comisión sin aliado_id (texto libre: la 290 no las compara)', (select count(*)::text from public.aliados_b2b where aliado_id is null), 'informativo', 'info')
),
r as (
  select orden, control, obs as observado, esp as esperado,
         case when nivel = 'info' then 'INFO' when obs = esp then 'OK' when nivel = 'revisar' then 'REVISAR' else 'FALLA' end as estado
    from v
)
select orden, control, observado, esperado, estado from r
union all
select 99, 'VEREDICTO',
       (select count(*) filter (where estado = 'FALLA') || ' falla(s), ' || count(*) filter (where estado = 'REVISAR') || ' por revisar' from r),
       '0 fallas, 0 por revisar',
       case when exists (select 1 from r where estado = 'FALLA') then 'NO APLICAR'
            when exists (select 1 from r where estado = 'REVISAR') then 'REVISAR ANTES DE APLICAR (duplicados históricos: decisión humana; la 290 no los toca)'
            else 'LISTO PARA APLICAR LA 290' end
order by orden;
