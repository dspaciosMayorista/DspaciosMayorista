-- Prueba de comportamiento de la migración 181
-- (tarifario_snapshots_atomicos). Ejecutar SOLO en Postgres local/desechable
-- después de aplicar la migración — termina en ROLLBACK, no persiste nada.
--
-- psql -d <base-local> -v ON_ERROR_STOP=1 \
--   -f supabase/scripts/test_181_tarifario_snapshots_atomicos.sql
--
-- ALCANCE DE ESTA BATERÍA (decisión explícita, ver informe de la Fase 1):
--   Los 14 triggers de la migración comparten solo 9 funciones, y esas 9
--   funciones comparten 2 formas de fan-out (por hotel_id / por servicio_id)
--   más una forma "directa" (paquete_id propio). Esta batería ejerce CADA
--   FORMA al menos una vez con un caso real (tarifa_hotel para "por hotel",
--   armado_hoteles para "directo", armado_paquetes para "columnas propias") y
--   además cubre el caso OLD/NEW con el mismo table de "por hotel". Las otras
--   tablas que comparten esas MISMAS funciones (hotel_temporadas comparte
--   función con tarifa_hotel; servicio_tarifa_pax/servicio_temporadas
--   comparten función entre sí; armado_vuelos/armado_servicios/
--   armado_empaquetados comparten función con armado_hoteles;
--   bloqueos_vuelo/empaquetados/salidas_dinamicas y hoteles/
--   servicios_adicionales tienen su propia función pero la MISMA estructura
--   ya probada) NO se re-prueban una por una aquí — se verifican solo por
--   existencia/adjunto correcto en postcheck_181. Justificación: son el
--   MISMO código ejecutándose sobre una tabla distinta, no lógica nueva.

begin;

do $$
declare
  v_destino_id       bigint;
  v_hotel_a          bigint;
  v_hotel_b          bigint;
  v_paquete_1        bigint;
  v_paquete_2        bigint;
  v_tarifa_id        bigint;
  v_temporada_id     bigint;
  v_rev_p1_0         bigint;
  v_rev_p1_1         bigint;
  v_rev_p1_2         bigint;
  v_rev_p2_0         bigint;
  v_rev_p2_1         bigint;
  v_pub_p1           boolean;
  v_estado_p1        text;
  v_usuario_id       uuid;
  v_rol              text;
  v_gen              bigint;
  v_rev_cap          bigint;
  v_gen2             bigint;
  v_rev_cap2         bigint;
  v_publicado        boolean;
  v_filas            jsonb;
  v_count_resultado  integer;
  v_procedencia_mixta boolean;
  v_estado_final     text;
  v_publicable_final boolean;
  v_rechazado        boolean;
  -- Variables de las pruebas de la ronda de auditoría (hallazgos 1-4).
  v_rev_antes        bigint;
  v_rev_despues      bigint;
  v_pub_antes        boolean;
  v_procedencia_valor jsonb;
  v_paquete_activo_bd boolean;
  v_revision_publicada bigint;
  v_estado_antes_falso text;
  v_destino_b_id      bigint;
  -- Variables de las pruebas de la ronda de auditoría 4 (p_moneda + cobertura
  -- de contenido denormalizado de hoteles/servicios/destinos).
  v_servicio_id       bigint;
  v_count_previo      integer;
  v_moneda_resultado  text;
  v_todas_coinciden   boolean;
begin
  raise notice '── SETUP: grafo sintético FK-válido (destino, 2 hoteles, 2 paquetes) ──';

  insert into public.destinos (nombre) values ('__test_181_destino__')
    returning id into v_destino_id;

  insert into public.hoteles (destino_id, nombre) values (v_destino_id, '__test_181_hotel_a__')
    returning id into v_hotel_a;
  insert into public.hoteles (destino_id, nombre) values (v_destino_id, '__test_181_hotel_b__')
    returning id into v_hotel_b;

  insert into public.armado_paquetes (nombre, tipo, activo, destino_id)
    values ('__test_181_paquete_1__', 'porcion_terrestre', true, v_destino_id)
    returning id into v_paquete_1;
  insert into public.armado_paquetes (nombre, tipo, activo, destino_id)
    values ('__test_181_paquete_2__', 'porcion_terrestre', true, v_destino_id)
    returning id into v_paquete_2;

  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_1, v_hotel_a);
  -- ⚠️ El INSERT de arriba ya disparó tarifario_trg_bump_armado_directo
  -- (bloquea siempre) — se consume/ignora acá, el estado base para las
  -- pruebas de abajo se toma DESPUÉS de este setup, no antes.
  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_2, v_hotel_b);

  select tarifario_revision_fuente into v_rev_p1_0 from public.armado_paquetes where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_p2_0 from public.armado_paquetes where id = v_paquete_2;
  raise notice 'OK setup: paquete_1=% (revisión base %), paquete_2=% (revisión base %)', v_paquete_1, v_rev_p1_0, v_paquete_2, v_rev_p2_0;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 1: INSERT aditivo de tarifa_hotel — sube revisión, NO bloquea ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;

  insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla)
    values (v_hotel_a, 'ESTANDAR', 'PC', 'BAJA', 100000)
    returning id into v_tarifa_id;

  select tarifario_revision_fuente, tarifario_snapshot_publicable, tarifario_estado
    into v_rev_p1_1, v_pub_p1, v_estado_p1
    from public.armado_paquetes where id = v_paquete_1;

  if v_rev_p1_1 <> v_rev_p1_0 + 1 then
    raise exception 'FALLO 1: INSERT en tarifa_hotel no incrementó la revisión (antes %, después %)', v_rev_p1_0, v_rev_p1_1;
  end if;
  if v_pub_p1 <> true then
    raise exception 'FALLO 1: INSERT aditivo forzó tarifario_snapshot_publicable a false (debía dejarlo tal como estaba: true)';
  end if;
  if v_estado_p1 <> 'pendiente' then
    raise exception 'FALLO 1: tarifario_estado esperado ''pendiente'', obtuvo ''%''', v_estado_p1;
  end if;
  raise notice 'OK 1: INSERT aditivo subió la revisión (% -> %) y dejó publicable=true, estado=pendiente.', v_rev_p1_0, v_rev_p1_1;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 2: UPDATE de una fuente existente — sube revisión Y bloquea ──';
  -------------------------------------------------------------------------
  update public.tarifa_hotel set neto_sencilla = 120000 where id = v_tarifa_id;

  select tarifario_revision_fuente, tarifario_snapshot_publicable
    into v_rev_p1_2, v_pub_p1
    from public.armado_paquetes where id = v_paquete_1;

  if v_rev_p1_2 <> v_rev_p1_1 + 1 then
    raise exception 'FALLO 2: UPDATE en tarifa_hotel no incrementó la revisión (antes %, después %)', v_rev_p1_1, v_rev_p1_2;
  end if;
  if v_pub_p1 <> false then
    raise exception 'FALLO 2: UPDATE de una fuente existente debía bloquear (tarifario_snapshot_publicable=false), quedó %', v_pub_p1;
  end if;
  raise notice 'OK 2: UPDATE subió la revisión (% -> %) y bloqueó el snapshot.', v_rev_p1_1, v_rev_p1_2;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 3: DELETE de una fuente existente — sube revisión Y bloquea ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1; -- reabre para aislar la prueba
  delete from public.tarifa_hotel where id = v_tarifa_id;

  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 3: DELETE de una fuente existente debía bloquear, quedó %', v_pub_p1;
  end if;
  raise notice 'OK 3: DELETE bloqueó el snapshot.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 4: OLD y NEW quedan invalidados al cambiar una relación ──';
  -------------------------------------------------------------------------
  insert into public.hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin)
    values (v_hotel_a, '__test_181_temp__', '2027-01-01', '2027-01-31')
    returning id into v_temporada_id;

  select tarifario_revision_fuente into v_rev_p1_0 from public.armado_paquetes where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_p2_0 from public.armado_paquetes where id = v_paquete_2;

  -- Mueve la temporada de HOTEL A (usado por paquete_1) a HOTEL B (usado por
  -- paquete_2) en un solo UPDATE — la prueba real de "OLD.hotel_id != NEW.hotel_id".
  update public.hotel_temporadas set hotel_id = v_hotel_b where id = v_temporada_id;

  select tarifario_revision_fuente into v_rev_p1_1 from public.armado_paquetes where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_p2_1 from public.armado_paquetes where id = v_paquete_2;

  if v_rev_p1_1 <= v_rev_p1_0 then
    raise exception 'FALLO 4: el paquete del hotel ANTERIOR (OLD.hotel_id) no se invalidó al mover la temporada (antes %, después %) — si solo se usara coalesce(NEW,OLD), este es exactamente el caso que se pierde.', v_rev_p1_0, v_rev_p1_1;
  end if;
  if v_rev_p2_1 <= v_rev_p2_0 then
    raise exception 'FALLO 4: el paquete del hotel NUEVO (NEW.hotel_id) no se invalidó al mover la temporada (antes %, después %)', v_rev_p2_0, v_rev_p2_1;
  end if;
  raise notice 'OK 4: mover hotel_temporadas de hotel_a a hotel_b invalidó AMBOS paquetes — paquete_1 (dueño del hotel viejo, % -> %) y paquete_2 (dueño del hotel nuevo, % -> %).', v_rev_p1_0, v_rev_p1_1, v_rev_p2_0, v_rev_p2_1;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 5: cambios de armado (directo) siempre bloquean ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  -- Vincula un tercer hotel sintético a paquete_1 y luego lo desvincula —
  -- ambas operaciones (insert y delete) sobre armado_hoteles deben bloquear.
  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paquete_1, v_hotel_b);
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 5a: INSERT en armado_hoteles (cambio de armado) debía bloquear, quedó %', v_pub_p1;
  end if;
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  delete from public.armado_hoteles where paquete_id = v_paquete_1 and hotel_id = v_hotel_b;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 5b: DELETE en armado_hoteles (cambio de armado) debía bloquear, quedó %', v_pub_p1;
  end if;
  raise notice 'OK 5: INSERT y DELETE en armado_hoteles (cambio de armado) bloquearon ambos.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 6: columnas propias de armado_paquetes — bloquea; columnas irrelevantes/recursión — NO dispara ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.armado_paquetes set pct_mk = 0.30 where id = v_paquete_1; -- columna en la lista OF
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 6a: UPDATE de pct_mk debía bloquear, quedó %', v_pub_p1;
  end if;

  select tarifario_revision_fuente into v_rev_p1_0 from public.armado_paquetes where id = v_paquete_1;
  update public.armado_paquetes set notas = '__test_181_notas__' where id = v_paquete_1; -- columna FUERA de la lista OF
  select tarifario_revision_fuente into v_rev_p1_1 from public.armado_paquetes where id = v_paquete_1;
  if v_rev_p1_1 <> v_rev_p1_0 then
    raise exception 'FALLO 6b: UPDATE de una columna irrelevante (notas) disparó el trigger igual (revisión % -> %) — la lista UPDATE OF no está funcionando.', v_rev_p1_0, v_rev_p1_1;
  end if;

  -- Recursión: el propio helper solo escribe columnas tarifario_* — un UPDATE
  -- de esas columnas (simulado acá directo) NUNCA debe re-disparar el trigger
  -- de armado_paquetes (si lo hiciera, esta prueba entraría en loop infinito
  -- o el conteo de revisión subiría más de lo esperado por un solo cambio).
  select tarifario_revision_fuente into v_rev_p1_0 from public.armado_paquetes where id = v_paquete_1;
  update public.armado_paquetes set tarifario_estado = 'listo' where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_p1_1 from public.armado_paquetes where id = v_paquete_1;
  if v_rev_p1_1 <> v_rev_p1_0 then
    raise exception 'FALLO 6c: actualizar una columna tarifario_* re-disparó el trigger (revisión % -> %) — riesgo de recursión confirmado.', v_rev_p1_0, v_rev_p1_1;
  end if;
  raise notice 'OK 6: pct_mk bloquea; notas no dispara nada; escribir columnas tarifario_* no se re-invalida a sí mismo (sin recursión).';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 7: activar bloquea; desactivar bloquea ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.armado_paquetes set activo = false where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 7a: desactivar el paquete debía bloquear inmediatamente, quedó %', v_pub_p1;
  end if;
  raise notice 'OK 7a: desactivar bloqueó inmediatamente.';

  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1; -- fuerza true a mano para aislar 7b
  update public.armado_paquetes set activo = true where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 7b: activar el paquete NO debía dejarlo visible hasta una publicación exitosa, quedó publicable=%', v_pub_p1;
  end if;
  raise notice 'OK 7b: activar quedó bloqueado hasta la próxima publicación exitosa (no se hizo visible solo por activarse).';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 14 (auditoría, hallazgo 4): UPDATE que escribe los MISMOS valores no invalida ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true, tarifario_estado = 'listo' where id = v_paquete_1;
  select tarifario_revision_fuente, tarifario_snapshot_publicable into v_rev_antes, v_pub_antes
    from public.armado_paquetes where id = v_paquete_1;

  -- UPDATE real, con las 10 columnas de la lista `UPDATE OF` vigente
  -- (auditoría de Fase 1, ronda 3: nombre/tipo/destino_id se agregaron;
  -- moneda se retiró — ver Prueba 15 para el porqué) presentes en el SET,
  -- pero TODAS con el mismo valor que ya tenían — antes de la corrección del
  -- hallazgo 4, `UPDATE OF <col>` disparaba igual (Postgres considera
  -- "tocada" cualquier columna listada en el SET, cambie o no el valor).
  update public.armado_paquetes
    set nombre = nombre, tipo = tipo, destino_id = destino_id,
        pct_mk = pct_mk, impuesto_tipo = impuesto_tipo, impuesto_fijo = impuesto_fijo,
        fecha_viaje_inicio = fecha_viaje_inicio, fecha_viaje_fin = fecha_viaje_fin,
        noches = noches, activo = activo
    where id = v_paquete_1;

  select tarifario_revision_fuente, tarifario_snapshot_publicable into v_rev_despues, v_pub_p1
    from public.armado_paquetes where id = v_paquete_1;

  if v_rev_despues <> v_rev_antes then
    raise exception 'FALLO 14: un UPDATE que escribe los MISMOS valores incrementó la revisión (antes %, después %) — el trigger no está comparando IS DISTINCT FROM.', v_rev_antes, v_rev_despues;
  end if;
  if v_pub_p1 <> v_pub_antes then
    raise exception 'FALLO 14: un UPDATE que escribe los MISMOS valores bloqueó el snapshot (antes %, después %).', v_pub_antes, v_pub_p1;
  end if;
  raise notice 'OK 14: UPDATE con las 10 columnas vigentes presentes pero SIN cambio real de valor no incrementó la revisión (se mantuvo en %) ni bloqueó el snapshot (publicable=%).', v_rev_despues, v_pub_p1;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 20 (auditoría P1-b): nombre/tipo/destino_id ahora invalidan; destinos.nombre invalida TODOS los paquetes del destino ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.armado_paquetes set nombre = '__test_181_paquete_1_renombrado__' where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 20a: cambiar armado_paquetes.nombre debía bloquear, quedó %', v_pub_p1;
  end if;

  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.armado_paquetes set tipo = 'bloqueo' where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 20b: cambiar armado_paquetes.tipo debía bloquear, quedó %', v_pub_p1;
  end if;
  update public.armado_paquetes set tipo = 'porcion_terrestre' where id = v_paquete_1; -- restaura para el resto de la batería

  -- Segundo destino, para probar destino_id Y el fan-out de destinos.nombre.
  insert into public.destinos (nombre) values ('__test_181_destino_b__') returning id into v_destino_b_id;

  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.armado_paquetes set destino_id = v_destino_b_id where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 20c: cambiar armado_paquetes.destino_id debía bloquear, quedó %', v_pub_p1;
  end if;
  update public.armado_paquetes set destino_id = v_destino_id where id = v_paquete_1; -- restaura al destino original

  -- "Una publicación capturada ANTES del cambio es rechazada": captura
  -- generación+revisión, LUEGO cambia `tipo` (sin pedir generación nueva), y
  -- confirma que publicar con la revisión vieja se rechaza.
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_1;
  update public.armado_paquetes set tipo = 'bloqueo' where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_despues from public.armado_paquetes where id = v_paquete_1;
  if v_rev_despues <= v_rev_antes then
    raise exception 'FALLO 20d: cambiar tipo no incrementó la revisión (antes %, después %)', v_rev_antes, v_rev_despues;
  end if;
  update public.armado_paquetes set tipo = 'porcion_terrestre' where id = v_paquete_1; -- restaura

  -- destinos.nombre: invalida TODOS los paquetes de ESE destino (fan-out).
  -- paquete_1 apunta a v_destino_id; se vincula temporalmente paquete_2 al
  -- MISMO destino para confirmar que el fan-out no es "solo el primero que
  -- encuentre" sino TODOS.
  update public.armado_paquetes set destino_id = v_destino_id where id = v_paquete_2;
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id in (v_paquete_1, v_paquete_2);
  update public.destinos set nombre = '__test_181_destino_renombrado__' where id = v_destino_id;
  select bool_and(tarifario_snapshot_publicable) into v_pub_antes -- reutilizado como "publicable_ambos"
    from public.armado_paquetes where id in (v_paquete_1, v_paquete_2);
  if v_pub_antes <> false then
    raise exception 'FALLO 20e: renombrar destinos.nombre debía bloquear AMBOS paquetes del destino, quedó publicable=% en al menos uno', v_pub_antes;
  end if;
  raise notice 'OK 20: nombre/tipo/destino_id de armado_paquetes bloquean al cambiar de verdad; una publicación capturada antes del cambio de tipo queda con revisión superada; renombrar destinos.nombre invalidó AMBOS paquetes del mismo destino.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 21 (auditoría P1-b, ronda 4): renombrar hoteles.nombre invalida (contenido denormalizado hotel_nombre) ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.hoteles set nombre = '__test_181_hotel_a_renombrado__' where id = v_hotel_a;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 21: renombrar hoteles.nombre debía bloquear paquete_1 (vía armado_hoteles), quedó %', v_pub_p1;
  end if;
  raise notice 'OK 21: renombrar hoteles.nombre invalidó paquete_1 (denormalizado como hotel_nombre en tarifario_resultado).';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 22 (auditoría P1-b, ronda 4): UPDATE no-op de hoteles (mismos valores) NO invalida ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_1;
  update public.hoteles set nombre = nombre, moneda = moneda, modelo_tarifario = modelo_tarifario where id = v_hotel_a;
  select tarifario_revision_fuente into v_rev_despues from public.armado_paquetes where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_rev_despues <> v_rev_antes then
    raise exception 'FALLO 22: un UPDATE de hoteles con los MISMOS valores incrementó la revisión (antes %, después %).', v_rev_antes, v_rev_despues;
  end if;
  if v_pub_p1 <> true then
    raise exception 'FALLO 22: un UPDATE de hoteles con los MISMOS valores bloqueó el snapshot, quedó %', v_pub_p1;
  end if;
  raise notice 'OK 22: UPDATE no-op de hoteles.nombre/moneda/modelo_tarifario no invalidó (revisión sigue %, publicable=%).', v_rev_despues, v_pub_p1;

  -------------------------------------------------------------------------
  raise notice '── SETUP servicio (para pruebas 23-25): servicio del catálogo enlazado a paquete_1 ──';
  -------------------------------------------------------------------------
  insert into public.servicios_adicionales (nombre, descripcion)
    values ('__test_181_servicio_catalogo__', '__test_181_descripcion_original__')
    returning id into v_servicio_id;
  insert into public.armado_servicios (paquete_id, servicio_id) values (v_paquete_1, v_servicio_id);
  -- ⚠️ El INSERT de arriba ya disparó tarifario_trg_bump_armado_directo
  -- (bloquea siempre) — se consume/ignora, igual que el setup de
  -- armado_hoteles al inicio de esta batería.

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 23 (auditoría P1-b, ronda 4): renombrar servicios_adicionales.nombre invalida (contenido denormalizado servicio_nombre) ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.servicios_adicionales set nombre = '__test_181_servicio_renombrado__' where id = v_servicio_id;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 23: renombrar servicios_adicionales.nombre debía bloquear paquete_1 (vía armado_servicios), quedó %', v_pub_p1;
  end if;
  raise notice 'OK 23: renombrar servicios_adicionales.nombre invalidó paquete_1.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 24 (auditoría P1-b, ronda 4): cambiar servicios_adicionales.descripcion invalida (denormalizada en tarifario_resultado) ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  update public.servicios_adicionales set descripcion = '__test_181_descripcion_nueva__' where id = v_servicio_id;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_pub_p1 <> false then
    raise exception 'FALLO 24: cambiar servicios_adicionales.descripcion debía bloquear paquete_1, quedó %', v_pub_p1;
  end if;
  raise notice 'OK 24: cambiar servicios_adicionales.descripcion invalidó paquete_1.';

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 25 (auditoría P1-b, ronda 4): UPDATE no-op de servicios_adicionales (mismos valores) NO invalida ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_1;
  update public.servicios_adicionales set
      nombre = nombre, descripcion = descripcion, precio_persona = precio_persona,
      recargo_individual = recargo_individual, liquidacion = liquidacion, moneda = moneda
    where id = v_servicio_id;
  select tarifario_revision_fuente into v_rev_despues from public.armado_paquetes where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_rev_despues <> v_rev_antes then
    raise exception 'FALLO 25: un UPDATE de servicios_adicionales con los MISMOS valores incrementó la revisión (antes %, después %).', v_rev_antes, v_rev_despues;
  end if;
  if v_pub_p1 <> true then
    raise exception 'FALLO 25: un UPDATE de servicios_adicionales con los MISMOS valores bloqueó el snapshot, quedó %', v_pub_p1;
  end if;
  raise notice 'OK 25: UPDATE no-op de servicios_adicionales (nombre/descripcion/precio_persona/recargo_individual/liquidacion/moneda) no invalidó (revisión sigue %, publicable=%).', v_rev_despues, v_pub_p1;

  -------------------------------------------------------------------------
  raise notice '── PRUEBA 26 (auditoría P1-b, ronda 4): UPDATE no-op de destinos.nombre NO invalida ──';
  -------------------------------------------------------------------------
  update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
  select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_1;
  update public.destinos set nombre = nombre where id = v_destino_id;
  select tarifario_revision_fuente into v_rev_despues from public.armado_paquetes where id = v_paquete_1;
  select tarifario_snapshot_publicable into v_pub_p1 from public.armado_paquetes where id = v_paquete_1;
  if v_rev_despues <> v_rev_antes then
    raise exception 'FALLO 26: un UPDATE de destinos.nombre con el MISMO valor incrementó la revisión (antes %, después %).', v_rev_antes, v_rev_despues;
  end if;
  if v_pub_p1 <> true then
    raise exception 'FALLO 26: un UPDATE de destinos.nombre con el MISMO valor bloqueó el snapshot, quedó %', v_pub_p1;
  end if;
  raise notice 'OK 26: UPDATE no-op de destinos.nombre no invalidó (revisión sigue %, publicable=%).', v_rev_despues, v_pub_p1;

  -------------------------------------------------------------------------
  raise notice '── PRUEBAS 8-19: flujo de RPC bajo sesión AUTENTICADA REAL ──';
  -------------------------------------------------------------------------
  select id, rol::text into v_usuario_id, v_rol
    from public.usuarios
    where activo and rol in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    limit 1;

  if v_usuario_id is null then
    raise notice 'AVISO: no hay ningún usuario ACTIVO con rol permitido en esta base — las pruebas 8-19 (RPC) NO se pudieron ejecutar bajo sesión autenticada real. Vuelve a correr esta batería en un entorno con al menos un usuario interno activo.';
  else
    perform set_config('request.jwt.claims', json_build_object('sub', v_usuario_id::text, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    if coalesce(public.mi_rol()::text, '<null>') <> v_rol then
      raise exception 'FALLO SETUP RPC: mi_rol() no resolvió al rol esperado bajo la sesión simulada (esperado %, obtuvo %).', v_rol, coalesce(public.mi_rol()::text, '<null>');
    end if;
    raise notice 'OK setup RPC: sesión autenticada simulada como usuario % (rol=%).', v_usuario_id, v_rol;

    -- Deja paquete_1 ACTIVO para el camino feliz.
    reset role;
    update public.armado_paquetes set activo = true, tarifario_snapshot_publicable = false where id = v_paquete_1;
    execute 'set local role authenticated';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 8: camino feliz + servicios conservan procedencia_mixta=false ──';
    -------------------------------------------------------------------------
    select generacion, revision_capturada into v_gen, v_rev_cap
      from public.iniciar_generacion_tarifario(v_paquete_1);

    select tarifario_estado into v_estado_p1 from public.armado_paquetes where id = v_paquete_1;
    if v_estado_p1 <> 'recalculando' then
      raise exception 'FALLO 8: iniciar_generacion_tarifario debía dejar tarifario_estado=recalculando, quedó %', v_estado_p1;
    end if;

    v_filas := jsonb_build_array(
      jsonb_build_object(
        'modulo', 'porcion_terrestre', 'hotel_id', v_hotel_a, 'categoria', 'ESTANDAR', 'regimen', 'PC',
        'acomodacion', 'sencilla', 'noches', 3, 'fecha_ida', '2027-02-01', 'fecha_regreso', '2027-02-04',
        'base_comisionable', 90000, 'impuesto', 0, 'precio_pvp', 150000, 'moneda', 'COP'
      ),
      jsonb_build_object(
        -- Fila de SERVICIOS: `procedencia_mixta` ausente a propósito (debe
        -- quedar en false, NOT NULL de la columna, nunca NULL) Y
        -- `procedencia_temporadas` EXPLÍCITO en JSON null (auditoría de Fase
        -- 1, hallazgo 1) — `jsonb_build_object('k', null)` SÍ incluye la
        -- clave con el escalar jsonb `null` (no la omite), que es EXACTAMENTE
        -- el caso que `v_fila->'procedencia_temporadas'` directo insertaría
        -- mal (JSON null literal, viola NOT NULL si la columna lo exigiera,
        -- o queda como un valor jsonb no-SQL-NULL) en vez de SQL NULL.
        'modulo', 'servicios', 'servicio_nombre', '__test_181_servicio__', 'tipo_tarifa', 'persona',
        'base_comisionable', 20000, 'impuesto', 0, 'precio_pvp', 20000, 'moneda', 'COP',
        'procedencia_temporadas', null
      )
    );

    v_publicado := public.publicar_tarifario_resultado(v_paquete_1, v_gen, v_rev_cap, 'COP', v_filas);
    if v_publicado is distinct from true then
      raise exception 'FALLO 8: el camino feliz debía publicar (true), devolvió %', v_publicado;
    end if;

    select count(*) into v_count_resultado from public.tarifario_resultado where paquete_id = v_paquete_1;
    if v_count_resultado <> 2 then
      raise exception 'FALLO 8: se esperaban 2 filas publicadas para paquete_1, hay %', v_count_resultado;
    end if;

    select procedencia_mixta into v_procedencia_mixta
      from public.tarifario_resultado where paquete_id = v_paquete_1 and modulo = 'servicios';
    if v_procedencia_mixta is distinct from false then
      raise exception 'FALLO 8: la fila de servicios debía quedar con procedencia_mixta=false, quedó %', v_procedencia_mixta;
    end if;

    -- Auditoría de Fase 1, hallazgo 1: el JSON `null` explícito del payload
    -- debe haberse guardado como SQL NULL real (`IS NULL`), no como el
    -- escalar jsonb `null` ni como cualquier otro valor no-nulo.
    select procedencia_temporadas into v_procedencia_valor
      from public.tarifario_resultado where paquete_id = v_paquete_1 and modulo = 'servicios';
    if v_procedencia_valor is not null then
      raise exception 'FALLO 1 (hallazgo 1): procedencia_temporadas debía quedar en SQL NULL, quedó %', v_procedencia_valor;
    end if;

    select tarifario_estado, tarifario_snapshot_publicable into v_estado_final, v_publicable_final
      from public.armado_paquetes where id = v_paquete_1;
    if v_estado_final <> 'listo' or v_publicable_final <> true then
      raise exception 'FALLO 8: tras publicar con éxito sobre un paquete ACTIVO se esperaba estado=listo y publicable=true, quedó estado=%, publicable=%', v_estado_final, v_publicable_final;
    end if;
    raise notice 'OK 8: camino feliz publicó 2 filas, procedencia_mixta=false y procedencia_temporadas=SQL NULL en la fila de servicios, estado=listo, publicable=true (paquete activo).';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 9: insert fallido conserva el snapshot anterior ──';
    -------------------------------------------------------------------------
    select generacion, revision_capturada into v_gen, v_rev_cap
      from public.iniciar_generacion_tarifario(v_paquete_1);

    v_rechazado := false;
    begin
      -- 'modulo' inválido: no castea a public.tarifario_modulo -> excepción
      -- ANTES de llegar al insert real, pero el delete de este mismo intento
      -- YA corrió dentro de la función — la garantía es que TODO el cuerpo
      -- de la función es una transacción y se revierte completo, delete incluido.
      perform public.publicar_tarifario_resultado(
        v_paquete_1, v_gen, v_rev_cap, 'COP',
        jsonb_build_array(jsonb_build_object('modulo', 'no_existe_este_modulo', 'precio_pvp', 1))
      );
    exception when others then
      v_rechazado := true;
    end;
    if not v_rechazado then
      raise exception 'FALLO 9: un modulo inválido debía lanzar excepción y no lo hizo.';
    end if;

    select count(*) into v_count_resultado from public.tarifario_resultado where paquete_id = v_paquete_1;
    if v_count_resultado <> 2 then
      raise exception 'FALLO 9: tras el intento fallido, el snapshot anterior (2 filas) no se conservó — hay % filas.', v_count_resultado;
    end if;
    raise notice 'OK 9: el intento fallido (excepción a mitad del cuerpo de la función) NO tocó el snapshot anterior — sigue con sus 2 filas originales.';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 10: generación vieja no publica ──';
    -------------------------------------------------------------------------
    select generacion, revision_capturada into v_gen, v_rev_cap
      from public.iniciar_generacion_tarifario(v_paquete_1); -- gen N
    select generacion, revision_capturada into v_gen2, v_rev_cap2
      from public.iniciar_generacion_tarifario(v_paquete_1); -- gen N+1, ahora la vigente

    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_1, v_gen, v_rev_cap, 'COP', -- la VIEJA (N), ya superada por N+1
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', 'no_deberia_publicarse', 'precio_pvp', 1))
    );
    if v_publicado is distinct from false then
      raise exception 'FALLO 10: publicar con una generación superada debía devolver false, devolvió %', v_publicado;
    end if;
    if exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_1 and servicio_nombre = 'no_deberia_publicarse') then
      raise exception 'FALLO 10: la fila de la generación vieja quedó publicada.';
    end if;
    raise notice 'OK 10: publicar() con generación vieja devolvió false y no tocó tarifario_resultado.';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 11: revisión de fuente cambiada durante el cálculo no publica ──';
    -------------------------------------------------------------------------
    select generacion, revision_capturada into v_gen, v_rev_cap
      from public.iniciar_generacion_tarifario(v_paquete_1); -- generación N+2 (la vigente ahora)

    -- Simula que ALGO cambió en las fuentes MIENTRAS el cálculo (imaginario)
    -- de TypeScript seguía corriendo: se muta una tarifa del hotel A (sube la
    -- revisión) sin pedir una generación nueva.
    reset role;
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion) values (v_hotel_a, '__test_181_intermedia__');
    execute 'set local role authenticated';

    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_1, v_gen, v_rev_cap, 'COP', -- generación SIGUE vigente, pero la revisión YA no coincide
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', 'no_deberia_publicarse_2', 'precio_pvp', 1))
    );
    if v_publicado is distinct from false then
      raise exception 'FALLO 11: publicar con la revisión de fuente superada debía devolver false, devolvió %', v_publicado;
    end if;
    if exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_1 and servicio_nombre = 'no_deberia_publicarse_2') then
      raise exception 'FALLO 11: la fila calculada contra una revisión vieja quedó publicada.';
    end if;
    select tarifario_estado into v_estado_p1 from public.armado_paquetes where id = v_paquete_1;
    if v_estado_p1 <> 'pendiente' then
      raise exception 'FALLO 11: el rechazo por revisión debía dejar tarifario_estado=pendiente (nunca recalculando colgado), quedó %', v_estado_p1;
    end if;
    raise notice 'OK 11: publicar() rechazó por revisión de fuente cambiada A MITAD DEL CÁLCULO (misma generación, revisión superada), devolvió false y dejó estado=pendiente.';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 12: payload con paquete_id distinto es rechazado ──';
    -------------------------------------------------------------------------
    select generacion, revision_capturada into v_gen, v_rev_cap
      from public.iniciar_generacion_tarifario(v_paquete_1);

    v_rechazado := false;
    begin
      perform public.publicar_tarifario_resultado(
        v_paquete_1, v_gen, v_rev_cap, 'COP',
        jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'paquete_id', v_paquete_2, 'precio_pvp', 1))
      );
    exception when others then
      v_rechazado := true;
    end;
    if not v_rechazado then
      raise exception 'FALLO 12: una fila con paquete_id de OTRO paquete debía rechazar toda la publicación.';
    end if;
    if exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_2 and precio_pvp = 1) then
      raise exception 'FALLO 12: se coló una fila en paquete_2 pese al rechazo.';
    end if;
    raise notice 'OK 12: publicar() rechazó una fila que declaraba paquete_id de otro paquete.';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 13 (fallo de revisión VIGENTE: sí queda fallido) — y nunca rehabilita un snapshot bloqueado ──';
    -------------------------------------------------------------------------
    reset role;
    update public.armado_paquetes set tarifario_snapshot_publicable = false where id = v_paquete_1;
    execute 'set local role authenticated';

    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_1);
    perform public.marcar_generacion_fallida(v_paquete_1, v_gen, v_rev_cap, 'Error de prueba saneado.');

    select tarifario_estado, tarifario_snapshot_publicable, tarifario_error
      into v_estado_final, v_publicable_final, v_estado_p1 -- reutiliza v_estado_p1 como texto de error
      from public.armado_paquetes where id = v_paquete_1;
    if v_estado_final <> 'fallido' then
      raise exception 'FALLO 13: con generación Y revisión VIGENTES se esperaba tarifario_estado=fallido, quedó %', v_estado_final;
    end if;
    if v_estado_p1 <> 'Error de prueba saneado.' then
      raise exception 'FALLO 13: tarifario_error no quedó con el mensaje esperado, quedó "%"', v_estado_p1;
    end if;
    if v_publicable_final <> false then
      raise exception 'FALLO 13: marcar_generacion_fallida NO debía rehabilitar el snapshot bloqueado, quedó publicable=%', v_publicable_final;
    end if;
    raise notice 'OK 13: con generación y revisión vigentes, marcar_generacion_fallida dejó estado=fallido, error="%", y NUNCA tocó publicable (sigue false).', v_estado_p1;

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 19 (auditoría, hallazgo P1-2): fallo VIEJO (revisión superada) no altera estado ni error ──';
    -------------------------------------------------------------------------
    -- Deja el paquete en un estado conocido y NO fallido, para poder detectar
    -- sin ambigüedad si el UPDATE de abajo lo tocó o no.
    reset role;
    update public.armado_paquetes set tarifario_estado = 'recalculando', tarifario_error = '__test_181_error_previo__' where id = v_paquete_1;
    execute 'set local role authenticated';

    -- Captura generación+revisión (intento A), y LUEGO — sin iniciar una
    -- generación nueva — cambia una fuente real para subir la revisión. El
    -- intento A queda con una revisión VIEJA respecto al armado_paquetes real.
    -- ⚠️ El INSERT aditivo de abajo dispara su PROPIO trigger, que
    -- legítimamente deja tarifario_estado='pendiente' (todo trigger de
    -- invalidación deja 'pendiente', ver diseño de la migración) — el
    -- "antes" que importa para esta prueba es el estado JUSTO DESPUÉS de esa
    -- inserción (lo que el trigger dejó), no un valor fijo supuesto de
    -- antemano: lo que se prueba es que `marcar_generacion_fallida` con la
    -- revisión VIEJA no lo cambie ni un paso más.
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_1);
    reset role;
    insert into public.tarifa_hotel (hotel_id, tipo_habitacion) values (v_hotel_a, '__test_181_prueba19__');
    execute 'set local role authenticated';

    select tarifario_estado, tarifario_error into v_estado_antes_falso, v_estado_p1 from public.armado_paquetes where id = v_paquete_1;

    -- Intenta marcar el intento A (generación SIGUE vigente — nadie pidió
    -- otra — pero la revisión capturada por A ya no coincide) como fallido.
    perform public.marcar_generacion_fallida(v_paquete_1, v_gen, v_rev_cap, 'Este mensaje NUNCA debe persistirse.');

    select tarifario_estado, tarifario_error into v_estado_final, v_estado_p1 from public.armado_paquetes where id = v_paquete_1;
    if v_estado_final <> v_estado_antes_falso then
      raise exception 'FALLO 19: un fallo con revisión VIEJA cambió tarifario_estado (antes de intentar marcarlo: ''%'', después: ''%'')', v_estado_antes_falso, v_estado_final;
    end if;
    if v_estado_p1 <> '__test_181_error_previo__' then
      raise exception 'FALLO 19: un fallo con revisión VIEJA sobrescribió tarifario_error (esperado el mensaje previo, quedó "%")', v_estado_p1;
    end if;
    raise notice 'OK 19: marcar_generacion_fallida con la MISMA generación pero revisión SUPERADA no tocó estado (sigue "%") ni error (sigue "%").', v_estado_final, v_estado_p1;

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 15 (auditoría P1-a, ronda 3): moneda es DERIVADA — la fuente cambia ANTES del token, y la moneda final coincide con la de las filas publicadas ──';
    -------------------------------------------------------------------------
    -- Usa paquete_2 (limpio de los intentos de paquete_1 de arriba). Simula
    -- la secuencia CORREGIDA (ronda 3): ya no existe ninguna escritura
    -- "preliminar" de armado_paquetes.moneda — la fuente real (hoteles.moneda
    -- del hotel_b, dueño de paquete_2) cambia de COP a USD ANTES de capturar
    -- el token (el trigger `tarifario_trg_bump_hotel_moneda_modelo` sube la
    -- revisión), así que `iniciar_generacion_tarifario` YA captura la
    -- revisión post-cambio. La moneda autoritativa (USD, la que "leería" la
    -- fase autoritativa de generarTarifario) se pasa como `p_moneda` al
    -- publicar — nunca se escribe por separado.
    reset role;
    update public.hoteles set moneda = 'COP' where id = v_hotel_b; -- estado base conocido
    update public.armado_paquetes set activo = true, tarifario_snapshot_publicable = false, moneda = 'COP' where id = v_paquete_2;
    update public.hoteles set moneda = 'USD' where id = v_hotel_b; -- la fuente cambia ANTES del token
    execute 'set local role authenticated';

    select generacion, revision_capturada into v_gen, v_rev_cap
      from public.iniciar_generacion_tarifario(v_paquete_2); -- captura la revisión YA con el cambio de moneda incluido
    select tarifario_revision_fuente into v_rev_antes from public.armado_paquetes where id = v_paquete_2;

    -- Publica con p_moneda='USD' (la autoritativa, coincide con la fuente
    -- real tras el cambio) y una fila también en USD.
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_2, v_gen, v_rev_cap, 'USD',
      jsonb_build_array(jsonb_build_object(
        'modulo', 'servicios', 'servicio_nombre', '__test_181_moneda__',
        'base_comisionable', 1000, 'impuesto', 0, 'precio_pvp', 1000, 'moneda', 'USD'
      ))
    );
    if v_publicado is distinct from true then
      raise exception 'FALLO 15: publicar con la moneda autoritativa debía tener éxito, devolvió %', v_publicado;
    end if;

    -- La escritura de moneda DENTRO de publicar_tarifario_resultado NO debe
    -- disparar el trigger de armado_paquetes (moneda ya no está vigilada) —
    -- la revisión no debe moverse por esta publicación.
    select tarifario_revision_fuente into v_rev_despues from public.armado_paquetes where id = v_paquete_2;
    if v_rev_despues <> v_rev_antes then
      raise exception 'FALLO 15: publicar_tarifario_resultado (que escribe moneda) incrementó la revisión (antes %, después %) — moneda no debería estar vigilada por el trigger.', v_rev_antes, v_rev_despues;
    end if;

    -- La moneda FINAL del paquete debe coincidir con la de la fila publicada.
    select moneda into v_estado_p1 from public.armado_paquetes where id = v_paquete_2; -- reutiliza v_estado_p1 como texto
    if v_estado_p1 <> 'USD' then
      raise exception 'FALLO 15: armado_paquetes.moneda debía quedar en USD (la autoritativa), quedó "%"', v_estado_p1;
    end if;
    if not exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_2 and moneda = 'USD') then
      raise exception 'FALLO 15: la fila publicada no quedó en USD — moneda del paquete y de las filas deben coincidir.';
    end if;
    raise notice 'OK 15: la fuente cambió de COP a USD ANTES del token; la publicación persistió moneda=USD tanto en armado_paquetes como en la fila — coinciden, y esa escritura no auto-invalidó la revisión.';

    select tarifario_estado, tarifario_revision_fuente, tarifario_revision_publicada, tarifario_snapshot_publicable
      into v_estado_final, v_rev_despues, v_revision_publicada, v_publicable_final
      from public.armado_paquetes where id = v_paquete_2;
    if v_estado_final <> 'listo' then
      raise exception 'FALLO 15: tras publicar con éxito se esperaba estado=listo, quedó % (nunca debe quedar pendiente después de publicar)', v_estado_final;
    end if;
    if v_revision_publicada <> v_rev_despues then
      raise exception 'FALLO 15: tarifario_revision_publicada (%) debía quedar IGUAL a tarifario_revision_fuente (%) tras publicar con éxito.', v_revision_publicada, v_rev_despues;
    end if;
    if v_publicable_final <> true then
      raise exception 'FALLO 15: el paquete sigue activo, snapshot_publicable debía ser true, quedó %', v_publicable_final;
    end if;
    raise notice 'OK 15: generar con cambio de moneda terminó estado=listo, revision_publicada=revision_fuente (%), publicable=true (activo) — nunca quedó pendiente tras publicar.', v_rev_despues;

    -------------------------------------------------------------------------
    raise notice '── PRUEBAS 16-18 (auditoría, hallazgo 3): paquete_activo del payload se IGNORA por completo ──';
    -------------------------------------------------------------------------
    -- 16: paquete INACTIVO + payload declara paquete_activo:true -> la fila
    -- insertada debe quedar en false y el snapshot NO publicable.
    reset role;
    update public.armado_paquetes set activo = false where id = v_paquete_2;
    execute 'set local role authenticated';
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_2);
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_2, v_gen, v_rev_cap, 'USD',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_activo_16__', 'paquete_activo', true, 'precio_pvp', 1))
    );
    if v_publicado is distinct from true then raise exception 'FALLO 16: la publicación debía tener éxito, devolvió %', v_publicado; end if;
    select paquete_activo into v_paquete_activo_bd from public.tarifario_resultado where paquete_id = v_paquete_2 and servicio_nombre = '__test_181_activo_16__';
    if v_paquete_activo_bd is distinct from false then
      raise exception 'FALLO 16: paquete INACTIVO con payload paquete_activo=true debía insertar la fila con false, quedó %', v_paquete_activo_bd;
    end if;
    select tarifario_snapshot_publicable into v_publicable_final from public.armado_paquetes where id = v_paquete_2;
    if v_publicable_final <> false then
      raise exception 'FALLO 16: paquete inactivo tras publicar debía quedar snapshot_publicable=false, quedó %', v_publicable_final;
    end if;
    raise notice 'OK 16: paquete inactivo + payload paquete_activo=true -> fila insertada con false, snapshot no publicable.';

    -- 17: payload SIN la clave paquete_activo -> usa el estado REAL del
    -- paquete (ahora activo:true de nuevo).
    reset role;
    update public.armado_paquetes set activo = true where id = v_paquete_2;
    execute 'set local role authenticated';
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_2);
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_2, v_gen, v_rev_cap, 'USD',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_activo_17__', 'precio_pvp', 1))
    );
    if v_publicado is distinct from true then raise exception 'FALLO 17: la publicación debía tener éxito, devolvió %', v_publicado; end if;
    select paquete_activo into v_paquete_activo_bd from public.tarifario_resultado where paquete_id = v_paquete_2 and servicio_nombre = '__test_181_activo_17__';
    if v_paquete_activo_bd is distinct from true then
      raise exception 'FALLO 17: payload sin paquete_activo sobre un paquete REALMENTE activo debía insertar la fila con true, quedó %', v_paquete_activo_bd;
    end if;
    raise notice 'OK 17: payload sin la clave paquete_activo -> usa el estado real del paquete (true).';

    -- 18: paquete ACTIVO + payload declara paquete_activo:false -> la fila
    -- insertada debe quedar en true (el payload se ignora igual en ambas
    -- direcciones, no solo cuando conviene).
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_2);
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_2, v_gen, v_rev_cap, 'USD',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_activo_18__', 'paquete_activo', false, 'precio_pvp', 1))
    );
    if v_publicado is distinct from true then raise exception 'FALLO 18: la publicación debía tener éxito, devolvió %', v_publicado; end if;
    select paquete_activo into v_paquete_activo_bd from public.tarifario_resultado where paquete_id = v_paquete_2 and servicio_nombre = '__test_181_activo_18__';
    if v_paquete_activo_bd is distinct from true then
      raise exception 'FALLO 18: paquete ACTIVO con payload paquete_activo=false debía insertar la fila con true, quedó %', v_paquete_activo_bd;
    end if;
    raise notice 'OK 18: paquete activo + payload paquete_activo=false -> fila insertada con true (payload ignorado en ambas direcciones).';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 27 (auditoría P1-a, ronda 4): p_moneda NULL se rechaza SIN borrar el snapshot anterior ──';
    -------------------------------------------------------------------------
    select count(*) into v_count_previo from public.tarifario_resultado where paquete_id = v_paquete_2;
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_2);
    v_rechazado := false;
    begin
      perform public.publicar_tarifario_resultado(
        v_paquete_2, v_gen, v_rev_cap, null,
        jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_moneda_27__', 'precio_pvp', 1))
      );
    exception when others then
      v_rechazado := true;
    end;
    if not v_rechazado then
      raise exception 'FALLO 27: p_moneda NULL debía rechazar la publicación con una excepción.';
    end if;
    select count(*) into v_count_resultado from public.tarifario_resultado where paquete_id = v_paquete_2;
    if v_count_resultado <> v_count_previo then
      raise exception 'FALLO 27: el rechazo por p_moneda NULL alteró el snapshot anterior (antes % filas, después %).', v_count_previo, v_count_resultado;
    end if;
    if exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_2 and servicio_nombre = '__test_181_moneda_27__') then
      raise exception 'FALLO 27: se coló una fila pese al rechazo por p_moneda NULL.';
    end if;
    raise notice 'OK 27: p_moneda NULL rechazó la publicación con excepción y NO tocó el snapshot anterior (sigue con % filas).', v_count_previo;

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 28 (auditoría P1-a, ronda 4): p_moneda inválida (ni COP ni USD) se rechaza ──';
    -------------------------------------------------------------------------
    select count(*) into v_count_previo from public.tarifario_resultado where paquete_id = v_paquete_2;
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_2);
    v_rechazado := false;
    begin
      perform public.publicar_tarifario_resultado(
        v_paquete_2, v_gen, v_rev_cap, 'EUR',
        jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_moneda_28__', 'precio_pvp', 1))
      );
    exception when others then
      v_rechazado := true;
    end;
    if not v_rechazado then
      raise exception 'FALLO 28: p_moneda=''EUR'' debía rechazar la publicación con una excepción.';
    end if;
    select count(*) into v_count_resultado from public.tarifario_resultado where paquete_id = v_paquete_2;
    if v_count_resultado <> v_count_previo then
      raise exception 'FALLO 28: el rechazo por p_moneda inválida alteró el snapshot anterior (antes % filas, después %).', v_count_previo, v_count_resultado;
    end if;
    raise notice 'OK 28: p_moneda=''EUR'' (inválida) rechazó la publicación y NO tocó el snapshot anterior.';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 29 (auditoría P1-a, ronda 4): p_moneda=USD + fila que declara moneda COP -> la fila termina en USD ──';
    -------------------------------------------------------------------------
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_2);
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_2, v_gen, v_rev_cap, 'USD',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_moneda_29__', 'precio_pvp', 1, 'moneda', 'COP'))
    );
    if v_publicado is distinct from true then
      raise exception 'FALLO 29: la publicación debía tener éxito, devolvió %', v_publicado;
    end if;
    select moneda into v_moneda_resultado from public.tarifario_resultado where paquete_id = v_paquete_2 and servicio_nombre = '__test_181_moneda_29__';
    if v_moneda_resultado <> 'USD' then
      raise exception 'FALLO 29: p_moneda=USD debía gobernar la fila pese a moneda:COP en el payload, quedó %', v_moneda_resultado;
    end if;
    raise notice 'OK 29: p_moneda=USD gobernó la fila pese a que el payload declaraba moneda=COP (quedó %).', v_moneda_resultado;

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 30 (auditoría P1-a, ronda 4): p_moneda=USD + fila SIN la clave moneda -> la fila termina en USD ──';
    -------------------------------------------------------------------------
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_2);
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_2, v_gen, v_rev_cap, 'USD',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_moneda_30__', 'precio_pvp', 1))
    );
    if v_publicado is distinct from true then
      raise exception 'FALLO 30: la publicación debía tener éxito, devolvió %', v_publicado;
    end if;
    select moneda into v_moneda_resultado from public.tarifario_resultado where paquete_id = v_paquete_2 and servicio_nombre = '__test_181_moneda_30__';
    if v_moneda_resultado <> 'USD' then
      raise exception 'FALLO 30: p_moneda=USD debía gobernar la fila aunque el payload omitiera moneda, quedó %', v_moneda_resultado;
    end if;
    raise notice 'OK 30: p_moneda=USD gobernó la fila aunque el payload omitía la clave moneda (quedó %).', v_moneda_resultado;

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 31 (auditoría P1-a, ronda 4): TODAS las filas publicadas de paquete_2 coinciden con armado_paquetes.moneda ──';
    -------------------------------------------------------------------------
    select moneda into v_moneda_resultado from public.armado_paquetes where id = v_paquete_2;
    select bool_and(moneda = v_moneda_resultado) into v_todas_coinciden
      from public.tarifario_resultado where paquete_id = v_paquete_2;
    if v_todas_coinciden is distinct from true then
      raise exception 'FALLO 31: hay filas de paquete_2 con moneda distinta a armado_paquetes.moneda (%).', v_moneda_resultado;
    end if;
    raise notice 'OK 31: todas las filas publicadas de paquete_2 coinciden con armado_paquetes.moneda (%).', v_moneda_resultado;

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 32 (auditoría P1-b, ronda 4): token capturado ANTES de renombrar el hotel queda rechazado al publicar ──';
    -------------------------------------------------------------------------
    reset role;
    update public.armado_paquetes set activo = true, tarifario_snapshot_publicable = true where id = v_paquete_1;
    execute 'set local role authenticated';
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_1);
    reset role;
    update public.hoteles set nombre = '__test_181_hotel_a_renombrado_32__' where id = v_hotel_a;
    execute 'set local role authenticated';
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_1, v_gen, v_rev_cap, 'COP',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_no_deberia_publicarse_32__', 'precio_pvp', 1))
    );
    if v_publicado is distinct from false then
      raise exception 'FALLO 32: un token capturado ANTES de renombrar el hotel debía rechazarse al publicar, devolvió %', v_publicado;
    end if;
    if exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_1 and servicio_nombre = '__test_181_no_deberia_publicarse_32__') then
      raise exception 'FALLO 32: se coló una fila pese al rechazo.';
    end if;
    raise notice 'OK 32: renombrar el hotel entre la captura del token y la publicación fue detectado — publicar() devolvió false.';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 33 (auditoría P1-b, ronda 4): token capturado ANTES de renombrar el servicio queda rechazado al publicar ──';
    -------------------------------------------------------------------------
    reset role;
    update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
    execute 'set local role authenticated';
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_1);
    reset role;
    update public.servicios_adicionales set nombre = '__test_181_servicio_renombrado_33__' where id = v_servicio_id;
    execute 'set local role authenticated';
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_1, v_gen, v_rev_cap, 'COP',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_no_deberia_publicarse_33__', 'precio_pvp', 1))
    );
    if v_publicado is distinct from false then
      raise exception 'FALLO 33: un token capturado ANTES de renombrar el servicio debía rechazarse al publicar, devolvió %', v_publicado;
    end if;
    if exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_1 and servicio_nombre = '__test_181_no_deberia_publicarse_33__') then
      raise exception 'FALLO 33: se coló una fila pese al rechazo.';
    end if;
    raise notice 'OK 33: renombrar el servicio entre la captura del token y la publicación fue detectado — publicar() devolvió false.';

    -------------------------------------------------------------------------
    raise notice '── PRUEBA 34 (auditoría P1-b, ronda 4): token capturado ANTES de renombrar destinos.nombre queda rechazado al publicar ──';
    -------------------------------------------------------------------------
    reset role;
    update public.armado_paquetes set tarifario_snapshot_publicable = true where id = v_paquete_1;
    execute 'set local role authenticated';
    select generacion, revision_capturada into v_gen, v_rev_cap from public.iniciar_generacion_tarifario(v_paquete_1);
    reset role;
    update public.destinos set nombre = '__test_181_destino_renombrado_34__' where id = v_destino_id;
    execute 'set local role authenticated';
    v_publicado := public.publicar_tarifario_resultado(
      v_paquete_1, v_gen, v_rev_cap, 'COP',
      jsonb_build_array(jsonb_build_object('modulo', 'servicios', 'servicio_nombre', '__test_181_no_deberia_publicarse_34__', 'precio_pvp', 1))
    );
    if v_publicado is distinct from false then
      raise exception 'FALLO 34: un token capturado ANTES de renombrar destinos.nombre debía rechazarse al publicar, devolvió %', v_publicado;
    end if;
    if exists (select 1 from public.tarifario_resultado where paquete_id = v_paquete_1 and servicio_nombre = '__test_181_no_deberia_publicarse_34__') then
      raise exception 'FALLO 34: se coló una fila pese al rechazo.';
    end if;
    raise notice 'OK 34: renombrar destinos.nombre entre la captura del token y la publicación fue detectado — publicar() devolvió false.';

    reset role;
  end if;

  raise notice '── TODAS LAS PRUEBAS EJECUTADAS TERMINARON EN OK (ver AVISOs si RPC 8-19 se omitió) ──';
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguna fila sintética (destinos/hoteles/armado_paquetes/
-- tarifa_hotel/hotel_temporadas/armado_hoteles/tarifario_resultado) ni
-- configuración de sesión (`set_config`/`set local role`) queda persistida.
