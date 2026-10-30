-- ═════════════════════════════════════════════════════════════════
-- #40 E3 · Guarda de cotización vencida (242). SOLO base desechable. Lo corre test_242_cotizacion_vencida.sh DESPUÉS de los fixtures 216 (cat),
-- dentro de begin … commit. Cada rechazo se mide contra la huella de dinero y el consecutivo: NO consume número ni deja hijos.
-- ═════════════════════════════════════════════════════════════════
\echo '--- V. Conversión manual por la puerta de la base'
do $$
declare
  hoy date := public.fecha_negocio();
  a bigint; b bigint; c bigint; d bigint; e bigint;
  antes jsonb; despues jsonb; seq_antes bigint; ventas_antes bigint;
  r text; r2 text; num_hoy text;
begin
  a := t216.crear('admin'); b := t216.crear('admin'); c := t216.crear('admin'); d := t216.crear('admin'); e := t216.crear('admin');
  perform t216.pagar(a, 600000, 'v-a'); perform t216.pagar(b, 600000, 'v-b'); perform t216.pagar(c, 600000, 'v-c');
  perform t216.pagar(d, 600000, 'v-d'); perform t216.pagar(e, 600000, 'v-e');

  -- Ayer (Bogotá): se rechaza ANTES de numerar y no deja nada.
  update public.cotizaciones set vigencia_hasta = hoy - 1 where id = a;
  antes := t216.huella_dinero(a); seq_antes := t216.ultimo_dtm(); select count(*) into ventas_antes from public.ventas;
  r := t216.escalar('service_role', null, t216.convertir_sql(a));
  perform t216.afirma('V1 vigencia de ayer: rechazada con COTIZACION_VENCIDA', r like 'ERR P0001: COTIZACION_VENCIDA%', r);
  despues := t216.huella_dinero(a);
  perform t216.afirma('V2 el rechazo no consume consecutivo ni crea venta', t216.ultimo_dtm() = seq_antes and (select count(*) from public.ventas) = ventas_antes);
  perform t216.afirma('V3 el rechazo no deja hijos financieros (huella de dinero idéntica) y la cotización sigue abierta',
    antes = despues and (select estado from public.cotizaciones where id = a) = 'abierta', t216.dif_huella(antes, despues));
  r2 := t216.escalar('service_role', null, t216.convertir_sql(a));
  perform t216.afirma('V4 reintento de la vencida: mismo rechazo y consecutivo intacto', r2 like 'ERR P0001: COTIZACION_VENCIDA%' and t216.ultimo_dtm() = seq_antes, r2);

  -- Hoy: el día indicado sigue válido.
  update public.cotizaciones set vigencia_hasta = hoy where id = b;
  num_hoy := t216.escalar('service_role', null, t216.convertir_sql(b));
  perform t216.afirma('V5 vigencia de hoy: convierte', num_hoy ~ '^\S+$' and num_hoy not like 'ERR%', num_hoy);

  -- Mañana.
  update public.cotizaciones set vigencia_hasta = hoy + 1 where id = c;
  r := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('V6 vigencia de mañana: convierte', r ~ '^\S+$' and r not like 'ERR%', r);

  -- Histórica sin fecha: no vence por inferencia y la conversión no la rellena.
  update public.cotizaciones set vigencia_hasta = null where id = d;
  r := t216.escalar('service_role', null, t216.convertir_sql(d));
  perform t216.afirma('V7 vigencia nula (histórica): convierte y conserva nulo', r ~ '^\S+$' and r not like 'ERR%'
    and (select vigencia_hasta is null from public.cotizaciones where id = d), r);

  -- Renovar una vencida: la nueva fecha la deja convertible.
  update public.cotizaciones set vigencia_hasta = hoy - 3 where id = e;
  r := t216.escalar('service_role', null, t216.convertir_sql(e));
  perform t216.afirma('V8 vencida hace 3 días: rechazada', r like 'ERR P0001: COTIZACION_VENCIDA%', r);
  update public.cotizaciones set vigencia_hasta = hoy + 2 where id = e;
  r := t216.escalar('service_role', null, t216.convertir_sql(e));
  perform t216.afirma('V9 renovada a una fecha futura: convierte', r ~ '^\S+$' and r not like 'ERR%', r);

  -- Replay de una ya convertida: pasa aunque su fecha ya haya quedado atrás (lo numerado no se abandona).
  update public.cotizaciones set vigencia_hasta = hoy - 1 where id = b;
  r := t216.escalar('service_role', null, t216.convertir_sql(b));
  perform t216.afirma('V10 reintento de una ya convertida: mismo número aunque su vigencia sea de ayer', r = num_hoy, r);
  perform t216.afirma('V11 la guarda no rechaza una cotización que ya no está abierta',
    t216.escalar('service_role', null, format('select public.p40_exigir_cotizacion_vigente(%s)::text', b)) = '');
end $$;

\echo '--- A. Aceptación #63 (envoltura)'
do $$
declare
  hoy date := public.fecha_negocio();
  v bigint; f bigint; n bigint; r text; seq_antes bigint;
begin
  v := t216.crear('admin'); f := t216.crear('admin'); n := t216.crear('admin');
  update public.cotizaciones set vigencia_hasta = hoy - 1 where id = v;
  update public.cotizaciones set vigencia_hasta = hoy + 5 where id = f;
  update public.cotizaciones set vigencia_hasta = null where id = n;
  seq_antes := t216.ultimo_dtm();
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''h'')::text', v, t216.u('admin')));
  perform t216.afirma('A1 aceptar_oferta_63 con la cotización vencida: COTIZACION_VENCIDA antes de numerar', r like 'ERR P0001: COTIZACION_VENCIDA%' and t216.ultimo_dtm() = seq_antes, r);
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''h'')::text', f, t216.u('admin')));
  perform t216.afirma('A2 vigente: la envoltura delega en el cuerpo de la 235 (p63_sin_oferta, no la guarda)', r like '%p63_sin_oferta%', r);
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''h'')::text', n, t216.u('admin')));
  perform t216.afirma('A3 vigencia nula: delega en el cuerpo (no la guarda)', r like '%p63_sin_oferta%', r);
end $$;

\echo '--- C. ACL'
do $$
begin
  perform t216.afirma('C1 authenticated no ejecuta la guarda',
    t216.intenta('authenticated', t216.u('admin'), 'select public.p40_exigir_cotizacion_vigente(1)') ~* 'permission denied|permiso denegado');
  perform t216.afirma('C2 authenticated no ejecuta aceptar_oferta_63',
    t216.intenta('authenticated', t216.u('admin'), 'select public.aceptar_oferta_63(1, ''mayorista'', ''' || t216.u('admin') || ''', ''h'', ''h'')') ~* 'permission denied|permiso denegado');
  perform t216.afirma('C3 ni siquiera service_role llama el cuerpo renombrado directo (saltaría la guarda)',
    t216.intenta('service_role', null, 'select public.p40_aceptar_oferta_63_base(1, ''mayorista'', ''' || t216.u('admin') || ''', ''h'', ''h'')') ~* 'permission denied|permiso denegado');
  perform t216.afirma('C4 una sola firma de aceptar_oferta_63', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'aceptar_oferta_63') = 1);
end $$;

\echo '--- R. Reintento de una aceptación #63 existente que vence DESPUÉS de aceptarse'
do $$
declare
  hoy date := public.fecha_negocio();
  p bigint; q bigint; d bigint; r text; r2 text; seq_antes bigint; n_antes bigint;
begin
  p := t216.crear('admin'); q := t216.crear('admin'); d := t216.crear('admin');
  insert into public.p63_oferta (cotizacion_id, tenant, paquete_id, trm, rev_fuente, rev_costos, huella, huella_financiera, snapshot)
    select x, 'mayorista', 999242, 4000, 1, 1, 'h', 'f', '{"moneda":"COP"}'::jsonb from unnest(array[p, q, d]) x;
  insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot, estado, moneda_cobro)
    select o.id, o.cotizacion_id, 'mayorista', case o.cotizacion_id when p then 'DTM-T242-P' when q then 'DTM-T242-Q' else 'DTM-T242-D' end,
           t216.u('admin'), hoy - 1, '{}'::jsonb, case o.cotizacion_id when p then 'preparada' when q then 'completa' else 'descartada' end, 'COP'
      from public.p63_oferta o where o.cotizacion_id in (p, q, d);
  update public.cotizaciones set vigencia_hasta = hoy - 1 where id in (p, q, d);   -- vence después de aceptarse
  seq_antes := t216.ultimo_dtm(); select count(*) into n_antes from public.p63_aceptacion;

  r := t216.escalar('service_role', null, format('select concat_ws(''|'', j->>''estado'', j->>''numero_contrato'') from (select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''f'') as j) s', p, t216.u('admin')));
  perform t216.afirma('R1 aceptación preparada + cotización vencida: el reintento devuelve el MISMO número (no la rechaza la guarda)', r = 'preparada|DTM-T242-P', r);
  r2 := t216.escalar('service_role', null, format('select concat_ws(''|'', j->>''estado'', j->>''numero_contrato'') from (select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''f'') as j) s', q, t216.u('admin')));
  perform t216.afirma('R2 aceptación completa + cotización vencida: devuelve su estado y el mismo número', r2 = 'completa|DTM-T242-Q', r2);
  perform t216.afirma('R3 los reintentos no consumen consecutivo ni crean otra aceptación',
    t216.ultimo_dtm() = seq_antes and (select count(*) from public.p63_aceptacion) = n_antes
    and (select count(*) from public.p63_aceptacion where cotizacion_id in (p, q)) = 2);
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''f'')::text', d, t216.u('admin')));
  perform t216.afirma('R4 solo una aceptación DESCARTADA + vencida: la guarda sí rechaza (no hay intento vigente que reanudar) y no numera',
    r like 'ERR P0001: COTIZACION_VENCIDA%' and t216.ultimo_dtm() = seq_antes, r);
end $$;
