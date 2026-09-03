-- ═══════════════════════════════════════════════════════════════════════════
-- COMMIT 6 · Condiciones PERMANENTES del contrato, PDF y candados.
--
-- Correr SOLO contra una base PostgreSQL DESECHABLE donde esté aplicada la
-- migración REAL 1→163 + `20260601000164_condiciones_pago_componente.sql`
-- (con el Commit 6 ya incluido en el mismo archivo). NO correr contra
-- Supabase real, preview ni la BD local persistente.
--
-- Ejecución: `psql -v ON_ERROR_STOP=1 -f test_164_commit6_condiciones_permanentes.sql`
-- como superusuario. Todo escenario que no cumpla su aserción lanza una
-- excepción → psql aborta (código de salida ≠ 0) → la prueba FALLA.
--
-- Cubre (numeración según los 15 casos exigidos del Commit 6; los 4 que
-- corresponden a UI/PDF/resolver puro/tsc se cubren aparte, ver el reporte):
--   9.  Un override válido de superadmin queda auditado correctamente.
--   10. Motivo vacío / rol no autorizado / tenant ajeno se rechazan.
--   11. El snapshot original queda byte-idéntico después de un override.
--   12. UPDATE/DELETE directo de condiciones y de overrides bloqueado en BD.
--   13. Cambio directo de ventas.cotizacion_id bloqueado en BD.
--   14. Lectura por tenant permitida/cruzada denegada (estructural, vía RLS
--       policy — ver también postcheck 10, que verifica la expresión).
-- Además: CHECK de restricción ampliado a 3 valores (soporte del Commit 6).
--
-- Convención: superusuario NO tiene RLS activa por defecto sobre tablas que
-- no son suyas si es propietario — como este script corre como el dueño de
-- las tablas (igual que el resto de la suite 164), las pruebas de candado se
-- centran en TRIGGERS (que SIEMPRE se ejecutan, sean quien sean el rol) y en
-- el RPC (que re-verifica todo explícitamente en su cuerpo) — no en RLS en
-- sí, que ya se audita estructuralmente en postcheck_164 (sección 10).
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── Ayudante de aserción (mismo patrón que el resto de la suite 164). ──────
create schema if not exists _t164;
grant usage on schema _t164 to service_role, anon, authenticated;
create or replace function _t164.expect(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if coalesce(p_cond, false) = false then
    raise exception 'ASSERT %', p_msg;
  end if;
end $$;
grant execute on function _t164.expect(boolean, text) to service_role, anon, authenticated;

-- ── Limpieza de la fixture propia de este archivo (idempotente). ──────────
-- `contrato_condiciones`/`restriccion_overrides` llevan el candado de
-- inmutabilidad/solo-append del Commit 6 (BEFORE UPDATE/DELETE, sin
-- excepción de rol): un DELETE de fila NUNCA funciona sobre ellas — ni
-- siquiera para limpiar la fixture de esta prueba. TRUNCATE sí funciona
-- (no dispara triggers de fila), mismo criterio que usa el resto de la
-- suite 164 para limpiar entre corridas — es lo correcto contra una BD
-- DESECHABLE (nunca correr esto contra Supabase real).
truncate table public.restriccion_overrides, public.contrato_condiciones cascade;
delete from public.ventas where numero_contrato in ('DTM-9991','MIN-9992');
delete from public.usuarios where email like '%@c6test';
delete from auth.users where email like '%@c6test';

-- ── Actores. ────────────────────────────────────────────────────────────
insert into auth.users (id, email, aud, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001','super@c6test','authenticated','authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002','adm@c6test','authenticated','authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000003','superinact@c6test','authenticated','authenticated')
on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('bbbbbbbb-0000-0000-0000-000000000001','super@c6test','SUPER C6','superadmin', true, 'mayorista'),
  ('bbbbbbbb-0000-0000-0000-000000000002','adm@c6test','ADM C6','administracion', true, 'mayorista'),
  ('bbbbbbbb-0000-0000-0000-000000000003','superinact@c6test','SUPER INACTIVO','superadmin', false, 'mayorista')
on conflict (id) do update set email=excluded.email, nombre=excluded.nombre, rol=excluded.rol,
  activo=excluded.activo, tenant=excluded.tenant;

-- ── Dos contratos + condiciones ya "convertidas" (fixture directa: no
--    depende de la conversión real — este archivo prueba SOLO los objetos
--    del Commit 6, que no les importa cómo llegaron las filas). ───────────
insert into public.ventas (numero_contrato, tenant, cliente, precio_venta, moneda, fecha_salida, estado)
values
  ('DTM-9991','mayorista','Cliente Uno', 10000000, 'COP', '2026-12-01', 'activo'),
  ('MIN-9992','minorista','Cliente Dos', 5000000, 'COP', '2026-12-15', 'activo');

insert into public.contrato_condiciones
  (numero_contrato, tipo_componente, referencia_externa, orden, valor_componente,
   condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
   monto_exigido, restriccion_comercial, moneda, trm)
values
  ('DTM-9991','hotel','Hotel A',0, 6000000,'pago_total', null, null, 6000000,'no_reembolsable_no_endosable','COP',1),
  ('DTM-9991','hotel','Hotel B',1, 4000000,'anticipo_saldo', 0.30, 30, 1200000,'normal','COP',1),
  ('MIN-9992','hotel','Hotel C',0, 5000000,'normal', null, null, 1500000,'normal','COP',1)
returning id;

-- id de la fila "Hotel A" (restringida) del contrato 1 — se resuelve por
-- referencia_externa para no depender de que bigserial arranque en 1.
do $$
declare v_cond_a bigint; v_cond_c bigint; v_err text; v_id bigint;
begin
  select id into v_cond_a from public.contrato_condiciones
    where numero_contrato='DTM-9991' and referencia_externa='Hotel A';
  select id into v_cond_c from public.contrato_condiciones
    where numero_contrato='MIN-9992' and referencia_externa='Hotel C';

  -- ── T1: UPDATE directo de contrato_condiciones bloqueado. ──────────────
  begin
    update public.contrato_condiciones set monto_exigido = 999 where id = v_cond_a;
    perform _t164.expect(false, 'T1: el UPDATE de contrato_condiciones debió fallar (inmutable)');
  exception when others then
    perform _t164.expect(sqlerrm like '%permanente%', 'T1: el error debe mencionar que es permanente — got: ' || sqlerrm);
  end;

  -- ── T2: DELETE directo de contrato_condiciones bloqueado. ──────────────
  begin
    delete from public.contrato_condiciones where id = v_cond_a;
    perform _t164.expect(false, 'T2: el DELETE de contrato_condiciones debió fallar (inmutable)');
  exception when others then
    perform _t164.expect(sqlerrm like '%permanente%', 'T2: el error debe mencionar que es permanente — got: ' || sqlerrm);
  end;

  -- Snapshot sigue intacto tras los intentos T1/T2.
  perform _t164.expect(
    (select monto_exigido from public.contrato_condiciones where id = v_cond_a) = 6000000,
    'T2b: el snapshot original debe seguir byte-idéntico tras los intentos de UPDATE/DELETE');

  -- ── T3: UPDATE de ventas.cotizacion_id (NULL → valor) bloqueado. ───────
  begin
    update public.ventas set cotizacion_id = 999999 where numero_contrato = 'DTM-9991';
    perform _t164.expect(false, 'T3: cambiar ventas.cotizacion_id por UPDATE debió fallar');
  exception when others then
    perform _t164.expect(sqlerrm like '%cotizacion_id%', 'T3: el error debe mencionar cotizacion_id — got: ' || sqlerrm);
  end;

  -- ── T4: RPC rechaza usuario NO superadmin (administracion). ────────────
  begin
    perform public.registrar_override_restriccion(
      'DTM-9991', v_cond_a, 'no_reembolsable_no_endosable', 'motivo de prueba',
      'bbbbbbbb-0000-0000-0000-000000000002');
    perform _t164.expect(false, 'T4: administracion NO debe poder registrar un override');
  exception when others then
    perform _t164.expect(sqlerrm like '%uperadmin%', 'T4: el error debe mencionar superadmin — got: ' || sqlerrm);
  end;

  -- ── T5: RPC rechaza usuario superadmin INACTIVO. ───────────────────────
  begin
    perform public.registrar_override_restriccion(
      'DTM-9991', v_cond_a, 'no_reembolsable_no_endosable', 'motivo de prueba',
      'bbbbbbbb-0000-0000-0000-000000000003');
    perform _t164.expect(false, 'T5: superadmin desactivado NO debe poder registrar un override');
  exception when others then
    perform _t164.expect(sqlerrm like '%desactivado%', 'T5: el error debe mencionar desactivado — got: ' || sqlerrm);
  end;

  -- ── T6: RPC rechaza motivo vacío/blanco. ───────────────────────────────
  begin
    perform public.registrar_override_restriccion(
      'DTM-9991', v_cond_a, 'no_reembolsable_no_endosable', '   ',
      'bbbbbbbb-0000-0000-0000-000000000001');
    perform _t164.expect(false, 'T6: motivo vacío/blanco debió rechazarse');
  exception when others then
    perform _t164.expect(sqlerrm like '%motivo%', 'T6: el error debe mencionar el motivo — got: ' || sqlerrm);
  end;

  -- ── T7: RPC rechaza restriccion_afectada vacía. ────────────────────────
  begin
    perform public.registrar_override_restriccion(
      'DTM-9991', v_cond_a, '', 'motivo de prueba',
      'bbbbbbbb-0000-0000-0000-000000000001');
    perform _t164.expect(false, 'T7: restriccion_afectada vacía debió rechazarse');
  exception when others then
    perform _t164.expect(sqlerrm like '%restricci%', 'T7: el error debe mencionar la restricción — got: ' || sqlerrm);
  end;

  -- ── T8: RPC rechaza condición de OTRO contrato (alcance explícito). ────
  begin
    perform public.registrar_override_restriccion(
      'DTM-9991', v_cond_c, 'normal', 'motivo de prueba',
      'bbbbbbbb-0000-0000-0000-000000000001');
    perform _t164.expect(false, 'T8: una condición de OTRO contrato debió rechazarse');
  exception when others then
    perform _t164.expect(sqlerrm like '%pertenece%', 'T8: el error debe mencionar pertenencia — got: ' || sqlerrm);
  end;

  -- ── T9: RPC rechaza contrato inexistente. ──────────────────────────────
  begin
    perform public.registrar_override_restriccion(
      'DTM-9999', null, 'normal', 'motivo de prueba',
      'bbbbbbbb-0000-0000-0000-000000000001');
    perform _t164.expect(false, 'T9: contrato inexistente debió rechazarse');
  exception when others then
    perform _t164.expect(sqlerrm like '%no existe%', 'T9: el error debe decir que no existe — got: ' || sqlerrm);
  end;

  -- ── T10: override VÁLIDO de superadmin — se registra y queda auditado. ─
  select public.registrar_override_restriccion(
    'DTM-9991', v_cond_a, 'no_reembolsable_no_endosable', 'Cliente pagó anticipo, se acuerda flexibilidad comercial excepcional.',
    'bbbbbbbb-0000-0000-0000-000000000001') into v_id;
  perform _t164.expect(v_id is not null and v_id > 0, 'T10: debe devolver el id del override creado');
  perform _t164.expect(
    (select count(*) from public.restriccion_overrides
       where id = v_id and numero_contrato='DTM-9991' and contrato_condicion_id=v_cond_a
         and restriccion_afectada='no_reembolsable_no_endosable'
         and usuario_id='bbbbbbbb-0000-0000-0000-000000000001'
         and usuario_email='super@c6test') = 1,
    'T10: el override debe quedar auditado con actor/alcance server-derivados');

  -- ── T11: el snapshot original NO se tocó por el override (byte-idéntico). ─
  perform _t164.expect(
    (select restriccion_comercial from public.contrato_condiciones where id = v_cond_a) = 'no_reembolsable_no_endosable'
    and (select monto_exigido from public.contrato_condiciones where id = v_cond_a) = 6000000,
    'T11: contrato_condiciones NO debe cambiar tras registrar un override — el original queda intacto');

  -- ── T12: el override YA CREADO no se puede editar ni borrar (solo-append). ─
  begin
    update public.restriccion_overrides set motivo = 'editado' where id = v_id;
    perform _t164.expect(false, 'T12a: UPDATE de un override ya creado debió fallar');
  exception when others then
    perform _t164.expect(sqlerrm like '%solo-append%', 'T12a: el error debe mencionar solo-append — got: ' || sqlerrm);
  end;
  begin
    delete from public.restriccion_overrides where id = v_id;
    perform _t164.expect(false, 'T12b: DELETE de un override ya creado debió fallar');
  exception when others then
    perform _t164.expect(sqlerrm like '%solo-append%', 'T12b: el error debe mencionar solo-append — got: ' || sqlerrm);
  end;

  raise notice 'COMMIT 6 — pruebas T1..T12: TODAS PASARON.';
end $$;

-- ── T13: el CHECK de restricción ahora admite los 3 valores del motor TS. ──
do $$
declare v_ok boolean := true;
begin
  begin
    insert into public.contrato_condiciones
      (numero_contrato, tipo_componente, orden, valor_componente, condicion_pago_tipo,
       monto_exigido, restriccion_comercial, moneda, trm)
    values ('MIN-9992','servicio', 5, 100, 'normal', 30, 'no_reembolsable_no_endosable', 'COP', 1);
  exception when others then
    v_ok := false;
  end;
  perform _t164.expect(v_ok, 'T13: el CHECK debe aceptar no_reembolsable_no_endosable en contrato_condiciones');
end $$;

-- ── Limpieza final (la prueba no deja datos). TRUNCATE, no DELETE — ver la
--    nota de arriba: el candado de inmutabilidad del Commit 6 bloquea
--    cualquier DELETE de fila sobre estas dos tablas, sin excepción. ───────
truncate table public.restriccion_overrides, public.contrato_condiciones cascade;
delete from public.ventas where numero_contrato in ('DTM-9991','MIN-9992');
delete from public.usuarios where email like '%@c6test';
delete from auth.users where email like '%@c6test';

select 'COMMIT 6 — SUITE SQL COMPLETA: TODAS LAS ASERCIONES PASARON.' as resultado;
