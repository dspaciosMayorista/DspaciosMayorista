-- ─────────────────────────────────────────────────────────────────────────────
-- 302 · #43/#60 entrega 6 — «Desde» de porción por estadía real: justificación publicada (PROVISIONAL; sin aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
-- Especificación §5 («Desde» de porción, U.1/U.4; diseño en AM). Exige la 260 y la 301.
--   1) `tarifario_resultado.desde_entrada` (date): entrada de la estadía completa más económica que produce el «desde» de una fila de PORCIÓN
--      de un hotel con grupos. Salida = desde_entrada + noches; categoría, régimen y acomodación ya están en la fila y la vigencia/grupo en su
--      procedencia. NULL = fila sin justificación (todas las anteriores y los hoteles sin grupos, que no cambian).
--   2) Se recrean la vista publicable (mismo bloque de la 260: expone la columna al final) y los dos insertores con lista EXPLÍCITA de columnas
--      (`publicar_tarifario_resultado_interno` de la 256 y `tarifario_lote_agregar_i` de la 260): cuerpo idéntico + la columna nueva
--      (GENERADO por supabase/scripts/generar_302_desde_estadia.mjs; cada cambio se comprueba como coincidencia única).
-- No cambia ninguna fila existente ni ningún precio. Orden: preflight_302 → 302 → postcheck_302 → código. Rollback: rollback_302 (protegido).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.tarifario_manifiesto') is null or to_regclass('public.hotel_promocion_combinacion') is null then
    raise exception '302 ABORTADA: requiere la 260 y la 301 aplicadas';
  end if;
end $$;

alter table public.tarifario_resultado add column if not exists desde_entrada date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarifario_resultado_desde_entrada_302' and conrelid = 'public.tarifario_resultado'::regclass) then
    alter table public.tarifario_resultado add constraint tarifario_resultado_desde_entrada_302
      check (desde_entrada is null or (modulo = 'porcion_terrestre'::public.tarifario_modulo and noches between 1 and public._e5_max_noches()));
  end if;
end $$;
comment on column public.tarifario_resultado.desde_entrada is
  '#43/#60 (302): entrada de la estadía que justifica el «desde» de una porción de un hotel con grupos (salida = entrada + noches). NULL = sin justificación.';

-- La vista (único punto de lectura comercial) lista las columnas de la tabla SIN los metadatos de generación (generacion, revision_fuente, lote): así no vuelve a heredar columnas internas por un `r.*`.
do $$
declare v_cols text;
begin
  select string_agg(format('r.%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.tarifario_resultado'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('generacion', 'revision_fuente', 'lote');
  execute format($v$
    create or replace view public.tarifario_resultado_publicable
      with (security_barrier = true, security_invoker = false)
    as
    select %s
      from public.tarifario_resultado r
      join public.armado_paquetes ap on ap.id = r.paquete_id
     where ap.tarifario_snapshot_publicable = true and ap.activo = true
       -- Una fila de una generación NO publicada jamás es visible (tenga o no el paquete la bandera). Las filas heredadas (sin generación: anteriores a la 260) se ven mientras el paquete
       -- no haya publicado nunca por lotes; en cuanto lo hace, solo es visible la generación publicada.
       and ((r.generacion is null and not ap.tarifario_por_generacion) or r.generacion = ap.tarifario_generacion_publicada)
       and not exists (select 1 from public.tarifario_fila_oculta o where o.fila_id = r.id)
  $v$, v_cols);
end $$;

-- Resumen de la vitrina (definición de la 226 + la entrada del «desde» DOBLE, al final).
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
    min(r.tipo_tarifa) as tipo_tarifa,
    -- Migración 302: entrada de la estadía que justifica el «desde» DOBLE de la combinación (porción con grupos; null = sin justificación).
    min(r.desde_entrada) filter (where r.acomodacion = 'doble' and r.precio_pvp > 0) as desde_entrada_doble
  from public.tarifario_resultado_publicable r
  where r.paquete_activo = true
  group by
    r.modulo, r.paquete_id, r.paquete_nombre, r.paquete_activo, r.bloqueo_id, r.bloqueo_label,
    r.empaquetado_id, r.salida_id, r.hotel_id, r.hotel_nombre, r.servicio_id, r.servicio_nombre,
    r.destino_id, r.destino_nombre, r.categoria, r.regimen, r.fecha_ida, r.fecha_regreso, r.noches, r.moneda;

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
    procedencia_temporadas, procedencia_mixta, fechas_disponibles, desde_entrada
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
    case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end,
    -- Migración 302: entrada de la estadía que justifica el «desde» (porción de un hotel con grupos). Ausente o null = sin justificación.
    (f.v->>'desde_entrada')::date
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

create or replace function public.tarifario_lote_agregar_i(p_paquete_id bigint, p_generacion bigint, p_lote integer, p_filas_txt text)
returns text language plpgsql security definer set search_path = public, pg_temp set statement_timeout = '30s' set lock_timeout = '8s' as $$
declare v_gen bigint; v_activo boolean; v_rev bigint; m public.tarifario_manifiesto; l public.tarifario_manifiesto_lote; v_filas jsonb; v_n integer; v_constraint text;
  v_seq regclass := pg_get_serial_sequence('public.tarifario_resultado', 'id')::regclass;
begin
  if p_paquete_id is null or p_generacion is null or p_lote is null or p_filas_txt is null then raise exception 'tarifario_lote_agregar: parámetros obligatorios'; end if;

  select tarifario_generacion, activo, tarifario_revision_fuente into v_gen, v_activo, v_rev from public.armado_paquetes where id = p_paquete_id for key share;
  if not found then raise exception 'tarifario_lote_agregar: paquete % no encontrado', p_paquete_id; end if;
  if v_gen <> p_generacion then return 'obsoleta'; end if;
  select * into m from public.tarifario_manifiesto where paquete_id = p_paquete_id and generacion = p_generacion;
  if not found then return 'sin_manifiesto'; end if;
  select * into l from public.tarifario_manifiesto_lote where paquete_id = p_paquete_id and generacion = p_generacion and lote = p_lote;
  if not found then return 'lote_desconocido'; end if;
  if encode(sha256(convert_to(p_filas_txt, 'UTF8')), 'hex') <> l.huella then return 'huella'; end if;   -- el contenido NO es el fijado
  if exists (select 1 from public.tarifario_lote_control where paquete_id = p_paquete_id and generacion = p_generacion and lote = p_lote) then return 'ok'; end if;   -- ya cargado
  if exists (select 1 from public.tarifario_cambio_fuente where paquete_id = p_paquete_id and revision > m.revision_capturada and alcance = 'paquete') then return 'fuente_cambio'; end if;

  v_filas := p_filas_txt::jsonb;
  if jsonb_typeof(v_filas) <> 'array' or jsonb_array_length(v_filas) <> l.filas then return 'filas'; end if;
  if exists (select 1 from jsonb_array_elements(v_filas) e where jsonb_typeof(e) <> 'object') then raise exception 'tarifario_lote_agregar: cada elemento debe ser un objeto jsonb'; end if;
  if exists (select 1 from jsonb_array_elements(v_filas) e where e ? 'paquete_id' and e->>'paquete_id' is not null and (e->>'paquete_id') !~ '^[0-9]+$') then
    raise exception 'tarifario_lote_agregar: paquete_id de una fila no es numérico';
  end if;
  if exists (select 1 from jsonb_array_elements(v_filas) e where e ? 'paquete_id' and e->>'paquete_id' is not null and (e->>'paquete_id')::bigint <> p_paquete_id) then
    raise exception 'tarifario_lote_agregar: una fila declara un paquete_id distinto al solicitado';
  end if;

  begin
    -- Cada lote es UNA transacción (filas + control): un intento que falla no deja restos, así que no hay nada que borrar antes. Los ids se toman de la secuencia ANTES de insertar para enlazar el neto del
    -- hotel (tabla aparte) sin volver a buscar las filas.
    with filas as materialized (
      select f.v, f.ord, nextval(v_seq) as id from jsonb_array_elements(v_filas) with ordinality as f(v, ord) order by f.ord
    ), ins as (
      insert into public.tarifario_resultado (
        id, paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, bloqueo_label, empaquetado_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
        destino_id, destino_nombre, categoria, regimen, acomodacion, noches, fecha_ida, fecha_regreso, pax_desde, pax_hasta, tipo_tarifa,
        base_comisionable, impuesto, precio_pvp, precio_pvp_menor2, precio_pvp_sin_fijo, precio_pvp_menor2_sin_fijo, descripcion, recargo_individual,
        moneda, salida_id, temporada_ganadora, es_promocion, precio_final_autoritativo, procedencia_temporadas, procedencia_mixta, fechas_disponibles, desde_entrada,
        generacion, revision_fuente, lote)
      select f.id, p_paquete_id, f.v->>'paquete_nombre', v_activo, (f.v->>'modulo')::public.tarifario_modulo, (f.v->>'bloqueo_id')::bigint, f.v->>'bloqueo_label',
             (f.v->>'empaquetado_id')::bigint, (f.v->>'hotel_id')::bigint, f.v->>'hotel_nombre', (f.v->>'servicio_id')::bigint, f.v->>'servicio_nombre',
             (f.v->>'destino_id')::bigint, f.v->>'destino_nombre', f.v->>'categoria', f.v->>'regimen', (f.v->>'acomodacion')::public.acomodacion_tipo, (f.v->>'noches')::integer,
             (f.v->>'fecha_ida')::date, (f.v->>'fecha_regreso')::date, (f.v->>'pax_desde')::integer, (f.v->>'pax_hasta')::integer, f.v->>'tipo_tarifa',
             coalesce((f.v->>'base_comisionable')::numeric, 0), coalesce((f.v->>'impuesto')::numeric, 0), coalesce((f.v->>'precio_pvp')::numeric, 0),
             (f.v->>'precio_pvp_menor2')::numeric, (f.v->>'precio_pvp_sin_fijo')::numeric, (f.v->>'precio_pvp_menor2_sin_fijo')::numeric, f.v->>'descripcion', (f.v->>'recargo_individual')::numeric,
             m.moneda, (f.v->>'salida_id')::bigint, f.v->>'temporada_ganadora', (f.v->>'es_promocion')::boolean, (f.v->>'precio_final_autoritativo')::boolean,
             case when not (f.v ? 'procedencia_temporadas') or f.v->'procedencia_temporadas' = 'null'::jsonb then null else f.v->'procedencia_temporadas' end,
             coalesce((f.v->>'procedencia_mixta')::boolean, false),
             case when jsonb_typeof(f.v->'fechas_disponibles') = 'array' then f.v->'fechas_disponibles' else null end,
             (f.v->>'desde_entrada')::date,
             p_generacion, m.revision_capturada, p_lote
        from filas f order by f.ord
      returning 1
    )
    insert into public.tarifario_resultado_neto (fila_id, neto_hotel)
    select f.id, (f.v->>'neto_hotel')::numeric from filas f where nullif(f.v->>'neto_hotel', '') is not null;
    v_n := l.filas;   -- la cantidad ya se validó contra el manifiesto (jsonb_array_length = l.filas)
    insert into public.tarifario_lote_control (paquete_id, generacion, lote, filas, huella) values (p_paquete_id, p_generacion, p_lote, v_n, l.huella);
  exception when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- SOLO la FK propia del control (el manifiesto desapareció porque la limpieza retiró una generación ya superada) significa «obsoleta».
    -- Una FK de los DATOS (hotel, bloqueo, destino, servicio, empaquetado o paquete inexistentes) es un error real: se propaga y revierte el lote.
    if v_constraint like 'tarifario\_lote\_control\_%' then return 'obsoleta'; end if;
    raise;
  end;
  -- Si la fuente ya cambió desde la captura, las filas recién cargadas se evalúan contra la fuente ACTUAL (la activación rechaza lo que ya no coincide).
  if v_rev <> m.revision_capturada then perform public.tarifario_evaluar_ocultar(p_paquete_id, null, null, null, p_generacion, p_lote, false); end if;
  return 'ok';
end $$;
revoke all on function public.tarifario_lote_agregar_i(bigint, bigint, integer, text) from public, anon, authenticated;

commit;
