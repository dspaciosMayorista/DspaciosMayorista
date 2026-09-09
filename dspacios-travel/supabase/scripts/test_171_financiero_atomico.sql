-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA DE COMPORTAMIENTO REAL de la migración 171 (escritura financiera
-- atómica + reversión). Ejecuta DML de verdad contra una base LOCAL desechable
-- y termina en ROLLBACK.
--
--   psql -d <base_local> -v ON_ERROR_STOP=1 -f test_171_financiero_atomico.sql
--
-- Casos (los cinco de aceptación que aplican a la capa de datos):
--   A1 · éxito: costos escritos + una CxP por servicio, cada una con su servicio_id;
--   A2 · dos servicios del MISMO tipo_proveedor conservan CxP independientes;
--   A3 · FALLO forzado a mitad del payload → NO queda costo ni CxP parcial
--        (atomicidad real, no "casi todo");
--   A4 · reintento de la operación → no duplica CxP (idempotente);
--   A5 · reversión: un contrato cuya escritura financiera falló se borra
--        completo (sin contrato fantasma), pero NO se borra si ya hubo dinero.
-- ───────────────────────────────────────────────────────────────────────────

begin;

\echo '=== Fixtures ==='
insert into public.destinos (id, nombre) values (991710, 'DESTINO PRUEBA 171') on conflict (id) do nothing;
insert into public.servicios_adicionales (id, nombre, destino_id, precio_persona)
  values (991711, 'Traslado grupal 171', 991710, null),
         (991712, 'City tour 171', 991710, 40000)
  on conflict (id) do nothing;
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta)
  values ('DTM-9171', 'Cliente prueba 171', 'mayorista', 5000000)
  on conflict (numero_contrato) do nothing;

\echo '=== A1 · éxito: costos + CxP con servicio_id ==='
select public.registrar_financiero_contrato(
  'DTM-9171', 'mayorista',
  '{"costo_hotel": 1200000, "costo_receptivo": 300000}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel X','valor_total',1200000,'proveedor','Hotel X SAS'),
    jsonb_build_object('tipo_proveedor','receptivo','servicio','Traslado grupal 171','valor_total',180000,'servicio_id',991711),
    jsonb_build_object('tipo_proveedor','receptivo','servicio','City tour 171','valor_total',120000,'servicio_id',991712)
  )
) is not null as a1_ejecuta;

select
  (select costo_hotel from public.ventas where numero_contrato='DTM-9171') = 1200000 as a1_costo_hotel,
  (select costo_receptivo from public.ventas where numero_contrato='DTM-9171') = 300000 as a1_costo_receptivo,
  (select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-9171') = 3 as a1_tres_cxp,
  (select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-9171' and servicio_id is not null) = 2 as a1_dos_con_servicio;

\echo '=== A2 · dos servicios del MISMO tipo_proveedor: CxP independientes ==='
select
  count(*) = 2                                   as a2_dos_filas_receptivo,
  count(distinct servicio_id) = 2                as a2_servicios_distintos,
  sum(valor_total) = 300000                      as a2_suma_correcta
from public.cuentas_por_pagar
where numero_contrato='DTM-9171' and tipo_proveedor='receptivo';

\echo '=== A3 · FALLO a mitad del payload: nada parcial ==='
do $$
declare v_cxp_antes int; v_costo_antes numeric; v_ok boolean := false;
begin
  select count(*) into v_cxp_antes from public.cuentas_por_pagar where numero_contrato='DTM-9171';
  select costo_aereo into v_costo_antes from public.ventas where numero_contrato='DTM-9171';
  begin
    -- La 2a entrada trae valor_total inválido → debe abortar TODO.
    perform public.registrar_financiero_contrato(
      'DTM-9171', 'mayorista',
      '{"costo_aereo": 999999}'::jsonb,
      jsonb_build_array(
        jsonb_build_object('tipo_proveedor','aereo','servicio','Aéreo X','valor_total',800000),
        jsonb_build_object('tipo_proveedor','receptivo','servicio','Roto','valor_total','no-es-numero')
      )
    );
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'A3 FALLÓ: el payload inválido no abortó'; end if;
  if (select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-9171') <> v_cxp_antes then
    raise exception 'A3 FALLÓ: quedaron CxP parciales';
  end if;
  if (select costo_aereo from public.ventas where numero_contrato='DTM-9171') is distinct from v_costo_antes then
    raise exception 'A3 FALLÓ: el costo se escribió pese al fallo';
  end if;
  raise notice 'A3 OK: fallo a mitad del payload no dejó costo ni CxP parcial';
end $$;

\echo '=== A4 · reintento: no duplica (idempotente) y DEVUELVE las CxP reemplazadas ==='
-- Los ids reemplazados importan: el asiento contable de cada CxP vive FUERA
-- de esta transacción (referencia `cxp:<id>`), así que quien reintenta tiene
-- que poder borrar esos asientos o el costo quedaría dos veces en el libro.
create temporary table t171_ids as
  select id from public.cuentas_por_pagar where numero_contrato='DTM-9171';
select
  (select count(*) from t171_ids) = 3 as a4_ids_previos,
  (
    select coalesce(bool_and(x.id in (select id from t171_ids)), false)
    from jsonb_array_elements_text(
      public.registrar_financiero_contrato(
        'DTM-9171','mayorista','{}'::jsonb,
        jsonb_build_array(jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel X','valor_total',1200000))
      ) -> 'eliminadas'
    ) as e(id_txt)
    cross join lateral (select e.id_txt::bigint as id) x
  ) as a4_devuelve_eliminadas;

select public.registrar_financiero_contrato(
  'DTM-9171', 'mayorista',
  '{"costo_hotel": 1200000, "costo_receptivo": 300000}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel X','valor_total',1200000,'proveedor','Hotel X SAS'),
    jsonb_build_object('tipo_proveedor','receptivo','servicio','Traslado grupal 171','valor_total',180000,'servicio_id',991711),
    jsonb_build_object('tipo_proveedor','receptivo','servicio','City tour 171','valor_total',120000,'servicio_id',991712)
  )
) is not null as a4_reintento_ejecuta;
select
  count(*) = 3               as a4_sigue_habiendo_3,
  sum(valor_total) = 1500000 as a4_suma_sin_duplicar
from public.cuentas_por_pagar where numero_contrato='DTM-9171';

\echo '=== A4-bis · una CxP MANUAL nunca se reemplaza en el reintento ==='
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total, observaciones)
  values ('DTM-9171','mayorista','otro','Cargado a mano', 50000, 'Registrado por contabilidad');
select public.registrar_financiero_contrato(
  'DTM-9171','mayorista','{}'::jsonb,
  jsonb_build_array(jsonb_build_object('tipo_proveedor','hotel','servicio','Hotel X','valor_total',1200000))
) is not null as a4b_ejecuta;
select
  count(*) filter (where observaciones = 'Registrado por contabilidad') = 1 as a4b_manual_intacta
from public.cuentas_por_pagar where numero_contrato='DTM-9171';

\echo '=== A5 · reversión de un contrato incompleto ==='
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta)
  values ('DTM-9172', 'Cliente reversión 171', 'mayorista', 900000);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total)
  values ('DTM-9172','mayorista','hotel','Hotel Y', 500000);
select public.revertir_contrato_incompleto('DTM-9172','mayorista'); -- void: las asserts reales son las de abajo
select
  (select count(*) from public.ventas where numero_contrato='DTM-9172') = 0            as a5_sin_contrato,
  (select count(*) from public.cuentas_por_pagar where numero_contrato='DTM-9172') = 0 as a5_sin_cxp;

\echo '=== A5-bis · con dinero real NO revierte (falla cerrado) ==='
do $$
declare v_ok boolean := false;
begin
  insert into public.ventas (numero_contrato, cliente, tenant, precio_venta)
    values ('DTM-9173','Cliente con abono','mayorista', 700000);
  insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono)
    values ('DTM-9173','mayorista', 100000, current_date);
  begin
    perform public.revertir_contrato_incompleto('DTM-9173','mayorista');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then raise exception 'A5-bis FALLÓ: revirtió un contrato con abonos'; end if;
  if (select count(*) from public.ventas where numero_contrato='DTM-9173') <> 1 then
    raise exception 'A5-bis FALLÓ: el contrato con abono se borró';
  end if;
  raise notice 'A5-bis OK: no revierte un contrato que ya tiene dinero';
end $$;

\echo '=== Resultado esperado: TODAS las columnas a*_ en t ==='
rollback;
