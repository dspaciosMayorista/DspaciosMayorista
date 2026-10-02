-- ───────────────────────────────────────────────────────────────────────────
-- Migración 194 · traslado de cupos y mover pasajero, ATÓMICOS (tareas 2 y 3)
-- (Numerada 194 y no 193: el 193 lo usa `registro_b2b_endurecido`, otra línea
-- de trabajo independiente. Ninguna de las dos depende de la otra.)
--
-- Diseño: docs/futuro/traslado-cupos-y-mover-pasajero.md
-- Requiere la 192 (`estado_silla = 'retirada'`) ya aplicada y confirmada.
--
-- QUÉ HACE (aditiva; compatible con el código actual en Producción):
--   · `operaciones_vuelo`: una fila por operación, clave para la idempotencia
--     de reintentos y de solicitudes simultáneas (diseño §6.0.2).
--   · `movimientos_silla` pasa a ser EL historial de cada silla movida o
--     retirada (no se crea ninguna tabla nueva de sillas): tipo de operación,
--     operación, números de silla, contrato (orgánico o manual) copiado,
--     cupos antes/después y autor. Las filas existentes quedan `tipo='legado'`
--     y el valor por defecto `legado` cubre los inserts del código antiguo
--     mientras siga desplegado.
--   · Funciones SECURITY DEFINER (diseño §6), todas con autorización
--     explícita leída de la base (nunca del cliente), bloqueo de filas en
--     orden fijo, `lock_timeout` de 5 s y comprobación de invariantes antes de
--     terminar (cualquier excepción revierte la operación entera):
--       trasladar_cupos        tarea 2: mueve N sillas LIBRES de Y a X (misma fila)
--       mover_pasajero         tarea 3: modo 'solo_datos' o 'con_cupo' (explícito)
--       retirar_cupo           reduce un cupo libre a 'retirada' sin borrarlo
--       cambiar_estado_silla   matriz DIR-1 (Devuelta es definitiva)
--       asignar_contrato_manual / quitar_contrato_manual
--       liberar_silla / editar_pasajero_silla   (DIR-2: permiso sobre el contrato)
--
-- QUÉ NO HACE (fases posteriores, ver diseño §6.5 y §12):
--   · No cierra la escritura DIRECTA a `sillas`/`bloqueos_vuelo` por la API
--     (RLS 137). Eso es la fase C y solo se activa tras desplegar y verificar
--     en Producción el código que usa estas funciones (barrera B→C).
--   · No vuelve inmutable el historial (fase E, misma barrera).
--   · No crea el índice único (bloqueo_id, numero_silla): depende del
--     preflight (duplicados sobre todas las filas). Las funciones asignan el
--     número con el pool bloqueado y `max()` sobre TODAS las filas del record.
--   · No altera importes: ni `costo_aereo` ni CxP (D4b aprobada: proveedor
--     distinto bloquea; tarifa distinta solo con aceptación explícita).
--   · No corrige datos existentes.
--
-- Decisiones aprobadas que aplica (2026-09-30): AUT-1 (solo Mayorista y
-- superadmin), AUT-1b/DIR-2 (permiso sobre el contrato, también Minorista),
-- D1 (no repartir contratos), D4 (mismo destino, destino no salido), D4b,
-- D8 (`retirada`), DIR-1 (matriz de estados manuales). Y D3-c (2026-10-01),
-- SOLO para sillas con numero_contrato: mismas fechas de ida y regreso, y los
-- tramos del contrato que apuntan a Y se reescriben con X en la misma
-- transacción (PNR, vuelo, horas); se bloquea si no quedan coherentes. Con
-- contrato_manual no se exigen fechas ni se tocan ventas/contrato_vuelos.
-- ───────────────────────────────────────────────────────────────────────────

-- ═══ 1. Operaciones (idempotencia) ═════════════════════════════════════════
create table if not exists public.operaciones_vuelo (
  operacion_id uuid primary key,
  tipo         text not null,
  huella       text not null,
  actor_id     uuid not null,
  created_at   timestamptz not null default now(),
  constraint operaciones_vuelo_tipo_check check (tipo in ('traslado_cupo', 'mover_pasajero', 'retiro_cupo'))
);
comment on table public.operaciones_vuelo is
  'Una fila por operación de traslado/mover/retiro. La función la inserta como PRIMERA escritura '
  '(INSERT … ON CONFLICT DO NOTHING): una segunda solicitud con el mismo operacion_id espera a la '
  'primera y, si esta confirmó, devuelve "repetida" sin aplicar nada. Migración 194.';
alter table public.operaciones_vuelo enable row level security;
drop policy if exists "operaciones_vuelo: lectura vuelos" on public.operaciones_vuelo;
create policy "operaciones_vuelo: lectura vuelos" on public.operaciones_vuelo for select
  using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo'));
revoke insert, update, delete, truncate on public.operaciones_vuelo from anon, authenticated;

-- ═══ 2. Historial: movimientos_silla ampliada ══════════════════════════════
alter table public.movimientos_silla
  add column if not exists tipo                     text not null default 'legado',
  add column if not exists operacion_id             uuid references public.operaciones_vuelo(operacion_id),
  add column if not exists silla_destino_id         bigint references public.sillas(id),
  add column if not exists numero_silla_origen      integer,
  add column if not exists numero_silla_destino     integer,
  add column if not exists numero_contrato          text,
  add column if not exists contrato_manual          text,
  add column if not exists contrato_manual_clase    text,
  add column if not exists contrato_manual_resuelto text,
  add column if not exists estado_silla             text,
  add column if not exists cupos_origen_antes       integer,
  add column if not exists cupos_origen_despues     integer,
  add column if not exists cupos_destino_antes      integer,
  add column if not exists cupos_destino_despues    integer,
  add column if not exists registrado_por_id        uuid,
  -- D3-c: tramos de contrato_vuelos del contrato orgánico reescritos de Y a X en esta operación.
  add column if not exists tramos_contrato_actualizados integer;

alter table public.movimientos_silla drop constraint if exists movimientos_silla_tipo_check;
alter table public.movimientos_silla add constraint movimientos_silla_tipo_check
  check (tipo in ('legado', 'traslado_cupo', 'mover_datos', 'mover_con_cupo', 'retiro_cupo'));

create index if not exists idx_movimientos_silla_origen    on public.movimientos_silla (bloqueo_origen_id);
create index if not exists idx_movimientos_silla_destino   on public.movimientos_silla (bloqueo_destino_id);
create index if not exists idx_movimientos_silla_operacion on public.movimientos_silla (operacion_id);
create index if not exists idx_movimientos_silla_contrato  on public.movimientos_silla (numero_contrato);
create unique index if not exists movimientos_silla_operacion_silla_uq
  on public.movimientos_silla (operacion_id, silla_id) where operacion_id is not null;

comment on column public.movimientos_silla.tipo is
  'legado (antes de la 194) · traslado_cupo · mover_datos · mover_con_cupo · retiro_cupo. '
  'El historial NO es un cupo: nunca cuenta en cupos_total, ocupación ni disponibilidad.';

-- ═══ 3. Funciones privadas (sin EXECUTE para los roles del cliente) ═══════

-- A1–A3 (diseño §6.0.1): sesión, rol de vuelos activo y agencia del actor.
create or replace function public._vuelos_actor(
  out actor_id uuid, out actor_rol text, out actor_tenant text, out actor_nombre text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sesión requerida.';
  end if;
  actor_rol := public.mi_rol()::text;   -- null si el usuario está inactivo (140)
  if actor_rol is null or actor_rol not in ('superadmin', 'administracion', 'gerencia', 'operaciones', 'control_vuelo') then
    raise exception using errcode = '42501', message = 'Sin permiso para operar vuelos.';
  end if;
  actor_tenant := public.mi_tenant();
  if actor_rol <> 'superadmin' and actor_tenant is distinct from 'mayorista' then   -- AUT-1
    raise exception using errcode = '42501', message = 'Sin permiso para operar vuelos.';
  end if;
  select coalesce(nullif(btrim(u.nombre), ''), u.email) into actor_nombre from public.usuarios u where u.id = actor_id;
end $$;

-- Recorte IDÉNTICO a String.prototype.trim() (ECMAScript WhiteSpace +
-- LineTerminator), comprobado caso por caso contra trim() (diseño §6.0.4).
create or replace function public._ref_manual_normalizada(p_ref text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case when p_ref is null then null else regexp_replace(p_ref,
    '^[\u0009-\u000d    -     　﻿]+|[\u0009-\u000d    -     　﻿]+$',
    '', 'g') end
$$;

-- Misma regla que lib/vuelos/contratoManual.ts (candidatos: tal cual y con
-- 'MIN-'; comparación exacta contra `ventas` de AMBAS agencias). Clases:
-- sin_referencia · no_admitida · externo · interno · ambiguo.
create or replace function public._resolver_contrato_manual(
  p_ref text, out clase text, out numero_contrato text, out tenant text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_ref text := public._ref_manual_normalizada(p_ref);
  v_cands text[];
  v_n integer;
begin
  if v_ref is null or v_ref = '' then clase := 'sin_referencia'; return; end if;
  if v_ref ~ '[\u0001-\u001f\u007f-\u009f   -     　﻿]' then
    clase := 'no_admitida'; return;
  end if;
  v_cands := case when left(v_ref, 4) = 'MIN-' then array[v_ref] else array[v_ref, 'MIN-' || v_ref] end;
  select count(*)::integer, min(v.numero_contrato), min(v.tenant)
    into v_n, numero_contrato, tenant
    from public.ventas v where v.numero_contrato = any(v_cands);
  if v_n = 0 then clase := 'externo'; numero_contrato := null; tenant := null;
  elsif v_n = 1 then clase := 'interno';
  else clase := 'ambiguo'; numero_contrato := null; tenant := null;
  end if;
end $$;

-- D1–D3 / AUT-1b / AUT-2 / DIR-2: autoriza el contrato de una silla con el
-- tenant DEL CONTRATO (acceso_editar_vuelos_contrato, 157). Lanza 42501 si no.
-- p_superadmin_corrige: permite a superadmin operar una referencia manual
-- ambigua o no admitida (solo para corregirla: quitar/liberar/editar).
create or replace function public._autorizar_contrato_silla(
  p_numero_contrato text, p_contrato_manual text, p_rol text, p_superadmin_corrige boolean,
  out clase text, out numero_resuelto text, out manual_normalizada text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if p_numero_contrato is not null then
    if not public.acceso_editar_vuelos_contrato(p_numero_contrato) then
      raise exception using errcode = '42501', message = 'Sin permiso sobre el contrato de esta silla.';
    end if;
    clase := 'organico'; numero_resuelto := p_numero_contrato; return;
  end if;
  if p_contrato_manual is null then clase := 'sin_contrato'; return; end if;
  manual_normalizada := public._ref_manual_normalizada(p_contrato_manual);
  select * into r from public._resolver_contrato_manual(p_contrato_manual);
  clase := r.clase; numero_resuelto := r.numero_contrato;
  if clase in ('ambiguo', 'no_admitida') and not (p_superadmin_corrige and p_rol = 'superadmin') then
    raise exception using errcode = 'P0001', message = case clase
      when 'ambiguo' then 'La referencia manual de esta silla corresponde a más de un contrato; corrígela antes de continuar.'
      else 'La referencia manual de esta silla tiene espacios o caracteres no admitidos; corrígela antes de continuar.' end;
  end if;
  if clase = 'interno' and not public.acceso_editar_vuelos_contrato(numero_resuelto) then
    raise exception using errcode = '42501', message = 'Sin permiso sobre el contrato de esta silla.';
  end if;
end $$;

-- ¿La silla conserva ALGÚN dato del grupo D (diseño §6.5)? Las 16 columnas de
-- datos: adulto, infante, responsable del menor y datos operativos (agencia,
-- asesor, hotel, acomodación, plazo). Una sola regla para "libre real",
-- "tiene pasajero", eliminar un record y las liberaciones (R1).
create or replace function public._silla_con_datos(s public.sillas)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(btrim(s.pasajero_nombres), '') <> '' or coalesce(btrim(s.pasajero_apellidos), '') <> ''
      or coalesce(btrim(s.tipo_doc), '') <> '' or coalesce(btrim(s.numero_doc), '') <> '' or s.nacimiento is not null
      or coalesce(btrim(s.inf_nombres), '') <> '' or coalesce(btrim(s.inf_apellidos), '') <> ''
      or coalesce(btrim(s.inf_tipo_doc), '') <> '' or coalesce(btrim(s.inf_numero), '') <> '' or s.inf_nacimiento is not null
      or coalesce(btrim(s.responsable_menor), '') <> ''
      or coalesce(btrim(s.agencia), '') <> '' or coalesce(btrim(s.asesor), '') <> '' or coalesce(btrim(s.hotel), '') <> ''
      or coalesce(btrim(s.acomodacion), '') <> '' or s.plazo is not null
$$;

-- Silla libre real (diseño §4.2): estado vendible, sin contrato ni manual y
-- sin NINGÚN dato del grupo D.
create or replace function public._silla_libre(s public.sillas)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select s.estado::text in ('disponible', 'cambio_entrante')
     and s.numero_contrato is null and s.contrato_manual is null
     and not public._silla_con_datos(s)
$$;

-- Idempotencia (diseño §6.0.2). true = esta transacción es la dueña de la
-- operación; false = ya estaba aplicada (mismos parámetros y actor).
create or replace function public._reservar_operacion(
  p_operacion_id uuid, p_tipo text, p_huella text, p_actor uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer; v_op public.operaciones_vuelo%rowtype;
begin
  if p_operacion_id is null then
    raise exception using errcode = '22023', message = 'Falta el identificador de la operación.';
  end if;
  insert into public.operaciones_vuelo (operacion_id, tipo, huella, actor_id)
  values (p_operacion_id, p_tipo, p_huella, p_actor)
  on conflict (operacion_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then return true; end if;
  select * into v_op from public.operaciones_vuelo where operacion_id = p_operacion_id;
  if v_op.tipo is distinct from p_tipo or v_op.huella is distinct from p_huella or v_op.actor_id is distinct from p_actor then
    raise exception using errcode = '22023', message = 'Operación inválida.';
  end if;
  return false;
end $$;

-- B2 / D4 / D4b: mismo destino (no nulo), destino no salido (hora de
-- Colombia) y mismo proveedor. La tarifa distinta la decide cada función.
create or replace function public._validar_record_destino(p_y public.bloqueos_vuelo, p_x public.bloqueos_vuelo)
returns void language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_y.destino_id is null or p_x.destino_id is null then
    raise exception using errcode = 'P0001',
      message = 'El record de origen o el de destino no tiene destino asignado; asígnalo antes de continuar.';
  end if;
  if p_x.destino_id <> p_y.destino_id then
    raise exception using errcode = 'P0001', message = format('El record %s tiene otro destino.', p_x.record);
  end if;
  if p_x.fecha_ida is null or p_x.fecha_ida < (now() at time zone 'America/Bogota')::date then
    raise exception using errcode = 'P0001', message = format('El record %s ya salió o no tiene fecha de ida.', p_x.record);
  end if;
  if p_x.proveedor_id is distinct from p_y.proveedor_id then
    raise exception using errcode = 'P0001', message = format('El record %s tiene otro proveedor; no se permite.', p_x.record);
  end if;
end $$;

-- Sillas activas (cuentan como cupo) de un record: todas menos cambio/retirada.
create or replace function public._sillas_activas(p_bloqueo_id bigint)
returns integer language sql stable set search_path = public, pg_temp as $$
  select count(*)::integer from public.sillas
   where bloqueo_id = p_bloqueo_id and estado::text not in ('cambio', 'retirada')
$$;

-- D3-c: dirección(es) que ocupa un tramo de contrato_vuelos. Fila nueva (135):
-- 'ida' o 'regreso'. Fila heredada (ida+regreso en una sola fila, sin
-- direccion ni numero_vuelo): ida si trae algún dato de ida, regreso si trae
-- algún dato de regreso. Se usan para validar que X tenga esos datos ANTES de
-- reescribir y para no tocar la parte que la fila no usa.
create or replace function public._tramo_legado(cv public.contrato_vuelos)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select cv.direccion is null and cv.numero_vuelo is null and (cv.vuelo_ida is not null or cv.vuelo_regreso is not null)
$$;
create or replace function public._tramo_usa_ida(cv public.contrato_vuelos)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(cv.direccion, '') = 'ida'
      or (public._tramo_legado(cv) and (nullif(btrim(cv.vuelo_ida), '') is not null or nullif(btrim(cv.hora_salida_ida), '') is not null
                                        or nullif(btrim(cv.hora_llegada_ida), '') is not null or cv.fecha_salida is not null))
$$;
create or replace function public._tramo_usa_regreso(cv public.contrato_vuelos)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(cv.direccion, '') = 'regreso'
      or (public._tramo_legado(cv) and (nullif(btrim(cv.vuelo_regreso), '') is not null or nullif(btrim(cv.hora_salida_reg), '') is not null
                                        or nullif(btrim(cv.hora_llegada_reg), '') is not null or cv.fecha_regreso is not null))
$$;
revoke all on function public._tramo_legado(public.contrato_vuelos) from public, anon, authenticated;
revoke all on function public._tramo_usa_ida(public.contrato_vuelos) from public, anon, authenticated;
revoke all on function public._tramo_usa_regreso(public.contrato_vuelos) from public, anon, authenticated;

revoke all on function public._vuelos_actor() from public, anon, authenticated;
revoke all on function public._ref_manual_normalizada(text) from public, anon, authenticated;
revoke all on function public._resolver_contrato_manual(text) from public, anon, authenticated;
revoke all on function public._autorizar_contrato_silla(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public._silla_con_datos(public.sillas) from public, anon, authenticated;
revoke all on function public._silla_libre(public.sillas) from public, anon, authenticated;
revoke all on function public._reservar_operacion(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public._validar_record_destino(public.bloqueos_vuelo, public.bloqueos_vuelo) from public, anon, authenticated;
revoke all on function public._sillas_activas(bigint) from public, anon, authenticated;

-- ═══ 4. Tarea 2 · trasladar cupos libres Y → X ═════════════════════════════
create or replace function public.trasladar_cupos(
  p_origen bigint, p_destino bigint, p_cantidad integer, p_motivo text, p_operacion_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record;
  v_y public.bloqueos_vuelo%rowtype;
  v_x public.bloqueos_vuelo%rowtype;
  v_ids bigint[];
  v_libres integer;
  v_next integer;
  v_num_ori integer;
  v_y_act integer; v_x_act integer;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into v_actor from public._vuelos_actor();
  if p_origen is null or p_destino is null or p_origen = p_destino then
    raise exception using errcode = '22023', message = 'Elige un record destino distinto al de origen.';
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 100 then
    raise exception using errcode = '22023', message = 'La cantidad debe estar entre 1 y 100.';
  end if;
  if not public._reservar_operacion(p_operacion_id, 'traslado_cupo',
       md5(concat_ws('|', 'traslado_cupo', p_origen, p_destino, p_cantidad)), v_actor.actor_id) then
    return jsonb_build_object('ok', true, 'repetida', true,
      'movidas', (select count(*) from public.movimientos_silla where operacion_id = p_operacion_id));
  end if;

  -- Bloqueo en orden fijo: records por id, después sus sillas.
  perform 1 from public.bloqueos_vuelo where id in (p_origen, p_destino) order by id for update;
  select * into v_y from public.bloqueos_vuelo where id = p_origen;
  select * into v_x from public.bloqueos_vuelo where id = p_destino;
  if v_y.id is null or v_x.id is null then
    raise exception using errcode = 'P0001', message = 'Record no disponible.';
  end if;
  perform public._validar_record_destino(v_y, v_x);
  perform 1 from public.sillas where bloqueo_id in (p_origen, p_destino) order by bloqueo_id, id for update;

  v_y_act := public._sillas_activas(p_origen);
  v_x_act := public._sillas_activas(p_destino);

  select array_agg(t.id order by t.numero_silla desc nulls last, t.id desc) into v_ids
    from (select s.id, s.numero_silla from public.sillas s
           where s.bloqueo_id = p_origen and public._silla_libre(s)
           order by s.numero_silla desc nulls last, s.id desc limit p_cantidad) t;
  v_libres := coalesce(array_length(v_ids, 1), 0);
  if v_libres < p_cantidad then
    raise exception using errcode = 'P0001', message =
      format('El record %s solo tiene %s cupo(s) libre(s); no se pueden trasladar %s.', v_y.record, v_libres, p_cantidad);
  end if;
  if coalesce(v_y.cupos_total, 0) < p_cantidad then
    raise exception using errcode = 'P0001', message =
      format('Los cupos registrados del record %s (%s) no alcanzan; revisa el inventario.', v_y.record, coalesce(v_y.cupos_total, 0));
  end if;

  select coalesce(max(numero_silla), 0) into v_next from public.sillas where bloqueo_id = p_destino;
  for i in 1 .. p_cantidad loop
    select numero_silla into v_num_ori from public.sillas where id = v_ids[i];
    update public.sillas
       set bloqueo_id = p_destino, numero_silla = v_next + i, estado = 'disponible', updated_at = now()
     where id = v_ids[i];
    insert into public.movimientos_silla (
      silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, registrado_por_id,
      tipo, operacion_id, numero_silla_origen, numero_silla_destino, estado_silla,
      cupos_origen_antes, cupos_origen_despues, cupos_destino_antes, cupos_destino_despues)
    values (
      v_ids[i], p_origen, p_destino, v_motivo, v_actor.actor_nombre, v_actor.actor_id,
      'traslado_cupo', p_operacion_id, v_num_ori, v_next + i, 'disponible',
      v_y.cupos_total, v_y.cupos_total - p_cantidad, coalesce(v_x.cupos_total, 0), coalesce(v_x.cupos_total, 0) + p_cantidad);
  end loop;
  update public.bloqueos_vuelo set cupos_total = cupos_total - p_cantidad where id = p_origen;
  update public.bloqueos_vuelo set cupos_total = coalesce(cupos_total, 0) + p_cantidad where id = p_destino;

  -- Invariantes (I3): Y pierde N activas, X gana N, la suma no cambia.
  if public._sillas_activas(p_origen) <> v_y_act - p_cantidad or public._sillas_activas(p_destino) <> v_x_act + p_cantidad then
    raise exception using errcode = 'P0001', message = 'Invariante de cupos violado; no se guardó nada.';
  end if;

  return jsonb_build_object('ok', true, 'repetida', false, 'movidas', p_cantidad,
    'origen', jsonb_build_object('record', v_y.record, 'cupos_antes', v_y.cupos_total, 'cupos_despues', v_y.cupos_total - p_cantidad),
    'destino', jsonb_build_object('record', v_x.record, 'cupos_antes', coalesce(v_x.cupos_total, 0), 'cupos_despues', coalesce(v_x.cupos_total, 0) + p_cantidad));
end $$;

-- ═══ 5. Tarea 3 · mover pasajero: 'solo_datos' o 'con_cupo' ════════════════
create or replace function public.mover_pasajero(
  p_silla_id bigint, p_destino bigint, p_modo text, p_acepta_tarifa_distinta boolean,
  p_motivo text, p_operacion_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record;
  v_s0 public.sillas%rowtype;
  v_s  public.sillas%rowtype;
  v_o  public.sillas%rowtype;
  v_y public.bloqueos_vuelo%rowtype;
  v_x public.bloqueos_vuelo%rowtype;
  v_aut record; v_aut2 record;
  v_grupo bigint[]; v_dest bigint[];
  v_n integer; v_libres integer; v_next integer; v_otros integer; v_inmovibles integer;
  v_y_act integer; v_x_act integer;
  v_tarifa_distinta boolean;
  v_contrato text;
  v_aviso_record boolean := false;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_ref bigint;
  v_tramos_total integer := 0; v_tramos_y integer := 0; v_tramos_mal integer := 0; v_tramos_act integer := 0;
  v_emp bigint; v_ref_final bigint; v_ventas_act integer := 0;
  v_req_ida boolean := false; v_req_reg boolean := false;
begin
  select * into v_actor from public._vuelos_actor();
  if p_modo is null or p_modo not in ('solo_datos', 'con_cupo') then
    raise exception using errcode = '22023',
      message = 'Elige cómo recibirá el record destino al pasajero: solo sus datos (usa un cupo libre de destino) o con su cupo.';
  end if;
  if p_silla_id is null or p_destino is null then
    raise exception using errcode = '22023', message = 'Datos incompletos para mover el pasajero.';
  end if;
  -- La idempotencia va ANTES de cualquier validación que dependa del estado
  -- de la silla: tras un 'con_cupo' confirmado la silla ya está en X, y un
  -- reintento con el mismo operacion_id (respuesta perdida, doble clic) debe
  -- responder "repetida", no "destino distinto al actual". Si algo de lo que
  -- sigue falla, la transacción entera se revierte y la reserva de la
  -- operación también (el reintento podrá aplicarse).
  if not public._reservar_operacion(p_operacion_id, 'mover_pasajero',
       md5(concat_ws('|', 'mover_pasajero', p_silla_id, p_destino, p_modo, coalesce(p_acepta_tarifa_distinta, false))),
       v_actor.actor_id) then
    return jsonb_build_object('ok', true, 'repetida', true, 'modo', p_modo,
      'movidas', (select count(*) from public.movimientos_silla where operacion_id = p_operacion_id));
  end if;
  select * into v_s0 from public.sillas where id = p_silla_id;
  if v_s0.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s0.bloqueo_id = p_destino then
    raise exception using errcode = '22023', message = 'Elige un record destino distinto al actual.';
  end if;

  -- Autorización del contrato con su tenant (AUT-1b / AUT-2) y bloqueo en
  -- orden fijo: venta del contrato → records por id → sillas.
  select * into v_aut from public._autorizar_contrato_silla(v_s0.numero_contrato, v_s0.contrato_manual, v_actor.actor_rol, false);
  if v_aut.numero_resuelto is not null then
    perform 1 from public.ventas where numero_contrato = v_aut.numero_resuelto for update;
  end if;
  perform 1 from public.bloqueos_vuelo where id in (v_s0.bloqueo_id, p_destino) order by id for update;
  select * into v_y from public.bloqueos_vuelo where id = v_s0.bloqueo_id;
  select * into v_x from public.bloqueos_vuelo where id = p_destino;
  if v_y.id is null or v_x.id is null then raise exception using errcode = 'P0001', message = 'Record no disponible.'; end if;
  perform public._validar_record_destino(v_y, v_x);
  v_tarifa_distinta := v_x.tarifa_neta is distinct from v_y.tarifa_neta;
  if v_tarifa_distinta and not coalesce(p_acepta_tarifa_distinta, false) then   -- D4b
    raise exception using errcode = 'P0001', message =
      'TARIFA_DISTINTA: La tarifa neta del record destino es distinta. Confirma para continuar; el costo del contrato no se recalcula.';
  end if;
  perform 1 from public.sillas where bloqueo_id in (v_y.id, v_x.id) order by bloqueo_id, id for update;

  -- Releer con todo bloqueado: la silla debe seguir igual.
  select * into v_s from public.sillas where id = p_silla_id;
  if v_s.bloqueo_id is distinct from v_y.id or v_s.numero_contrato is distinct from v_s0.numero_contrato
     or v_s.contrato_manual is distinct from v_s0.contrato_manual then
    raise exception using errcode = 'P0001', message = 'La silla cambió mientras se procesaba; recarga e intenta de nuevo.';
  end if;
  if v_s.numero_contrato is null and v_s.contrato_manual is not null then
    select * into v_aut2 from public._autorizar_contrato_silla(null, v_s.contrato_manual, v_actor.actor_rol, false);
    if v_aut2.clase is distinct from v_aut.clase or v_aut2.numero_resuelto is distinct from v_aut.numero_resuelto then
      raise exception using errcode = 'P0001', message = 'La silla cambió mientras se procesaba; recarga e intenta de nuevo.';
    end if;
  end if;
  if v_s.estado::text in ('cambio', 'retirada', 'devuelta', 'no_vendida') then
    raise exception using errcode = 'P0001', message = format('Esta silla no se puede mover (estado %s).', v_s.estado);
  end if;
  if public._silla_libre(v_s) then
    raise exception using errcode = 'P0001',
      message = 'La silla está libre: no hay pasajero que mover. Para mover cupos libres usa "Trasladar cupos".';
  end if;

  -- D1: todas las sillas del mismo contrato en Y viajan juntas y el contrato
  -- no puede quedar repartido con un tercer record.
  if v_s.numero_contrato is not null then
    select array_agg(id order by numero_silla, id) into v_grupo from public.sillas
     where bloqueo_id = v_y.id and numero_contrato = v_s.numero_contrato and estado::text in ('en_plazo', 'confirmada', 'disponible', 'cambio_entrante');
    select count(*) into v_inmovibles from public.sillas
     where bloqueo_id = v_y.id and numero_contrato = v_s.numero_contrato and estado::text in ('devuelta', 'no_vendida');
    select count(*) into v_otros from public.sillas
     where numero_contrato = v_s.numero_contrato and bloqueo_id not in (v_y.id, v_x.id) and estado::text not in ('cambio', 'retirada');
  elsif v_s.contrato_manual is not null and coalesce(v_aut.manual_normalizada, '') <> '' then
    select array_agg(id order by numero_silla, id) into v_grupo from public.sillas s
     where s.bloqueo_id = v_y.id and s.numero_contrato is null and s.contrato_manual is not null
       and public._ref_manual_normalizada(s.contrato_manual) = v_aut.manual_normalizada
       and s.estado::text in ('en_plazo', 'confirmada', 'disponible', 'cambio_entrante');
    select count(*) into v_inmovibles from public.sillas s
     where s.bloqueo_id = v_y.id and s.numero_contrato is null and s.contrato_manual is not null
       and public._ref_manual_normalizada(s.contrato_manual) = v_aut.manual_normalizada and s.estado::text in ('devuelta', 'no_vendida');
    select count(*) into v_otros from public.sillas s
     where s.bloqueo_id not in (v_y.id, v_x.id) and s.numero_contrato is null and s.contrato_manual is not null
       and public._ref_manual_normalizada(s.contrato_manual) = v_aut.manual_normalizada and s.estado::text not in ('cambio', 'retirada');
  else
    v_grupo := array[v_s.id]; v_inmovibles := 0; v_otros := 0;
  end if;
  if v_otros > 0 then
    raise exception using errcode = 'P0001',
      message = 'El contrato tiene sillas en otro record; no se puede repartir entre más records. Resuélvelo primero.';
  end if;
  if v_inmovibles > 0 then
    raise exception using errcode = 'P0001',
      message = 'El contrato tiene sillas devueltas o no vendidas en este record; no se puede mover parcialmente.';
  end if;

  -- D3-c (aprobada): SOLO cuando la silla tiene numero_contrato (venta del
  -- sistema). Se exige la misma fecha de ida y regreso, y los tramos del
  -- contrato que apuntan a Y se reescriben con los datos de X en esta misma
  -- transacción. Todo lo que impida dejar silla y contrato coherentes se
  -- rechaza ANTES de escribir nada. Con contrato_manual (aunque resuelva a
  -- una venta) no aplica: ni fechas, ni ventas, ni contrato_vuelos.
  if v_s.numero_contrato is not null then
    if v_x.fecha_ida is distinct from v_y.fecha_ida or v_x.fecha_regreso is distinct from v_y.fecha_regreso then
      raise exception using errcode = 'P0001', message = format(
        'El contrato %s solo se puede mover a un record con las mismas fechas de ida y regreso (%s: %s / %s; %s: %s / %s). Para cambiar de fecha, anula y vuelve a reservar.',
        v_s.numero_contrato, v_y.record, coalesce(v_y.fecha_ida::text, '—'), coalesce(v_y.fecha_regreso::text, '—'),
        v_x.record, coalesce(v_x.fecha_ida::text, '—'), coalesce(v_x.fecha_regreso::text, '—'));
    end if;
    select bloqueo_ref_id, empaquetado_ref_id into v_ref, v_emp from public.ventas where numero_contrato = v_s.numero_contrato;
    if not found then
      raise exception using errcode = 'P0001', message = format('No se encontró la venta del contrato %s.', v_s.numero_contrato);
    end if;
    if v_ref is not null and v_ref not in (v_y.id, v_x.id) then
      raise exception using errcode = 'P0001', message = format(
        'El contrato %s está vinculado a otro record; corrígelo antes de mover.', v_s.numero_contrato);
    end if;
    -- Vínculo nulo: decisión explícita. Se VINCULA a X (el núcleo 167 ya
    -- descubre el bloqueo por las sillas, que tras mover están todas en X).
    -- Si la venta tiene empaquetado_ref_id, vincularla violaría
    -- ventas_origen_excluyente_check y dejarla nula no es admisible: rechazo.
    if v_ref is null and v_emp is not null then
      raise exception using errcode = 'P0001', message = format(
        'El contrato %s está ligado a un empaquetado, no a un record; no se puede vincular a %s. Corrígelo antes de mover.',
        v_s.numero_contrato, v_x.record);
    end if;
    perform 1 from public.contrato_vuelos where numero_contrato = v_s.numero_contrato order by id for update;
    select count(*),
           count(*) filter (where upper(btrim(coalesce(record, ''))) = upper(btrim(v_y.record))),
           count(*) filter (where upper(btrim(coalesce(record, ''))) = upper(btrim(v_y.record))
                              and not (coalesce(direccion, '') in ('ida', 'regreso') or public._tramo_legado(contrato_vuelos)))
      into v_tramos_total, v_tramos_y, v_tramos_mal
      from public.contrato_vuelos where numero_contrato = v_s.numero_contrato;
    if v_tramos_total > 0 and v_tramos_y = 0 then
      raise exception using errcode = 'P0001', message = format(
        'Ningún tramo del vuelo del contrato %s corresponde al record %s; corrígelo en el editor de vuelos del contrato antes de mover.',
        v_s.numero_contrato, v_y.record);
    end if;
    if v_tramos_mal > 0 then
      raise exception using errcode = 'P0001', message = format(
        'El contrato %s tiene un tramo del record %s sin dirección de ida o regreso; no se puede actualizar sin ambigüedad.',
        v_s.numero_contrato, v_y.record);
    end if;
    if v_tramos_y > 0 then
      if upper(regexp_replace(coalesce(v_x.ruta, ''), '\s', '', 'g')) is distinct from upper(regexp_replace(coalesce(v_y.ruta, ''), '\s', '', 'g')) then
        raise exception using errcode = 'P0001', message = format(
          'El record %s tiene otra ruta; el vuelo del contrato %s no quedaría coherente.', v_x.record, v_s.numero_contrato);
      end if;
      if upper(btrim(coalesce(v_x.aerolinea, ''))) is distinct from upper(btrim(coalesce(v_y.aerolinea, ''))) then
        raise exception using errcode = 'P0001', message = format(
          'El record %s tiene otra aerolínea; el vuelo del contrato %s no quedaría coherente.', v_x.record, v_s.numero_contrato);
      end if;
      select coalesce(bool_or(public._tramo_usa_ida(cv)), false), coalesce(bool_or(public._tramo_usa_regreso(cv)), false)
        into v_req_ida, v_req_reg
        from public.contrato_vuelos cv
       where cv.numero_contrato = v_s.numero_contrato
         and upper(btrim(coalesce(cv.record, ''))) = upper(btrim(v_y.record));
      if v_req_ida and (nullif(btrim(v_x.vuelo_ida), '') is null or v_x.hora_salida_ida is null or v_x.hora_llegada_ida is null) then
        raise exception using errcode = 'P0001', message = format(
          'El record %s no tiene completo el vuelo de ida (número de vuelo, hora de salida y de llegada); complétalo antes de mover. No se cambió nada.',
          v_x.record);
      end if;
      if v_req_reg and (nullif(btrim(v_x.vuelo_regreso), '') is null or v_x.hora_salida_reg is null or v_x.hora_llegada_reg is null) then
        raise exception using errcode = 'P0001', message = format(
          'El record %s no tiene completo el vuelo de regreso (número de vuelo, hora de salida y de llegada); complétalo antes de mover. No se cambió nada.',
          v_x.record);
      end if;
    end if;
  end if;
  v_n := coalesce(array_length(v_grupo, 1), 0);
  v_y_act := public._sillas_activas(v_y.id);
  v_x_act := public._sillas_activas(v_x.id);

  if p_modo = 'con_cupo' then
    if coalesce(v_y.cupos_total, 0) < v_n then
      raise exception using errcode = 'P0001', message =
        format('Los cupos registrados del record %s (%s) no alcanzan; revisa el inventario.', v_y.record, coalesce(v_y.cupos_total, 0));
    end if;
    select coalesce(max(numero_silla), 0) into v_next from public.sillas where bloqueo_id = v_x.id;
    for i in 1 .. v_n loop
      select * into v_o from public.sillas where id = v_grupo[i];
      update public.sillas set bloqueo_id = v_x.id, numero_silla = v_next + i, updated_at = now() where id = v_grupo[i];
      insert into public.movimientos_silla (
        silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, registrado_por_id,
        tipo, operacion_id, numero_silla_origen, numero_silla_destino, estado_silla,
        numero_contrato, contrato_manual, contrato_manual_clase, contrato_manual_resuelto,
        cupos_origen_antes, cupos_origen_despues, cupos_destino_antes, cupos_destino_despues)
      values (
        v_o.id, v_y.id, v_x.id, v_motivo, v_actor.actor_nombre, v_actor.actor_id,
        'mover_con_cupo', p_operacion_id, v_o.numero_silla, v_next + i, v_o.estado::text,
        v_o.numero_contrato, v_o.contrato_manual,
        case when v_o.contrato_manual is not null then v_aut.clase end, case when v_o.contrato_manual is not null then v_aut.numero_resuelto end,
        v_y.cupos_total, v_y.cupos_total - v_n, coalesce(v_x.cupos_total, 0), coalesce(v_x.cupos_total, 0) + v_n);
    end loop;
    update public.bloqueos_vuelo set cupos_total = cupos_total - v_n where id = v_y.id;
    update public.bloqueos_vuelo set cupos_total = coalesce(cupos_total, 0) + v_n where id = v_x.id;
    if public._sillas_activas(v_y.id) <> v_y_act - v_n or public._sillas_activas(v_x.id) <> v_x_act + v_n then
      raise exception using errcode = 'P0001', message = 'Invariante de cupos violado; no se guardó nada.';
    end if;
  else
    select array_agg(t.id order by t.numero_silla, t.id) into v_dest
      from (select s.id, s.numero_silla from public.sillas s
             where s.bloqueo_id = v_x.id and public._silla_libre(s)
             order by s.numero_silla nulls last, s.id limit v_n) t;
    v_libres := coalesce(array_length(v_dest, 1), 0);
    if v_libres < v_n then
      raise exception using errcode = 'P0001', message = format(
        'El record %s no tiene cupo libre suficiente (necesita %s, tiene %s). Elige "Trasladar el cupo" o libera cupos en ese record.',
        v_x.record, v_n, v_libres);
    end if;
    for i in 1 .. v_n loop
      select * into v_o from public.sillas where id = v_grupo[i];
      update public.sillas d set
        estado = v_o.estado, numero_contrato = v_o.numero_contrato, contrato_manual = v_o.contrato_manual,
        pasajero_nombres = v_o.pasajero_nombres, pasajero_apellidos = v_o.pasajero_apellidos,
        tipo_doc = v_o.tipo_doc, numero_doc = v_o.numero_doc, nacimiento = v_o.nacimiento,
        asesor = v_o.asesor, agencia = v_o.agencia, hotel = v_o.hotel, acomodacion = v_o.acomodacion, plazo = v_o.plazo,
        inf_nombres = v_o.inf_nombres, inf_apellidos = v_o.inf_apellidos, inf_tipo_doc = v_o.inf_tipo_doc,
        inf_numero = v_o.inf_numero, inf_nacimiento = v_o.inf_nacimiento, responsable_menor = v_o.responsable_menor,
        updated_at = now()
      where d.id = v_dest[i];
      update public.sillas set
        estado = 'disponible', numero_contrato = null, contrato_manual = null,
        pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null, numero_doc = null, nacimiento = null,
        asesor = null, agencia = null, hotel = null, acomodacion = null, plazo = null,
        inf_nombres = null, inf_apellidos = null, inf_tipo_doc = null, inf_numero = null, inf_nacimiento = null,
        responsable_menor = null, updated_at = now()
      where id = v_grupo[i];
      insert into public.movimientos_silla (
        silla_id, silla_destino_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, registrado_por_id,
        tipo, operacion_id, numero_silla_origen, numero_silla_destino, estado_silla,
        numero_contrato, contrato_manual, contrato_manual_clase, contrato_manual_resuelto,
        cupos_origen_antes, cupos_origen_despues, cupos_destino_antes, cupos_destino_despues)
      values (
        v_o.id, v_dest[i], v_y.id, v_x.id, v_motivo, v_actor.actor_nombre, v_actor.actor_id,
        'mover_datos', p_operacion_id, v_o.numero_silla, (select numero_silla from public.sillas where id = v_dest[i]), v_o.estado::text,
        v_o.numero_contrato, v_o.contrato_manual,
        case when v_o.contrato_manual is not null then v_aut.clase end, case when v_o.contrato_manual is not null then v_aut.numero_resuelto end,
        v_y.cupos_total, v_y.cupos_total, coalesce(v_x.cupos_total, 0), coalesce(v_x.cupos_total, 0));
    end loop;
    if public._sillas_activas(v_y.id) <> v_y_act or public._sillas_activas(v_x.id) <> v_x_act then
      raise exception using errcode = 'P0001', message = 'Invariante de cupos violado; no se guardó nada.';
    end if;
  end if;

  -- Vínculo durable contrato→record (167): sin esto, editar los pasajeros
  -- del contrato después volvería a tomar sillas en Y. Solo contratos
  -- orgánicos (AUT-2b: el manual no se convierte en orgánico).
  if v_s.numero_contrato is not null then
    update public.ventas set bloqueo_ref_id = v_x.id
     where numero_contrato = v_s.numero_contrato
       and empaquetado_ref_id is null
       and (bloqueo_ref_id is null or bloqueo_ref_id in (v_y.id, v_x.id));
    get diagnostics v_ventas_act = row_count;
    select bloqueo_ref_id into v_ref_final from public.ventas where numero_contrato = v_s.numero_contrato;
    if v_ventas_act <> 1 or v_ref_final is distinct from v_x.id then
      raise exception using errcode = 'P0001', message = format(
        'No se pudo vincular el contrato %s al record %s; no se guardó nada.', v_s.numero_contrato, v_x.record);
    end if;
    -- D3-c: los tramos que apuntaban a Y pasan a X (PNR, vuelo y horas; las
    -- fechas ya son iguales). Filas nuevas (un tramo por fila, 135) y filas
    -- heredadas ida+regreso en una sola fila. Los tramos de otros records no
    -- se tocan. Queda en la auditoría (087) con el actor.
    update public.contrato_vuelos cv set
      record           = v_x.record,
      numero_vuelo     = case cv.direccion when 'ida' then v_x.vuelo_ida when 'regreso' then v_x.vuelo_regreso else cv.numero_vuelo end,
      hora_salida      = case cv.direccion when 'ida' then v_x.hora_salida_ida::text when 'regreso' then v_x.hora_salida_reg::text else cv.hora_salida end,
      hora_llegada     = case cv.direccion when 'ida' then v_x.hora_llegada_ida::text when 'regreso' then v_x.hora_llegada_reg::text else cv.hora_llegada end,
      -- Fila heredada: solo la parte (ida/regreso) que la fila usa; la otra queda igual.
      vuelo_ida        = case when public._tramo_legado(cv) and public._tramo_usa_ida(cv) then v_x.vuelo_ida else cv.vuelo_ida end,
      hora_salida_ida  = case when public._tramo_legado(cv) and public._tramo_usa_ida(cv) then v_x.hora_salida_ida::text else cv.hora_salida_ida end,
      hora_llegada_ida = case when public._tramo_legado(cv) and public._tramo_usa_ida(cv) then v_x.hora_llegada_ida::text else cv.hora_llegada_ida end,
      vuelo_regreso    = case when public._tramo_legado(cv) and public._tramo_usa_regreso(cv) then v_x.vuelo_regreso else cv.vuelo_regreso end,
      hora_salida_reg  = case when public._tramo_legado(cv) and public._tramo_usa_regreso(cv) then v_x.hora_salida_reg::text else cv.hora_salida_reg end,
      hora_llegada_reg = case when public._tramo_legado(cv) and public._tramo_usa_regreso(cv) then v_x.hora_llegada_reg::text else cv.hora_llegada_reg end
    where cv.numero_contrato = v_s.numero_contrato
      and upper(btrim(coalesce(cv.record, ''))) = upper(btrim(v_y.record));
    get diagnostics v_tramos_act = row_count;
    if v_tramos_act <> v_tramos_y then
      raise exception using errcode = 'P0001', message = 'Los tramos del contrato cambiaron mientras se procesaba; no se guardó nada.';
    end if;
    update public.movimientos_silla set tramos_contrato_actualizados = v_tramos_act
     where operacion_id = p_operacion_id;
  end if;
  -- Con contrato_manual el vuelo de la venta resuelta NO se toca (D3-c no
  -- aplica): solo se avisa si sus tramos todavía dicen Y.
  v_contrato := coalesce(v_s.numero_contrato, v_aut.numero_resuelto);
  if v_contrato is not null then
    select exists (select 1 from public.contrato_vuelos cv
                    where cv.numero_contrato = v_contrato and upper(btrim(cv.record)) = upper(btrim(v_y.record)))
      into v_aviso_record;
  end if;

  return jsonb_build_object('ok', true, 'repetida', false, 'modo', p_modo, 'movidas', v_n,
    'contrato', v_contrato, 'aviso_tarifa_distinta', v_tarifa_distinta, 'aviso_record_contrato', v_aviso_record,
    'tramos_actualizados', v_tramos_act, 'contrato_manual', (v_s.numero_contrato is null and v_s.contrato_manual is not null),
    'vinculo_anterior', case when v_s.numero_contrato is not null then v_ref end,
    'origen', jsonb_build_object('record', v_y.record, 'cupos_antes', v_y.cupos_total,
       'cupos_despues', case when p_modo = 'con_cupo' then v_y.cupos_total - v_n else v_y.cupos_total end),
    'destino', jsonb_build_object('record', v_x.record, 'cupos_antes', coalesce(v_x.cupos_total, 0),
       'cupos_despues', case when p_modo = 'con_cupo' then coalesce(v_x.cupos_total, 0) + v_n else coalesce(v_x.cupos_total, 0) end));
end $$;

-- ═══ 6. Retirar un cupo libre (D8) ═════════════════════════════════════════
create or replace function public.retirar_cupo(p_silla_id bigint, p_motivo text, p_operacion_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record; v_bloq bigint;
  v_s public.sillas%rowtype; v_y public.bloqueos_vuelo%rowtype; v_act integer;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into v_actor from public._vuelos_actor();
  if p_silla_id is null then raise exception using errcode = '22023', message = 'Datos incompletos.'; end if;
  if not public._reservar_operacion(p_operacion_id, 'retiro_cupo', md5(concat_ws('|', 'retiro_cupo', p_silla_id)), v_actor.actor_id) then
    return jsonb_build_object('ok', true, 'repetida', true);
  end if;
  select bloqueo_id into v_bloq from public.sillas where id = p_silla_id;
  if v_bloq is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  select * into v_y from public.bloqueos_vuelo where id = v_bloq for update;
  perform 1 from public.sillas where bloqueo_id = v_bloq order by id for update;
  select * into v_s from public.sillas where id = p_silla_id;
  if v_s.bloqueo_id is distinct from v_bloq then
    raise exception using errcode = 'P0001', message = 'La silla cambió mientras se procesaba; recarga e intenta de nuevo.';
  end if;
  if not public._silla_libre(v_s) then
    raise exception using errcode = 'P0001', message = 'Solo se puede retirar un cupo libre (sin contrato ni pasajero).';
  end if;
  if coalesce(v_y.cupos_total, 0) < 1 then
    raise exception using errcode = 'P0001', message = 'Los cupos registrados del record no alcanzan; revisa el inventario.';
  end if;
  v_act := public._sillas_activas(v_bloq);
  update public.sillas set estado = 'retirada', updated_at = now() where id = p_silla_id;
  update public.bloqueos_vuelo set cupos_total = cupos_total - 1 where id = v_bloq;
  insert into public.movimientos_silla (
    silla_id, bloqueo_origen_id, bloqueo_destino_id, motivo, registrado_por, registrado_por_id,
    tipo, operacion_id, numero_silla_origen, estado_silla, cupos_origen_antes, cupos_origen_despues)
  values (
    p_silla_id, v_bloq, null, v_motivo, v_actor.actor_nombre, v_actor.actor_id,
    'retiro_cupo', p_operacion_id, v_s.numero_silla, v_s.estado::text, v_y.cupos_total, v_y.cupos_total - 1);
  if public._sillas_activas(v_bloq) <> v_act - 1 then
    raise exception using errcode = 'P0001', message = 'Invariante de cupos violado; no se guardó nada.';
  end if;
  return jsonb_build_object('ok', true, 'repetida', false, 'record', v_y.record,
    'cupos_antes', v_y.cupos_total, 'cupos_despues', v_y.cupos_total - 1);
end $$;

-- ═══ 7. Cambios manuales de estado (DIR-1, aprobada) ═══════════════════════
-- Solo sillas sin contrato ni pasajero. Permitidos: disponible→no_vendida,
-- disponible→devuelta, no_vendida→disponible, no_vendida→devuelta (solo
-- devolución real). Devuelta es definitiva. cambio_entrante = disponible.
create or replace function public.cambiar_estado_silla(
  p_silla_id bigint, p_estado text, p_motivo text, p_devolucion_real boolean)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record; v_s public.sillas%rowtype; v_desde text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select * into v_actor from public._vuelos_actor();
  if v_motivo is null then raise exception using errcode = '22023', message = 'Escribe el motivo del cambio de estado.'; end if;
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.numero_contrato is not null or v_s.contrato_manual is not null or public._silla_con_datos(v_s) then
    raise exception using errcode = 'P0001',
      message = 'Esta silla tiene contrato o pasajero: su estado se cambia con las acciones del contrato (confirmar, liberar…).';
  end if;
  v_desde := case when v_s.estado::text = 'cambio_entrante' then 'disponible' else v_s.estado::text end;
  if v_desde = 'devuelta' then
    raise exception using errcode = 'P0001', message = 'Una silla devuelta es definitiva: no vuelve a otro estado.';
  end if;
  if p_estado is null or p_estado not in ('disponible', 'no_vendida', 'devuelta') then
    raise exception using errcode = 'P0001',
      message = 'Ese cambio de estado no se hace a mano: usa reservar, confirmar venta, liberar silla o retirar cupo.';
  end if;
  if v_desde = p_estado then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  if not ((v_desde = 'disponible' and p_estado in ('no_vendida', 'devuelta'))
       or (v_desde = 'no_vendida' and p_estado = 'disponible')
       or (v_desde = 'no_vendida' and p_estado = 'devuelta')) then
    raise exception using errcode = 'P0001', message = format('Cambio no permitido de %s a %s.', v_desde, p_estado);
  end if;
  if v_desde = 'no_vendida' and p_estado = 'devuelta' and not coalesce(p_devolucion_real, false) then
    raise exception using errcode = 'P0001',
      message = 'Pasar de "No vendida" a "Devuelta" solo registra una devolución real a la aerolínea; confírmala.';
  end if;
  update public.sillas set estado = p_estado::public.estado_silla, updated_at = now() where id = p_silla_id;
  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (v_s.bloqueo_id, format('Silla %s: %s → %s', v_s.numero_silla, v_s.estado, p_estado), v_motivo, v_actor.actor_nombre);
  return jsonb_build_object('ok', true, 'sin_cambios', false, 'desde', v_s.estado::text, 'hacia', p_estado);
end $$;

-- ═══ 8. Contrato manual, liberar y editar (AUT-2, DIR-2) ═══════════════════
create or replace function public.asignar_contrato_manual(p_silla_id bigint, p_referencia text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v_actor record; v_s public.sillas%rowtype; v_ref text; r record;
begin
  select * into v_actor from public._vuelos_actor();
  v_ref := public._ref_manual_normalizada(p_referencia);
  if v_ref is null or v_ref = '' then raise exception using errcode = '22023', message = 'Escribe el número de contrato manual.'; end if;
  select * into r from public._autorizar_contrato_silla(null, v_ref, v_actor.actor_rol, false);
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if not public._silla_libre(v_s) then
    raise exception using errcode = 'P0001', message = 'Solo se asigna un contrato manual a un cupo libre (sin contrato ni pasajero).';
  end if;
  update public.sillas set contrato_manual = v_ref, estado = 'confirmada', updated_at = now() where id = p_silla_id;
  return jsonb_build_object('ok', true, 'clase', r.clase, 'contrato_resuelto', r.numero_resuelto, 'referencia', v_ref);
end $$;

create or replace function public.quitar_contrato_manual(p_silla_id bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v_actor record; v_s public.sillas%rowtype;
begin
  select * into v_actor from public._vuelos_actor();
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.contrato_manual is null then raise exception using errcode = 'P0001', message = 'Esta silla no tiene contrato manual.'; end if;
  perform public._autorizar_contrato_silla(null, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set contrato_manual = null,
         estado = case when estado::text in ('devuelta', 'no_vendida', 'retirada', 'cambio') then estado else 'disponible' end,
         updated_at = now()
   where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.liberar_silla(p_silla_id bigint)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare v_actor record; v_s public.sillas%rowtype;
begin
  select * into v_actor from public._vuelos_actor();
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.estado::text in ('cambio', 'retirada', 'devuelta', 'no_vendida') then
    raise exception using errcode = 'P0001', message = format('Esta silla no se puede liberar (estado %s).', v_s.estado);
  end if;
  perform public._autorizar_contrato_silla(v_s.numero_contrato, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set
    estado = 'disponible', numero_contrato = null, contrato_manual = null,
    pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null, numero_doc = null, nacimiento = null,
    asesor = null, agencia = null, hotel = null, acomodacion = null, plazo = null,
    inf_nombres = null, inf_apellidos = null, inf_tipo_doc = null, inf_numero = null, inf_nacimiento = null,
    responsable_menor = null, updated_at = now()
  where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.editar_pasajero_silla(p_silla_id bigint, p_datos jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp set lock_timeout = '5s' as $$
declare
  v_actor record; v_s public.sillas%rowtype; v_nac date; v_plazo date;
  t_nac text := nullif(btrim(coalesce(p_datos ->> 'nacimiento', '')), '');
  t_plazo text := nullif(btrim(coalesce(p_datos ->> 'plazo', '')), '');
begin
  select * into v_actor from public._vuelos_actor();
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception using errcode = '22023', message = 'Datos del pasajero inválidos.';
  end if;
  if t_nac is not null then
    if t_nac !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de nacimiento inválida.'; end if;
    v_nac := t_nac::date;
  end if;
  if t_plazo is not null then
    if t_plazo !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'Fecha de plazo inválida.'; end if;
    v_plazo := t_plazo::date;
  end if;
  select * into v_s from public.sillas where id = p_silla_id for update;
  if v_s.id is null then raise exception using errcode = 'P0001', message = 'Silla no disponible.'; end if;
  if v_s.estado::text in ('cambio', 'retirada') then
    raise exception using errcode = 'P0001', message = 'Esta silla es historial; no se edita.';
  end if;
  perform public._autorizar_contrato_silla(v_s.numero_contrato, v_s.contrato_manual, v_actor.actor_rol, true);
  update public.sillas set
    pasajero_nombres   = nullif(btrim(coalesce(p_datos ->> 'pasajero_nombres', '')), ''),
    pasajero_apellidos = nullif(btrim(coalesce(p_datos ->> 'pasajero_apellidos', '')), ''),
    tipo_doc           = nullif(btrim(coalesce(p_datos ->> 'tipo_doc', '')), ''),
    numero_doc         = nullif(btrim(coalesce(p_datos ->> 'numero_doc', '')), ''),
    nacimiento         = v_nac,
    asesor             = nullif(btrim(coalesce(p_datos ->> 'asesor', '')), ''),
    hotel              = nullif(btrim(coalesce(p_datos ->> 'hotel', '')), ''),
    acomodacion        = nullif(btrim(coalesce(p_datos ->> 'acomodacion', '')), ''),
    plazo              = v_plazo,
    updated_at         = now()
  where id = p_silla_id;
  return jsonb_build_object('ok', true);
end $$;

-- ═══ 9. Permisos de ejecución ══════════════════════════════════════════════
revoke all on function public.trasladar_cupos(bigint, bigint, integer, text, uuid) from public, anon;
revoke all on function public.mover_pasajero(bigint, bigint, text, boolean, text, uuid) from public, anon;
revoke all on function public.retirar_cupo(bigint, text, uuid) from public, anon;
revoke all on function public.cambiar_estado_silla(bigint, text, text, boolean) from public, anon;
revoke all on function public.asignar_contrato_manual(bigint, text) from public, anon;
revoke all on function public.quitar_contrato_manual(bigint) from public, anon;
revoke all on function public.liberar_silla(bigint) from public, anon;
revoke all on function public.editar_pasajero_silla(bigint, jsonb) from public, anon;
grant execute on function public.trasladar_cupos(bigint, bigint, integer, text, uuid) to authenticated;
grant execute on function public.mover_pasajero(bigint, bigint, text, boolean, text, uuid) to authenticated;
grant execute on function public.retirar_cupo(bigint, text, uuid) to authenticated;
grant execute on function public.cambiar_estado_silla(bigint, text, text, boolean) to authenticated;
grant execute on function public.asignar_contrato_manual(bigint, text) to authenticated;
grant execute on function public.quitar_contrato_manual(bigint) to authenticated;
grant execute on function public.liberar_silla(bigint) to authenticated;
grant execute on function public.editar_pasajero_silla(bigint, jsonb) to authenticated;

comment on function public.trasladar_cupos(bigint, bigint, integer, text, uuid) is
  'Tarea 2: mueve N sillas LIBRES de Y a X (la misma fila, nunca un clon). Y-N / X+N, suma constante, '
  'una fila de historial traslado_cupo por silla. Idempotente por operacion_id. Migración 194.';
comment on function public.mover_pasajero(bigint, bigint, text, boolean, text, uuid) is
  'Tarea 3: modo obligatorio solo_datos (ocupa sillas libres reales de X, sin cambiar cupos) o con_cupo '
  '(mueve las filas, Y-n / X+n). Todas las sillas del contrato en Y viajan juntas (D1). Conserva '
  'numero_contrato y contrato_manual. No altera importes. Migración 194.';
