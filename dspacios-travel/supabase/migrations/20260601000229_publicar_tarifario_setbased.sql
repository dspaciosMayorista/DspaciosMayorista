-- ═══════════════════════════════════════════════════════════════════════════
-- 229 · publicar_tarifario_resultado: validación y carga SET-BASED (#100)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Problema (#100). Generar el tarifario del paquete 33 (5.062 filas) falla con
-- "canceling statement due to statement timeout". Medido en producción:
-- publicar_tarifario_resultado = 677 llamadas, promedio 995 ms, MÁXIMO 7.668 ms,
-- contra un statement_timeout de 8 s para `authenticated`. publicar_..._63 llega
-- a 594 ms y las lecturas del generador no se acercan al límite: lo que pasa de
-- 8 s es la publicación. La tabla no tiene triggers y la función corre como
-- postgres con bypassrls, así que lo que queda es el costo por fila del propio
-- publicador: la 226 (y la 181 antes) recorren el payload con DOS bucles
-- PL/pgSQL, el segundo con un INSERT por fila (≈35 extracciones y casts de jsonb
-- por fila, una sentencia SQL interpretada por fila).
--
-- Qué hace la 229. Reemplaza (CREATE OR REPLACE, MISMA firma, MISMO
-- SECURITY DEFINER, MISMO search_path, MISMOS grants) SOLO el cuerpo:
--   · la validación del lote ya no es un bucle que castea fila por fila: el tipo
--     de objeto se comprueba con UNA consulta y los paquete_id distintos del
--     payload (normalmente uno solo) se castean una vez cada uno, con el mismo
--     texto de error de antes;
--   · la carga ya no es un INSERT por fila dentro de un bucle: es UN SOLO
--     `insert … select … from jsonb_array_elements(p_filas) with ordinality`,
--     con EXACTAMENTE las mismas expresiones y casts por columna que la 226
--     (incluido el `case` que convierte la clave ausente o el JSON `null` de
--     procedencia_temporadas en SQL NULL) y con `order by ordinality` para que
--     los id se asignen en el orden del payload, igual que el bucle.
-- NO cambia: el candado de rol (mi_rol), los obligatorios, la validación de
-- moneda, el FOR UPDATE de armado_paquetes, el rechazo por generación y por
-- revisión de fuente (devuelve false), `paquete_id`/`paquete_activo`/`moneda`
-- siempre gobernados por el servidor, el DELETE previo, la columna
-- precio_pvp_menor2 de la 226 y el UPDATE final del estado de publicación.
-- NO se edita la 226 ni la 227: la 227 (publicar_tarifario_resultado_63) delega
-- en esta función por nombre y firma, y sigue funcionando igual. La acción
-- TypeScript no cambia.
--
-- Diferencia deliberada y mínima de comportamiento (solo en payloads inválidos):
-- el bucle de la 226 reportaba el primer error por ORDEN de fila; la 229 revisa
-- primero que todo elemento sea un objeto y luego los paquete_id. Un payload con
-- los dos defectos a la vez puede reportar el otro error primero. Ambos siguen
-- fallando cerrado, sin tocar el snapshot anterior, con los mismos mensajes.
--
-- Numeración: 229 es el siguiente número libre en `main` (228 = guarda_saldo_cxp).
-- Línea D'spacios (main); no aplica a `saas-whitelabel`.
--
-- Reversión: supabase/scripts/rollback_229_publicar_tarifario_setbased.sql
-- (restaura el cuerpo EXACTO de la 226). Preflight y postcheck:
-- supabase/scripts/{preflight,postcheck}_229_publicar_tarifario_setbased.sql.
-- ⚠️ NO SE HA EJECUTADO EN NINGÚN ENTORNO REMOTO.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regprocedure('public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)') is null then
    raise exception '229 ABORTADA: falta public.publicar_tarifario_resultado (181/226).';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'precio_pvp_menor2'
  ) then
    raise exception '229 ABORTADA: falta tarifario_resultado.precio_pvp_menor2 (la 226 no está aplicada).';
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
    base_comisionable, impuesto, precio_pvp, precio_pvp_menor2, descripcion, recargo_individual,
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

comment on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) is
  'Publica atómicamente (delete+insert+actualización de estado en UNA transacción) el snapshot de tarifario_resultado de un paquete. Rechaza (devuelve false, sin tocar tarifario_resultado) si p_generacion o p_revision_capturada ya no coinciden con el estado actual de armado_paquetes; rechaza con excepción (sin borrar el snapshot anterior) si p_moneda es NULL o distinto de COP/USD. p_moneda GOBIERNA la moneda de TODAS las filas. Desde la migración 226 persiste también precio_pvp_menor2 (precio del menor de 2 años). Desde la 229 valida y carga el lote en forma set-based (un solo INSERT … SELECT, sin bucle por fila). SECURITY DEFINER con candado de rol propio. Migración 181/226/229.';
revoke all on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) from public, anon;
grant execute on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) to authenticated;

commit;
