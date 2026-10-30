-- Rollback de la 254: restaura la función y el trigger de la 181, el publicador interno de la 234 y quita las columnas nuevas.
-- ABORTA si alguna definición NO es exactamente la que dejó la 254 (alguien la cambió después): no se pisa trabajo ajeno.
-- Efecto sobre datos: se pierden los PVP fijos configurados y los precios normales guardados (sin_fijo); los tarifarios ya publicados conservan
-- el precio que traían hasta regenerarlos. No toca contratos ni cotizaciones.
begin;

do $$
declare
  v_fn  text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.tarifario_trg_bump_armado_paquetes()')), chr(13), ''));
  v_def text := (select md5(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgname = 'tarifario_trg_armado_paquetes' and t.tgrelid = to_regclass('public.armado_paquetes'));
  v_int text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), ''));
  v_vis text := (select md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true)));
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='pvp_infante_fijo') then
    raise exception 'ROLLBACK 254 ABORTADO: la 254 no está aplicada (no existe pvp_infante_fijo).';
  end if;
  if v_fn is distinct from '47a597c5ac1faaf86c9820797115bd61' or v_def is distinct from '65c829bcdf7f83da9d2f7f6c54fbb122' or v_int is distinct from '990e246824e567293372355d290a61a9' or v_vis is distinct from 'd4165ca9aaa100ae9bfb49d07e1aacb6' then
    raise exception 'ROLLBACK 254 ABORTADO (REVISAR): alguna definición ya no es la de la 254 (función %, trigger %, publicador %); no se sobrescribe.', v_fn, v_def, v_int;
  end if;
end $$;

create or replace function public.tarifario_trg_bump_armado_paquetes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Auditoría de Fase 1, hallazgo 4: `UPDATE OF <columnas>` dispara el
  -- trigger cuando esas columnas son TARGET del UPDATE, sin importar si el
  -- valor realmente cambió. Un no-op de este tipo (guardar el formulario de
  -- configuración sin cambiar nada) no debe invalidar un snapshot que sigue
  -- siendo exacto. Se compara CADA columna con `IS DISTINCT FROM` (seguro
  -- con NULL) y solo se invalida si AL MENOS UNA cambió de verdad.
  if NEW.nombre is distinct from OLD.nombre
    or NEW.tipo is distinct from OLD.tipo
    or NEW.destino_id is distinct from OLD.destino_id
    or NEW.pct_mk is distinct from OLD.pct_mk
    or NEW.impuesto_tipo is distinct from OLD.impuesto_tipo
    or NEW.impuesto_fijo is distinct from OLD.impuesto_fijo
    or NEW.fecha_viaje_inicio is distinct from OLD.fecha_viaje_inicio
    or NEW.fecha_viaje_fin is distinct from OLD.fecha_viaje_fin
    or NEW.noches is distinct from OLD.noches
    or NEW.activo is distinct from OLD.activo
  then
    perform public.tarifario_invalidar(array[NEW.id], true);
  end if;
  return NEW;
end;
$$;

revoke all on function public.tarifario_trg_bump_armado_paquetes() from public, anon, authenticated;

drop trigger if exists tarifario_trg_armado_paquetes on public.armado_paquetes;
create trigger tarifario_trg_armado_paquetes
  after update of nombre, tipo, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, noches, activo
  on public.armado_paquetes
  for each row execute function public.tarifario_trg_bump_armado_paquetes();

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

revoke all on function public.publicar_tarifario_resultado_interno(bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;

-- Las vistas tarifario_resultado_publicable y tarifario_resumen dependen de las columnas nuevas (select r.*): se recrean sin ellas, con las
-- mismas opciones, grants y comentarios (el SQL de tarifario_resumen se captura tal cual está).
do $v$
declare
  v_res   text := pg_get_viewdef('public.tarifario_resumen'::regclass);
  v_cres  text := obj_description('public.tarifario_resumen'::regclass, 'pg_class');
  v_cpub  text := obj_description('public.tarifario_resultado_publicable'::regclass, 'pg_class');
begin
  drop view public.tarifario_resumen;
  drop view public.tarifario_resultado_publicable;
  alter table public.tarifario_resultado drop constraint if exists tarifario_resultado_sin_fijo_chk;
  alter table public.tarifario_resultado drop column if exists precio_pvp_sin_fijo, drop column if exists precio_pvp_menor2_sin_fijo;
  create view public.tarifario_resultado_publicable with (security_barrier = true, security_invoker = false) as
    select r.*
    from public.tarifario_resultado r
    join public.armado_paquetes ap on ap.id = r.paquete_id
    where ap.tarifario_snapshot_publicable = true
      and ap.activo = true;
  revoke all on public.tarifario_resultado_publicable from anon, authenticated, service_role;
  grant select on public.tarifario_resultado_publicable to anon, authenticated, service_role;
  execute format('comment on view public.tarifario_resultado_publicable is %L', v_cpub);
  execute 'create view public.tarifario_resumen with (security_invoker = true) as ' || rtrim(v_res, E';
 ');
  revoke all on public.tarifario_resumen from anon, authenticated;
  grant select on public.tarifario_resumen to anon, authenticated;
  grant all on public.tarifario_resumen to service_role;
  execute format('comment on view public.tarifario_resumen is %L', v_cres);
end $v$;
alter table public.armado_paquetes drop constraint if exists armado_paquetes_pvp_infante_fijo_chk;
alter table public.armado_paquetes drop column if exists pvp_infante_fijo;

commit;
