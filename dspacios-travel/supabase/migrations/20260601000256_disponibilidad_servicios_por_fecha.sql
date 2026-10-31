-- 256 · Disponibilidad por fecha/salida de los servicios del paquete (reemplaza «un hueco tumba la generación»).
--
-- Decisión del dueño: no se extienden vigencias, no se copia GENERAL, no se pone tarifa en un hueco sin respaldo del proveedor. Entonces la publicación deja de
-- exigir cobertura total y publica solo lo vendible:
--   · servicio OPCIONAL: se ofrece únicamente donde una vigencia con tarifa válida cubre la fecha. `tarifario_resultado.fechas_disponibles` (jsonb, arreglo de
--     {desde,hasta}) guarda los tramos cuando la cobertura de la ventana del paquete es parcial; NULL = todas las fechas. Sin ninguna vigencia no se publica.
--   · servicio INCLUIDO: forma parte del precio del hotel; una salida/estadía que no lo cubre NO se publica (las cubiertas sí). Nunca se publica una salida
--     que dice incluirlo omitiéndolo. Si ninguna salida es vendible se publica el conjunto vacío (reemplaza lo anterior) y queda el motivo.
--   · `armado_paquetes.tarifario_diagnostico`: texto con lo que se dejó de publicar y por qué (solo lectura para la UI). Lo borra cada publicación y lo escribe,
--     tras ella, `registrar_diagnostico_tarifario` solo si esa generación sigue siendo la vigente.
-- La atomicidad no cambia: filas + estado + borrado del diagnóstico anterior van en la MISMA transacción del publicador; el diagnóstico nuevo es informativo y
-- su fallo nunca deja filas incorrectas. La venta/cotización/reserva re-valida SIEMPRE contra las vigencias vivas de la fecha: una fila publicada antes jamás
-- autoriza vender una fecha sin cobertura.
--
-- Reemplaza SOLO definiciones auditadas por huella exacta: el publicador interno (254) y la vista tarifario_resultado_publicable (254). Si fueron modificadas por
-- otra vía ABORTA sin cambiar nada. Reaplicar la 256 ya aplicada es idempotente. NO modifica la 255.
-- Preflight: supabase/scripts/preflight_256_disponibilidad_servicios.sql · Postcheck: postcheck_256_… · Rollback: rollback_256_….
begin;

do $$
declare
  v_interno text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), ''));
  v_vista   text := md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true));
begin
  if to_regclass('public.armado_paquetes') is null or to_regclass('public.tarifario_resultado') is null or to_regclass('public.tarifario_resultado_publicable') is null then
    raise exception '256 ABORTADA: faltan armado_paquetes/tarifario_resultado/tarifario_resultado_publicable.';
  end if;
  if v_interno is null then
    raise exception '256 ABORTADA: falta el publicador interno (234/254).';
  end if;
  if v_interno not in ('990e246824e567293372355d290a61a9', 'fdea107e195de51abca78e34b3e90c9b') then
    raise exception '256 ABORTADA (REVISAR): publicar_tarifario_resultado_interno no es la definición auditada de la 254 (huella %); hay un cambio ajeno.', v_interno;
  end if;
  if v_vista not in ('d4165ca9aaa100ae9bfb49d07e1aacb6', '882ad9b869dae2ffdf58a746f24d9631') then
    raise exception '256 ABORTADA (REVISAR): tarifario_resultado_publicable no es la vista auditada de la 254 (huella %); hay un cambio ajeno.', v_vista;
  end if;
end $$;

alter table public.tarifario_resultado
  add column if not exists fechas_disponibles jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarifario_resultado_fechas_disponibles_chk' and conrelid = 'public.tarifario_resultado'::regclass) then
    alter table public.tarifario_resultado
      add constraint tarifario_resultado_fechas_disponibles_chk check (
        fechas_disponibles is null
        or (jsonb_typeof(fechas_disponibles) = 'array' and modulo = 'servicios'::public.tarifario_modulo)
      );
  end if;
end $$;

comment on column public.tarifario_resultado.fechas_disponibles is
  'Solo filas de servicios opcionales: tramos [{desde,hasta}] (ISO, inclusivos) donde el servicio tiene vigencia y tarifa válidas dentro del viaje del paquete. NULL = todas las fechas del viaje. [] = ninguna. La venta re-valida contra las vigencias vivas. Migración 256.';

alter table public.armado_paquetes
  add column if not exists tarifario_diagnostico text;
comment on column public.armado_paquetes.tarifario_diagnostico is
  'Qué se dejó de publicar en la última publicación por falta de vigencia confirmada (incluidos por salida, opcionales ocultos o parciales) o NULL. Lo borra cada publicación; lo escribe registrar_diagnostico_tarifario. Migración 256.';

-- La vista se expandió con select r.* al crearse: se recrea (mismo SQL y opciones de la 254) para exponer la columna nueva AL FINAL; conserva grants.
create or replace view public.tarifario_resultado_publicable
  with (security_barrier = true, security_invoker = false)
as
  select r.*
  from public.tarifario_resultado r
  join public.armado_paquetes ap on ap.id = r.paquete_id
  where ap.tarifario_snapshot_publicable = true
    and ap.activo = true;

-- Publicador interno: cuerpo de la 254 + fechas_disponibles en el INSERT y borrado del diagnóstico anterior (únicas diferencias).
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
    procedencia_temporadas, procedencia_mixta, fechas_disponibles
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
    coalesce((f.v->>'procedencia_mixta')::boolean, false),
    -- Migración 256: tramos de fecha donde un servicio opcional se ofrece. Ausente, null o no-arreglo = todas las fechas del viaje del paquete.
    case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end
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
    tarifario_diagnostico = null,
    tarifario_snapshot_publicable = v_activo,
    tarifario_actualizado_en = now(),
    moneda = p_moneda
  where id = p_paquete_id;

  return true;
end;
$$;

revoke all on function public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;

-- Diagnóstico de disponibilidad de la ÚLTIMA publicación. Devuelve false (sin escribir) si la generación publicada ya no es la de quien llama.
create or replace function public.registrar_diagnostico_tarifario(
  p_paquete_id bigint,
  p_generacion bigint,
  p_diagnostico text
)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_filas integer;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'registrar_diagnostico_tarifario: rol sin permiso de escritura sobre armado_paquetes';
  end if;
  update public.armado_paquetes
    set tarifario_diagnostico = nullif(left(coalesce(p_diagnostico, ''), 2000), '')
    where id = p_paquete_id
      and tarifario_estado = 'listo'
      and tarifario_generacion = p_generacion
      and tarifario_generacion_publicada = p_generacion;
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$$;
comment on function public.registrar_diagnostico_tarifario(bigint, bigint, text) is
  'Guarda armado_paquetes.tarifario_diagnostico solo si la generación publicada y vigente es p_generacion (nunca pisa una más nueva). No invalida el tarifario. SECURITY INVOKER. Migración 256.';
revoke all on function public.registrar_diagnostico_tarifario(bigint, bigint, text) from public, anon;
grant execute on function public.registrar_diagnostico_tarifario(bigint, bigint, text) to authenticated;

commit;
