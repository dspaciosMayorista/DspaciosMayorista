-- ───────────────────────────────────────────────────────────────────────────
-- Migración 195 · crear y eliminar un bloqueo (record) de forma ATÓMICA
-- (tareas 2 y 3, fase B-bis del diseño §6.8).
--
-- Diseño: docs/futuro/traslado-cupos-y-mover-pasajero.md §6.8
-- Requiere la 194 (usa `_vuelos_actor`, autorización AUT-1).
--
-- POR QUÉ: hoy `crearBloqueo` y `cargarBloqueosMasivo` insertan el record y
-- después sus sillas en dos llamadas sueltas (la carga masiva ni siquiera mira
-- el error de las sillas: puede quedar un record con `cupos_total = N` y cero
-- sillas), y `eliminarBloqueo` borra sillas y record directamente. Son además
-- los únicos escritores legítimos que INSERTAN o BORRAN sillas, así que deben
-- pasar a funciones antes de poder cerrar la escritura directa (fase C).
--
-- QUÉ HACE (ADITIVA): crea dos funciones SECURITY DEFINER. No cambia
-- policies, privilegios, tablas ni datos: el código anterior (que escribe
-- directo) sigue funcionando igual mientras se despliega el nuevo, por eso
-- esta migración va ANTES del código.
--   crear_bloqueo(p_datos jsonb, p_cupos integer) → jsonb
--     record + N sillas `disponible` (1..N) en UNA transacción, con
--     `cupos_total` = sillas creadas (se comprueba). Si algo falla, no queda
--     nada.
--   eliminar_bloqueo(p_bloqueo_id bigint) → jsonb
--     borra sillas y record en UNA transacción solo si TODAS sus sillas son
--     libres de verdad: sin historial de movimientos, contrato, referencia
--     manual, ningún dato del grupo D (`_silla_con_datos`, 194) ni estado
--     devuelta/no vendida/retirada/cambio; y sin contratos, paquetes,
--     tarifario ni itinerarios que lo referencien. Si no, rechaza con TODOS
--     los motivos y no borra nada.
--
-- QUÉ NO HACE: no cierra la escritura directa (fase C), no vuelve inmutable
-- el historial (fase E), no corrige datos existentes.
-- ───────────────────────────────────────────────────────────────────────────

-- ═══ crear_bloqueo ═════════════════════════════════════════════════════════
-- p_datos: claves con el nombre de la columna (record, aerolinea, ruta,
-- origen, proveedor_id, destino_id, tarifa_neta, tarifa_para_empaquetar,
-- vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida, vuelo_regreso,
-- fecha_regreso, hora_salida_reg, hora_llegada_reg, fecha_devolucion,
-- fecha_emision, notas, rangos_edad (arreglo de ids), modalidad_emision,
-- estado_emision, estado_pago). Textos vacíos = null. Los estados de emisión
-- y pago vacíos = 'pendiente' (un record nuevo nace así).
create or replace function public.crear_bloqueo(p_datos jsonb, p_cupos integer)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record;
  v_id bigint;
  v_record text;
  v_modalidad text;
  v_emision text;
  v_pago text;
  v_creadas integer;
  t text;
  v_rangos bigint[];
begin
  select * into v_actor from public._vuelos_actor();   -- AUT-1: rol de vuelos + Mayorista o superadmin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'Datos del bloqueo inválidos.';
  end if;
  if p_cupos is null or p_cupos < 0 or p_cupos > 1000 then
    raise exception using errcode = '22023', message = 'Los cupos deben estar entre 0 y 1000.';
  end if;
  v_record := upper(btrim(coalesce(p_datos ->> 'record', '')));
  if v_record = '' then
    raise exception using errcode = '22023', message = 'Falta el record (PNR).';
  end if;
  v_modalidad := lower(btrim(coalesce(p_datos ->> 'modalidad_emision', '')));
  if v_modalidad not in ('serie', 'grupo') then
    raise exception using errcode = '22023', message = 'Selecciona la modalidad de emisión (serie o grupo).';
  end if;
  v_emision := coalesce(nullif(lower(btrim(coalesce(p_datos ->> 'estado_emision', ''))), ''), 'pendiente');
  if v_emision not in ('pendiente', 'emitido') then
    raise exception using errcode = '22023', message = 'El estado de emisión debe ser pendiente o emitido.';
  end if;
  v_pago := coalesce(nullif(lower(btrim(coalesce(p_datos ->> 'estado_pago', ''))), ''), 'pendiente');
  if v_pago not in ('pendiente', 'pagado') then
    raise exception using errcode = '22023', message = 'El estado de pago debe ser pendiente o pagado.';
  end if;
  if exists (select 1 from public.bloqueos_vuelo where record = v_record) then
    raise exception using errcode = '23505', message = format('Ya existe un bloqueo con el record %s.', v_record);
  end if;
  if jsonb_typeof(p_datos -> 'rangos_edad') = 'array' then
    select array_agg(x::bigint) into v_rangos from jsonb_array_elements_text(p_datos -> 'rangos_edad') x;
  end if;

  insert into public.bloqueos_vuelo (
    record, aerolinea, ruta, origen, proveedor_id, destino_id, tarifa_neta, tarifa_para_empaquetar,
    vuelo_ida, fecha_ida, hora_salida_ida, hora_llegada_ida,
    vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg,
    fecha_devolucion, fecha_emision, notas, rangos_edad,
    cupos_total, modalidad_emision, estado_emision, estado_pago)
  values (
    v_record,
    nullif(btrim(p_datos ->> 'aerolinea'), ''),
    nullif(btrim(p_datos ->> 'ruta'), ''),
    nullif(btrim(p_datos ->> 'origen'), ''),
    nullif(btrim(p_datos ->> 'proveedor_id'), '')::bigint,
    nullif(btrim(p_datos ->> 'destino_id'), '')::bigint,
    nullif(nullif(btrim(p_datos ->> 'tarifa_neta'), ''), '0')::numeric,
    coalesce(nullif(btrim(p_datos ->> 'tarifa_para_empaquetar'), '')::numeric, 0),
    nullif(btrim(p_datos ->> 'vuelo_ida'), ''),
    nullif(btrim(p_datos ->> 'fecha_ida'), '')::date,
    nullif(btrim(p_datos ->> 'hora_salida_ida'), '')::time,
    nullif(btrim(p_datos ->> 'hora_llegada_ida'), '')::time,
    nullif(btrim(p_datos ->> 'vuelo_regreso'), ''),
    nullif(btrim(p_datos ->> 'fecha_regreso'), '')::date,
    nullif(btrim(p_datos ->> 'hora_salida_reg'), '')::time,
    nullif(btrim(p_datos ->> 'hora_llegada_reg'), '')::time,
    nullif(btrim(p_datos ->> 'fecha_devolucion'), '')::date,
    nullif(btrim(p_datos ->> 'fecha_emision'), '')::date,
    nullif(btrim(p_datos ->> 'notas'), ''),
    v_rangos,
    p_cupos, v_modalidad, v_emision, v_pago)
  returning id into v_id;

  insert into public.sillas (bloqueo_id, numero_silla, estado)
  select v_id, g, 'disponible' from generate_series(1, p_cupos) g;
  get diagnostics v_creadas = row_count;
  if v_creadas <> p_cupos or public._sillas_activas(v_id) <> p_cupos then
    raise exception using errcode = 'P0001', message = 'No se crearon todas las sillas del bloqueo; no se guardó nada.';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'record', v_record, 'cupos', p_cupos);
exception
  -- Mensajes legibles para los errores de forma más comunes (la transacción
  -- se revierte igual: re-lanzar dentro del handler aborta toda la función).
  when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22007', message = 'Hay una fecha u hora inválida en el bloqueo.';
  when invalid_text_representation then
    raise exception using errcode = '22P02', message = 'Hay un número inválido en el bloqueo (tarifa, proveedor, destino o rangos de edad).';
  when unique_violation then
    raise exception using errcode = '23505', message = format('Ya existe un bloqueo con el record %s.', v_record);
end $$;

-- ═══ eliminar_bloqueo ══════════════════════════════════════════════════════
create or replace function public.eliminar_bloqueo(p_bloqueo_id bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record;
  v_b public.bloqueos_vuelo%rowtype;
  v_n integer;
  v_borradas integer;
  v_motivos text[] := array[]::text[];
begin
  select * into v_actor from public._vuelos_actor();
  if p_bloqueo_id is null then raise exception using errcode = '22023', message = 'Falta el bloqueo.'; end if;
  select * into v_b from public.bloqueos_vuelo where id = p_bloqueo_id for update;
  if v_b.id is null then raise exception using errcode = 'P0001', message = 'El bloqueo no existe.'; end if;
  perform 1 from public.sillas where bloqueo_id = p_bloqueo_id order by id for update;

  -- Historial: el record participó en un traslado, un movimiento de pasajero
  -- o un retiro (también filas legadas). Borrarlo obligaría a borrar historial.
  select count(*) into v_n from public.movimientos_silla m
   where m.bloqueo_origen_id = p_bloqueo_id or m.bloqueo_destino_id = p_bloqueo_id
      or m.silla_id in (select id from public.sillas where bloqueo_id = p_bloqueo_id)
      or m.silla_destino_id in (select id from public.sillas where bloqueo_id = p_bloqueo_id);
  if v_n > 0 then v_motivos := v_motivos || format('%s movimiento(s) en su historial', v_n); end if;

  select count(*) into v_n from public.sillas where bloqueo_id = p_bloqueo_id and numero_contrato is not null;
  if v_n > 0 then v_motivos := v_motivos || format('%s silla(s) con contrato', v_n); end if;
  select count(*) into v_n from public.sillas where bloqueo_id = p_bloqueo_id and contrato_manual is not null;
  if v_n > 0 then v_motivos := v_motivos || format('%s silla(s) con contrato manual', v_n); end if;
  -- Cualquier dato residual del grupo D (las 16 columnas: adulto, infante,
  -- responsable del menor, agencia, asesor, hotel, acomodación, plazo).
  select count(*) into v_n from public.sillas s where s.bloqueo_id = p_bloqueo_id and public._silla_con_datos(s);
  if v_n > 0 then v_motivos := v_motivos || format('%s silla(s) con datos de pasajero u operativos', v_n); end if;
  -- Devuelta (definitiva) y no vendida son registro del negocio con su motivo
  -- en bloqueo_cambios, que caería en cascada; retirada y cambio son historial.
  select count(*) into v_n from public.sillas
   where bloqueo_id = p_bloqueo_id and estado::text in ('devuelta', 'no_vendida', 'retirada', 'cambio');
  if v_n > 0 then v_motivos := v_motivos || format('%s silla(s) devuelta(s), no vendida(s), retirada(s) o en cambio', v_n); end if;

  -- Contratos que apuntan al record (vínculo durable o PNR en el vuelo del contrato).
  select count(*) into v_n from public.ventas where bloqueo_ref_id = p_bloqueo_id;
  if v_n > 0 then v_motivos := v_motivos || format('%s contrato(s) vinculado(s)', v_n); end if;
  select count(distinct numero_contrato) into v_n from public.contrato_vuelos
   where upper(btrim(coalesce(record, ''))) = upper(btrim(v_b.record));
  if v_n > 0 then v_motivos := v_motivos || format('%s contrato(s) con este PNR en su vuelo', v_n); end if;
  -- Producto que lo usa (FK sin cascada).
  select count(*) into v_n from public.paquetes where bloqueo_id = p_bloqueo_id;
  if v_n > 0 then v_motivos := v_motivos || format('%s paquete(s)', v_n); end if;
  select count(*) into v_n from public.tarifario_resultado where bloqueo_id = p_bloqueo_id;
  if v_n > 0 then v_motivos := v_motivos || 'filas del tarifario generado'; end if;
  select count(*) into v_n from public.itinerarios where bloqueo_id = p_bloqueo_id;
  if v_n > 0 then v_motivos := v_motivos || format('%s itinerario(s)', v_n); end if;

  if cardinality(v_motivos) > 0 then
    raise exception using errcode = 'P0001', message = format(
      'No se puede eliminar el bloqueo %s: %s. No se borró nada.', v_b.record, array_to_string(v_motivos, '; '));
  end if;

  delete from public.sillas where bloqueo_id = p_bloqueo_id;
  get diagnostics v_borradas = row_count;
  delete from public.bloqueos_vuelo where id = p_bloqueo_id;   -- armado_vuelos y bloqueo_cambios caen en cascada
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception using errcode = 'P0001', message = 'El bloqueo no se pudo eliminar; no se borró nada.';
  end if;
  return jsonb_build_object('ok', true, 'record', v_b.record, 'sillas_borradas', v_borradas);
end $$;

revoke all on function public.crear_bloqueo(jsonb, integer) from public, anon;
revoke all on function public.eliminar_bloqueo(bigint) from public, anon;
grant execute on function public.crear_bloqueo(jsonb, integer) to authenticated;
grant execute on function public.eliminar_bloqueo(bigint) to authenticated;

comment on function public.crear_bloqueo(jsonb, integer) is
  'Fase B-bis (§6.8): crea un record y sus N sillas disponibles en una sola transacción; '
  'cupos_total = sillas creadas. AUT-1. Migración 195.';
comment on function public.eliminar_bloqueo(bigint) is
  'Fase B-bis (§6.8): borra un record y sus sillas solo si no tiene historial, contratos, '
  'referencias manuales, pasajeros ni producto que lo use. AUT-1. Migración 195.';
