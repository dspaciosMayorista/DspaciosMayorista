-- ───────────────────────────────────────────────────────────────────────────
-- PRUEBA DE COMPORTAMIENTO REAL de la migración 170 (`cuentas_por_pagar.
-- servicio_id`). Ejecuta DML de verdad contra una base LOCAL desechable y
-- termina en ROLLBACK (no deja rastro).
--
--   psql -d <base_local> -v ON_ERROR_STOP=1 -f test_170_cxp_servicio_id.sql
--
-- Comprueba lo que de verdad importa cuando hay dinero de por medio:
--   T1 · una CxP puede declarar de qué servicio viene;
--   T2 · borrar el servicio del catálogo NO borra la cuenta por pagar
--        (ON DELETE SET NULL) — la obligación sobrevive, solo pierde el vínculo;
--   T3 · no se puede apuntar a un servicio inexistente (FK real, no adorno);
--   T4 · las CxP de hotel/aéreo/manuales conviven con servicio_id NULL;
--   T5 · el índice parcial se usa para buscar las CxP de servicios de un
--        contrato (la consulta de reconciliación).
-- ───────────────────────────────────────────────────────────────────────────

begin;

\echo '=== Fixtures ==='
insert into public.destinos (id, nombre) values (990170, 'DESTINO PRUEBA 170')
  on conflict (id) do nothing;
insert into public.servicios_adicionales (id, nombre, destino_id, precio_persona)
  values (990170, 'Tour de prueba 170', 990170, 50000)
  on conflict (id) do nothing;
insert into public.ventas (numero_contrato, cliente, tenant)
  values ('DTM-9170', 'Cliente prueba 170', 'mayorista')
  on conflict (numero_contrato) do nothing;

\echo '=== T1 · una CxP puede declarar su servicio de origen ==='
insert into public.cuentas_por_pagar (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, servicio_id, valor_total)
  values ('DTM-9170', 'mayorista', 'Proveedor X', 'receptivo', 'Tour de prueba 170', 990170, 150000);
select
  count(*) = 1 as t1_cxp_creada_con_servicio_id
from public.cuentas_por_pagar
where numero_contrato = 'DTM-9170' and servicio_id = 990170 and valor_total = 150000;

\echo '=== T2 · borrar el SERVICIO no borra la CxP (la obligación sobrevive) ==='
delete from public.servicios_adicionales where id = 990170;
select
  count(*) = 1                                as t2_cxp_sigue_viva,
  bool_and(servicio_id is null)               as t2_vinculo_en_null,
  bool_and(valor_total = 150000)              as t2_valor_intacto
from public.cuentas_por_pagar
where numero_contrato = 'DTM-9170' and tipo_proveedor = 'receptivo';

\echo '=== T3 · no se puede apuntar a un servicio inexistente ==='
do $$
declare ok boolean := false;
begin
  begin
    insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, servicio_id, valor_total)
      values ('DTM-9170', 'mayorista', 'receptivo', 'Servicio fantasma', 999999999, 1000);
  exception when foreign_key_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'T3 FALLÓ: la FK aceptó un servicio_id inexistente';
  end if;
  raise notice 'T3 OK: la FK rechaza un servicio_id inexistente';
end $$;

\echo '=== T4 · hotel/aéreo/manuales conviven con servicio_id NULL ==='
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total)
  values ('DTM-9170', 'mayorista', 'hotel', 'Hotel prueba', 1200000),
         ('DTM-9170', 'mayorista', 'aereo', 'Aéreo prueba', 800000);
select
  count(*) filter (where servicio_id is null) = 3 as t4_tres_filas_sin_vinculo,
  count(*)                                   = 3 as t4_total_esperado
from public.cuentas_por_pagar
where numero_contrato = 'DTM-9170';

\echo '=== T5 · la consulta de reconciliación (servicio_id not null) funciona ==='
insert into public.servicios_adicionales (id, nombre, destino_id, precio_persona)
  values (990171, 'Asistencia de prueba 170', 990170, 20000);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, servicio_id, valor_total)
  values ('DTM-9170', 'mayorista', 'asistencia', 'Asistencia de prueba 170', 990171, 60000);
select
  count(*) = 1 as t5_solo_la_de_servicio,
  bool_and(servicio_id = 990171) as t5_es_la_correcta
from public.cuentas_por_pagar
where numero_contrato = 'DTM-9170' and servicio_id is not null;

\echo '=== Resultado esperado: TODAS las columnas t*_ en t ==='
rollback;
