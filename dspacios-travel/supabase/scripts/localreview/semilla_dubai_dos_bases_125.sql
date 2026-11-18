-- REVISIÓN — semilla SINTÉTICA ADITIVA: calculadora DUBAI con DOS bases sucesivas y UNA sola promoción por noche (#125). Solo bases locales desechables / la de revisión.
-- NO se ejecutó contra ninguna base al escribirla. Idempotente: si el hotel 912511 ya existe no hace nada (no borra ni modifica ningún dato existente).
-- Requiere las migraciones 310 (promo_sigue_base / nino_gratis) y 311 (edades del hotel) y la semilla base de #125 (destino «DEMO 125», proveedor 912501) — si faltan, las crea.
--
-- H5 912511 «Hotel Dubai 2 bases 125 (configurar)» — calculadora Dubai guardada + BASE A (1–5 dic 2026) + BASE B (6–12 dic) + «PRE BF DUBAI» (4–8 dic, −10 %, prioridad 5)
--    SIN el modo nuevo: cruza dos bases. La sección «Una promoción sobre varias bases sucesivas» (/dashboard/producto/hoteles/912511?tab=temporadas#cruce-bases) la lista UNA vez.
-- H6 912512 «Hotel Dubai 2 bases 125 ACTIVO» — igual, pero «PRE BF DUBAI» ya sigue la base ganadora (regla −10 %, todos los días, sin niño gratis) + paquete 912512 (porción terrestre, markup 20 %)
--    para verificar publicación → búsqueda → cotización con las acciones reales.
--
-- Dubai: régimen base PAM (sin suplemento) + FULL con +30.000 por persona. Modificadores: sencilla +20 %, 3er pax −15 %, 4º pax −25 %, niño −50 %, niño 2 −60 %, infante −80 %.
-- Filas de BASE guardadas (las MISMAS que genera la calculadora; calculadas a mano), por persona y noche:
--                     Sencilla   Doble   Triple  Múltiple  Niño 1  Niño 2  Infante
--   BASE A · PAM       120.000  100.000   95.000    90.000  50.000  40.000   20.000
--   BASE A · FULL      150.000  130.000  125.000   120.000  80.000  70.000   50.000
--   BASE B · PAM       180.000  150.000  142.500   135.000  75.000  60.000   30.000
--   BASE B · FULL      210.000  180.000  172.500   165.000 105.000  90.000   60.000
-- Resultado esperado de la promoción −10 % (sobre la tarifa completa del régimen; el infante conserva la de su base):
--   4–5 dic BASE A · PAM    108.000   90.000   85.500    81.000  45.000  36.000   20.000
--   4–5 dic BASE A · FULL   135.000  117.000  112.500   108.000  72.000  63.000   50.000
--   6–8 dic BASE B · PAM    162.000  135.000  128.250   121.500  67.500  54.000   30.000
--   6–8 dic BASE B · FULL   189.000  162.000  155.250   148.500  94.500  81.000   60.000
-- Límite del fixture: una sola categoría (Estandar), una moneda (COP), sin blackouts ni grupos de días ni niño gratis; las fronteras se prueban en pruebas/matrizPromoDerivada125.test.ts.
begin;
do $semilla$
declare
  v_destino bigint;
  v_cat bigint;
  v_plan_pam bigint;
  v_plan_full bigint;
  v_hotel bigint;
  v_params jsonb;
  r record;
begin
  if exists (select 1 from public.hoteles where id = 912511) then
    raise notice 'semilla Dubai 125: el hotel 912511 ya existe; no se cambia nada';
    return;
  end if;
  insert into public.destinos (nombre) select 'DEMO 125' where not exists (select 1 from public.destinos where nombre = 'DEMO 125');
  insert into public.categorias_habitacion (nombre) select 'Estandar' where not exists (select 1 from public.categorias_habitacion where nombre = 'Estandar');
  insert into public.planes_alimentacion (codigo, nombre) select 'PAM', 'Pensión alimentación media' where not exists (select 1 from public.planes_alimentacion where codigo = 'PAM');
  insert into public.planes_alimentacion (codigo, nombre) select 'FULL', 'Todo incluido' where not exists (select 1 from public.planes_alimentacion where codigo = 'FULL');
  insert into public.proveedores (id, nombre) values (912501, 'Proveedor Hotel 125') on conflict (id) do nothing;
  select id into v_destino from public.destinos where nombre = 'DEMO 125' limit 1;
  select id into v_cat from public.categorias_habitacion where nombre = 'Estandar' limit 1;
  select id into v_plan_pam from public.planes_alimentacion where codigo = 'PAM' limit 1;
  select id into v_plan_full from public.planes_alimentacion where codigo = 'FULL' limit 1;
  v_params := jsonb_build_object(
    'regimen_base', 'PAM',
    'modificadores', jsonb_build_object('sencilla_pct', 20, 'pax3_pct', -15, 'pax4_pct', -25, 'nino_pct', -50, 'nino2_pct', -60, 'infante_pct', -80),
    'suplementos', jsonb_build_array(jsonb_build_object('regimen', 'FULL', 'monto', 30000)),
    'bases', jsonb_build_array(
      jsonb_build_object('categoria', 'Estandar', 'temporada', 'BASE A', 'precio', 100000),
      jsonb_build_object('categoria', 'Estandar', 'temporada', 'BASE B', 'precio', 150000)),
    'promos', jsonb_build_array());

  foreach v_hotel in array array[912511, 912512] loop
    insert into public.hoteles (id, destino_id, nombre, modelo_tarifario, moneda, proveedor_id, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max)
      values (v_hotel, v_destino, case when v_hotel = 912511 then 'Hotel Dubai 2 bases 125 (configurar)' else 'Hotel Dubai 2 bases 125 ACTIVO' end, 'persona', 'COP', 912501, 0, 2, 2, 10);
    insert into public.hotel_categorias (hotel_id, categoria_id) values (v_hotel, v_cat);
    insert into public.hotel_regimenes (hotel_id, plan_id) values (v_hotel, v_plan_pam), (v_hotel, v_plan_full);
    insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) values (v_hotel, 'doble', 2, 4, 2, 2, 0, 2, 0, 2);
    insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values
      (v_hotel * 100 + 1, v_hotel, 'BASE A', '2026-12-01', '2026-12-05', 1, 'tarifa'),
      (v_hotel * 100 + 2, v_hotel, 'BASE B', '2026-12-06', '2026-12-12', 1, 'tarifa');
    for r in select * from (values
      ('BASE A', 'PAM', 120000, 100000, 95000, 90000, 50000, 40000, 20000),
      ('BASE A', 'FULL', 150000, 130000, 125000, 120000, 80000, 70000, 50000),
      ('BASE B', 'PAM', 180000, 150000, 142500, 135000, 75000, 60000, 30000),
      ('BASE B', 'FULL', 210000, 180000, 172500, 165000, 105000, 90000, 60000)) as t(temporada, regimen, sen, dob, tri, mul, n1, n2, inf) loop
      insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, neto_nino2, neto_infante)
        values (v_hotel, 'Estandar', r.regimen, r.temporada, r.sen, r.dob, r.tri, r.mul, r.n1, r.n2, r.inf);
    end loop;
    insert into public.hotel_calculadora (hotel_id, tipo, params) values (v_hotel, 'dubai', v_params);
  end loop;

  -- H5: la promoción tal cual se crea en Temporadas (sin el modo nuevo): cruza dos bases.
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
    values (91251103, 912511, 'PRE BF DUBAI', '2026-12-04', '2026-12-08', 5, 'descuento_pct', 10);
  -- H6: la misma promoción ya configurada (sigue la base ganadora) + su regla del 10 %.
  insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, promo_sigue_base)
    values (91251203, 912512, 'PRE BF DUBAI', '2026-12-04', '2026-12-08', 5, 'descuento_pct', 10, true);
  insert into public.hotel_promocion_reglas (promocion_id, grupo_id, valor, dias) values (91251203, null, 10, null);

  -- Paquete de porción terrestre del hotel ACTIVO (la publicación del tarifario se hace con la acción REAL; nada se publica aquí).
  insert into public.armado_paquetes (id, nombre, destino_id, fecha_viaje_inicio, fecha_viaje_fin, pct_mk, tipo, noches, moneda_publicacion)
    values (912512, 'Paquete Dubai 2 bases 125', v_destino, '2026-12-01', '2026-12-31', 0.2, 'porcion_terrestre', 3, 'COP');
  insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) values (912512, 912512, array['Estandar'], array['PAM', 'FULL']);
end
$semilla$;
commit;
