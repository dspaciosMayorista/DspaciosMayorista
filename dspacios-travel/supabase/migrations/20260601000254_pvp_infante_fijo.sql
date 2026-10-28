-- 254 · PVP fijo opcional de la clase «infante» por paquete.
--
-- `armado_paquetes.pvp_infante_fijo` (numeric(15,2), NULL = sin configurar; 0 es válido y distinto de NULL; en la moneda de publicación del paquete).
-- Lo usan `generarTarifario` y la liquidación por fechas para reemplazar el precio de venta del infante del hotel cuando no tiene cargo de vuelo ni de
-- servicios (ver lib/paquetes/pvpInfanteFijo.ts). Cuando lo reemplaza, el precio NORMAL queda guardado en `tarifario_resultado.precio_pvp_sin_fijo` /
-- `precio_pvp_menor2_sin_fijo` (una por ruta: 2 años o más / menor de 2) para que, al cotizar, un servicio opcional con cargo positivo devuelva al infante
-- a la fórmula normal completa (nunca se cobran las dos). Los costos, CxP y proveedores no pasan por estas columnas.
--
-- Es configuración que cambia el contenido del tarifario publicado: el trigger de invalidación (181) pasa a vigilar la columna, así que cambiarla deja
-- el tarifario en `pendiente` y no publicable hasta regenerarlo. No toca contratos ni cotizaciones emitidas (conservan sus importes congelados).
--
-- Reemplaza SOLO definiciones auditadas: la función del trigger y su definición (181) y el publicador interno (234), reconocidas por huella exacta. Si
-- alguna fue modificada por otra vía (aunque conserve frases iguales), ABORTA sin cambiar nada. Reaplicar la 254 ya aplicada es idempotente.
-- Preflight: supabase/scripts/preflight_254_pvp_infante_fijo.sql · Postcheck: postcheck_254_… · Rollback: rollback_254_….
begin;

do $$
declare
  v_trg_fn   text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.tarifario_trg_bump_armado_paquetes()')), chr(13), ''));
  v_trg_def  text := (select md5(pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgname = 'tarifario_trg_armado_paquetes' and t.tgrelid = to_regclass('public.armado_paquetes'));
  v_interno  text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.publicar_tarifario_resultado_interno(bigint,bigint,bigint,text,jsonb)')), chr(13), ''));
  v_vista    text := (select md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true)));
begin
  if to_regclass('public.armado_paquetes') is null or to_regclass('public.tarifario_resultado') is null then
    raise exception '254 ABORTADA: faltan armado_paquetes/tarifario_resultado.';
  end if;
  if v_trg_fn is null or v_trg_def is null or v_interno is null then
    raise exception '254 ABORTADA: falta la función/trigger de invalidación (181) o el publicador interno (234).';
  end if;
  if v_trg_fn not in ('368cb5199877e9cfbc10f66c6e74d113', '47a597c5ac1faaf86c9820797115bd61') then
    raise exception '254 ABORTADA (REVISAR): tarifario_trg_bump_armado_paquetes no es la definición auditada de la 181 (huella %); hay un cambio ajeno.', v_trg_fn;
  end if;
  if v_trg_def not in ('d6c23513669a2addf5b7fbfa67f20d62', '65c829bcdf7f83da9d2f7f6c54fbb122') then
    raise exception '254 ABORTADA (REVISAR): el trigger tarifario_trg_armado_paquetes no es el auditado de la 181 (huella %); hay un cambio ajeno.', v_trg_def;
  end if;
  if v_vista is null or v_vista not in ('41b2f693d2a480abe615f57403294375', 'd4165ca9aaa100ae9bfb49d07e1aacb6') then
    raise exception '254 ABORTADA (REVISAR): la vista tarifario_resultado_publicable no es la auditada de la 226 (huella %); hay un cambio ajeno.', v_vista;
  end if;
  if v_interno not in ('c0a7d986441e22a74b2fcd20b505706f', '990e246824e567293372355d290a61a9') then
    raise exception '254 ABORTADA (REVISAR): publicar_tarifario_resultado_interno no es la definición auditada de la 234 (huella %); hay un cambio ajeno.', v_interno;
  end if;
end $$;

alter table public.armado_paquetes
  add column if not exists pvp_infante_fijo numeric(15,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'armado_paquetes_pvp_infante_fijo_chk' and conrelid = 'public.armado_paquetes'::regclass) then
    alter table public.armado_paquetes
      add constraint armado_paquetes_pvp_infante_fijo_chk check (pvp_infante_fijo is null or pvp_infante_fijo >= 0);
  end if;
end $$;

comment on column public.armado_paquetes.pvp_infante_fijo is
  'PVP fijo opcional de la clase infante del hotel, en la moneda de publicación. NULL = sin configurar (fórmula normal); 0 es válido. Reemplaza el precio del infante solo si no tiene cargo positivo de vuelo ni de servicios (la asistencia no cuenta). Cambiarlo invalida el tarifario. Migración 254.';

alter table public.tarifario_resultado
  add column if not exists precio_pvp_sin_fijo numeric(15,2),
  add column if not exists precio_pvp_menor2_sin_fijo numeric(15,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tarifario_resultado_sin_fijo_chk' and conrelid = 'public.tarifario_resultado'::regclass) then
    alter table public.tarifario_resultado
      add constraint tarifario_resultado_sin_fijo_chk check (
        (precio_pvp_sin_fijo is null or precio_pvp_sin_fijo >= 0) and (precio_pvp_menor2_sin_fijo is null or precio_pvp_menor2_sin_fijo >= 0)
      );
  end if;
end $$;

comment on column public.tarifario_resultado.precio_pvp_sin_fijo is
  'Precio NORMAL (2 años o más) de la fila infante cuando el PVP fijo del paquete la reemplazó en precio_pvp; NULL si el fijo no se aplicó. Migración 254.';
comment on column public.tarifario_resultado.precio_pvp_menor2_sin_fijo is
  'Precio NORMAL (menor de 2 años) de la fila infante cuando el PVP fijo del paquete la reemplazó en precio_pvp_menor2; NULL si el fijo no se aplicó. Migración 254.';

-- La vista se expandio con select r.* al crearse: se recrea (mismo SQL y opciones de la 226/182) para exponer las dos columnas nuevas AL FINAL; conserva grants y comentario.
create or replace view public.tarifario_resultado_publicable
  with (security_barrier = true, security_invoker = false)
as
  select r.*
  from public.tarifario_resultado r
  join public.armado_paquetes ap on ap.id = r.paquete_id
  where ap.tarifario_snapshot_publicable = true
    and ap.activo = true;

create or replace function public.tarifario_trg_bump_armado_paquetes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Cuerpo de la 181 + `pvp_infante_fijo` (254). `IS DISTINCT FROM` por columna: un guardado sin cambios no invalida el snapshot.
  if NEW.nombre is distinct from OLD.nombre
    or NEW.tipo is distinct from OLD.tipo
    or NEW.destino_id is distinct from OLD.destino_id
    or NEW.pct_mk is distinct from OLD.pct_mk
    or NEW.pvp_infante_fijo is distinct from OLD.pvp_infante_fijo
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
  after update of nombre, tipo, destino_id, pct_mk, pvp_infante_fijo, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, noches, activo
  on public.armado_paquetes
  for each row execute function public.tarifario_trg_bump_armado_paquetes();

-- Publicador interno: cuerpo de la 234 + las dos columnas nuevas (únicas diferencias: la lista de columnas y los dos valores).
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

commit;
