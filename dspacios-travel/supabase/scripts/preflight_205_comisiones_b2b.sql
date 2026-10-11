-- PREFLIGHT · migración 205 (comisiones B2B) — SOLO LECTURA.
-- Correr ANTES de aplicar la 205. Transacción READ ONLY + ROLLBACK.
-- Sin datos personales: solo existencia de objetos y conteos.
-- Cualquier fila 'FALLA' detiene la aplicación. 'INFO' no bloquea.
begin;
set transaction read only;

with chequeos(orden, chequeo, ok, detalle) as (
  values
  -- Dependencias reales (no depende de 201–204).
  (1,  'mi_rol() (140)',                          to_regprocedure('public.mi_rol()') is not null, null::text),
  (2,  'mi_tenant() / puede_ver_tenant(text) (107)', to_regprocedure('public.mi_tenant()') is not null and to_regprocedure('public.puede_ver_tenant(text)') is not null, null),
  (3,  'puede_ver_tenant_cotizacion(text) (154)', to_regprocedure('public.puede_ver_tenant_cotizacion(text)') is not null, null),
  (4,  'comision_b2b_pagos (131) con FK a aliados_b2b',
        exists (select 1 from pg_constraint where conrelid = 'public.comision_b2b_pagos'::regclass and contype = 'f' and confrelid = 'public.aliados_b2b'::regclass), null),
  (5,  'ventas.financiero_estado (172)',
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'financiero_estado'), null),
  (6,  'ventas: modo_compra / comision_b2b / comision_estado / aliado_id / tipo_asesor / impuesto',
        (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ventas'
          and column_name in ('modo_compra','comision_b2b','comision_estado','aliado_id','tipo_asesor','impuesto')) = 6, null),
  (7,  'aliados: tipo / pct_comision / aplica_retencion / pct_retencion',
        (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'aliados'
          and column_name in ('tipo','pct_comision','aplica_retencion','pct_retencion')) = 4, null),
  (8,  'eliminar_contrato, revertir_contrato_incompleto y soy_asesor_del_contrato existen',
        to_regprocedure('public.eliminar_contrato(text,boolean)') is not null and to_regprocedure('public.revertir_contrato_incompleto(text,text)') is not null
        and to_regprocedure('public.soy_asesor_del_contrato(text)') is not null, null),
  -- La 205 no está aplicada ni hay nombres que choquen.
  (9,  'columnas de la 205 aún no existen',
        not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'aliados_b2b'
          and column_name in ('base_explicita','comision_valor','descontada_en_precio')), null),
  (10, 'funciones de la 205 aún no existen',
        not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
          and p.proname in ('comision_b2b_total','comision_b2b_descontada','registrar_comision_b2b_reserva','registrar_comision_b2b_manual',
                            'tg_aliados_b2b_proteger_abonos','tg_comision_b2b_pagos_guardas','tg_aliados_b2b_neto_no_borrar','tg_aliados_b2b_neto_sin_segunda')), null),
  (11, 'triggers y policies de la 205 aún no existen; está la policy de 116',
        not exists (select 1 from pg_trigger where tgname in ('trg_aliados_b2b_proteger_abonos','trg_comision_b2b_pagos_guardas','trg_aliados_b2b_neto_no_borrar','trg_aliados_b2b_neto_sin_segunda'))
        and exists (select 1 from pg_policy where polrelid = 'public.aliados_b2b'::regclass and polname = 'aliados_b2b: acceso contable'), null)
),
info(orden, chequeo, detalle) as (
  values
  (20, 'INFO comisiones B2B existentes (se leerán igual: base_explicita NULL)', (select count(*)::text from public.aliados_b2b)),
  (21, 'INFO comisiones con abonos (no se podrán borrar ni cambiar de total)',
        (select count(distinct aliado_b2b_id)::text from public.comision_b2b_pagos)),
  (22, 'INFO NETO legado (firma de reservar: se mostrarán "descontada", sin abonos nuevos ni cuenta de cobro, y ya no se borran sueltas)',
        (select count(*)::text from public.aliados_b2b a where a.estado = 'pagada'
           and exists (select 1 from public.ventas v where v.numero_contrato = a.numero_contrato and v.comision_estado = 'descontada'))),
  (23, 'INFO contratos con abonos a comisión (eliminar_contrato quedará bloqueado para ellos)',
        (select count(distinct b.numero_contrato)::text from public.aliados_b2b b join public.comision_b2b_pagos p on p.aliado_b2b_id = b.id)),
  (25, 'INFO ventas B2B atascadas en financiero pendiente (>5 min) SIN comisión: la RPC de reserva no les añade una (sin backfill; revisar a mano)',
        (select count(*)::text from public.ventas v
          where v.financiero_estado = 'pendiente' and v.financiero_actualizado_en < now() - interval '5 minutes'
            and v.tipo_asesor in ('agencia','freelance')
            and not exists (select 1 from public.aliados_b2b b where b.numero_contrato = v.numero_contrato))),
  -- Impacto del código nuevo (no de la 205): una comisión SIN ficha
  -- (aliado_id null) solo la cobra el aliado por URL si su documento
  -- (aliados_b2b.nit) es el de su ficha; el nombre escrito ya no basta (salvo
  -- la vía legacy por nombre). Un interno las sigue generando.
  (26, 'INFO comisiones sin ficha en contratos B2B: con documento / SIN documento (estas últimas: el aliado ya no las cobra por URL salvo vía legacy)',
        (select count(*) filter (where nullif(regexp_replace(split_part(coalesce(b.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g'), '') is not null)::text
                || ' / ' ||
                count(*) filter (where nullif(regexp_replace(split_part(coalesce(b.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g'), '') is null)::text
           from public.aliados_b2b b join public.ventas v on v.numero_contrato = b.numero_contrato
          where b.aliado_id is null and v.tipo_asesor in ('agencia', 'freelance'))),
  (27, 'INFO de las anteriores, con documento DISTINTO al de la ficha enlazada al contrato (ventas.aliado_id): esa ficha no las cobra',
        (select count(*)::text
           from public.aliados_b2b b
           join public.ventas v on v.numero_contrato = b.numero_contrato
           join public.aliados a on a.id = v.aliado_id
          where b.aliado_id is null
            and upper(regexp_replace(split_part(coalesce(b.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g'))
                is distinct from upper(regexp_replace(split_part(coalesce(a.nit, ''), '-', 1), '[^0-9A-Za-z]', '', 'g')))),
  -- Filas B2B de contratos NETO (comision_estado = 'descontada') SIN la firma
  -- legado de comisión descontada (estado <> 'pagada'). Con la 205 no admiten
  -- abonos nuevos ni aumentos; las que ya tienen abonos se conservan y
  -- requieren revisión manual. Las 'pagada' NO entran aquí: si un contrato
  -- tiene varias, no se sabe cuál fue la descontada — eso es INFO 30/31.
  -- Solo recuentos (sin datos personales).
  (28, 'INFO filas B2B de contratos NETO con estado distinto de ''pagada'' (sin la firma legado de descontada): sin abonos / CON abonos / contratos',
        (select count(*) filter (where not exists (select 1 from public.comision_b2b_pagos p where p.aliado_b2b_id = b.id))::text
                || ' / ' ||
                count(*) filter (where exists (select 1 from public.comision_b2b_pagos p where p.aliado_b2b_id = b.id))::text
                || ' / ' || count(distinct b.numero_contrato)::text
           from public.aliados_b2b b join public.ventas v on v.numero_contrato = b.numero_contrato
          where v.comision_estado = 'descontada' and b.estado is distinct from 'pagada')),
  -- Las mismas filas, IDENTIFICADAS para la revisión manual: id de la
  -- comisión, número de contrato y cuántos abonos tiene. Sin nombres, NIT ni
  -- importes. Nada se borra ni recalcula: con la 205 solo dejan de admitir
  -- abonos nuevos o aumentos.
  (29, 'INFO las filas de INFO 28, identificadas para revisión manual (id_comision@contrato:abonos)',
        (select coalesce(string_agg(b.id::text || '@' || b.numero_contrato || ':' ||
                                    (select count(*) from public.comision_b2b_pagos p where p.aliado_b2b_id = b.id)::text,
                                    ', ' order by b.numero_contrato, b.id), '—')
           from public.aliados_b2b b join public.ventas v on v.numero_contrato = b.numero_contrato
          where v.comision_estado = 'descontada' and b.estado is distinct from 'pagada')),
  -- Contratos NETO con DOS O MÁS filas B2B, incluidas las 'pagada'. La firma
  -- legado de descontada es estado = 'pagada': con dos o más 'pagada' en el
  -- mismo contrato NO se puede saber cuál fue la comisión descontada en el
  -- precio y cuál otra cosa. La 205 y la app tratan toda 'pagada' de un
  -- contrato NETO como descontada; aquí solo se señala para revisión manual
  -- (no se cambia estado, abonos, rentabilidad ni clasificación).
  (30, 'INFO contratos NETO con 2+ filas B2B (incluidas ''pagada''): contratos / filas / contratos con 2+ ''pagada'' (AMBIGUO: no se sabe cuál fue la descontada)',
        (select count(*)::text || ' / ' || coalesce(sum(n), 0)::text || ' / ' || count(*) filter (where n_pagada >= 2)::text
           from (select b.numero_contrato, count(*) as n, count(*) filter (where b.estado = 'pagada') as n_pagada
                   from public.aliados_b2b b join public.ventas v on v.numero_contrato = b.numero_contrato
                  where v.comision_estado = 'descontada'
                  group by b.numero_contrato
                 having count(*) >= 2) c)),
  -- Los mismos contratos, IDENTIFICADOS: número de contrato, filas, cuántas
  -- 'pagada', cuántas con abonos e ids de las comisiones. Sin nombres, NIT ni
  -- importes.
  (31, 'INFO contratos de INFO 30, identificados para revisión manual (contrato [AMBIGUO si 2+ pagada] filas pagada con_abonos ids)',
        (select coalesce(string_agg(c.numero_contrato || case when c.n_pagada >= 2 then ' [AMBIGUO]' else '' end
                                    || ' filas=' || c.n || ' pagada=' || c.n_pagada || ' con_abonos=' || c.n_abonadas
                                    || ' ids=' || c.ids,
                                    '; ' order by c.numero_contrato), '—')
           from (select b.numero_contrato, count(*) as n,
                        count(*) filter (where b.estado = 'pagada') as n_pagada,
                        count(*) filter (where exists (select 1 from public.comision_b2b_pagos p where p.aliado_b2b_id = b.id)) as n_abonadas,
                        string_agg(b.id::text, ',' order by b.id) as ids
                   from public.aliados_b2b b join public.ventas v on v.numero_contrato = b.numero_contrato
                  where v.comision_estado = 'descontada'
                  group by b.numero_contrato
                 having count(*) >= 2) c))
)
select orden, case when ok then 'OK' else 'FALLA' end as resultado, chequeo from chequeos
union all
select orden, 'INFO', chequeo || ': ' || detalle from info
order by orden;

rollback;
