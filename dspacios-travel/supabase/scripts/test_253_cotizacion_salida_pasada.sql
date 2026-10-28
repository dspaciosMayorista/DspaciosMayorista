-- ═════════════════════════════════════════════════════════════════
-- #40 / #75 · Guarda de salida pasada (253). SOLO base desechable. Lo corre test_253_cotizacion_salida_pasada.sh DESPUÉS de los fixtures 216 (cat)
-- y con la 242 y la 253 aplicadas, dentro de begin … commit. Cada rechazo se mide contra la huella de dinero y el consecutivo: NO numera ni deja hijos.
-- ═════════════════════════════════════════════════════════════════
\echo '--- S. Conversión manual por la puerta de la base'
do $$
declare
  hoy date := public.fecha_negocio();
  a bigint; b bigint; c bigint; d bigint; e bigint;
  antes jsonb; despues jsonb; seq_antes bigint; ventas_antes bigint;
  r text; r2 text; num_hoy text;
begin
  a := t216.crear('admin'); b := t216.crear('admin'); c := t216.crear('admin'); d := t216.crear('admin'); e := t216.crear('admin');
  perform t216.pagar(a, 600000, 's-a'); perform t216.pagar(b, 600000, 's-b'); perform t216.pagar(c, 600000, 's-c');
  perform t216.pagar(d, 600000, 's-d'); perform t216.pagar(e, 600000, 's-e');

  -- Salida de ayer (Bogotá), vigencia aún vigente: se rechaza ANTES de numerar y no deja nada.
  update public.cotizaciones set fecha_salida = hoy - 1, vigencia_hasta = hoy + 5 where id = a;
  antes := t216.huella_dinero(a); seq_antes := t216.ultimo_dtm(); select count(*) into ventas_antes from public.ventas;
  r := t216.escalar('service_role', null, t216.convertir_sql(a));
  perform t216.afirma('S1 salida de ayer: rechazada con COTIZACION_SALIDA_PASADA', r like 'ERR P0001: COTIZACION_SALIDA_PASADA%', r);
  despues := t216.huella_dinero(a);
  perform t216.afirma('S2 el rechazo no consume consecutivo ni crea venta', t216.ultimo_dtm() = seq_antes and (select count(*) from public.ventas) = ventas_antes);
  perform t216.afirma('S3 el rechazo no deja hijos financieros (huella idéntica) y la cotización sigue abierta',
    antes = despues and (select estado from public.cotizaciones where id = a) = 'abierta', t216.dif_huella(antes, despues));

  -- Salida de ayer Y vigencia vencida: manda la salida pasada (renovar la vigencia no sirve).
  update public.cotizaciones set fecha_salida = hoy - 1, vigencia_hasta = hoy - 3 where id = a;
  r := t216.escalar('service_role', null, t216.convertir_sql(a));
  perform t216.afirma('S4 salida pasada + vigencia vencida: COTIZACION_SALIDA_PASADA (prioridad), no COTIZACION_VENCIDA',
    r like 'ERR P0001: COTIZACION_SALIDA_PASADA%' and t216.ultimo_dtm() = seq_antes, r);

  -- Salida hoy: el día de la salida aún cuenta.
  update public.cotizaciones set fecha_salida = hoy, vigencia_hasta = hoy where id = b;
  num_hoy := t216.escalar('service_role', null, t216.convertir_sql(b));
  perform t216.afirma('S5 salida de hoy: convierte', num_hoy ~ '^\S+$' and num_hoy not like 'ERR%', num_hoy);

  -- Salida nula (histórica): no caduca por inferencia y la conversión no la rellena.
  update public.cotizaciones set fecha_salida = null, vigencia_hasta = null where id = c;
  r := t216.escalar('service_role', null, t216.convertir_sql(c));
  perform t216.afirma('S6 salida nula (histórica): convierte y conserva nulo', r ~ '^\S+$' and r not like 'ERR%'
    and (select fecha_salida is null from public.cotizaciones where id = c), r);

  -- Solo la vigencia vencida (salida futura): sigue siendo COTIZACION_VENCIDA.
  update public.cotizaciones set fecha_salida = hoy + 10, vigencia_hasta = hoy - 1 where id = d;
  r := t216.escalar('service_role', null, t216.convertir_sql(d));
  perform t216.afirma('S7 solo vigencia vencida: COTIZACION_VENCIDA (la 242 sigue igual)', r like 'ERR P0001: COTIZACION_VENCIDA%', r);

  -- Reintento de una ya convertida: pasa aunque su salida ya quedara atrás.
  update public.cotizaciones set fecha_salida = hoy - 1 where id = b;
  r := t216.escalar('service_role', null, t216.convertir_sql(b));
  perform t216.afirma('S8 reintento de una ya convertida con salida de ayer: mismo número', r = num_hoy, r);
  perform t216.afirma('S9 la guarda no rechaza una cotización que ya no está abierta',
    t216.escalar('service_role', null, format('select public.p40_exigir_cotizacion_vigente(%s)::text', b)) = '');
end $$;

\echo '--- A. Aceptación #63 (envoltura)'
do $$
declare
  hoy date := public.fecha_negocio();
  v bigint; w bigint; n bigint; r text; seq_antes bigint;
begin
  v := t216.crear('admin'); w := t216.crear('admin'); n := t216.crear('admin');
  update public.cotizaciones set fecha_salida = hoy - 1, vigencia_hasta = hoy + 5 where id = v;
  update public.cotizaciones set fecha_salida = hoy - 1, vigencia_hasta = hoy - 2 where id = w;
  update public.cotizaciones set fecha_salida = null, vigencia_hasta = null where id = n;
  seq_antes := t216.ultimo_dtm();
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''h'')::text', v, t216.u('admin')));
  perform t216.afirma('A1 aceptar_oferta_63 con salida de ayer: COTIZACION_SALIDA_PASADA antes de numerar', r like 'ERR P0001: COTIZACION_SALIDA_PASADA%' and t216.ultimo_dtm() = seq_antes, r);
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''h'')::text', w, t216.u('admin')));
  perform t216.afirma('A2 salida de ayer + vigencia vencida: COTIZACION_SALIDA_PASADA (prioridad)', r like 'ERR P0001: COTIZACION_SALIDA_PASADA%' and t216.ultimo_dtm() = seq_antes, r);
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''h'')::text', n, t216.u('admin')));
  perform t216.afirma('A3 salida nula: delega en el cuerpo (no la guarda)', r like '%p63_sin_oferta%', r);
end $$;

\echo '--- R. Reintento de una aceptación #63 existente cuya salida pasa DESPUÉS de aceptarse'
do $$
declare
  hoy date := public.fecha_negocio();
  p bigint; q bigint; d bigint; r text; r2 text; seq_antes bigint; n_antes bigint;
begin
  p := t216.crear('admin'); q := t216.crear('admin'); d := t216.crear('admin');
  insert into public.p63_oferta (cotizacion_id, tenant, paquete_id, trm, rev_fuente, rev_costos, huella, huella_financiera, snapshot)
    select x, 'mayorista', 999253, 4000, 1, 1, 'h', 'f', '{"moneda":"COP"}'::jsonb from unnest(array[p, q, d]) x;
  insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot, estado, moneda_cobro)
    select o.id, o.cotizacion_id, 'mayorista', case o.cotizacion_id when p then 'DTM-T253-P' when q then 'DTM-T253-Q' else 'DTM-T253-D' end,
           t216.u('admin'), hoy - 5, '{}'::jsonb, case o.cotizacion_id when p then 'preparada' when q then 'completa' else 'descartada' end, 'COP'
      from public.p63_oferta o where o.cotizacion_id in (p, q, d);
  update public.cotizaciones set fecha_salida = hoy - 1, vigencia_hasta = hoy - 1 where id in (p, q, d);   -- salida y vigencia pasan después de aceptarse
  seq_antes := t216.ultimo_dtm(); select count(*) into n_antes from public.p63_aceptacion;

  r := t216.escalar('service_role', null, format('select concat_ws(''|'', j->>''estado'', j->>''numero_contrato'') from (select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''f'') as j) s', p, t216.u('admin')));
  perform t216.afirma('R1 aceptación preparada + salida pasada: el reintento devuelve el MISMO número', r = 'preparada|DTM-T253-P', r);
  r2 := t216.escalar('service_role', null, format('select concat_ws(''|'', j->>''estado'', j->>''numero_contrato'') from (select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''f'') as j) s', q, t216.u('admin')));
  perform t216.afirma('R2 aceptación completa + salida pasada: devuelve su estado y el mismo número', r2 = 'completa|DTM-T253-Q', r2);
  perform t216.afirma('R3 los reintentos no consumen consecutivo ni crean otra aceptación',
    t216.ultimo_dtm() = seq_antes and (select count(*) from public.p63_aceptacion) = n_antes);
  r := t216.escalar('service_role', null, format('select public.aceptar_oferta_63(%s, ''mayorista'', %L, ''h'', ''f'')::text', d, t216.u('admin')));
  perform t216.afirma('R4 solo una aceptación DESCARTADA + salida pasada: la guarda rechaza con COTIZACION_SALIDA_PASADA y no numera',
    r like 'ERR P0001: COTIZACION_SALIDA_PASADA%' and t216.ultimo_dtm() = seq_antes, r);
end $$;

\echo '--- C. ACL'
do $$
begin
  perform t216.afirma('C1 authenticated no ejecuta la guarda',
    t216.intenta('authenticated', t216.u('admin'), 'select public.p40_exigir_cotizacion_vigente(1)') ~* 'permission denied|permiso denegado');
  perform t216.afirma('C2 anon no ejecuta la guarda y hay una sola firma',
    t216.intenta('anon', null, 'select public.p40_exigir_cotizacion_vigente(1)') ~* 'permission denied|permiso denegado'
    and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'p40_exigir_cotizacion_vigente') = 1);
end $$;
