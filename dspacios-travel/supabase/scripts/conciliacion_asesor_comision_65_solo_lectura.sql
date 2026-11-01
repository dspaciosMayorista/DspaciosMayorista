-- ─────────────────────────────────────────────────────────────────────────────
-- #65 · CONCILIACIÓN DE SOLO LECTURA: asesor confirmado por el dueño vs. beneficiario actual de cada fila de aliados_b2b
--
-- Ni un INSERT/UPDATE/DELETE: una sola consulta SELECT con columna `estado`. Pegar tal cual en el editor SQL.
-- Plan de corrección (aparte, NO se ejecuta aquí): supabase/scripts/correccion_asesor_comision_65_plan.sql
-- Doc: docs/tecnico/comisiones-aliado-vs-interna-65.md
--
-- REGLA CONFIRMADA POR EL DUEÑO: en estas diez ventas la línea de COMISIÓN y la de RECOBRO pertenecen al MISMO asesor
-- de la comisión, aunque hoy estén atribuidas a personas distintas. Asesor confirmado por contrato → CTE `esperado`
-- (única entrada manual del script; no agregar contratos sin confirmación expresa).
--
-- QUÉ NO HACE: no deduce que una fila sea «recobro» por tener recobro_total (puede estar calculada con base y porcentaje
-- aunque comercialmente sea el recobro); muestra los componentes y deja la lectura comercial al dueño. No cambia
-- beneficiarios ni abonos. El primer nombre solo se usa para SEÑALAR una diferencia, nunca para reasignar.
--
-- EVIDENCIA SOBRE EL DESTINATARIO REAL DEL PAGO: comision_b2b_pagos solo guarda fecha, valor y tenant (no beneficiario,
-- forma de pago ni referencia). Lo único disponible es: a quién pertenecía la fila cuando se pagó (la fila actual),
-- quién registró el abono (auditoría, si hay rastro) y cuándo. Por eso, toda fila señalada CON abonos queda como
-- REVISION_CONTABLE: no se puede probar a quién se le consignó.
-- ─────────────────────────────────────────────────────────────────────────────
with
esperado(numero_contrato, asesor, primer_nombre) as (
  values
    ('MIN-00-0422', 'Paola',               'paola'),
    ('MIN-00-0432', 'Katherine Colorado',  'katherine'),
    ('MIN-00-0433', 'Katherine Colorado',  'katherine'),
    ('MIN-00-0439', 'Juliana',             'juliana'),
    ('MIN-00-0462', 'Javier',              'javier'),
    ('MIN-00-0463', 'Marcela',             'marcela'),
    ('MIN-00-0476', 'Javier',              'javier'),
    ('MIN-00-0484', 'Sebastián',           'sebastian'),
    ('MIN-00-0498', 'Javier',              'javier'),
    ('MIN-00-0519', 'Yaqueline',           'yaqueline')
),
-- Asignación CONFIRMADA por el dueño (fila -> ficha destino); 0476 (100 y 101) ya es de Javier (ficha 8). Si una fila no está aquí, se compara el primer nombre.
destino(fila_id, ficha_destino) as (
  values (79::bigint, 8::bigint), (81, 33), (82, 1), (83, 1), (85, 24), (89, 28), (107, 7), (137, 37), (1, 8), (100, 8), (101, 8)
),
-- Filas que el dueño señaló como atribuidas a otra persona (referencia cruzada; el script las calcula por su cuenta).
senaladas(fila_id, motivo) as (
  values (79::bigint, 'otra persona'), (81, 'otra persona'), (82, 'otra persona'), (83, 'otra persona'), (85, 'otra persona'),
         (89, 'otra persona'), (107, 'otra persona'), (137, 'otra persona'), (1, 'sin ficha (0498)')
),
filas as (
  select b.id, b.numero_contrato, b.aliado, b.aliado_id, b.nit, b.tipo_aliado, b.estado, b.descontada_en_precio, b.tenant,
         b.base_explicita, b.base_comision, b.pct_comision, b.comision_valor, b.recobro_total, b.pct_recobro_aliado,
         b.aplica_retencion, b.pct_retencion, coalesce(b.precio_venta, 0) as pvp,
         case when b.base_explicita then coalesce(b.base_comision, coalesce(b.precio_venta, 0))
              else coalesce(nullif(b.base_comision, 0), coalesce(b.precio_venta, 0)) end as base_usada,
         public.comision_b2b_total(b) as total
    from public.aliados_b2b b
   where b.numero_contrato in (select numero_contrato from esperado)
),
comp as (
  select f.*,
         coalesce(f.comision_valor, f.base_usada * coalesce(f.pct_comision, 0)) as comision_base,
         coalesce(f.recobro_total, 0) * coalesce(f.pct_recobro_aliado, 0.5)     as recobro_aliado,
         (coalesce(f.comision_valor, f.base_usada * coalesce(f.pct_comision, 0)) + coalesce(f.recobro_total, 0) * coalesce(f.pct_recobro_aliado, 0.5))
           * (case when f.aplica_retencion then coalesce(f.pct_retencion, 0) else 0 end) as retencion
    from filas f
),
det as (
  select c.*, e.asesor as asesor_confirmado, e.primer_nombre,
         a.nombre as ficha_nombre, a.tipo as ficha_tipo,
         translate(lower(split_part(btrim(coalesce(a.nombre, c.aliado, '')), ' ', 1)), 'áéíóúñ', 'aeioun') as primer_nombre_beneficiario,
         -- Fichas del catálogo cuyo primer nombre coincide con el del asesor confirmado: EVIDENCIA para elegir la ficha destino.
         (select string_agg('ficha ' || x.id || ' «' || x.nombre || '» (' || coalesce(x.tipo, '-') || ')', ' · ' order by x.id)
            from public.aliados x
           where translate(lower(split_part(btrim(coalesce(x.nombre, '')), ' ', 1)), 'áéíóúñ', 'aeioun') = e.primer_nombre) as fichas_del_asesor,
         (select string_agg(u.rol::text || ':' || coalesce(u.nombre, '?'), ', ' order by u.nombre)
            from public.usuarios u where c.aliado_id is not null and u.aliado_id = c.aliado_id) as cuentas_con_esa_ficha,
         v.aliado_id as venta_aliado_id, v.asesor as venta_asesor, v.asesor_firma_nombre, v.tipo_asesor, v.canal, v.estado as venta_estado,
         (select count(*) from public.comision_b2b_pagos g where g.aliado_b2b_id = c.id) as n_abonos,
         (select coalesce(sum(g.valor), 0) from public.comision_b2b_pagos g where g.aliado_b2b_id = c.id) as abonado,
         (select string_agg(g.fecha::text || ' $' || g.valor || ' (id ' || g.id || ', registrado '
                            || coalesce((select au.actor_rol || ':' || coalesce(au.actor_nombre, 'Sistema') from public.auditoria au
                                          where au.tabla = 'comision_b2b_pagos' and au.accion = 'INSERT' and au.despues ->> 'id' = g.id::text
                                          order by au.id limit 1), 'sin rastro en auditoría') || ')', ' ; ' order by g.fecha, g.id)
            from public.comision_b2b_pagos g where g.aliado_b2b_id = c.id) as detalle_abonos,
         (select au.actor_rol || ':' || coalesce(au.actor_nombre, 'Sistema') from public.auditoria au
           where au.tabla = 'aliados_b2b' and au.accion = 'INSERT' and au.despues ->> 'id' = c.id::text order by au.id limit 1) as fila_creada_por
    from comp c
    join esperado e on e.numero_contrato = c.numero_contrato
    join public.ventas v on v.numero_contrato = c.numero_contrato
    left join public.aliados a on a.id = c.aliado_id
),
res as (
  select d.*,
         case
           when (select x.ficha_destino from destino x where x.fila_id = d.id) is not null then
                case when d.aliado_id is null then 'SIN_FICHA'
                     when d.aliado_id = (select x.ficha_destino from destino x where x.fila_id = d.id) then 'COINCIDE_CON_EL_ASESOR'
                     else 'ATRIBUIDA_A_OTRA_PERSONA' end
           when d.aliado_id is null then 'SIN_FICHA'
           when d.primer_nombre_beneficiario <> d.primer_nombre then 'ATRIBUIDA_A_OTRA_PERSONA'
           else 'COINCIDE_CON_EL_ASESOR'
         end as diagnostico,
         (d.total > 0) as positiva,
         exists (select 1 from senaladas s where s.fila_id = d.id) as senalada_por_dueno
    from det d
)
select * from (
-- Resumen: contraste con lo que dijo el dueño.
select 'resumen'::text as seccion, 'INFO'::text as estado, null::text as numero_contrato, null::bigint as fila_id,
       'contratos esperados: ' || (select count(*) from esperado)
         || ' · con filas: ' || (select count(distinct numero_contrato) from res)
         || ' · filas totales: ' || (select count(*) from res)
         || ' · filas POSITIVAS: ' || (select count(*) from res where positiva) || ' (el dueño reportó 20)'
         || ' · a corregir (otra persona o sin ficha, positivas): '
         || coalesce((select string_agg(numero_contrato || '#' || id, ', ' order by numero_contrato, id) from res where positiva and diagnostico <> 'COINCIDE_CON_EL_ASESOR'), '(ninguna)')
         || ' · señaladas por el dueño que el cálculo NO marca: '
         || coalesce((select string_agg(s.fila_id::text, ', ' order by s.fila_id) from senaladas s
                       where not exists (select 1 from res r where r.id = s.fila_id and r.diagnostico <> 'COINCIDE_CON_EL_ASESOR')), '(ninguna)')
         || ' · marcadas por el cálculo que el dueño NO señaló: '
         || coalesce((select string_agg(r.numero_contrato || '#' || r.id, ', ' order by r.id) from res r
                       where r.positiva and r.diagnostico <> 'COINCIDE_CON_EL_ASESOR' and not r.senalada_por_dueno), '(ninguna)') as evidencia
union all
-- Un renglón por contrato: ¿cuántas personas distintas figuran vs. el asesor confirmado?
select 'contrato',
       case when count(distinct coalesce(aliado_id::text, 'texto:' || lower(btrim(aliado)))) filter (where positiva) > 1 then 'CORREGIR' else 'INFO' end,
       numero_contrato, null,
       'asesor confirmado=' || max(asesor_confirmado)
         || ' · filas positivas=' || count(*) filter (where positiva) || ' (' || coalesce(string_agg(id::text, ',' order by id) filter (where positiva), '-') || ')'
         || ' · beneficiarios actuales distintos=' || count(distinct coalesce(aliado_id::text, 'texto:' || lower(btrim(aliado)))) filter (where positiva)
         || ' · filas en cero (no cuentan)=' || count(*) filter (where not positiva)
         || ' · venta.aliado_id=' || coalesce(max(venta_aliado_id)::text, 'NULL')
  from res group by numero_contrato
union all
-- Una fila por renglón de aliados_b2b.
select 'fila',
       case when not positiva then 'EN_CERO'
            when diagnostico = 'COINCIDE_CON_EL_ASESOR' then 'OK'
            when n_abonos > 0 then 'REVISION_CONTABLE'
            else 'CORREGIR' end,
       numero_contrato, id,
       'asesor confirmado=' || asesor_confirmado
         || ' | beneficiario actual=«' || coalesce(aliado, '(sin nombre)') || '» ficha=' || coalesce(aliado_id::text, 'NULL') || ' (' || coalesce(ficha_nombre, 'sin ficha') || ', ' || coalesce(ficha_tipo, '-') || ')'
         || ' | ficha destino confirmada=' || coalesce((select x.ficha_destino::text from destino x where x.fila_id = res.id), '(sin asignación: se compara el nombre)')
         || ' | diagnóstico=' || diagnostico || case when senalada_por_dueno then ' (el dueño la señaló)' else '' end
         || ' | total=' || round(total, 2)
         || ' = comisión_base ' || round(comision_base, 2) || ' [pvp=' || pvp || ', base_usada=' || round(base_usada, 2) || ', pct=' || coalesce(pct_comision::text, 'NULL') || ', valor_fijo=' || coalesce(comision_valor::text, 'NULL') || ']'
         || ' + recobro_aliado ' || round(recobro_aliado, 2) || ' [recobro_total=' || coalesce(recobro_total::text, 'NULL') || ' × pct_recobro=' || coalesce(pct_recobro_aliado::text, 'NULL(0.5)') || ']'
         || ' − retención ' || round(retencion, 2)
         || ' | positiva por: ' || case when comision_base > 0 and recobro_aliado > 0 then 'comisión base Y recobro' when comision_base > 0 then 'solo base×%/valor fijo' when recobro_aliado > 0 then 'solo recobro_total×pct' else '-' end
         || ' | fichas del asesor (evidencia)=' || coalesce(fichas_del_asesor, 'NINGUNA con ese primer nombre')
         || ' | cuentas con la ficha actual=' || coalesce(cuentas_con_esa_ficha, 'ninguna')
         || ' | venta.aliado_id=' || coalesce(venta_aliado_id::text, 'NULL') || ' · asesor_venta=' || coalesce(venta_asesor, 'NULL') || ' · firma=' || coalesce(asesor_firma_nombre, 'NULL')
         || ' | estado fila=' || coalesce(estado, 'NULL') || ' · descontada_en_precio=' || descontada_en_precio
         || ' | abonos=' || n_abonos || ' por ' || round(abonado, 2) || ' (saldo ' || round(greatest(total - abonado, 0), 2) || ')'
         || case when n_abonos > 0 then ' → ' || detalle_abonos || ' | DESTINATARIO REAL DEL PAGO: sin dato (comision_b2b_pagos no guarda beneficiario ni referencia)' else '' end
         || ' | fila creada por=' || coalesce(fila_creada_por, 'sin rastro en auditoría')
  from res
) x
order by case x.seccion when 'resumen' then 0 when 'contrato' then 1 else 2 end, x.numero_contrato nulls first, x.fila_id nulls first;
