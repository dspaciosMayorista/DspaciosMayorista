-- Prueba de comportamiento de la migracion 173.
-- Ejecutar solo en Postgres local despues de aplicar la migracion.
-- Todo ocurre dentro de una transaccion que termina en ROLLBACK.
--
-- psql -d <base-local> -v ON_ERROR_STOP=1 \
--   -f supabase/scripts/test_173_tarifas_alojamiento_unidad.sql

begin;

-- La base local recien reseteada puede no tener hoteles. En esta prueba
-- desactivamos temporalmente los triggers (incluidas las FK) para usar dos ids
-- sinteticos. La tabla no tiene triggers propios; los CHECK y UNIQUE que esta
-- prueba verifica siguen activos.
-- ROLLBACK restaura el ajuste y elimina todas las filas de prueba.
set local session_replication_role = replica;

do $$
declare
  v_hotel_1 constant bigint := 900000000000001;
  v_hotel_2 constant bigint := 900000000000002;
  v_rechazo boolean;
begin
  insert into public.hotel_tarifas_unidad (
    hotel_id, tarifa_id, version_tarifario, payload
  ) values (
    v_hotel_1,
    '__test_173_tarifa__',
    '__test_173_v1__',
    '{"id":"__test_173_tarifa__","versionTarifario":"__test_173_v1__"}'::jsonb
  );

  -- La misma identidad/version no puede reaparecer ni siquiera en otro hotel:
  -- el snapshot solo guarda esa pareja y debe resolver una fila unica.
  v_rechazo := false;
  begin
    insert into public.hotel_tarifas_unidad (
      hotel_id, tarifa_id, version_tarifario, payload
    ) values (
      v_hotel_2,
      '__test_173_tarifa__',
      '__test_173_v1__',
      '{"id":"__test_173_tarifa__","versionTarifario":"__test_173_v1__"}'::jsonb
    );
  exception when unique_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 173 fallo: identidad/version duplicada entre hoteles fue aceptada';
  end if;

  v_rechazo := false;
  begin
    insert into public.hotel_tarifas_unidad (
      hotel_id, tarifa_id, version_tarifario, payload
    ) values (
      v_hotel_1,
      '__test_173_sin_id__',
      '__test_173_v1__',
      '{"versionTarifario":"__test_173_v1__"}'::jsonb
    );
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 173 fallo: payload sin id fue aceptado';
  end if;

  v_rechazo := false;
  begin
    insert into public.hotel_tarifas_unidad (
      hotel_id, tarifa_id, version_tarifario, payload
    ) values (
      v_hotel_1,
      '__test_173_columna__',
      '__test_173_v1__',
      '{"id":"__test_173_otro__","versionTarifario":"__test_173_v1__"}'::jsonb
    );
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 173 fallo: payload.id incoherente fue aceptado';
  end if;

  v_rechazo := false;
  begin
    insert into public.hotel_tarifas_unidad (
      hotel_id, tarifa_id, version_tarifario, payload
    ) values (
      v_hotel_1,
      '__test_173_sin_version__',
      '__test_173_v1__',
      '{"id":"__test_173_sin_version__"}'::jsonb
    );
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 173 fallo: payload sin versionTarifario fue aceptado';
  end if;

  v_rechazo := false;
  begin
    insert into public.hotel_tarifas_unidad (
      hotel_id, tarifa_id, version_tarifario, payload
    ) values (
      v_hotel_1,
      '__test_173_version__',
      '__test_173_v1__',
      '{"id":"__test_173_version__","versionTarifario":"__test_173_v2__"}'::jsonb
    );
  exception when check_violation then
    v_rechazo := true;
  end;
  if not v_rechazo then
    raise exception 'TEST 173 fallo: payload.versionTarifario incoherente fue aceptado';
  end if;

  raise notice 'TEST 173 OK: identidad global y coherencia del payload verificadas';
end
$$;

rollback;
