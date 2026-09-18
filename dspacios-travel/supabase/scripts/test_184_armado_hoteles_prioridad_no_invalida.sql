-- Test 184 — cobertura funcional de `tarifario_trg_bump_armado_hoteles`
-- (defecto P1: `armado_hoteles.prioridad` NO debe invalidar el snapshot).
--
-- Usa DATOS SINTÉTICOS PROPIOS (3 paquetes y hasta 4 hoteles de prueba) para no
-- depender del catálogo real — construidos y destruidos dentro de una
-- transacción que termina en ROLLBACK: no deja NINGÚN dato persistido sin
-- importar el resultado. Requiere al menos un `destino` (FK de
-- `hoteles`/`armado_paquetes`); si no hay ninguno, el bloque FALLA
-- EXPLÍCITAMENTE con `raise exception` (nunca `rollback` dentro del `DO`:
-- PL/pgSQL no permite control de transacción dentro de un bloque anónimo — el
-- `rollback;` final, fuera del bloque, cierra la transacción sin dejar datos).
--
-- El estado de partida de cada caso se normaliza a "publicado y sano"
-- (`tarifario_estado = 'listo'`, `tarifario_snapshot_publicable = true`) y
-- se fotografía la revisión: así el caso "no invalida" es observable de verdad
-- (revisión igual, estado igual, publicable sigue true). Ese `update` de las
-- columnas `tarifario_*` NO dispara ningún trigger (el de `armado_paquetes` es
-- `update of nombre, tipo, destino_id, pct_mk, …` — no vigila las suyas).

begin;

do $$
declare
  v_destino_id bigint;
  v_paquete_a  bigint;
  v_paquete_b  bigint;
  v_hotel      bigint[] := array[]::bigint[];
  v_hotel_id   bigint;
  i            int;
  v_rev        bigint;
  v_rev_antes  bigint;
  v_rev_a_antes bigint;
  v_rev_b      bigint;
  v_rev_b_antes bigint;
  v_estado     text;
  v_estado_b   text;
  v_estado_b_antes text;
  v_publicable boolean;
  v_publicable_b boolean;
  v_publicable_b_antes boolean;
begin
  select id into v_destino_id from public.destinos limit 1;
  if v_destino_id is null then
    raise exception 'TEST 184 NO EJECUTADO: no hay ningún destino en esta base (necesita al menos 1 fila en destinos para las FK de hoteles/armado_paquetes).';
  end if;

  -- ── Datos sintéticos: 2 paquetes, 4 hoteles ───────────────────────────────
  insert into public.armado_paquetes (nombre, tipo, destino_id, pct_mk)
    values ('TEST184 Paquete A', 'porcion_terrestre', v_destino_id, 0.20)
    returning id into v_paquete_a;
  insert into public.armado_paquetes (nombre, tipo, destino_id, pct_mk)
    values ('TEST184 Paquete B', 'porcion_terrestre', v_destino_id, 0.20)
    returning id into v_paquete_b;

  -- `insert ... returning` no es una expresión válida dentro de una
  -- concatenación de arreglo: cada INSERT captura su id en una variable escalar
  -- y ESE valor se agrega con `array_append`.
  for i in 1..4 loop
    insert into public.hoteles (nombre, destino_id, modelo_tarifario)
      values ('TEST184 Hotel ' || i, v_destino_id, 'persona')
      returning id into v_hotel_id;
    v_hotel := array_append(v_hotel, v_hotel_id);
  end loop;

  insert into public.armado_hoteles (paquete_id, hotel_id) values
    (v_paquete_a, v_hotel[1]),
    (v_paquete_a, v_hotel[2]);
  raise notice 'Datos sintéticos: paquete_a=%, paquete_b=%, hoteles=%', v_paquete_a, v_paquete_b, v_hotel;

  -- Normaliza el paquete A a "publicado y sano" y fotografía su revisión.
  update public.armado_paquetes
    set tarifario_estado = 'listo', tarifario_snapshot_publicable = true
    where id = v_paquete_a;
  select tarifario_revision_fuente into v_rev from public.armado_paquetes where id = v_paquete_a;

  -- ── Caso 1: prioridad NULL -> 1 NO invalida ───────────────────────────────
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_antes then
    raise exception 'FALLO 1: prioridad NULL -> 1 incrementó la revisión (% -> %).', v_rev_antes, v_rev;
  end if;
  if v_estado <> 'listo' or v_publicable is not true then
    raise exception 'FALLO 1: prioridad NULL -> 1 bloqueó el paquete (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 1: prioridad NULL -> 1 conservó revisión (%, sin cambio), estado (%) y publicable (%).', v_rev, v_estado, v_publicable;

  -- ── Caso 2: prioridad 1 -> 2 NO invalida ──────────────────────────────────
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles set prioridad = 2 where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_antes then
    raise exception 'FALLO 2: prioridad 1 -> 2 incrementó la revisión (% -> %).', v_rev_antes, v_rev;
  end if;
  if v_estado <> 'listo' or v_publicable is not true then
    raise exception 'FALLO 2: prioridad 1 -> 2 bloqueó el paquete (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 2: prioridad 1 -> 2 conservó revisión (%), estado (%) y publicable (%).', v_rev, v_estado, v_publicable;

  -- ── Caso 3: UPDATE no-op de prioridad tampoco invalida ────────────────────
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles set prioridad = 2 where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_antes then
    raise exception 'FALLO 3: el UPDATE no-op de prioridad incrementó la revisión (% -> %).', v_rev_antes, v_rev;
  end if;
  if v_estado <> 'listo' or v_publicable is not true then
    raise exception 'FALLO 3: un UPDATE no-op de prioridad bloqueó el paquete (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 3: UPDATE no-op de prioridad no invalidó (estado=%, publicable=%).', v_estado, v_publicable;

  -- ── Caso 4: desmarcar (prioridad -> NULL) tampoco invalida ────────────────
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles set prioridad = null where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_antes or v_estado <> 'listo' or v_publicable is not true then
    raise exception 'FALLO 4: desmarcar la prioridad bloqueó el paquete (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;
  end if;
  raise notice 'OK 4: prioridad -> NULL no invalidó (estado=%, publicable=%).', v_estado, v_publicable;

  -- ── Caso 5: `categorias` SÍ invalida (revisión +1 y bloqueo) ──────────────
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles set categorias = array['TEST184-CAT'] where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_antes + 1 then
    raise exception 'FALLO 5: cambiar categorias no incrementó la revisión en 1 (% -> %).', v_rev_antes, v_rev;
  end if;
  if v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO 5: cambiar categorias debía bloquear (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 5: cambiar categorias invalidó (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;

  -- Se restaura el "publicado y sano" para el caso siguiente.
  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_a;

  -- ── Caso 6: `regimenes` SÍ invalida (revisión +1 y bloqueo) ───────────────
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles set regimenes = array['TEST184-REG'] where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_antes + 1 then
    raise exception 'FALLO 6: cambiar regimenes no incrementó la revisión en 1 (% -> %).', v_rev_antes, v_rev;
  end if;
  if v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO 6: cambiar regimenes debía bloquear (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 6: cambiar regimenes invalidó (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;

  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_a;

  -- ── Caso 7: prioridad + OTRO campo real en el MISMO update SÍ invalida ────
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles
    set prioridad = 3, categorias = array['TEST184-CAT2']
    where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_antes + 1 then
    raise exception 'FALLO 7: prioridad + categorias no incrementó la revisión en 1 (% -> %).', v_rev_antes, v_rev;
  end if;
  if v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO 7: prioridad + categorias en el mismo update debía bloquear (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 7: prioridad + categorias en el mismo UPDATE invalidó (revisión % -> %, estado=%, publicable=%).', v_rev_antes, v_rev, v_estado, v_publicable;

  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_a;

  -- ── Caso 8: `hotel_id` SÍ invalida (campo real de la oferta) ──────────────
  update public.armado_hoteles set hotel_id = v_hotel[3] where paquete_id = v_paquete_a and hotel_id = v_hotel[1];
  select tarifario_estado, tarifario_snapshot_publicable into v_estado, v_publicable
    from public.armado_paquetes where id = v_paquete_a;
  if v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO 8: cambiar hotel_id debía bloquear (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 8: cambiar hotel_id invalidó (estado=%, publicable=%).', v_estado, v_publicable;
  -- Se revierte el hotel para no arrastrar el cambio a los casos siguientes.
  update public.armado_hoteles set hotel_id = v_hotel[1] where paquete_id = v_paquete_a and hotel_id = v_hotel[3];
  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_a;

  -- ── Caso 9: INSERT sigue invalidando ─────────────────────────────────────
  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_a, v_hotel[4]);
  select tarifario_estado, tarifario_snapshot_publicable into v_estado, v_publicable
    from public.armado_paquetes where id = v_paquete_a;
  if v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO 9: INSERT debía bloquear (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 9: INSERT de armado_hoteles sigue bloqueando (estado=%, publicable=%).', v_estado, v_publicable;

  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_a;

  -- ── Caso 10: DELETE sigue invalidando ────────────────────────────────────
  delete from public.armado_hoteles where paquete_id = v_paquete_a and hotel_id = v_hotel[4];
  select tarifario_estado, tarifario_snapshot_publicable into v_estado, v_publicable
    from public.armado_paquetes where id = v_paquete_a;
  if v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO 10: DELETE debía bloquear (estado=%, publicable=%).', v_estado, v_publicable;
  end if;
  raise notice 'OK 10: DELETE de armado_hoteles sigue bloqueando (estado=%, publicable=%).', v_estado, v_publicable;

  -- ── Caso 11: un paquete YA bloqueado NO se rehabilita al cambiar prioridad ─
  -- (`tarifario_snapshot_publicable` queda en false y la revisión NO se mueve:
  -- el cambio de prioridad no toca ninguna columna del paquete, así que no
  -- puede "desbloquear" ni registrar una invalidación). Se recupera publicando
  -- de nuevo, no por acá.
  update public.armado_paquetes set tarifario_estado = 'pendiente', tarifario_snapshot_publicable = false where id = v_paquete_a;
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_a;
  update public.armado_hoteles set prioridad = 5 where paquete_id = v_paquete_a and hotel_id = v_hotel[2];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_publicable is not false then
    raise exception 'FALLO 11: un cambio de prioridad REHABILITÓ un paquete bloqueado (publicable=%).', v_publicable;
  end if;
  if v_estado <> 'pendiente' then
    raise exception 'FALLO 11: un cambio de prioridad alteró el estado de un paquete bloqueado (estado=%).', v_estado;
  end if;
  if v_rev <> v_rev_antes then
    raise exception 'FALLO 11: un cambio de prioridad en un paquete bloqueado SÍ movió la revisión (% -> %).', v_rev_antes, v_rev;
  end if;
  raise notice 'OK 11: cambiar prioridad en un paquete ya bloqueado no lo rehabilitó NI movió la revisión (%, estado=%, publicable=%).', v_rev, v_estado, v_publicable;

  -- ── Caso 12: el trigger propio NO cambió el alcance por paquete ───────────
  -- Se normalizan A y B, se invalida una fila de A, y se comprueba que A cambia
  -- mientras B queda EXACTAMENTE igual en las tres columnas del tarifario.
  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_a;
  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_b;
  select tarifario_revision_fuente into v_rev_a_antes from public.armado_paquetes where id = v_paquete_a;
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev_b_antes, v_estado_b_antes, v_publicable_b_antes
    from public.armado_paquetes where id = v_paquete_b;

  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_a, v_hotel[4]);

  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev, v_estado, v_publicable from public.armado_paquetes where id = v_paquete_a;
  if v_rev <> v_rev_a_antes + 1 or v_estado <> 'pendiente' or v_publicable is not false then
    raise exception 'FALLO 12a: mutar A debía invalidar A (revisión % -> %, estado=%, publicable=%).', v_rev_a_antes, v_rev, v_estado, v_publicable;
  end if;
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev_b, v_estado_b, v_publicable_b from public.armado_paquetes where id = v_paquete_b;
  if v_rev_b <> v_rev_b_antes or v_estado_b <> v_estado_b_antes or v_publicable_b <> v_publicable_b_antes then
    raise exception 'FALLO 12a: mutar A alteró B (revisión % -> %, estado % -> %, publicable % -> %).', v_rev_b_antes, v_rev_b, v_estado_b_antes, v_estado_b, v_publicable_b_antes, v_publicable_b;
  end if;
  raise notice 'OK 12a: invalidar una fila de A cambió solo A (revisión % -> %); B quedó exactamente igual (revisión=%, estado=%, publicable=%).', v_rev_a_antes, v_rev, v_rev_b, v_estado_b, v_publicable_b;

  -- Y una mutación REAL de B sí invalida B (el trigger propio no perdió alcance).
  delete from public.armado_hoteles where paquete_id = v_paquete_a and hotel_id = v_hotel[4];
  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_b;
  select tarifario_revision_fuente into v_rev_b_antes from public.armado_paquetes where id = v_paquete_b;
  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_b, v_hotel[3]);
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev_b, v_estado_b, v_publicable_b from public.armado_paquetes where id = v_paquete_b;
  if v_rev_b <> v_rev_b_antes + 1 or v_estado_b <> 'pendiente' or v_publicable_b is not false then
    raise exception 'FALLO 12b: una mutación real de B debía invalidar B (revisión % -> %, estado=%, publicable=%).', v_rev_b_antes, v_rev_b, v_estado_b, v_publicable_b;
  end if;
  raise notice 'OK 12b: una mutación real de B invalidó B (revisión % -> %, estado=%, publicable=%).', v_rev_b_antes, v_rev_b, v_estado_b, v_publicable_b;

  -- Conservada: una PRIORIDAD en B (paquete sano) tampoco lo invalida.
  update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = v_paquete_b;
  select tarifario_revision_fuente into v_rev_b_antes from public.armado_paquetes where id = v_paquete_b;
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_b and hotel_id = v_hotel[3];
  select tarifario_revision_fuente, tarifario_estado, tarifario_snapshot_publicable
    into v_rev_b, v_estado_b, v_publicable_b from public.armado_paquetes where id = v_paquete_b;
  if v_rev_b <> v_rev_b_antes or v_estado_b <> 'listo' or v_publicable_b is not true then
    raise exception 'FALLO 12c: la prioridad invalidó el paquete B (revisión % -> %, estado=%, publicable=%).', v_rev_b_antes, v_rev_b, v_estado_b, v_publicable_b;
  end if;
  raise notice 'OK 12c: una prioridad en B no lo invalidó (revisión sigue %, estado=%, publicable=%).', v_rev_b, v_estado_b, v_publicable_b;
  raise notice 'OK 12: la invalidación sigue siendo POR PAQUETE, y la prioridad no bloquea a ninguno de los dos.';

  raise notice 'TEST 184 COMPLETO: todos los casos de invalidación pasaron.';
end $$;

rollback;
-- ⚠️ ROLLBACK: NINGÚN dato sintético (paquetes, hoteles, asociaciones) queda
-- persistido, sin importar el resultado.
