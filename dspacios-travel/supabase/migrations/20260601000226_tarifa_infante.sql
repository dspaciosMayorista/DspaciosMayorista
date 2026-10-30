-- ───────────────────────────────────────────────────────────────────────────
-- 226 · TARIFA DE INFANTE (0 a 1,99 años) en vuelo y servicios
--
-- REGLA DEL DUEÑO
--   · Menor de 2 años (0 a 1,99; `edad < 2`): en el VUELO paga solo su fee de infante (puede ser $0) y en cada
--     SERVICIO su "precio de infante" (puede ser $0). No ocupa silla ni cuenta para el rango de un servicio por grupo.
--   · Desde los 2 años: tarifa de adulto en vuelo y servicios.
--   · El HOTEL conserva su propia clase de infante/niño (edad configurable por hotel).
--   · Fee = precio = costo (sin markup ni TA); el precio de infante del servicio es NETO con markup. NULL ≠ $0: un
--     servicio sin precio de infante cobra al infante como adulto y la app lo avisa.
--
-- QUÉ HACE (ADITIVA — no quita acceso a nadie ni toca datos existentes)
--   1. `bloqueos_vuelo.fee_infante` numeric(15,2) not null default 0 (el Bloqueo no tenía fee de infante;
--      salidas_dinamicas y empaquetados ya lo tienen desde la 094/156).
--   2. `servicios_adicionales.precio_infante` y `servicio_temporadas.precio_infante` numeric(15,2) NULL (>= 0).
--      NULL = sin configurar (el infante paga como adulto); en la temporada NULL = hereda el de la tarifa GENERAL.
--   3. `tarifario_resultado.precio_pvp_menor2` numeric(15,2) NULL (>= 0): precio publicado de un menor de 2 años.
--   4. Reemplaza (mismas firmas, mismos grants): publicar_tarifario_resultado (181, ahora persiste la columna nueva),
--      crear_bloqueo (195, ahora acepta fee_infante), la función de trigger del catálogo de servicios (181) y los
--      triggers de bloqueos_vuelo, empaquetados y servicios_adicionales para que cambiar un fee_infante o un
--      precio_infante INVALIDE el tarifario (hoy no lo hacían). servicio_temporadas y salidas_dinamicas ya disparan
--      con cualquier cambio.
--   5. Reemplaza las vistas tarifario_resultado_publicable (182, `select r.*` se vuelve a expandir) y
--      tarifario_resumen (162/182: `precio_infante` pasa a ser el precio del menor de 2 años).
--
-- QUÉ NO HACE
--   No regenera ningún tarifario (la regeneración es MANUAL, por paquete, con el botón existente: hasta entonces las
--   filas viejas no traen precio_pvp_menor2 y la reserva con infantes pide regenerar), no toca contratos, pagos,
--   cuentas por pagar ni cotizaciones, no cambia policies ni privilegios, no toca `bloqueos_vuelo.tarifa_neta` ni
--   `trasladar_cupos` (un fee distinto NO vuelve incompatibles dos records).
--
-- ORDEN DE DESPLIEGUE: esta migración va ANTES del código nuevo (el código selecciona las columnas nuevas); el código
--   anterior sigue funcionando con ella aplicada. Rollback: supabase/scripts/rollback_226_tarifa_infante.sql.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- Prerrequisitos: falla cerrado con un mensaje claro si falta algo de lo que esta migración reemplaza.
do $$
begin
  if to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is null then
    raise exception '226 ABORTADA: falta public.publicar_tarifario_resultado (181).';
  end if;
  if to_regclass('public.tarifario_resultado_publicable') is null or to_regclass('public.tarifario_resumen') is null then
    raise exception '226 ABORTADA: faltan las vistas tarifario_resultado_publicable / tarifario_resumen (162/182).';
  end if;
  if to_regprocedure('public.crear_bloqueo(jsonb, integer)') is null then
    raise exception '226 ABORTADA: falta public.crear_bloqueo (195).';
  end if;
  if to_regprocedure('public.tarifario_trg_bump_servicio_catalogo()') is null
     or to_regprocedure('public.tarifario_trg_bump_por_bloqueo()') is null
     or to_regprocedure('public.tarifario_trg_bump_por_empaquetado()') is null then
    raise exception '226 ABORTADA: faltan las funciones de trigger de invalidación del tarifario (181).';
  end if;
  if to_regclass('public.empaquetados') is null or to_regclass('public.servicio_temporadas') is null then
    raise exception '226 ABORTADA: faltan empaquetados (156) o servicio_temporadas (089).';
  end if;
end $$;

-- ═══ 1-3. Columnas nuevas ═════════════════════════════════════════════════
alter table public.bloqueos_vuelo
  add column if not exists fee_infante numeric(15,2) not null default 0
    constraint bloqueos_vuelo_fee_infante_chk check (fee_infante >= 0);
comment on column public.bloqueos_vuelo.fee_infante is
  'Fee de infante del vuelo (0 a 1,99 años). El infante paga SOLO esto en el vuelo: precio = costo, sin markup ni TA. 0 = gratis. Migración 226.';

alter table public.servicios_adicionales
  add column if not exists precio_infante numeric(15,2)
    constraint servicios_adicionales_precio_infante_chk check (precio_infante is null or precio_infante >= 0);
comment on column public.servicios_adicionales.precio_infante is
  'Precio NETO por infante (0 a 1,99 años) en cobro por persona. NULL = sin configurar: el infante paga como adulto (NULL no es $0). 0 = gratis. Migración 226.';

alter table public.servicio_temporadas
  add column if not exists precio_infante numeric(15,2)
    constraint servicio_temporadas_precio_infante_chk check (precio_infante is null or precio_infante >= 0);
comment on column public.servicio_temporadas.precio_infante is
  'Precio NETO por infante en esta temporada. NULL = hereda el de la tarifa GENERAL del servicio. Migración 226.';

alter table public.tarifario_resultado
  add column if not exists precio_pvp_menor2 numeric(15,2)
    constraint tarifario_resultado_precio_pvp_menor2_chk check (precio_pvp_menor2 is null or precio_pvp_menor2 >= 0);
comment on column public.tarifario_resultado.precio_pvp_menor2 is
  'Precio publicado de un MENOR DE 2 AÑOS: parte de hotel de su clase + servicios incluidos con su precio de infante + fee de infante del vuelo EXACTO (redondeo solo de hotel + servicios). En filas de servicio por persona = PVP del infante; NULL = paga como adulto. NULL en habitaciones adultas y en filas publicadas antes de la 226 (hay que regenerar). Migración 226.';

-- ═══ 4. Publicador atómico (181): persiste la columna nueva ═══════════════
create or replace function public.publicar_tarifario_resultado(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_moneda text,
  p_filas jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_generacion_actual bigint;
  v_revision_actual   bigint;
  v_activo            boolean;
  v_fila              jsonb;
  v_fila_paquete      bigint;
  v_insertadas        integer := 0;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null then
    raise exception 'publicar_tarifario_resultado: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  -- Auditoría de Fase 1, ronda 3 (hallazgo P1 "carrera entre moneda
  -- preliminar y autoritativa"): `moneda` es un dato DERIVADO del mismo
  -- cálculo que produce `p_filas` — se recibe y persiste AQUÍ, en la misma
  -- transacción, en vez de escribirse por separado antes de capturar el
  -- token (ver el comentario largo en el trigger de armado_paquetes, más
  -- arriba en esta migración). Solo admite los 2 valores reales de la
  -- columna `moneda` de tarifario_resultado/armado_paquetes.
  --
  -- ⚠️ `p_moneda is null or ...`, NUNCA `p_moneda not in (...)` a secas
  -- (auditoría de Fase 1, ronda 4): si `p_moneda` llega NULL, `NULL not in
  -- (...)` evalúa a NULL, y `if NULL then` en PL/pgSQL es FALSO — la
  -- excepción nunca se lanzaría y un NULL seguiría de largo hasta el INSERT,
  -- violando el NOT NULL de `tarifario_resultado.moneda` con un error menos
  -- claro. Mismo defecto ya corregido antes en `mi_rol()` (migración 179).
  if p_moneda is null or p_moneda not in ('COP', 'USD') then
    raise exception 'publicar_tarifario_resultado: p_moneda debe ser COP o USD, recibido: %', p_moneda;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'publicar_tarifario_resultado: p_filas debe ser un arreglo jsonb';
  end if;

  -- Candado de fila + lectura del estado actual, dentro de la transacción —
  -- serializa dos publicaciones concurrentes del MISMO paquete (la segunda
  -- espera a que la primera libere el FOR UPDATE antes de comparar). También
  -- lee `activo` AQUÍ (auditoría de Fase 1, hallazgo 3): el `paquete_activo`
  -- de CADA fila insertada viene de esta lectura autoritativa, NUNCA del
  -- payload — un caller no puede publicar un snapshot que se declare activo
  -- mientras el paquete real está desactivado, ni al revés.
  select tarifario_generacion, tarifario_revision_fuente, activo
    into v_generacion_actual, v_revision_actual, v_activo
    from public.armado_paquetes
    where id = p_paquete_id
    for update;

  if not found then
    raise exception 'publicar_tarifario_resultado: paquete % no encontrado', p_paquete_id;
  end if;

  -- Rechazo #1: alguien más ya pidió (o publicó) una generación más nueva.
  if v_generacion_actual <> p_generacion then
    return false;
  end if;

  -- Rechazo #2 (el hallazgo central de esta ronda): las FUENTES cambiaron
  -- DURANTE este cálculo, aunque nadie haya pedido una generación nueva
  -- todavía. Publicar ahora mezclaría datos calculados contra una versión
  -- vieja de las fuentes con lo que hay en la base en este instante. Queda
  -- 'pendiente' (nunca 'recalculando' colgado en falso) — la mutación que
  -- invalidó ya disparó su propio trigger de recálculo automático por su
  -- cuenta, nadie necesita "hacerse cargo" de este intento puntual.
  if v_revision_actual <> p_revision_capturada then
    update public.armado_paquetes set tarifario_estado = 'pendiente' where id = p_paquete_id;
    return false;
  end if;

  -- Validación COMPLETA del lote ANTES de tocar una sola fila (fail-closed
  -- real, mismo criterio que reemplazar_tarifas_hotel_calculadora): ninguna
  -- fila puede declarar un paquete_id distinto al solicitado.
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'publicar_tarifario_resultado: cada elemento de p_filas debe ser un objeto jsonb';
    end if;
    if v_fila ? 'paquete_id' and v_fila->>'paquete_id' is not null then
      begin
        v_fila_paquete := (v_fila->>'paquete_id')::bigint;
      exception when others then
        raise exception 'publicar_tarifario_resultado: paquete_id de una fila no es numérico: %', v_fila->>'paquete_id';
      end;
      if v_fila_paquete <> p_paquete_id then
        raise exception 'publicar_tarifario_resultado: una fila declara paquete_id % distinto al solicitado (%)', v_fila_paquete, p_paquete_id;
      end if;
    end if;
  end loop;

  delete from public.tarifario_resultado where paquete_id = p_paquete_id;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    -- Columnas EXPLÍCITAS únicamente (nunca `select *`/`insert *`): `id` y
    -- `created_at` nunca se leen del payload (Postgres los genera); el
    -- `paquete_id` insertado es SIEMPRE p_paquete_id, nunca el de la fila.
    insert into public.tarifario_resultado (
      paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, bloqueo_label,
      empaquetado_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
      destino_id, destino_nombre, categoria, regimen, acomodacion, noches,
      fecha_ida, fecha_regreso, pax_desde, pax_hasta, tipo_tarifa,
      base_comisionable, impuesto, precio_pvp, precio_pvp_menor2, descripcion, recargo_individual,
      moneda, salida_id, temporada_ganadora, es_promocion, precio_final_autoritativo,
      procedencia_temporadas, procedencia_mixta
    ) values (
      p_paquete_id,
      v_fila->>'paquete_nombre',
      -- Auditoría de Fase 1, hallazgo 3: `paquete_activo` IGNORA por
      -- completo lo que traiga el payload — siempre es `v_activo`, leído
      -- arriba del `armado_paquetes` real dentro del mismo `FOR UPDATE`. Un
      -- payload que declare `paquete_activo: true` sobre un paquete
      -- desactivado (o viceversa) nunca se respeta.
      v_activo,
      (v_fila->>'modulo')::public.tarifario_modulo,
      (v_fila->>'bloqueo_id')::bigint,
      v_fila->>'bloqueo_label',
      (v_fila->>'empaquetado_id')::bigint,
      (v_fila->>'hotel_id')::bigint,
      v_fila->>'hotel_nombre',
      (v_fila->>'servicio_id')::bigint,
      v_fila->>'servicio_nombre',
      (v_fila->>'destino_id')::bigint,
      v_fila->>'destino_nombre',
      v_fila->>'categoria',
      v_fila->>'regimen',
      (v_fila->>'acomodacion')::public.acomodacion_tipo,
      (v_fila->>'noches')::integer,
      (v_fila->>'fecha_ida')::date,
      (v_fila->>'fecha_regreso')::date,
      (v_fila->>'pax_desde')::integer,
      (v_fila->>'pax_hasta')::integer,
      v_fila->>'tipo_tarifa',
      coalesce((v_fila->>'base_comisionable')::numeric, 0),
      coalesce((v_fila->>'impuesto')::numeric, 0),
      coalesce((v_fila->>'precio_pvp')::numeric, 0),
      -- Migración 226: precio de un MENOR DE 2 AÑOS (fee de infante + servicios de infante + hotel
      -- de su clase). NULL = no aplica (habitación adulta) o fila de un código anterior a la 226.
      (v_fila->>'precio_pvp_menor2')::numeric,
      v_fila->>'descripcion',
      (v_fila->>'recargo_individual')::numeric,
      -- Auditoría de Fase 1, ronda 4: `p_moneda` GOBIERNA la moneda de TODAS
      -- las filas — igual criterio que `paquete_activo`/`paquete_id`, nunca
      -- se lee `v_fila->>'moneda'`. Un paquete es de UNA sola moneda (regla
      -- de negocio ya validada por generarTarifario antes de calcular
      -- `filas`); permitir que el payload declarara una moneda distinta por
      -- fila habría dejado un paquete USD con filas COP mezcladas — el
      -- hallazgo confirmado que motivó este cambio.
      p_moneda,
      (v_fila->>'salida_id')::bigint,
      v_fila->>'temporada_ganadora',
      (v_fila->>'es_promocion')::boolean,
      (v_fila->>'precio_final_autoritativo')::boolean,
      -- Auditoría de Fase 1, hallazgo 1: `v_fila->'procedencia_temporadas'`
      -- directo insertaría el escalar jsonb `null` (JSON null, NOT NULL en
      -- Postgres) cuando la clave está presente con valor `null` — distinto
      -- de SQL NULL. Se normaliza explícitamente: clave ausente O valor
      -- `null`::jsonb ⇒ SQL NULL; cualquier otro valor (incl. un arreglo
      -- vacío `[]`) se inserta tal cual. Los CHECK de la migración 180 sobre
      -- esta columna no se tocan.
      case
        when not (v_fila ? 'procedencia_temporadas')
          or v_fila->'procedencia_temporadas' = 'null'::jsonb
        then null
        else v_fila->'procedencia_temporadas'
      end,
      coalesce((v_fila->>'procedencia_mixta')::boolean, false)
    );
    v_insertadas := v_insertadas + 1;
  end loop;

  -- Regla del dueño: una publicación exitosa habilita el snapshot SOLO si el
  -- paquete sigue activo (`tarifario_snapshot_publicable = activo`) — nunca
  -- `true` a secas. Un paquete desactivado que de todas formas se regenera
  -- (ej. por un trigger de hotel disparado mientras está inactivo) publica
  -- su snapshot correctamente pero SIGUE bloqueado para lectores.
  -- `moneda = p_moneda` (auditoría de Fase 1, ronda 3): escrita EN LA MISMA
  -- transacción/UPDATE que el resto del estado de publicación, con el valor
  -- AUTORITATIVO que generarTarifario acaba de usar para calcular `p_filas`
  -- — nunca puede quedar desincronizada de las filas que se publicaron.
  -- Esta columna no está en la lista `UPDATE OF` del trigger de
  -- armado_paquetes (ver esa migración más arriba), así que este UPDATE
  -- nunca se re-invalida a sí mismo sin importar el valor.
  update public.armado_paquetes set
    tarifario_generacion_publicada = p_generacion,
    tarifario_revision_publicada = p_revision_capturada,
    tarifario_estado = 'listo',
    tarifario_error = null,
    tarifario_snapshot_publicable = v_activo,
    tarifario_actualizado_en = now(),
    moneda = p_moneda
  where id = p_paquete_id;

  return true;
end;
$$;

comment on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) is
  'Publica atómicamente (delete+insert+actualización de estado en UNA transacción) el snapshot de tarifario_resultado de un paquete. Rechaza (devuelve false, sin tocar tarifario_resultado) si p_generacion o p_revision_capturada ya no coinciden con el estado actual de armado_paquetes; rechaza con excepción (sin borrar el snapshot anterior) si p_moneda es NULL o distinto de COP/USD. p_moneda GOBIERNA la moneda de TODAS las filas. Desde la migración 226 persiste también precio_pvp_menor2 (precio del menor de 2 años). SECURITY DEFINER con candado de rol propio. Migración 181/226.';
revoke all on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) from public, anon;
grant execute on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) to authenticated;

-- ═══ 4. crear_bloqueo (195): acepta fee_infante ═══════════════════════════
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

-- ═══ 4. Invalidación del tarifario: fee_infante y precio_infante ══════════
create or replace function public.tarifario_trg_bump_servicio_catalogo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  if TG_OP = 'UPDATE'
    and NEW.nombre is not distinct from OLD.nombre
    and NEW.descripcion is not distinct from OLD.descripcion
    and NEW.precio_persona is not distinct from OLD.precio_persona
    and NEW.precio_infante is not distinct from OLD.precio_infante
    and NEW.recargo_individual is not distinct from OLD.recargo_individual
    and NEW.liquidacion is not distinct from OLD.liquidacion
    and NEW.moneda is not distinct from OLD.moneda
  then
    return NEW;
  end if;

  select array_agg(distinct paquete_id) into v_ids
    from public.armado_servicios
    where servicio_id = any(array_remove(array[OLD.id, NEW.id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_servicio_catalogo() from public, anon, authenticated;

drop trigger if exists tarifario_trg_servicios_adicionales on public.servicios_adicionales;
create trigger tarifario_trg_servicios_adicionales
  after insert or delete or update of nombre, descripcion, precio_persona, precio_infante, recargo_individual, liquidacion, moneda
  on public.servicios_adicionales
  for each row execute function public.tarifario_trg_bump_servicio_catalogo();

drop trigger if exists tarifario_trg_bloqueos_vuelo on public.bloqueos_vuelo;
create trigger tarifario_trg_bloqueos_vuelo
  after insert or delete or update of tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta
  on public.bloqueos_vuelo
  for each row execute function public.tarifario_trg_bump_por_bloqueo();

drop trigger if exists tarifario_trg_empaquetados on public.empaquetados;
create trigger tarifario_trg_empaquetados
  after insert or delete or update of activo, compra_inicio, compra_fin, tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta
  on public.empaquetados
  for each row execute function public.tarifario_trg_bump_por_empaquetado();

-- ═══ 5. Vistas ════════════════════════════════════════════════════════════
-- `select r.*` se vuelve a expandir: la columna nueva queda AL FINAL (create or replace view lo permite y conserva
-- los grants y los comentarios). Mismas opciones que la 182.
create or replace view public.tarifario_resultado_publicable
  with (security_barrier = true, security_invoker = false)
as
  select r.*
  from public.tarifario_resultado r
  join public.armado_paquetes ap on ap.id = r.paquete_id
  where ap.tarifario_snapshot_publicable = true
    and ap.activo = true;

create or replace view public.tarifario_resumen
  with (security_invoker = true)
as
  select
    r.modulo,
    r.paquete_id,
    r.paquete_nombre,
    r.paquete_activo,
    r.bloqueo_id,
    r.bloqueo_label,
    r.empaquetado_id,
    r.salida_id,
    r.hotel_id,
    r.hotel_nombre,
    r.servicio_id,
    r.servicio_nombre,
    r.destino_id,
    r.destino_nombre,
    r.categoria,
    r.regimen,
    r.fecha_ida,
    r.fecha_regreso,
    r.noches,
    r.moneda,
    min(r.precio_pvp) filter (where r.acomodacion = 'sencilla' and r.precio_pvp > 0) as precio_sencilla,
    min(r.precio_pvp) filter (where r.acomodacion = 'doble'    and r.precio_pvp > 0) as precio_doble,
    min(r.precio_pvp) filter (where r.acomodacion = 'triple'   and r.precio_pvp > 0) as precio_triple,
    min(r.precio_pvp) filter (where r.acomodacion = 'multiple' and r.precio_pvp > 0) as precio_multiple,
    min(r.precio_pvp) filter (where r.acomodacion = 'nino')    as precio_nino,
    min(r.precio_pvp) filter (where r.acomodacion = 'nino2')   as precio_nino2,
    -- Infante = MENOR DE 2 AÑOS (migración 226): su precio (fee de vuelo + servicios de infante + hotel de su
    -- clase); las filas publicadas antes de la 226 no lo traen y siguen mostrando precio_pvp.
    min(coalesce(r.precio_pvp_menor2, r.precio_pvp)) filter (where r.acomodacion = 'infante') as precio_infante,
    min(r.precio_pvp) filter (
      where r.acomodacion in ('sencilla', 'doble', 'triple', 'multiple') and r.precio_pvp > 0
    ) as desde_adulto,
    min(r.precio_pvp) filter (where r.precio_pvp > 0) as desde_general,
    min(r.descripcion) as descripcion,
    min(r.recargo_individual) as recargo_individual,
    min(r.tipo_tarifa) as tipo_tarifa
  from public.tarifario_resultado_publicable r
  where r.paquete_activo = true
  group by
    r.modulo, r.paquete_id, r.paquete_nombre, r.paquete_activo, r.bloqueo_id, r.bloqueo_label,
    r.empaquetado_id, r.salida_id, r.hotel_id, r.hotel_nombre, r.servicio_id, r.servicio_nombre,
    r.destino_id, r.destino_nombre, r.categoria, r.regimen, r.fecha_ida, r.fecha_regreso, r.noches, r.moneda;

commit;
