-- DIAGNÓSTICO (solo lectura, una consulta) · #97/#75 — comisiones B2B HISTÓRICAS frente al ciclo de vida «pendiente = solo cálculo informativo».
-- No modifica, recalcula ni desactiva nada. Sirve para decidir con el dueño qué hacer con lo que ya existe; la materialización de la 286 NO duplica estas filas
-- (si ya hay una fila del MISMO aliado en el contrato, la devuelve sin tocarla).
-- Columnas: categoria | contratos | filas | detalle.
with filas as (
  select b.id, b.numero_contrato, b.aliado_id, b.estado, b.descontada_en_precio, b.plan_id,
         v.estado as estado_contrato, v.modo_compra, v.comision_estado, v.created_at
    from public.aliados_b2b b left join public.ventas v on v.numero_contrato = b.numero_contrato
)
select categoria, count(distinct numero_contrato) as contratos, count(*) as filas, detalle from (
  select 'A · comisión EXIGIBLE en un contrato PENDIENTE (histórica: nació antes del ciclo de vida; se conserva, no se borra ni se desactiva)' as categoria, numero_contrato,
         'estados de la fila: ' || string_agg(distinct estado, ', ') as detalle, id
    from filas where estado_contrato = 'pendiente' and not coalesce(descontada_en_precio, false) and plan_id is null group by numero_contrato, id
  union all
  select 'B · filas NETO descontadas (no exigibles) en cualquier estado: se conservan', numero_contrato, 'descontada_en_precio', id
    from filas where coalesce(descontada_en_precio, false)
  union all
  select 'C · filas materializadas desde un plan (nacidas con la 286 + gancho de confirmación)', numero_contrato, 'plan_id ' || plan_id, id
    from filas where plan_id is not null
  union all
  select 'D · contratos PENDIENTES con respaldo ventas.comision_b2b (modo comisionable) y SIN fila ni plan: cobro bloqueado por estado hasta confirmar', v.numero_contrato, 'comision_b2b ' || coalesce(v.comision_b2b::text, '-'), null::bigint
    from public.ventas v
   where v.estado = 'pendiente' and v.modo_compra = 'comisionable' and coalesce(v.comision_b2b, 0) > 0
     and not exists (select 1 from public.aliados_b2b b where b.numero_contrato = v.numero_contrato)
     and not exists (select 1 from public.comision_plan c where c.numero_contrato = v.numero_contrato)
  union all
  select 'E · contratos con plan y SIN fila (pendientes con plan informativo; o confirmados que esperan materializarse)', c.numero_contrato, 'estado ' || coalesce(v.estado, '(contrato inexistente: plan huérfano)'), null::bigint
    from public.comision_plan c left join public.ventas v on v.numero_contrato = c.numero_contrato
   where c.numero_contrato is not null and not exists (select 1 from public.aliados_b2b b where b.numero_contrato = c.numero_contrato)
) t
group by categoria, detalle
order by categoria, detalle;
