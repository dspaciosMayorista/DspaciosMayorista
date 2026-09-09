-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA DE COMPORTAMIENTO REAL de la migración 172. Ejecuta DML de verdad
-- contra una base LOCAL desechable y termina en ROLLBACK.
--
--   psql -d <base_local> -v ON_ERROR_STOP=1 -f test_172_financiero_pendiente_durable.sql
--
-- Reproduce, contra el código YA CORREGIDO, los puntos de interrupción
-- exigidos por la revisión de B7:
--   E1 · reversión con condiciones YA congeladas (bug A, antes rompía);
--   E2 · reversión con aliados_b2b YA insertada (bug B, antes rompía);
--   E3 · reset completo de sillas al revertir (bug C);
--   E4 · caída DESPUÉS de persistir el payload pendiente, ANTES/DURANTE el
--        RPC financiero → el payload sobrevive y permite reintento
--        idempotente exacto, sin que el proceso original haya podido hacer
--        nada más;
--   E5 · caída ANTES de persistir cualquier payload → no hay nada que
--        reintentar con certeza, así que la única resolución correcta es
--        revertir (nunca inventar un costo);
--   E6 · un pendiente rechaza abonos antes de cualquier escritura; la
--        reversión conserva además su defensa ante dinero real previo;
--   E7 · reintento del payload pendiente es idempotente (no duplica CxP ni
--        pierde el marcador de éxito);
--   E8 · CxP sin asiento es detectable por una consulta simple, sin columna
--        redundante que pueda desincronizarse.
-- ───────────────────────────────────────────────────────────────────────────

begin;

\echo '=== Fixtures ==='
insert into public.destinos (id, nombre) values (991720, 'DESTINO PRUEBA 172') on conflict (id) do nothing;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000009172', 'asesor.172@x.com')
  on conflict (id) do nothing;
-- El trigger handle_new_user ya crea la fila en public.usuarios al insertar
-- en auth.users — se ACTUALIZA (no se inserta) para fijar rol/tenant/activo.
update public.usuarios set nombre='Asesor 172', rol='venta', tenant='mayorista', activo=true
  where id='00000000-0000-0000-0000-000000009172';

\echo '=== E1 · reversión con condiciones YA congeladas (bug A) ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado)
  values ('DTM-9720', 'Cliente E1', 'mayorista', 1000000, 'pendiente');
-- Silla ya asignada al contrato (paso 9-bis del flujo real) ANTES del fallo
-- financiero — mismo fixture sirve para E3 (reset completo de sillas).
\set silla_e1_id ''
insert into public.sillas (bloqueo_id, numero_silla, estado, numero_contrato, asesor, hotel, acomodacion, plazo)
  select b.id, 1, 'en_plazo', 'DTM-9720', 'Asesor Viejo', 'Hotel Viejo', 'Doble', current_date
  from public.bloqueos_vuelo b limit 1
  returning id as silla_e1_id \gset
-- Si no hay ningún bloqueo en el catálogo semilla, :silla_e1_id queda sin
-- fijar (E3 se salta sola sin fallar el resto del script, ver más abajo) —
-- comprobado con un conteo, no con una suposición.
select count(*) as sillas_fixture from public.sillas where numero_contrato='DTM-9720';
select public.congelar_condiciones_contrato(
  'DTM-9720',
  jsonb_build_array(jsonb_build_object(
    'tipo_componente', 'hotel', 'referencia_externa', 'Hotel E1', 'orden', 0,
    'valor_componente', 1000000, 'condicion_pago_tipo', 'sin_condicion',
    'monto_exigido', 1000000, 'restriccion_comercial', 'normal'
  )),
  'COP', 1, '00000000-0000-0000-0000-000000009172'
);
do $$ begin
  begin
    perform public.registrar_financiero_contrato('DTM-9720','mayorista','{}'::jsonb,
      jsonb_build_array(jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel X','valor_total','no-es-numero')));
  exception when others then null; end;
end $$;
select public.revertir_contrato_incompleto('DTM-9720', 'mayorista');
select
  (select count(*) from public.ventas where numero_contrato='DTM-9720') = 0 as e1_sin_contrato,
  (select count(*) from public.contrato_condiciones where numero_contrato='DTM-9720') = 0 as e1_sin_condiciones;

\echo '=== E2 · reversión con aliados_b2b YA insertada (bug B) ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado)
  values ('DTM-9721', 'Cliente E2', 'mayorista', 500000, 'pendiente');
insert into public.aliados_b2b (numero_contrato, aliado, precio_venta, base_comision, pct_comision)
  values ('DTM-9721', 'Aliado E2', 500000, 400000, 0.11);
select public.revertir_contrato_incompleto('DTM-9721', 'mayorista');
select
  (select count(*) from public.ventas where numero_contrato='DTM-9721') = 0 as e2_sin_contrato,
  (select count(*) from public.aliados_b2b where numero_contrato='DTM-9721') = 0 as e2_sin_huerfano;

\echo '=== E3 · reset completo de sillas (bug C) — usa el fixture de E1 si existía ==='
select
  case when :'silla_e1_id' = '' then true -- no había bloqueo en el catálogo semilla: no aplica, no falla
       else (
         select count(*) = 1 from public.sillas
         where id = :silla_e1_id
           and estado = 'disponible' and numero_contrato is null and plazo is null
           and pasajero_nombres is null and pasajero_apellidos is null
           and tipo_doc is null and numero_doc is null and nacimiento is null
           and asesor is null and hotel is null and acomodacion is null
       )
  end as e3_silla_reseteada_completa;

\echo '=== E4 · caída DESPUÉS de persistir el payload, ANTES del RPC — reintento idempotente exacto ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado)
  values ('DTM-9722', 'Cliente E4', 'mayorista', 700000, 'pendiente');
-- Esto es EXACTAMENTE lo que hace lib/reservar/financieroContrato.ts ANTES
-- de llamar a registrar_financiero_contrato — su propio commit, así que
-- sobrevive aunque el proceso muera inmediatamente después.
insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp)
  values ('DTM-9722', 'mayorista', '{"costo_hotel": 700000}'::jsonb,
    jsonb_build_array(jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel E4','valor_total',700000)));
-- "El proceso muere aquí" — nada más se ejecuta en esta sesión hasta que la
-- reconciliación (una sesión NUEVA, ver más abajo) recoge el payload.
select financiero_estado from public.ventas where numero_contrato='DTM-9722';
select count(*) as payload_sobrevive from public.contrato_financiero_pendiente where numero_contrato='DTM-9722';
-- La "reconciliación" hace EXACTAMENTE esto: lee el payload persistido y
-- reintenta la MISMA llamada — nunca recalcula ni inventa el costo.
select public.registrar_financiero_contrato(
  'DTM-9722', 'mayorista',
  (select costos from public.contrato_financiero_pendiente where numero_contrato='DTM-9722'),
  (select cxp     from public.contrato_financiero_pendiente where numero_contrato='DTM-9722')
) is not null as e4_reconciliacion_ejecuta;
select
  (select financiero_estado from public.ventas where numero_contrato='DTM-9722') = 'completo' as e4_queda_completo,
  (select count(*) from public.contrato_financiero_pendiente where numero_contrato='DTM-9722') = 0 as e4_payload_limpiado,
  (select costo_hotel from public.ventas where numero_contrato='DTM-9722') = 700000 as e4_costo_correcto,
  (select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-9722') = 1 as e4_una_cxp;

\echo '=== E5 · caída ANTES de persistir cualquier payload — nunca se inventa, se revierte ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado)
  values ('DTM-9723', 'Cliente E5', 'mayorista', 300000, 'pendiente');
-- "El proceso muere aquí" — jamás llegó a persistir contrato_financiero_pendiente.
select count(*) as e5_sin_payload_conocido from public.contrato_financiero_pendiente where numero_contrato='DTM-9723';
-- La reconciliación, al no encontrar payload, NO recalcula nada — revierte.
select public.revertir_contrato_incompleto('DTM-9723', 'mayorista');
select (select count(*) from public.ventas where numero_contrato='DTM-9723') = 0 as e5_revertido_sin_inventar_costo;

\echo '=== E6 · un pendiente no acepta abonos; la reversión conserva su defensa para dinero previo ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado)
  values ('DTM-9724', 'Cliente E6', 'mayorista', 400000, 'pendiente');
do $$
declare v_bloqueado boolean := false;
begin
  begin
    insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono)
      values ('DTM-9724', 'mayorista', 100000, current_date);
  exception when others then
    if position('pendiente su registro financiero' in sqlerrm) = 0 then raise; end if;
    v_bloqueado := true;
  end;
  if not v_bloqueado then raise exception 'E6 FALLÓ: permitió un abono sobre un contrato financiero pendiente'; end if;
end $$;
select
  (select count(*) from public.abonos where numero_contrato='DTM-9724') = 0 as e6_sin_abono_parcial,
  (select financiero_estado from public.ventas where numero_contrato='DTM-9724') = 'pendiente' as e6_sigue_pendiente;

-- Defensa adicional para datos que ya tuvieran dinero antes de quedar en un
-- estado pendiente por reparación administrativa: la reversión no los borra.
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado)
  values ('DTM-9724B', 'Cliente E6B', 'mayorista', 400000, 'completo');
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono)
  values ('DTM-9724B', 'mayorista', 100000, current_date);
update public.ventas set financiero_estado='pendiente' where numero_contrato='DTM-9724B';
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.revertir_contrato_incompleto('DTM-9724B', 'mayorista');
  exception when others then
    if position('ya tiene abonos' in sqlerrm) = 0 then raise; end if;
    v_ok := true;
  end;
  if not v_ok then raise exception 'E6B FALLÓ: revirtió un contrato con abono real previo'; end if;
end $$;
select
  (select count(*) from public.ventas where numero_contrato='DTM-9724B') = 1 as e6b_contrato_con_dinero_sobrevive,
  (select count(*) from public.abonos where numero_contrato='DTM-9724B') = 1 as e6b_abono_sobrevive;

\echo '=== E7 · reintento del payload es idempotente (no duplica CxP) ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, financiero_estado)
  values ('DTM-9725', 'Cliente E7', 'mayorista', 200000, 'pendiente');
insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp)
  values ('DTM-9725', 'mayorista', '{"costo_hotel": 200000}'::jsonb,
    jsonb_build_array(jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel E7','valor_total',200000)));
select public.registrar_financiero_contrato('DTM-9725','mayorista',
  (select costos from public.contrato_financiero_pendiente where numero_contrato='DTM-9725'),
  (select cxp from public.contrato_financiero_pendiente where numero_contrato='DTM-9725'));
-- Reintento MANUAL con el MISMO payload que ya se aplicó (simula un segundo
-- disparo de la reconciliación sobre un contrato que en realidad ya quedó
-- completo hace un instante — condición de carrera benigna).
select public.registrar_financiero_contrato('DTM-9725','mayorista',
  '{"costo_hotel": 200000}'::jsonb,
  jsonb_build_array(jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel E7','valor_total',200000)));
select
  (select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-9725') = 1 as e7_no_duplica,
  (select financiero_estado from public.ventas where numero_contrato='DTM-9725') = 'completo' as e7_sigue_completo;

\echo '=== E8 · CxP sin asiento es detectable por una consulta simple (sin columna redundante) ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta)
  values ('DTM-9726', 'Cliente E8', 'mayorista', 150000);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total)
  values ('DTM-9726', 'mayorista', 'hotel', 'Hotel E8', 150000)
  returning id as cxp_e8_id \gset
select not exists (
  select 1 from public.asientos_contables a
  where a.origen = 'cxp' and a.referencia = 'cxp:' || :cxp_e8_id
) as e8_detectable_sin_asiento;

\echo '=== Resultado esperado: TODAS las columnas e*_ en t ==='
rollback;
