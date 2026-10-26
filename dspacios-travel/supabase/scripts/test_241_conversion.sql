-- ═════════════════════════════════════════════════════════════════
-- #40 E2 · Conversión REAL de cotización manual (convertir_cotizacion_manual_controlada) con el tipo de documento (240 + 241 aplicadas).
-- SOLO base desechable. Lo corre test_241_tipo_documento.sh DESPUÉS de los fixtures 216/211 (cat), dentro de begin … commit.
-- ═════════════════════════════════════════════════════════════════
\echo '--- T. Conversión manual: mismo número, tipos CC y CE'
do $$
declare
  cc bigint; ce bigint; pas bigint; ra text; rb text; rc text; rr text; rr2 text;
  v record; antes bigint;
begin
  perform t216.afirma('T0 240 y 241 aplicadas', to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is not null
    and exists (select 1 from information_schema.columns where table_name = 'ventas' and column_name = 'titular_tipo_documento')
    and exists (select 1 from information_schema.columns where table_name = 'ventas' and column_name = 'cliente_tipo_documento'));

  cc  := t216.crear('admin');                                                                                    -- tipoDoc CC, numeroDoc 1234567
  ce  := t216.crear('admin', jsonb_set(t216.cab(), '{payload,cliente,tipoDoc}', '"CE"'));                        -- MISMO número, tipo CE
  pas := t216.crear('admin', jsonb_set(t216.cab(), '{payload,cliente,tipoDoc}', '"PASAPORTE"'));                 -- etiqueta legada

  -- La conversión exige la condición congelada por el pago previo (misma ruta que el servidor).
  perform t216.pagar(cc, 600000, 'e2-cc'); perform t216.pagar(ce, 600000, 'e2-ce'); perform t216.pagar(pas, 600000, 'e2-pas');
  ra := t216.escalar('service_role', null, t216.convertir_sql(cc));
  rb := t216.escalar('service_role', null, t216.convertir_sql(ce));
  rc := t216.escalar('service_role', null, t216.convertir_sql(pas));
  perform t216.afirma('T1 las tres conversiones devuelven un número de contrato distinto',
    ra ~ '^\S+$' and rb ~ '^\S+$' and rc ~ '^\S+$' and ra <> rb and rb <> rc and ra <> rc, ra || ' / ' || rb || ' / ' || rc);

  perform t216.afirma('T2 CC: ventas conserva número y tipo CC',
    (select (cliente_documento, cliente_tipo_documento) = ('1234567', 'CC') from public.ventas where numero_contrato = ra));
  perform t216.afirma('T3 CE (mismo número): ventas conserva CE, no se confunde con CC',
    (select (cliente_documento, cliente_tipo_documento) = ('1234567', 'CE') from public.ventas where numero_contrato = rb));
  perform t216.afirma('T4 «PASAPORTE» legado se guarda como PAS',
    (select cliente_tipo_documento = 'PAS' from public.ventas where numero_contrato = rc));
  perform t216.afirma('T5 el tipo del titular (columna titular_*) queda sin tocar en una manual',
    (select count(*) = 0 from public.ventas where numero_contrato in (ra, rb, rc) and titular_tipo_documento is not null));
  perform t216.afirma('T6 el PVP no depende del tipo (CC y CE iguales)',
    (select count(distinct precio_venta) = 1 from public.ventas where numero_contrato in (ra, rb)));
  perform t216.afirma('T7 el pasajero titular conserva el tipo elegido',
    (select tipo_id from public.contrato_pasajeros where numero_contrato = rb order by orden limit 1) = 'CE');

  -- Reintento: ya convertida → devuelve el MISMO número y no reescribe ni duplica.
  select count(*) into antes from public.ventas;
  rr := t216.escalar('service_role', null, t216.convertir_sql(ce));
  perform t216.afirma('T8 el reintento devuelve el mismo número', rr = rb, rr);
  perform t216.afirma('T9 el reintento no crea otra venta y el tipo sigue CE',
    (select count(*) from public.ventas) = antes and (select cliente_tipo_documento = 'CE' from public.ventas where numero_contrato = rb));
  rr2 := t216.escalar('service_role', null, t216.convertir_sql(cc));
  perform t216.afirma('T10 reintento de CC: mismo número y tipo CC', rr2 = ra and (select cliente_tipo_documento = 'CC' from public.ventas where numero_contrato = ra));
end $$;

\echo '--- A. ACL del wrapper'
do $$
begin
  perform t216.afirma('A1 solo service_role ejecuta el wrapper',
    has_function_privilege('service_role', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE'));
  perform t216.afirma('A2 el wrapper sigue SECURITY INVOKER',
    (select not prosecdef from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)')));
  perform t216.afirma('A3 un usuario autenticado no puede llamarlo',
    t216.intenta('authenticated', t216.u('admin'), 'select public.convertir_cotizacion_manual_controlada(1, ''' || t216.u('admin') || ''')') ~* 'permission denied|permiso denegado');
  perform t216.afirma('A4 anon no puede llamarlo',
    t216.intenta('anon', null, 'select public.convertir_cotizacion_manual_controlada(1, ''' || t216.u('admin') || ''')') ~* 'permission denied|permiso denegado');
  perform t216.afirma('A5 CHECK: un tipo fuera del catálogo se rechaza en titular_tipo_documento y en cliente_tipo_documento',
    t216.intenta('service_role', null, 'update public.ventas set titular_tipo_documento = ''XX''') ~ '23514'
    and t216.intenta('service_role', null, 'update public.ventas set cliente_tipo_documento = ''XX''') ~ '23514');
end $$;
