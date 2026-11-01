-- ─────────────────────────────────────────────────────────────────────────────
-- #65 · AUDITORÍA CONTABLE DE SOLO LECTURA de las filas de comisión B2B retenidas (requiere la migración 268)
--
-- Una sola consulta SELECT, sin escrituras: una fila por retención + una fila de VERIFICACIÓN (postcheck de la 268).
-- COLUMNAS: contrato · línea (1 = persona que cobra la comisión; menor id del contrato) · componente · ficha actual · ficha confirmada por el dueño · total ·
-- abonos registrados · diferencia (abonos − total) · estado.
-- `componente` es aritmético, NO comercial: «comisión» = base×% o valor fijo, «recobro» = recobro_total×%, «mixta» = ambos. Qué es cada cosa lo decide el dueño.
-- El destinatario real de cada pago NO consta en comision_b2b_pagos (solo fecha, valor y agencia): sigue DESCONOCIDO hasta que contabilidad lo concilie.
-- VERIFICACION_OK exige EXACTAMENTE los ids 1, 80, 81, 82, 83, 85, 89, 107, 135 y 137, cada uno con la ficha confirmada esperada (1→8, 80→3, 81→33, 82→1,
-- 83→1, 85→24, 89→28, 107→7, 135→37, 137→37), todos existentes en aliados_b2b y sin ninguna marca de más. Cualquier otro resultado es VERIFICAR.
-- ─────────────────────────────────────────────────────────────────────────────
with esperado(fila_id, ficha) as (
  values (1::bigint, 8::bigint), (80, 3), (81, 33), (82, 1), (83, 1), (85, 24), (89, 28), (107, 7), (135, 37), (137, 37)
),
base as (
  select r.aliado_b2b_id as fila_id, b.numero_contrato, b.aliado, b.aliado_id as ficha_actual, fa.nombre as ficha_actual_nombre,
         r.ficha_confirmada, fc.nombre as ficha_confirmada_nombre, r.motivo,
         (select count(*) from public.aliados_b2b x where x.numero_contrato = b.numero_contrato and x.id <= b.id) as linea,
         (select count(*) from public.aliados_b2b x where x.numero_contrato = b.numero_contrato) as n_lineas,
         public.comision_b2b_total(b) as total,
         coalesce((select sum(g.valor) from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id), 0) as abonado,
         (select count(*) from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id) as n_abonos,
         case when coalesce(b.comision_valor, case when b.base_explicita then coalesce(b.base_comision, coalesce(b.precio_venta, 0))
                                                   else coalesce(nullif(b.base_comision, 0), coalesce(b.precio_venta, 0)) end * coalesce(b.pct_comision, 0)) > 0
                   and coalesce(b.recobro_total, 0) * coalesce(b.pct_recobro_aliado, 0.5) > 0 then 'mixta'
              when coalesce(b.recobro_total, 0) * coalesce(b.pct_recobro_aliado, 0.5) > 0 then 'recobro'
              else 'comisión' end as componente
    from public.comision_b2b_revision r
    join public.aliados_b2b b on b.id = r.aliado_b2b_id
    left join public.aliados fa on fa.id = b.aliado_id
    left join public.aliados fc on fc.id = r.ficha_confirmada
)
select * from (
  select 'fila'::text as seccion, 'RETENIDA'::text as estado,
         numero_contrato as contrato, 'línea ' || linea || ' de ' || n_lineas as linea, fila_id, componente,
         coalesce(ficha_actual::text, 'SIN FICHA') || ' (' || coalesce(ficha_actual_nombre, aliado, '-') || ')' as ficha_actual,
         coalesce(ficha_confirmada::text, '-') || ' (' || coalesce(ficha_confirmada_nombre, '-') || ')' as ficha_confirmada,
         round(total, 2) as total, round(abonado, 2) as abonos, n_abonos,
         round(abonado - total, 2) as diferencia,
         'ficha actual ' || (case when ficha_actual is not distinct from ficha_confirmada then 'ya es la confirmada' else 'DIFIERE de la confirmada' end)
           || ' · destinatario del pago DESCONOCIDO · ' || motivo as detalle
    from base
  union all
  select 'verificacion',
         case when (select count(*) from public.comision_b2b_revision) = 10
               and (select count(*) from esperado e join public.aliados_b2b b on b.id = e.fila_id) = 10
               and (select count(*) from esperado e join public.comision_b2b_revision r on r.aliado_b2b_id = e.fila_id and r.ficha_confirmada = e.ficha) = 10
              then 'VERIFICACION_OK' else 'VERIFICAR' end,
         null, null, null, null, null, null, null, null, null, null,
         'retenidas=' || (select count(*) from public.comision_b2b_revision)
           || ' · esperadas=10 · ids esperados presentes con su ficha confirmada='
           || (select count(*) from esperado e join public.comision_b2b_revision r on r.aliado_b2b_id = e.fila_id and r.ficha_confirmada = e.ficha)
           || ' · ids de más=' || coalesce((select string_agg(r.aliado_b2b_id::text, ',' order by r.aliado_b2b_id) from public.comision_b2b_revision r
                                             where r.aliado_b2b_id not in (select fila_id from esperado)), '(ninguno)')
           || ' · ids que faltan o con ficha distinta=' || coalesce((select string_agg(e.fila_id::text, ',' order by e.fila_id) from esperado e
                                             where not exists (select 1 from public.comision_b2b_revision r where r.aliado_b2b_id = e.fila_id and r.ficha_confirmada = e.ficha)), '(ninguno)')
) x
order by case x.seccion when 'verificacion' then 0 else 1 end, x.contrato nulls last, x.fila_id nulls last;
