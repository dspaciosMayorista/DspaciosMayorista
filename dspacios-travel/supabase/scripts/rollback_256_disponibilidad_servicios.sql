-- Rollback de la 256: restaura el publicador interno de la 254 y quita la función y el diagnóstico (la columna fechas_disponibles queda inerte).
-- ABORTA si alguna definición NO es exactamente la que dejó la 256 (alguien la cambió después).
-- Efecto sobre datos: se pierden los tramos de disponibilidad (fechas_disponibles) y los diagnósticos. Un servicio opcional publicado con tramos pasaría a
-- verse en todas las fechas hasta regenerar (la venta sigue validando la vigencia viva de la fecha). No toca contratos ni la 255.
begin;

do $$
declare
  v_int text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), ''));
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tarifario_resultado' and column_name='fechas_disponibles') then
    raise exception 'ROLLBACK 256 ABORTADO: la 256 no está aplicada.';
  end if;
  if v_int is distinct from 'fdea107e195de51abca78e34b3e90c9b' then
    raise exception 'ROLLBACK 256 ABORTADO (REVISAR): el publicador ya no es el de la 256 (huella %); no se sobrescribe.', v_int;
  end if;
end $$;

drop function if exists public.registrar_diagnostico_tarifario(bigint, bigint, text);

-- Publicador de la 254 (sin fechas_disponibles ni borrado del diagnóstico).
create or replace function public.publicar_tarifario_resultado_interno(
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
  v_fila_paquete_txt  text;
  v_fila_paquete      bigint;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null then
    raise exception 'publicar_tarifario_resultado: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  -- `p_moneda is null or ...`, NUNCA `p_moneda not in (...)` a secas: con NULL esa comparación es NULL y el `if` no
  -- dispararía la excepción (mismo defecto ya corregido en `mi_rol()`, migración 179).
  if p_moneda is null or p_moneda not in ('COP', 'USD') then
    raise exception 'publicar_tarifario_resultado: p_moneda debe ser COP o USD, recibido: %', p_moneda;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'publicar_tarifario_resultado: p_filas debe ser un arreglo jsonb';
  end if;

  -- Candado de fila + lectura del estado actual (serializa dos publicaciones del MISMO paquete). `activo` se lee AQUÍ:
  -- el `paquete_activo` de cada fila sale de esta lectura autoritativa, nunca del payload.
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

  -- Rechazo #2: las FUENTES cambiaron durante este cálculo. Queda 'pendiente' (nunca 'recalculando' colgado en falso).
  if v_revision_actual <> p_revision_capturada then
    update public.armado_paquetes set tarifario_estado = 'pendiente' where id = p_paquete_id;
    return false;
  end if;

  -- Validación COMPLETA del lote ANTES de tocar una sola fila (fail-closed). Set-based: UNA consulta para el tipo de
  -- cada elemento, y el cast de paquete_id solo sobre los valores DISTINTOS del payload (normalmente uno).
  if exists (select 1 from jsonb_array_elements(p_filas) e where jsonb_typeof(e) <> 'object') then
    raise exception 'publicar_tarifario_resultado: cada elemento de p_filas debe ser un objeto jsonb';
  end if;
  for v_fila_paquete_txt in
    select distinct e->>'paquete_id' from jsonb_array_elements(p_filas) e
     where e ? 'paquete_id' and e->>'paquete_id' is not null
  loop
    begin
      v_fila_paquete := v_fila_paquete_txt::bigint;
    exception when others then
      raise exception 'publicar_tarifario_resultado: paquete_id de una fila no es numérico: %', v_fila_paquete_txt;
    end;
    if v_fila_paquete <> p_paquete_id then
      raise exception 'publicar_tarifario_resultado: una fila declara paquete_id % distinto al solicitado (%)', v_fila_paquete, p_paquete_id;
    end if;
  end loop;

  delete from public.tarifario_resultado where paquete_id = p_paquete_id;

  -- Carga SET-BASED: un solo INSERT … SELECT. Columnas EXPLÍCITAS (nunca `insert *`): `id` y `created_at` los genera
  -- Postgres; `paquete_id` es SIEMPRE p_paquete_id, `paquete_activo` SIEMPRE v_activo y `moneda` SIEMPRE p_moneda
  -- (un paquete es de UNA sola moneda), nunca lo que traiga la fila. Mismas expresiones y casts que la 226.
  insert into public.tarifario_resultado (
    paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, bloqueo_label,
    empaquetado_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, acomodacion, noches,
    fecha_ida, fecha_regreso, pax_desde, pax_hasta, tipo_tarifa,
    base_comisionable, impuesto, precio_pvp, precio_pvp_menor2, precio_pvp_sin_fijo, precio_pvp_menor2_sin_fijo, descripcion, recargo_individual,
    moneda, salida_id, temporada_ganadora, es_promocion, precio_final_autoritativo,
    procedencia_temporadas, procedencia_mixta
  )
  select
    p_paquete_id,
    f.v->>'paquete_nombre',
    v_activo,
    (f.v->>'modulo')::public.tarifario_modulo,
    (f.v->>'bloqueo_id')::bigint,
    f.v->>'bloqueo_label',
    (f.v->>'empaquetado_id')::bigint,
    (f.v->>'hotel_id')::bigint,
    f.v->>'hotel_nombre',
    (f.v->>'servicio_id')::bigint,
    f.v->>'servicio_nombre',
    (f.v->>'destino_id')::bigint,
    f.v->>'destino_nombre',
    f.v->>'categoria',
    f.v->>'regimen',
    (f.v->>'acomodacion')::public.acomodacion_tipo,
    (f.v->>'noches')::integer,
    (f.v->>'fecha_ida')::date,
    (f.v->>'fecha_regreso')::date,
    (f.v->>'pax_desde')::integer,
    (f.v->>'pax_hasta')::integer,
    f.v->>'tipo_tarifa',
    coalesce((f.v->>'base_comisionable')::numeric, 0),
    coalesce((f.v->>'impuesto')::numeric, 0),
    coalesce((f.v->>'precio_pvp')::numeric, 0),
    -- Migración 226: precio de un MENOR DE 2 AÑOS. NULL = no aplica o fila de un código anterior a la 226.
    (f.v->>'precio_pvp_menor2')::numeric,
    -- Migración 254: precio NORMAL del infante cuando el PVP fijo del paquete lo reemplazó (NULL = el fijo no se aplicó a esa ruta).
    (f.v->>'precio_pvp_sin_fijo')::numeric,
    (f.v->>'precio_pvp_menor2_sin_fijo')::numeric,
    f.v->>'descripcion',
    (f.v->>'recargo_individual')::numeric,
    p_moneda,
    (f.v->>'salida_id')::bigint,
    f.v->>'temporada_ganadora',
    (f.v->>'es_promocion')::boolean,
    (f.v->>'precio_final_autoritativo')::boolean,
    -- Clave ausente O valor `null`::jsonb ⇒ SQL NULL (el escalar jsonb `null` NO es SQL NULL y violaría los CHECK de la
    -- 180); cualquier otro valor, incluido un arreglo vacío `[]`, se inserta tal cual.
    case
      when not (f.v ? 'procedencia_temporadas')
        or f.v->'procedencia_temporadas' = 'null'::jsonb
      then null
      else f.v->'procedencia_temporadas'
    end,
    coalesce((f.v->>'procedencia_mixta')::boolean, false)
  from jsonb_array_elements(p_filas) with ordinality as f(v, ord)
  order by f.ord;

  -- Una publicación exitosa habilita el snapshot SOLO si el paquete sigue activo. `moneda = p_moneda` se escribe EN LA
  -- MISMA transacción que las filas (columna fuera de la lista `UPDATE OF` del trigger de armado_paquetes: no se
  -- re-invalida a sí misma).
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

revoke all on function public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;

-- La columna fechas_disponibles NO se borra: la vista publicable y tarifario_resumen dependen de ella (select r.*) y soltarla arrastraría objetos ajenos. Queda
-- inerte (sin CHECK y en NULL = todas las fechas), como las demás columnas históricas del proyecto; ningún código de la 254 la lee ni la escribe.
alter table public.tarifario_resultado drop constraint if exists tarifario_resultado_fechas_disponibles_chk;
update public.tarifario_resultado set fechas_disponibles = null where fechas_disponibles is not null;
alter table public.armado_paquetes drop column if exists tarifario_diagnostico;

commit;
