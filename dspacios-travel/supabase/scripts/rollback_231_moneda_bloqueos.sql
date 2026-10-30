-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 231 (moneda de la fuente en Bloqueos) — ESTRUCTURA. Devuelve el esquema al estado de la 230.
-- NO toca datos de negocio (la acreditación tiene su propio rollback: rollback_231_acreditacion_datos.sql, que va ANTES).
-- Se NIEGA si hay algún Bloqueo con moneda acreditada (se perdería la constancia) o si el interruptor estricto está encendido:
--   1) apaga el interruptor (update p90_priv.config set exigir_moneda_bloqueo = false where id)
--   2) corre rollback_231_acreditacion_datos.sql (y, si hay Bloqueos acreditados a mano en el formulario, ponlos en NULL a mano)
--   3) recién entonces este script.
-- Orden con el código: el código nuevo ENVÍA moneda y la LEE (select ... moneda): primero se revierte el despliegue, después este script.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bloqueos_vuelo' and column_name = 'moneda') then
    raise exception 'ROLLBACK 231 ABORTADO: la 231 no está aplicada (falta bloqueos_vuelo.moneda).';
  end if;
  if exists (select 1 from public.bloqueos_vuelo where moneda is not null) then
    raise exception 'ROLLBACK 231 ABORTADO: hay Bloqueos con moneda acreditada; revierte antes los datos (rollback_231_acreditacion_datos.sql).';
  end if;
  if coalesce((select exigir_moneda_bloqueo from p90_priv.config where id), false) then
    raise exception 'ROLLBACK 231 ABORTADO: el interruptor estricto está encendido; apágalo antes.';
  end if;
end $$;

-- 1. Guarda de la moneda y su función
drop trigger if exists trg_bloqueos_moneda_90 on public.bloqueos_vuelo;
drop function if exists public.trg_bloqueos_moneda_90();

-- 2. Invalidación del tarifario como la dejó la 226 (sin 'moneda') y la función como la 181 (sin la excepción NULL -> COP)
create or replace function public.tarifario_trg_bump_por_bloqueo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  select array_agg(distinct paquete_id) into v_ids
    from public.armado_vuelos
    where bloqueo_id = any(array_remove(array[OLD.id, NEW.id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_por_bloqueo() from public, anon, authenticated;
comment on function public.tarifario_trg_bump_por_bloqueo() is null;

drop trigger if exists tarifario_trg_bloqueos_vuelo on public.bloqueos_vuelo;
create trigger tarifario_trg_bloqueos_vuelo
  after insert or delete or update of tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta
  on public.bloqueos_vuelo
  for each row execute function public.tarifario_trg_bump_por_bloqueo();

-- 3. crear_bloqueo como lo dejó la 226 (sin moneda)
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
    record, aerolinea, ruta, origen, proveedor_id, destino_id, tarifa_neta, tarifa_para_empaquetar, fee_infante,
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
    coalesce(nullif(btrim(p_datos ->> 'fee_infante'), '')::numeric, 0),   -- migración 226
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

revoke all on function public.crear_bloqueo(jsonb, integer) from public, anon;
grant execute on function public.crear_bloqueo(jsonb, integer) to authenticated;
comment on function public.crear_bloqueo(jsonb, integer) is
  'Fase B-bis (§6.8): crea un record y sus N sillas disponibles en una sola transacción; cupos_total = sillas creadas. AUT-1. Migración 195.';

-- 4. Columnas, CHECK, interruptor
alter table public.bloqueos_vuelo
  drop constraint bloqueos_vuelo_moneda_constancia_chk,
  drop constraint bloqueos_vuelo_moneda_chk,
  drop column moneda_acreditada_ref,
  drop column moneda_acreditada_por,
  drop column moneda_acreditada_en,
  drop column moneda;
drop function if exists p90_priv.exigir_moneda_bloqueo();
drop table if exists p90_priv.config;
drop schema if exists p90_priv;

commit;
