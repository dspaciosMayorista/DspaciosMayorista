-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 229 · publicar_tarifario_resultado set-based (#100). Restaura el cuerpo EXACTO de la 226 (el bloque de abajo
-- es una copia literal de la definición, el comment y los grants de supabase/migrations/20260601000226_tarifa_infante.sql).
-- Misma firma, así que NO cambia ninguna dependencia (la 227 sigue delegando en esta función). No toca datos ni
-- tablas. Idempotente. Volver a aplicar la 229 después es seguro.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is null then
    raise exception 'ROLLBACK 229 ABORTADO: falta public.publicar_tarifario_resultado.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'precio_pvp_menor2') then
    raise exception 'ROLLBACK 229 ABORTADO: falta tarifario_resultado.precio_pvp_menor2 (el cuerpo de la 226 la necesita).';
  end if;
end $$;

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

commit;
