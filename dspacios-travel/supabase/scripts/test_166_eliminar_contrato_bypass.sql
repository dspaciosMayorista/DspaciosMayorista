-- ─────────────────────────────────────────────────────────────────────────
-- Pruebas funcionales LOCALES (Postgres desechable, nunca remoto) de la
-- migración 166 — bypass controlado de inmutabilidad para eliminar_contrato().
--
-- Uso: aplicar sobre una base con las migraciones 1→166 ya aplicadas
-- (supabase/scripts/pruebas/local-desde-cero.sh), dentro de una transacción
-- que termina en ROLLBACK — no deja ningún dato.
--
-- Cubre exactamente el pliego de pruebas pedido en la revisión del PR #282:
--   T1) superadmin SÍ puede eliminar un contrato con contrato_condiciones.
--   T2) las filas de contrato_condiciones desaparecen (cascade real).
--   T3) usuario NO autorizado sigue sin poder eliminar contratos (candado
--       de rol intacto, con o sin condiciones congeladas).
--   T4) DELETE directo sobre contrato_condiciones (fuera de
--       eliminar_contrato(), flag nunca encendido en esta sesión) sigue
--       bloqueado.
--   T5) UPDATE directo sobre contrato_condiciones sigue bloqueado SIEMPRE —
--       incluso si alguien enciende el flag a mano en su propia sesión
--       (prueba explícita de que el bypass nunca alcanza a UPDATE).
--   T6) doble llamada / contrato inexistente conserva el comportamiento
--       previo (no-op silencioso, sin excepción).
-- ─────────────────────────────────────────────────────────────────────────
begin;

-- Fixtures: un superadmin y un rol sin permiso, dos contratos con condiciones
-- congeladas (uno para T1/T2, otro para T3), un tercero para T4/T5.
insert into auth.users (id, email) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'super166@test.local'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'venta166@test.local')
on conflict do nothing;

insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'super166@test.local', 'Super 166', 'superadmin', true, 'mayorista'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'venta166@test.local', 'Venta 166', 'venta', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;

insert into public.ventas (numero_contrato, tenant, cliente, estado) values
  ('DTM-9200', 'mayorista', 'Cliente 166 A', 'pendiente'),
  ('DTM-9201', 'mayorista', 'Cliente 166 B', 'pendiente'),
  ('DTM-9202', 'mayorista', 'Cliente 166 C', 'pendiente');

select public.congelar_condiciones_contrato(
  'DTM-9200',
  '[{"orden":0,"tipo_componente":"hotel","valor_componente":1000000,"condicion_pago_tipo":"pago_total","monto_exigido":1000000,"restriccion_comercial":"no_reembolsable_no_endosable"}]'::jsonb,
  'COP', 1, 'bbbbbbbb-2222-2222-2222-222222222222'
);
select public.congelar_condiciones_contrato(
  'DTM-9201',
  '[{"orden":0,"tipo_componente":"servicio","valor_componente":1,"monto_exigido":1}]'::jsonb,
  'COP', 1, 'bbbbbbbb-2222-2222-2222-222222222222'
);
select public.congelar_condiciones_contrato(
  'DTM-9202',
  '[{"orden":0,"tipo_componente":"servicio","valor_componente":1,"monto_exigido":1}]'::jsonb,
  'COP', 1, 'bbbbbbbb-2222-2222-2222-222222222222'
);

do $$
declare v_n int;
begin
  select count(*) into v_n from public.contrato_condiciones where numero_contrato in ('DTM-9200','DTM-9201','DTM-9202');
  if v_n <> 3 then raise exception 'FIXTURE FALLÓ: esperaba 3 condiciones congeladas, hay %', v_n; end if;
end $$;

-- Simula la sesión del superadmin (mi_rol()/auth.uid() vía el claim del JWT,
-- mismo mecanismo que usan las demás pruebas locales de este repo). El rol de
-- conexión de Postgres se deja en el default de esta sesión (postgres,
-- superusuario — así llega la propia local-desde-cero.sh), a propósito: T4/T5
-- necesitan un DELETE/UPDATE directo que SÍ llegue a evaluar el trigger de
-- inmutabilidad — con el rol `authenticated` sin policy de UPDATE/DELETE
-- (por diseño, ver migración 164), RLS filtraría la fila ANTES de que el
-- trigger se ejecute, y la prueba pasaría por la razón equivocada.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- ── T1 + T2: superadmin elimina DTM-9200 (con condiciones) → antes de la
--    166 esto fallaba (reproducido y documentado en el review de PR #282);
--    ahora debe tener éxito Y las condiciones deben desaparecer por cascade.
do $$
begin
  perform public.eliminar_contrato('DTM-9200', false);
  raise notice 'T1 OK: eliminar_contrato() tuvo éxito con condiciones congeladas presentes';
exception when others then
  raise exception 'T1 FALLÓ: eliminar_contrato() debía tener éxito, pero lanzó: %', sqlerrm;
end $$;

do $$
declare v_ventas int; v_cond int;
begin
  select count(*) into v_ventas from public.ventas where numero_contrato = 'DTM-9200';
  select count(*) into v_cond from public.contrato_condiciones where numero_contrato = 'DTM-9200';
  if v_ventas <> 0 then raise exception 'T1 FALLÓ: la venta DTM-9200 sigue existiendo (%)', v_ventas; end if;
  if v_cond <> 0 then raise exception 'T2 FALLÓ: quedaron % condiciones congeladas de DTM-9200 (debía cascadear a 0)', v_cond; end if;
  raise notice 'T2 OK: contrato_condiciones de DTM-9200 desapareció por cascade (0 filas)';
end $$;

-- ── T3: usuario sin permiso (rol venta) sigue sin poder eliminar, tenga o
--    no condiciones congeladas (DTM-9201 SÍ tiene). El candado de rol es lo
--    PRIMERO que evalúa la función — nunca llega ni al bypass.
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$
begin
  perform public.eliminar_contrato('DTM-9201', false);
  raise exception 'T3 FALLÓ: un usuario con rol venta pudo eliminar un contrato';
exception when others then
  if sqlerrm like '%Solo un superadmin%' then
    raise notice 'T3 OK: rol sin permiso rechazado (%)', sqlerrm;
  else
    raise exception 'T3 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.ventas where numero_contrato = 'DTM-9201';
  if v_n <> 1 then raise exception 'T3 FALLÓ: DTM-9201 no debía tocarse (quedan % filas)', v_n; end if;
end $$;

-- Vuelve a la sesión del superadmin para el resto de las pruebas.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- ── T4: DELETE directo sobre contrato_condiciones (nunca a través de
--    eliminar_contrato()) sigue bloqueado — el flag nunca se encendió en
--    esta sesión antes de este DELETE suelto.
do $$
begin
  delete from public.contrato_condiciones where numero_contrato = 'DTM-9201';
  raise exception 'T4 FALLÓ: se pudo borrar contrato_condiciones directo, sin pasar por eliminar_contrato()';
exception when others then
  if sqlerrm like '%permanente%' then
    raise notice 'T4 OK: DELETE directo sigue bloqueado fuera de eliminar_contrato() (%)', sqlerrm;
  else
    raise exception 'T4 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;

-- ── T5: UPDATE directo sigue bloqueado SIEMPRE, incluso si alguien enciende
--    el flag de sesión a mano (prueba explícita de que el bypass jamás
--    alcanza UPDATE, sin importar quién prenda el flag ni por qué).
do $$
begin
  perform set_config('app.eliminando_contrato', 'true', true);
  update public.contrato_condiciones set monto_exigido = 999999 where numero_contrato = 'DTM-9201';
  raise exception 'T5 FALLÓ: se pudo modificar una condición congelada con el flag encendido';
exception when others then
  if sqlerrm like '%permanente%' then
    raise notice 'T5 OK: UPDATE sigue bloqueado incluso con el flag de bypass encendido a mano (%)', sqlerrm;
  else
    raise exception 'T5 FALLÓ con error inesperado: %', sqlerrm;
  end if;
end $$;
-- Apaga el flag que se encendió a mano arriba, para no contaminar T6.
select set_config('app.eliminando_contrato', 'false', true);

-- Y, por completitud: con el flag encendido a mano, un DELETE directo (sin
-- pasar por eliminar_contrato(), pero con el flag ya prendido en la MISMA
-- sesión/transacción) SÍ pasaría — esto es el riesgo residual documentado en
-- la cabecera de la 166 (solo alcanzable con una conexión SQL directa de
-- confianza total, nunca desde la API REST de la app: cada request de
-- PostgREST es su propia transacción aislada, sin forma de que un cliente
-- prenda el flag en una llamada y lo aproveche en otra). Se deja constancia
-- explícita en vez de fingir que no existe.
do $$
begin
  perform set_config('app.eliminando_contrato', 'true', true);
  delete from public.contrato_condiciones where numero_contrato = 'DTM-9202';
  raise notice 'NOTA (riesgo residual documentado): con el flag prendido A MANO en la MISMA sesión, un DELETE directo sí pasa — ver cabecera de la 166.';
end $$;
select set_config('app.eliminando_contrato', 'false', true);

-- ── T6: doble llamada y contrato inexistente conservan el comportamiento
--    previo (no-op silencioso, RETURNS void, sin excepción).
do $$
begin
  perform public.eliminar_contrato('DTM-9200', false); -- ya no existe (T1 la borró)
  raise notice 'T6 OK: eliminar_contrato() sobre un numero ya eliminado no lanza (no-op)';
exception when others then
  raise exception 'T6 FALLÓ: doble llamada / contrato inexistente lanzó un error nuevo: %', sqlerrm;
end $$;

do $$
begin
  perform public.eliminar_contrato('DTM-9999-NO-EXISTE', false);
  raise notice 'T6b OK: eliminar_contrato() sobre un contrato que nunca existió no lanza (no-op)';
exception when others then
  raise exception 'T6b FALLÓ: contrato inexistente lanzó un error nuevo: %', sqlerrm;
end $$;

do $$
begin
  raise notice '=== TODAS LAS PRUEBAS DE LA 166 PASARON ===';
end $$;

rollback;
