-- 341 · #76 — REFERIDOS: una persona (el «referidor») trae a una agencia o freelance y recibe una participación configurada del 1 % o del 2 % sobre la BASE COMISIONABLE de las compras FUTURAS de ese aliado.
-- Decisiones del dueño (2026-11-24, docs/tecnico/crm-referral-notification-owner-decisions-2026-11-24.md):
--   · Solo superadmin y gerencia asignan o cambian el referidor y el porcentaje. El CÓDIGO DE REFERIDO es una ruta adicional: se resuelve contra una regla GUARDADA (referidor + porcentaje en
--     `referidor_codigos`); el navegador solo aporta el texto del código, nunca la identidad ni la tarifa.
--   · La atribución rige para las compras FUTURAS del aliado hasta que cambie. Cada contrato guarda una FOTO (referidor, porcentaje, asignación) de lo vigente cuando se creó; cambiar o quitar la
--     asignación NO toca contratos ya atribuidos. SIN backfill: la tabla nace vacía y ninguna asignación puede tener fecha anterior a su creación (vigente_desde = now()).
--   · La comisión del referidor SOLO es pagable cuando el contrato está 100 % pagado: se DERIVA en cada lectura del único criterio ya existente (`contratos_pagados_completos`, 307), así que un
--     abono anulado devuelve el contrato a «pendiente de pago». Un comprobante o un saldo pendiente no bastan.
--   · BASE = EXACTAMENTE la base comisionable con la que se calculó la comisión del aliado (agencia/freelance) de ese contrato: la GUARDADA en su fila de `aliados_b2b` (la misma expresión de `comision_b2b_total`, 205), en la moneda del contrato.
--     En un contrato NETO es la base ORIGINAL sobre la que se calculó la comisión antes de descontarla (decisión del dueño, 2026-11-25): NO se calcula desde lo cobrado en NETO ni desde el monto de la comisión del aliado.
--     No se descuenta recobro ni retención. Si la fila guardada no existe o es ambigua NO se adivina ni se muestra un cero calculado: el estado lo dice y el monto queda NULL.
--   · La participación del referidor es DISTINTA de la comisión del aliado: tablas propias, sin filas en `aliados_b2b`; no cambia comisiones, abonos, portal, cuenta de cobro ni rentabilidad existentes.
--   · NO hay pagos al referidor, ni asientos contables, ni retenciones, ni pagos automáticos: esta migración atribuye, calcula y muestra la elegibilidad. Cómo se paga/contabiliza queda como pregunta.
--   · Elegible = el contrato está 100 % pagado (sobre lo que el comprador debe pagar; en NETO, el total exigible). Nada se paga solo.
-- Seguridad: tablas SOLO service_role (RLS sin políticas, sin permisos para anon/authenticated). Toda escritura y lectura pasa por funciones SECURITY DEFINER que reciben el actor como id y
-- RE-VERIFICAN rol activo y agencia (patrón de la 323). Auditoría genérica (087/108) en las tablas nuevas.
-- La atribución al crear el contrato la hace un TRIGGER sobre `ventas` (todas las rutas de alta pasan por él, atómico con el contrato) que NUNCA hace fallar la creación del contrato (cualquier error
-- se degrada a aviso). Se identifica el contrato por `contrato_uid` (no por número: renumerar copia la fila entera y reutilizar un consecutivo crea otro contrato).
-- Aditiva e idempotente por guardas; rollback: supabase/scripts/rollback_341_referidos.sql (se niega si ya hay datos).
do $$ begin
  if to_regclass('public.aliados') is null then raise exception '341 ABORTADA: falta public.aliados.'; end if;
  if to_regclass('public.usuarios') is null or to_regclass('public.ventas') is null then raise exception '341 ABORTADA: faltan usuarios o ventas.'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid') then raise exception '341 ABORTADA: falta ventas.contrato_uid.'; end if;
  if to_regprocedure('public.contratos_pagados_completos(text[])') is null then raise exception '341 ABORTADA: falta contratos_pagados_completos (307).'; end if;
  if to_regprocedure('public.fn_auditoria()') is null then raise exception '341 ABORTADA: falta fn_auditoria (087).'; end if;
  if to_regclass('public.referidores') is not null then raise exception '341: ya aplicada (existe referidores).'; end if;
end $$;

create schema if not exists f341_priv;
revoke all on schema f341_priv from public, anon, authenticated;

-- ── Tablas ────────────────────────────────────────────────────────────────
create table public.referidores (
  id bigserial primary key,
  tenant text not null check (tenant in ('mayorista', 'minorista')),
  nombre text not null check (char_length(btrim(nombre)) between 3 and 120),
  tipo_documento text check (tipo_documento is null or tipo_documento in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT')),
  documento text check (documento is null or char_length(documento) between 3 and 30),
  email text check (email is null or char_length(email) <= 120),
  telefono text check (telefono is null or char_length(telefono) <= 30),
  notas text check (notas is null or char_length(notas) <= 500),
  activo boolean not null default true,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint referidores_documento_completo check ((documento is null) = (tipo_documento is null)),
  constraint referidores_id_tenant_uk unique (id, tenant)
);
create unique index referidores_documento_uq on public.referidores (tenant, tipo_documento, documento) where documento is not null;
comment on table public.referidores is '#76: personas que refieren aliados. Solo service_role; se opera por referidor_guardar().';

create table public.referidor_codigos (
  codigo text primary key check (codigo ~ '^[A-Z0-9][A-Z0-9-]{3,19}$'),
  referidor_id bigint not null references public.referidores(id) on delete restrict,
  pct numeric(5,4) not null check (pct in (0.01, 0.02)),
  activo boolean not null default true,
  creado_por uuid,
  creado_en timestamptz not null default now()
);
create index referidor_codigos_referidor_idx on public.referidor_codigos (referidor_id);
comment on table public.referidor_codigos is '#76: código de referido = regla guardada (referidor + porcentaje 1 % o 2 %). El navegador solo aporta el texto.';

create table public.aliado_referidores (
  id bigserial primary key,
  aliado_id bigint not null references public.aliados(id) on delete restrict,
  referidor_id bigint not null,
  tenant text not null check (tenant in ('mayorista', 'minorista')),
  pct numeric(5,4) not null check (pct in (0.01, 0.02)),
  origen text not null check (origen in ('manual', 'codigo')),
  codigo text,
  motivo text check (motivo is null or char_length(motivo) <= 300),
  vigente_desde timestamptz not null default now(),
  vigente_hasta timestamptz,
  asignado_por uuid not null,
  cerrado_por uuid,
  constraint aliado_referidores_referidor_fk foreign key (referidor_id, tenant) references public.referidores (id, tenant) on delete restrict,
  constraint aliado_referidores_origen_codigo check ((origen = 'codigo') = (codigo is not null)),
  constraint aliado_referidores_vigencia check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
-- Una sola asignación VIGENTE por aliado y agencia (lo garantiza la base aunque dos operaciones lleguen a la vez).
create unique index aliado_referidores_vigente_uq on public.aliado_referidores (aliado_id, tenant) where vigente_hasta is null;
create index aliado_referidores_referidor_idx on public.aliado_referidores (referidor_id, vigente_desde desc);
create index aliado_referidores_aliado_idx on public.aliado_referidores (aliado_id, vigente_desde desc);
comment on table public.aliado_referidores is '#76: historial de asignaciones aliado → referidor. Nunca se borra ni se reescribe: cambiar = cerrar la vigente y abrir otra.';

create table public.contrato_referidos (
  id bigserial primary key,
  contrato_uid uuid not null,
  tenant text not null check (tenant in ('mayorista', 'minorista')),
  aliado_id bigint not null references public.aliados(id) on delete restrict,
  referidor_id bigint not null references public.referidores(id) on delete restrict,
  asignacion_id bigint not null references public.aliado_referidores(id) on delete restrict,
  pct numeric(5,4) not null check (pct in (0.01, 0.02)),
  origen text not null check (origen in ('manual', 'codigo')),
  codigo text,
  atribuido_en timestamptz not null default now(),
  constraint contrato_referidos_uid_uq unique (contrato_uid)
);
create index contrato_referidos_referidor_idx on public.contrato_referidos (referidor_id, id desc);
create index contrato_referidos_aliado_idx on public.contrato_referidos (aliado_id, id desc);
comment on table public.contrato_referidos is '#76: FOTO de la atribución vigente al crearse el contrato (por contrato_uid). Un cambio posterior de asignación no la toca.';

do $$
declare t text;
begin
  foreach t in array array['referidores', 'referidor_codigos', 'aliado_referidores', 'contrato_referidos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to service_role', t);
    execute format('drop trigger if exists trg_auditoria on public.%I', t);
    execute format('create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_auditoria()', t);
  end loop;
end $$;
-- Solo las secuencias de ESTA migración (nunca las de otras tablas).
revoke all on sequence public.referidores_id_seq, public.aliado_referidores_id_seq, public.contrato_referidos_id_seq from public, anon, authenticated;

-- ── Ayudas privadas ───────────────────────────────────────────────────────
create function f341_priv.actor(p_actor uuid, p_roles text[]) returns public.usuarios
language plpgsql stable security definer set search_path = '' as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = p_actor;
  if not found or u.activo is not true or u.rol::text <> all (p_roles) then
    raise exception 'REF_ACTOR: no tienes permiso para esta operación.' using errcode = 'F4701';
  end if;
  return u;
end $$;

-- Alcance por agencia: superadmin y gerencia ven/gestionan las dos (igual que las comisiones, `puede_ver_tenant`); administración, solo la suya.
create function f341_priv.ve_tenant(u public.usuarios, t text) returns boolean
language sql immutable set search_path = '' as $$ select u.rol::text in ('superadmin', 'gerencia') or u.tenant = t $$;

create function f341_priv.asignar(u public.usuarios, p_aliado bigint, p_referidor bigint, p_pct numeric, p_origen text, p_codigo text, p_motivo text, p_reemplazar boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.referidores; act public.aliado_referidores; v_id bigint; v_pct numeric(5,4) := round(p_pct, 4); v_t timestamptz;
begin
  if v_pct is null or v_pct not in (0.01, 0.02) then raise exception 'REF_PCT: el porcentaje solo puede ser 1 %% o 2 %%.' using errcode = 'F4704'; end if;
  select * into r from public.referidores where id = p_referidor;
  if not found or r.activo is not true then raise exception 'REF_REFERIDOR: el referidor no existe o está inactivo.' using errcode = 'F4705'; end if;
  if not f341_priv.ve_tenant(u, r.tenant) then raise exception 'REF_ACTOR: no tienes permiso para esta operación.' using errcode = 'F4701'; end if;
  if not exists (select 1 from public.aliados where id = p_aliado) then raise exception 'REF_ALIADO: el aliado no existe.' using errcode = 'F4706'; end if;
  -- Serializa operaciones simultáneas sobre el MISMO aliado (el índice único parcial sigue siendo la garantía final).
  perform pg_advisory_xact_lock(341, p_aliado::integer);
  -- UN solo instante (tomado con el candado en la mano) cierra la vigente y abre la nueva: sin huecos ni solapes aunque dos operaciones compitan (`now()` es el inicio de la transacción y no sirve aquí).
  v_t := clock_timestamp();
  select * into act from public.aliado_referidores where aliado_id = p_aliado and tenant = r.tenant and vigente_hasta is null;
  if found then
    if act.referidor_id = p_referidor and act.pct = v_pct then
      return jsonb_build_object('estado', 'sin_cambio', 'asignacion_id', act.id);
    end if;
    if not p_reemplazar then
      return jsonb_build_object('estado', 'ya_asignado', 'asignacion_id', act.id);
    end if;
    update public.aliado_referidores set vigente_hasta = v_t, cerrado_por = u.id where id = act.id;
  end if;
  insert into public.aliado_referidores (aliado_id, referidor_id, tenant, pct, origen, codigo, motivo, asignado_por, vigente_desde)
  values (p_aliado, p_referidor, r.tenant, v_pct, p_origen, p_codigo, nullif(btrim(p_motivo), ''), u.id, v_t) returning id into v_id;
  return jsonb_build_object('estado', case when act.id is not null then 'cambiada' else 'asignada' end, 'asignacion_id', v_id);
end $$;

-- ── Escritura (solo service_role; el actor se re-verifica aquí) ───────────
create function public.referidor_guardar(p_actor uuid, p_id bigint, p_tenant text, p_nombre text, p_tipo_documento text, p_documento text, p_email text, p_telefono text, p_notas text, p_activo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.usuarios; v_id bigint; v_t text;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia']);
  if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then raise exception 'REF_AGENCIA: agencia no válida.' using errcode = 'F4702'; end if;
  if not f341_priv.ve_tenant(u, p_tenant) then raise exception 'REF_ACTOR: no tienes permiso para esta operación.' using errcode = 'F4701'; end if;
  begin
    if p_id is null then
      insert into public.referidores (tenant, nombre, tipo_documento, documento, email, telefono, notas, activo, creado_por)
      values (p_tenant, btrim(p_nombre), nullif(btrim(p_tipo_documento), ''), nullif(btrim(p_documento), ''), nullif(btrim(p_email), ''), nullif(btrim(p_telefono), ''), nullif(btrim(p_notas), ''), coalesce(p_activo, true), u.id)
      returning id into v_id;
    else
      select tenant into v_t from public.referidores where id = p_id for update;
      if not found then raise exception 'REF_REFERIDOR: el referidor no existe.' using errcode = 'F4705'; end if;
      if v_t <> p_tenant then raise exception 'REF_AGENCIA: un referidor no cambia de agencia.' using errcode = 'F4702'; end if;
      update public.referidores set nombre = btrim(p_nombre), tipo_documento = nullif(btrim(p_tipo_documento), ''), documento = nullif(btrim(p_documento), ''), email = nullif(btrim(p_email), ''),
             telefono = nullif(btrim(p_telefono), ''), notas = nullif(btrim(p_notas), ''), activo = coalesce(p_activo, activo), actualizado_en = now()
       where id = p_id;
      v_id := p_id;
    end if;
  exception when unique_violation then
    raise exception 'REF_DOCUMENTO_DUPLICADO: ya existe un referidor con ese documento en la agencia.' using errcode = 'F4703';
  when check_violation then
    raise exception 'REF_DATOS: revisa los datos del referidor (nombre de 3 a 120 caracteres; tipo y número de documento juntos).' using errcode = 'F4708';
  end;
  return jsonb_build_object('estado', case when p_id is null then 'creado' else 'actualizado' end, 'id', v_id);
end $$;

create function public.referidor_codigo_definir(p_actor uuid, p_referidor_id bigint, p_codigo text, p_pct numeric, p_activo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.usuarios; r public.referidores; v_cod text := upper(btrim(p_codigo)); v_pct numeric(5,4) := round(p_pct, 4); prev public.referidor_codigos;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia']);
  if v_pct is null or v_pct not in (0.01, 0.02) then raise exception 'REF_PCT: el porcentaje solo puede ser 1 %% o 2 %%.' using errcode = 'F4704'; end if;
  if v_cod is null or v_cod !~ '^[A-Z0-9][A-Z0-9-]{3,19}$' then raise exception 'REF_CODIGO_FORMATO: el código usa 4 a 20 letras, números o guiones.' using errcode = 'F4709'; end if;
  select * into r from public.referidores where id = p_referidor_id;
  if not found then raise exception 'REF_REFERIDOR: el referidor no existe o está inactivo.' using errcode = 'F4705'; end if;
  if not f341_priv.ve_tenant(u, r.tenant) then raise exception 'REF_ACTOR: no tienes permiso para esta operación.' using errcode = 'F4701'; end if;
  perform pg_advisory_xact_lock(342, hashtext(v_cod));
  select * into prev from public.referidor_codigos where codigo = v_cod;
  if found then
    if prev.referidor_id <> p_referidor_id then raise exception 'REF_CODIGO_EN_USO: ese código ya pertenece a otro referidor.' using errcode = 'F4710'; end if;
    update public.referidor_codigos set pct = v_pct, activo = coalesce(p_activo, activo) where codigo = v_cod;
    return jsonb_build_object('estado', 'actualizado', 'codigo', v_cod);
  end if;
  insert into public.referidor_codigos (codigo, referidor_id, pct, activo, creado_por) values (v_cod, p_referidor_id, v_pct, coalesce(p_activo, true), u.id);
  return jsonb_build_object('estado', 'creado', 'codigo', v_cod);
end $$;

create function public.referido_asignar(p_actor uuid, p_aliado_id bigint, p_referidor_id bigint, p_pct numeric, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.usuarios;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia']);
  return f341_priv.asignar(u, p_aliado_id, p_referidor_id, p_pct, 'manual', null, p_motivo, true);
end $$;

-- Ruta por CÓDIGO: la identidad y la tarifa salen de la regla guardada. SOLO superadmin y gerencia (decisión del dueño, 2026-11-24: administración consulta pero NO asigna ni cambia, tampoco por aprobación);
-- pueden reemplazar una asignación vigente (compras futuras). El código escrito en el registro público es un CANDIDATO que se confirma con referido_decidir_solicitud (migración 342).
create function public.referido_aplicar_codigo(p_actor uuid, p_aliado_id bigint, p_codigo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.usuarios; c public.referidor_codigos; r public.referidores;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia']);
  select * into c from public.referidor_codigos where codigo = upper(btrim(p_codigo)) and activo;
  if found then select * into r from public.referidores where id = c.referidor_id and activo; end if;
  -- Mensaje único: no distingue «no existe», «inactivo» u «otra agencia» (no se puede sondear qué códigos existen).
  if c.codigo is null or r.id is null or not f341_priv.ve_tenant(u, r.tenant) then
    raise exception 'REF_CODIGO_INVALIDO: el código de referido no es válido.' using errcode = 'F4707';
  end if;
  return f341_priv.asignar(u, p_aliado_id, c.referidor_id, c.pct, 'codigo', c.codigo, null, true);
end $$;

create function public.referido_quitar(p_actor uuid, p_aliado_id bigint, p_tenant text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.usuarios; act public.aliado_referidores;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia']);
  if p_tenant is null or p_tenant not in ('mayorista', 'minorista') or not f341_priv.ve_tenant(u, p_tenant) then raise exception 'REF_ACTOR: no tienes permiso para esta operación.' using errcode = 'F4701'; end if;
  perform pg_advisory_xact_lock(341, p_aliado_id::integer);
  select * into act from public.aliado_referidores where aliado_id = p_aliado_id and tenant = p_tenant and vigente_hasta is null;
  if not found then return jsonb_build_object('estado', 'sin_asignacion'); end if;
  update public.aliado_referidores set vigente_hasta = clock_timestamp(), cerrado_por = u.id, motivo = coalesce(nullif(btrim(p_motivo), ''), motivo) where id = act.id;
  return jsonb_build_object('estado', 'quitada', 'asignacion_id', act.id);
end $$;

-- ── Atribución al crear el contrato (trigger sobre ventas) ────────────────
-- Foto de lo vigente EN EL MOMENTO de crearse el contrato (`ventas.created_at`). Idempotente (un contrato, una atribución). Nunca bloquea la creación del contrato.
create function f341_priv.atribuir(p_uid uuid, p_numero text, p_tenant text, p_aliado bigint, p_usuario_b2b uuid, p_creado timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare v_aliado bigint := p_aliado; a public.aliado_referidores;
begin
  if v_aliado is null and p_usuario_b2b is not null then
    select aliado_id into v_aliado from public.usuarios where id = p_usuario_b2b;   -- id estable del portal B2B (nunca un nombre)
  end if;
  if v_aliado is null or p_uid is null then return; end if;
  -- La copia que crea renumerar un contrato (misma identidad, otro número) NO es una compra nueva: no se atribuye de nuevo.
  if exists (select 1 from public.ventas v2 where v2.contrato_uid = p_uid and v2.numero_contrato <> p_numero) then return; end if;
  select * into a from public.aliado_referidores
   where aliado_id = v_aliado and tenant = p_tenant and vigente_desde <= p_creado and (vigente_hasta is null or p_creado < vigente_hasta);
  if not found then return; end if;
  insert into public.contrato_referidos (contrato_uid, tenant, aliado_id, referidor_id, asignacion_id, pct, origen, codigo)
  values (p_uid, p_tenant, v_aliado, a.referidor_id, a.id, a.pct, a.origen, a.codigo)
  on conflict (contrato_uid) do nothing;
end $$;

create function f341_priv.trg_atribuir() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform f341_priv.atribuir(new.contrato_uid, new.numero_contrato, new.tenant, new.aliado_id, new.b2b_usuario_id, new.created_at);
  exception when others then
    -- La atribución es secundaria: jamás debe impedir crear o editar un contrato.
    raise warning '341: atribución de referido omitida para % (%).', new.numero_contrato, sqlstate;
  end;
  return null;
end $$;

create function f341_priv.trg_limpiar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- El contrato deja de existir (eliminar, revertir): su atribución se va con él. Renumerar copia la fila antes de borrar la vieja, así que allí la atribución se conserva.
  delete from public.contrato_referidos cr where cr.contrato_uid = old.contrato_uid and not exists (select 1 from public.ventas v where v.contrato_uid = old.contrato_uid);
  return null;
end $$;

create trigger trg_f341_atribuir_ins after insert on public.ventas for each row execute function f341_priv.trg_atribuir();
create trigger trg_f341_atribuir_upd after update of aliado_id, b2b_usuario_id on public.ventas for each row
  when (old.aliado_id is distinct from new.aliado_id or old.b2b_usuario_id is distinct from new.b2b_usuario_id) execute function f341_priv.trg_atribuir();
create trigger trg_f341_limpiar after delete on public.ventas for each row execute function f341_priv.trg_limpiar();

-- ── Lectura autorizada (CRM): referidor, aliado, porcentaje, contratos y elegibilidad ────────
-- BASE = EXACTAMENTE la base comisionable con la que se calculó la comisión del aliado (agencia/freelance) de ese contrato: la que quedó GUARDADA en su fila de `aliados_b2b` (`f341_priv.base_aliado`
-- es el espejo literal de la base que usa `comision_b2b_total`, 205). En un contrato NETO (`comision_estado = 'descontada'`) esa fila es la que nació «descontada en el precio» y conserva la base ORIGINAL
-- (antes de descontar la comisión para llegar al NETO): NUNCA se calcula desde lo cobrado en NETO ni desde el monto de la comisión del aliado. Si esa evidencia no existe o es ambigua NO se adivina ni se
-- muestra un cero calculado: el estado lo dice (`sin_evidencia_base`, `base_ambigua`) y el monto queda NULL. Un 0 solo aparece cuando la base guardada ES 0 (`sin_base`) o el contrato está cancelado.
-- Estados (derivados en cada lectura): `cancelado`; `sin_evidencia_base` (el contrato no tiene comisión del aliado guardada); `base_ambigua` (varias filas con bases distintas); `sin_base` (base guardada = 0);
-- `elegible` = contrato 100 % pagado según `contratos_pagados_completos` (307, ÚNICO criterio, sobre el total que el comprador debe pagar —en NETO, el total exigible—; un abono anulado lo devuelve a pendiente);
-- `pendiente_pago` en cualquier otro caso. Elegible NO es pago: no hay pagos automáticos.
create function f341_priv.base_aliado(a public.aliados_b2b) returns numeric
language sql immutable set search_path = '' as $$
  -- Espejo EXACTO de la base de public.comision_b2b_total (205): explícita → base_comision manda (NULL cae al PVP guardado); legado → base 0/NULL cae al PVP guardado.
  select case when a.base_explicita then coalesce(a.base_comision, coalesce(a.precio_venta, 0))
              else coalesce(nullif(a.base_comision, 0), coalesce(a.precio_venta, 0)) end
$$;

create function public.referidos_contratos(p_actor uuid, p_referidor_id bigint default null, p_aliado_id bigint default null, p_estado text default null, p_limite integer default 100, p_antes bigint default null)
returns table (id bigint, numero_contrato text, tenant text, referidor_id bigint, referidor_nombre text, aliado_id bigint, aliado_nombre text, pct numeric, origen text, codigo text,
               atribuido_en timestamptz, moneda text, base numeric, comision numeric, estado text, hay_mas boolean, neto boolean, comision_aliado_id bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare u public.usuarios; v_lim integer := least(greatest(coalesce(p_limite, 100), 1), 200);
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia', 'administracion']);
  return query
  with b as (
    select cr.id, v.numero_contrato, cr.tenant, cr.referidor_id, r.nombre as referidor_nombre, cr.aliado_id, a.nombre as aliado_nombre, cr.pct, cr.origen, cr.codigo, cr.atribuido_en,
           coalesce(v.moneda, 'COP') as moneda, v.estado as estado_contrato, v.comision_estado
      from public.contrato_referidos cr
      join public.ventas v on v.contrato_uid = cr.contrato_uid
      join public.referidores r on r.id = cr.referidor_id
      join public.aliados a on a.id = cr.aliado_id
     where f341_priv.ve_tenant(u, cr.tenant)
       and (p_referidor_id is null or cr.referidor_id = p_referidor_id)
       and (p_aliado_id is null or cr.aliado_id = p_aliado_id)
       and (p_antes is null or cr.id < p_antes)
     order by cr.id desc
     limit 5000
  ), ev as (
    -- Evidencia: la(s) fila(s) de comisión del aliado de ESE contrato y agencia, identificadas por el id guardado del aliado (`aliados_b2b.aliado_id` = el aliado atribuido). Una fila de otro aliado NO cuenta, y una fila SIN id
    -- (aliado_id NULL, p. ej. una comisión manual con beneficiario en texto libre) tampoco: no se infiere su dueño por nombre, contrato, unicidad ni monto. Sin fila identificada → `sin_evidencia_base`. En NETO solo vale la nacida «descontada en el precio»
    -- (una segunda fila B2B en un contrato NETO es una revisión manual y no es la base con la que se calculó el descuento).
    select b.id, count(x.id)::int as n, count(distinct f341_priv.base_aliado(x))::int as nb, min(x.id) as fila_id, min(f341_priv.base_aliado(x)) as base_ali
      from b
      left join public.aliados_b2b x on x.numero_contrato = b.numero_contrato and x.tenant = b.tenant and x.aliado_id = b.aliado_id
                                    and case when b.comision_estado = 'descontada' then public.comision_b2b_descontada(x)
                                           -- Una fila de SOLO recobro (198/267) no es la comisión ordinaria: no es la base que se busca.
                                           else not (coalesce(x.recobro_total, 0) > 0 and coalesce(x.pct_comision, 0) = 0 and coalesce(x.comision_valor, 0) = 0) end
     group by b.id
  ), pag as (
    select n from public.contratos_pagados_completos((select coalesce(array_agg(x.numero_contrato), '{}'::text[]) from b x)) n
  ), e as (
    select b.*, ev.n as n_filas, ev.nb as n_bases, ev.fila_id, ev.base_ali,
           case when b.estado_contrato = 'cancelado' then 'cancelado'
                when ev.n = 0 then 'sin_evidencia_base'
                when ev.nb > 1 then 'base_ambigua'
                when ev.base_ali <= 0 then 'sin_base'
                when pag.n is not null then 'elegible'
                else 'pendiente_pago' end as est
      from b join ev on ev.id = b.id left join pag on pag.n = b.numero_contrato
  ), f as (
    select e.*, row_number() over (order by e.id desc) as rn from e where p_estado is null or e.est = p_estado
  )
  select f.id, f.numero_contrato, f.tenant, f.referidor_id, f.referidor_nombre, f.aliado_id, f.aliado_nombre, f.pct, f.origen, f.codigo, f.atribuido_en, f.moneda,
         case when f.n_filas > 0 and f.n_bases = 1 then greatest(0, f.base_ali) else null end,
         case when f.est in ('elegible', 'pendiente_pago') then round(f.pct * f.base_ali, 2) when f.est in ('sin_base', 'cancelado') then 0::numeric else null end,
         f.est, exists (select 1 from f f2 where f2.rn > v_lim), (f.comision_estado is not distinct from 'descontada'), case when f.n_filas > 0 then f.fila_id else null end
    from f where f.rn <= v_lim order by f.id desc;
end $$;

-- Catálogo para la pantalla: referidores (con sus códigos) y asignaciones vigentes + las últimas cerradas.
create function public.referidos_catalogo(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare u public.usuarios;
begin
  u := f341_priv.actor(p_actor, array['superadmin', 'gerencia', 'administracion']);
  return jsonb_build_object(
    'referidores', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'tenant', r.tenant, 'nombre', r.nombre, 'tipo_documento', r.tipo_documento, 'documento', r.documento, 'email', r.email,
        'telefono', r.telefono, 'notas', r.notas, 'activo', r.activo,
        'codigos', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'pct', c.pct, 'activo', c.activo) order by c.codigo) from public.referidor_codigos c where c.referidor_id = r.id), '[]'::jsonb),
        'aliados_vigentes', (select count(*) from public.aliado_referidores x where x.referidor_id = r.id and x.vigente_hasta is null)) order by r.nombre)
        from public.referidores r where f341_priv.ve_tenant(u, r.tenant)), '[]'::jsonb),
    'asignaciones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'aliado_id', z.aliado_id, 'aliado_nombre', z.aliado_nombre, 'referidor_id', z.referidor_id, 'referidor_nombre', z.referidor_nombre,
        'tenant', z.tenant, 'pct', z.pct, 'origen', z.origen, 'codigo', z.codigo, 'vigente_desde', z.vigente_desde, 'vigente_hasta', z.vigente_hasta) order by z.vigente_hasta is not null, z.id desc)
        from (select x.*, a.nombre as aliado_nombre, r.nombre as referidor_nombre,
                     row_number() over (partition by (x.vigente_hasta is null) order by x.id desc) as rn
                from public.aliado_referidores x join public.aliados a on a.id = x.aliado_id join public.referidores r on r.id = x.referidor_id
               where f341_priv.ve_tenant(u, x.tenant)) z
       where z.vigente_hasta is null or z.rn <= 100), '[]'::jsonb));
end $$;

-- ── Permisos de ejecución: solo service_role ──────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.referidor_guardar(uuid,bigint,text,text,text,text,text,text,text,boolean)',
    'public.referidor_codigo_definir(uuid,bigint,text,numeric,boolean)',
    'public.referido_asignar(uuid,bigint,bigint,numeric,text)',
    'public.referido_aplicar_codigo(uuid,bigint,text)',
    'public.referido_quitar(uuid,bigint,text,text)',
    'public.referidos_contratos(uuid,bigint,bigint,text,integer,bigint)',
    'public.referidos_catalogo(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on all functions in schema f341_priv from public, anon, authenticated;
