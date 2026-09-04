-- ─────────────────────────────────────────────────────────────────────────
-- Pruebas funcionales LOCALES (Postgres desechable, nunca remoto) de la
-- migración 165 — congelar_condiciones_contrato.
--
-- Uso: aplicar sobre una base con las migraciones 1→165 ya aplicadas
-- (supabase/scripts/pruebas/local-desde-cero.sh), dentro de una transacción
-- que termina en ROLLBACK — no deja ningún dato.
-- ─────────────────────────────────────────────────────────────────────────
begin;

-- Fixtures: dos tenants, tres usuarios (venta autorizado, venta de OTRO
-- tenant, rol sin permiso), un contrato.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'venta.mayorista@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'venta.minorista@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'control.vuelo@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'venta.inactivo@test.local'),
  ('55555555-5555-5555-5555-555555555555', 'super@test.local');

-- `on_auth_user_created` (migración 006) ya insertó la fila en public.usuarios
-- al insertar en auth.users arriba — aquí solo se AJUSTAN rol/activo/tenant a
-- lo que necesita cada escenario de prueba.
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('11111111-1111-1111-1111-111111111111', 'venta.mayorista@test.local', 'Venta Mayorista', 'venta', true, 'mayorista'),
  ('22222222-2222-2222-2222-222222222222', 'venta.minorista@test.local', 'Venta Minorista', 'venta', true, 'minorista'),
  ('33333333-3333-3333-3333-333333333333', 'control.vuelo@test.local', 'Control Vuelo', 'control_vuelo', true, 'mayorista'),
  ('44444444-4444-4444-4444-444444444444', 'venta.inactivo@test.local', 'Venta Inactivo', 'venta', false, 'mayorista'),
  ('55555555-5555-5555-5555-555555555555', 'super@test.local', 'Superadmin', 'superadmin', true, 'mayorista')
on conflict (id) do update set
  nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

insert into public.ventas (numero_contrato, tenant, cliente, estado) values
  ('DTM-9001', 'mayorista', 'Cliente Prueba 165', 'pendiente');

-- ── T1: rol autorizado (venta), mismo tenant, snapshot con 2 componentes ──
select public.congelar_condiciones_contrato(
  'DTM-9001',
  '[
    {"orden":0,"tipo_componente":"hotel","referencia_externa":"Hotel Test","valor_componente":1000000,
     "condicion_pago_tipo":"anticipo_saldo","condicion_pago_pct_aplicable":0.4,"condicion_pago_dias_saldo":20,
     "monto_exigido":400000,"restriccion_comercial":"no_reembolsable_no_endosable"},
    {"orden":1,"tipo_componente":"paquete","referencia_externa":"Paquete Test","valor_componente":200000,
     "condicion_pago_tipo":"normal","monto_exigido":60000,"restriccion_comercial":"normal"}
  ]'::jsonb,
  'COP', 1, '11111111-1111-1111-1111-111111111111'
) as t1_resultado;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.contrato_condiciones where numero_contrato = 'DTM-9001';
  if v_n <> 2 then raise exception 'T1 FALLÓ: esperaba 2 filas, hay %', v_n; end if;
  raise notice 'T1 OK: 2 filas insertadas';
end $$;

do $$
declare v_tipo text; v_pct numeric; v_restr text;
begin
  select condicion_pago_tipo, condicion_pago_pct_aplicable, restriccion_comercial
    into v_tipo, v_pct, v_restr
  from public.contrato_condiciones where numero_contrato = 'DTM-9001' and tipo_componente = 'hotel';
  if v_tipo <> 'anticipo_saldo' or v_pct <> 0.4 or v_restr <> 'no_reembolsable_no_endosable' then
    raise exception 'T1b FALLÓ: valores persistidos incorrectos (tipo=%, pct=%, restr=%)', v_tipo, v_pct, v_restr;
  end if;
  raise notice 'T1b OK: valores reales persistidos, no defaults';
end $$;

-- ── T2: no-op — segunda llamada al MISMO contrato no duplica ──
select public.congelar_condiciones_contrato(
  'DTM-9001',
  '[{"orden":0,"tipo_componente":"servicio","valor_componente":1,"monto_exigido":1}]'::jsonb,
  'COP', 1, '11111111-1111-1111-1111-111111111111'
) as t2_resultado;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.contrato_condiciones where numero_contrato = 'DTM-9001';
  if v_n <> 2 then raise exception 'T2 FALLÓ: la segunda llamada duplicó filas (hay %)', v_n; end if;
  raise notice 'T2 OK: no-op, sigue en 2 filas (no duplicó)';
end $$;

-- ── T3: rol sin permiso (control_vuelo) → debe rechazar ──
do $$
begin
  perform public.congelar_condiciones_contrato(
    'DTM-9001', '[{"orden":0,"tipo_componente":"servicio","valor_componente":1,"monto_exigido":1}]'::jsonb,
    'COP', 1, '33333333-3333-3333-3333-333333333333'
  );
  raise exception 'T3 FALLÓ: control_vuelo no debía poder llamar la función';
exception when others then
  if sqlerrm like '%no autorizado%' then
    raise notice 'T3 OK: rol sin permiso rechazado (%)', sqlerrm;
  else
    raise exception 'T3 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

-- ── T4: usuario inactivo → debe rechazar ──
do $$
begin
  perform public.congelar_condiciones_contrato(
    'DTM-9001', '[{"orden":0,"tipo_componente":"servicio","valor_componente":1,"monto_exigido":1}]'::jsonb,
    'COP', 1, '44444444-4444-4444-4444-444444444444'
  );
  raise exception 'T4 FALLÓ: usuario desactivado no debía poder llamar la función';
exception when others then
  if sqlerrm like '%desactivado%' then
    raise notice 'T4 OK: usuario inactivo rechazado (%)', sqlerrm;
  else
    raise exception 'T4 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

-- ── T5: otro contrato, actor de OTRO tenant → debe rechazar ──
insert into public.ventas (numero_contrato, tenant, cliente, estado) values
  ('DTM-9002', 'mayorista', 'Cliente Prueba 165 B', 'pendiente');
do $$
begin
  perform public.congelar_condiciones_contrato(
    'DTM-9002', '[{"orden":0,"tipo_componente":"servicio","valor_componente":1,"monto_exigido":1}]'::jsonb,
    'COP', 1, '22222222-2222-2222-2222-222222222222'
  );
  raise exception 'T5 FALLÓ: venta de minorista no debía poder congelar un contrato de mayorista';
exception when others then
  if sqlerrm like '%No tienes acceso%' then
    raise notice 'T5 OK: tenant ajeno rechazado (%)', sqlerrm;
  else
    raise exception 'T5 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

-- ── T6: superadmin SÍ puede (excepción global de tenant) ──
select public.congelar_condiciones_contrato(
  'DTM-9002', '[{"orden":0,"tipo_componente":"servicio","valor_componente":500,"monto_exigido":150}]'::jsonb,
  'COP', 1, '55555555-5555-5555-5555-555555555555'
) as t6_resultado;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.contrato_condiciones where numero_contrato = 'DTM-9002';
  if v_n <> 1 then raise exception 'T6 FALLÓ: superadmin debía poder congelar el contrato de otro tenant'; end if;
  raise notice 'T6 OK: superadmin cruza tenant';
end $$;

-- ── T7: contrato inexistente → debe rechazar ──
do $$
begin
  perform public.congelar_condiciones_contrato(
    'DTM-9999', '[{"orden":0,"tipo_componente":"servicio","valor_componente":1,"monto_exigido":1}]'::jsonb,
    'COP', 1, '11111111-1111-1111-1111-111111111111'
  );
  raise exception 'T7 FALLÓ: contrato inexistente no debía aceptar el congelado';
exception when others then
  if sqlerrm like '%no existe%' then
    raise notice 'T7 OK: contrato inexistente rechazado (%)', sqlerrm;
  else
    raise exception 'T7 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

-- ── T8: snapshot no-arreglo (objeto suelto) → debe rechazar ──
insert into public.ventas (numero_contrato, tenant, cliente, estado) values
  ('DTM-9003', 'mayorista', 'Cliente Prueba 165 C', 'pendiente');
do $$
begin
  perform public.congelar_condiciones_contrato(
    'DTM-9003', '{"orden":0}'::jsonb,
    'COP', 1, '11111111-1111-1111-1111-111111111111'
  );
  raise exception 'T8 FALLÓ: snapshot no-arreglo no debía aceptarse';
exception when others then
  if sqlerrm like '%arreglo JSON%' then
    raise notice 'T8 OK: snapshot no-arreglo rechazado (%)', sqlerrm;
  else
    raise exception 'T8 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

-- ── T9: snapshot vacío ([]) → debe rechazar (0 componentes es un bug del llamador) ──
do $$
begin
  perform public.congelar_condiciones_contrato(
    'DTM-9003', '[]'::jsonb,
    'COP', 1, '11111111-1111-1111-1111-111111111111'
  );
  raise exception 'T9 FALLÓ: snapshot vacío no debía aceptarse';
exception when others then
  if sqlerrm like '%no tiene componentes válidos%' then
    raise notice 'T9 OK: snapshot vacío rechazado (%)', sqlerrm;
  else
    raise exception 'T9 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

-- ── T10: ACL — anon/authenticated/public NO pueden ejecutar la función ──
do $$
declare v_acl text;
begin
  select array_to_string(
    (select array_agg(x) from unnest(
       (select proacl::text[] from pg_proc where proname = 'congelar_condiciones_contrato')
     ) as x), ','
  ) into v_acl;
  if v_acl ilike '%=X/%anon%' or v_acl ilike '%anon=X%' then
    raise exception 'T10 FALLÓ: anon tiene EXECUTE sobre congelar_condiciones_contrato';
  end if;
  if v_acl ilike '%authenticated=X%' then
    raise exception 'T10 FALLÓ: authenticated tiene EXECUTE sobre congelar_condiciones_contrato';
  end if;
  raise notice 'T10 OK: ACL de congelar_condiciones_contrato = %', v_acl;
end $$;

do $$
declare v_tiene boolean;
begin
  select has_function_privilege('service_role', 'public.congelar_condiciones_contrato(text, jsonb, text, numeric, uuid)', 'EXECUTE')
    into v_tiene;
  if not v_tiene then raise exception 'T10b FALLÓ: service_role NO tiene EXECUTE'; end if;
  select has_function_privilege('anon', 'public.congelar_condiciones_contrato(text, jsonb, text, numeric, uuid)', 'EXECUTE')
    into v_tiene;
  if v_tiene then raise exception 'T10b FALLÓ: anon SÍ tiene EXECUTE'; end if;
  select has_function_privilege('authenticated', 'public.congelar_condiciones_contrato(text, jsonb, text, numeric, uuid)', 'EXECUTE')
    into v_tiene;
  if v_tiene then raise exception 'T10b FALLÓ: authenticated SÍ tiene EXECUTE'; end if;
  raise notice 'T10b OK: service_role sí, anon/authenticated no (has_function_privilege)';
end $$;

-- ── T11: inmutabilidad heredada de la 164 — un UPDATE directo sobre una fila
--    ya congelada por esta función también debe rechazarse (el trigger de la
--    164 no distingue el origen de la fila).
do $$
begin
  update public.contrato_condiciones set monto_exigido = 999999
    where id = (select id from public.contrato_condiciones where numero_contrato = 'DTM-9001' limit 1);
  raise exception 'T11 FALLÓ: se pudo modificar una fila ya congelada';
exception when others then
  if sqlerrm like '%permanente%' then
    raise notice 'T11 OK: candado de inmutabilidad de la 164 sigue aplicando (%)', sqlerrm;
  else
    raise exception 'T11 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

do $$
begin
  raise notice '=== TODAS LAS PRUEBAS DE LA 165 PASARON ===';
end $$;

rollback;
