-- ───────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN 219 · Personas de cotizaciones en el CRM (#42)
--
-- Número reservado por el Coordinador (WORKSTREAMS.md, reserva #42 del 2026-10-19; GO solo
-- local). Contrato: docs/coordinacion/auditorias-identidad-crm.md, "Contrato de escritura #42
-- sobre la 214" (C1-C8), con las decisiones del dueño D-3=N2, D-4, D-5 y D-6.
-- Scripts: supabase/scripts/{preflight,postcheck,rollback,test}_219_personas_cotizaciones.*
--
-- QUÉ HACE
--   · Fuente nueva `cotizacion` en `persona_capturas`, con origen tipado (cotizacion_id,
--     participante_ref, rol) y nivel `pasajero_cotizacion` para pasajeros (N2); el titular es
--     `comercial`. CHECK de tres disyuntos: las fuentes de la 214 NO admiten columnas de
--     cotización y `cotizacion` las exige.
--   · `public.cotizacion_participantes`: el PUESTO (titular o pasajero) de una cotización. Su
--     `id` es el `participante_ref`, inmutable; apunta a la captura VIGENTE de ese puesto con
--     una FK compuesta que solo admite capturas de ESTE puesto, cotización, tenant y persona.
--     Un solo titular activo por cotización. Sin borrado. Sin trg_auditoria (regla de la 214).
--   · Generaliza en `p214_priv` (DROP y CREATE en esta misma transacción, parámetros nuevos con
--     default nulo y comportamiento de V1 idéntico): validar_entrada_captura, captura_coincide y
--     upsert_persona. `promover_persona` NO se toca: como no tiene parámetros de cotización,
--     `validar_entrada_captura` le rechaza la fuente `cotizacion` (origen_invalido).
--   · Reemplaza `p214_priv.captura_visible` (firma nueva con captura, nivel, cotización y actor)
--     y re-crea `public.buscar_personas_documento` con la MISMA firma para usarla: un solo filtro.
--   · Fachadas de escritura (SECURITY DEFINER, EXECUTE solo service_role):
--       registrar_personas_cotizacion · actualizar_titular_cotizacion · sellar_creador_cotizacion
--     y la lectura del CRM `crm_personas_cotizacion_buscar` (EXECUTE solo authenticated).
--   · Foto de las definiciones 214 que cambia (p214_priv.r219_foto_214), para que el rollback
--     las restaure EXACTAS y lo compruebe.
--
-- QUÉ NO HACE
--   · No toca 154, 187, 188, 198, 202, 207, 211, 216 ni 217, ni los disparadores de
--     `cotizaciones`, ni `crear_cotizacion_manual` (su sello `creado_por_id` es de #39 y se
--     consume tal cual). El sello NUEVO de Reservar/checkout con sesión es
--     `sellar_creador_cotizacion`; anónimos e históricos quedan con creado_por_id NULL.
--   · No crea esquema nuevo (reutiliza p214_priv: nada nuevo que vigilar en Exposed schemas).
--   · No hace backfill: las cotizaciones existentes no ganan puestos.
--   · No depende de la 218 (reservada a #56).
--
-- ORDEN (todo lo remoto lo ejecuta el usuario, con autorización separada)
--   1. preflight_219_personas_cotizaciones.sql — solo lectura; con el MISMO rol que aplicará esto.
--   2. esta migración.        3. postcheck_219_personas_cotizaciones.sql — solo lectura.
-- Idempotente: re-ejecutarla no duplica objetos ni cambia datos.
-- Rollback (solo sin capturas de cotización ni puestos): rollback_219_personas_cotizaciones.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

-- 0) Guardas.
do $$
declare
  v_falta text;
  v_v1 boolean;
  v_219 boolean;
begin
  if to_regclass('public.personas') is null or to_regclass('public.persona_capturas') is null
     or to_regclass('public.persona_observaciones') is null or to_regnamespace('p214_priv') is null
     or to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') is null then
    raise exception '219 ABORTADA: falta la 214 (registro central de personas).';
  end if;
  if to_regclass('public.cotizaciones') is null or to_regclass('public.usuarios') is null
     or to_regclass('public.uq_cotizaciones_id_tenant') is null then
    raise exception '219 ABORTADA: faltan public.cotizaciones, public.usuarios o el índice uq_cotizaciones_id_tenant (211).';
  end if;
  if to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)') is null then
    raise exception '219 ABORTADA: falta crear_cotizacion_manual (216), dueña del sello manual de creado_por_id.';
  end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('public.soy_ese_asesor(text)') is null then
    raise exception '219 ABORTADA: faltan auth.uid() o public.soy_ese_asesor(text).';
  end if;
  select string_agg(c, ', ') into v_falta
    from unnest(array['cotizaciones.id', 'cotizaciones.tenant', 'cotizaciones.estado', 'cotizaciones.tipo',
                      'cotizaciones.modo', 'cotizaciones.payload', 'cotizaciones.detalle', 'cotizaciones.codigo',
                      'cotizaciones.created_at', 'cotizaciones.creado_por', 'cotizaciones.creado_por_id',
                      'cotizaciones.propietario_id', 'cotizaciones.aliado_id', 'cotizaciones.cotizacion_origen_id',
                      'cotizaciones.cliente', 'cotizaciones.cliente_documento',
                      'usuarios.id', 'usuarios.rol', 'usuarios.activo', 'usuarios.tenant', 'usuarios.email']) c
   where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.' || split_part(c, '.', 1))
                        and a.attname = split_part(c, '.', 2) and a.attnum > 0 and not a.attisdropped);
  if v_falta is not null then
    raise exception '219 ABORTADA: faltan columnas: %', v_falta;
  end if;
  select string_agg(r, ', ') into v_falta
    from unnest(array['anon', 'authenticated', 'service_role']) r
   where not exists (select 1 from pg_roles where rolname = r);
  if v_falta is not null then
    raise exception '219 ABORTADA: faltan los roles: %', v_falta;
  end if;
  -- Las fachadas son SECURITY DEFINER y leen usuarios/cotizaciones/ventas como su dueño.
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolbypassrls))
     and ((select pg_get_userbyid(relowner) from pg_class where oid = 'public.usuarios'::regclass) <> current_user
          or (select pg_get_userbyid(relowner) from pg_class where oid = 'public.cotizaciones'::regclass) <> current_user) then
    raise exception '219 ABORTADA: el rol % no puede leer usuarios y cotizaciones sin RLS (ni BYPASSRLS ni dueño).', current_user;
  end if;
  -- Estado de partida: o la 214 tal cual (V1), o la 219 ya aplicada. Nada intermedio.
  v_v1 := to_regprocedure('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text)') is not null
          and to_regprocedure('p214_priv.captura_visible(text,text,text,text,text)') is not null
          and not exists (select 1 from pg_catalog.pg_attribute a
                           where a.attrelid = 'public.persona_capturas'::regclass and a.attname = 'cotizacion_id'
                             and a.attnum > 0 and not a.attisdropped);
  v_219 := to_regprocedure('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text,bigint,uuid,text)') is not null
           and to_regclass('public.cotizacion_participantes') is not null
           and to_regclass('p214_priv.r219_foto_214') is not null;
  if not v_v1 and not v_219 then
    raise exception '219 ABORTADA: el registro de personas no está ni en la forma de la 214 ni en la de la 219 (estado intermedio o ajeno).';
  end if;
  if v_v1 and (select count(*) from pg_constraint
                where conrelid = 'public.persona_capturas'::regclass
                  and conname in ('persona_capturas_fuente_check', 'persona_capturas_nivel_check',
                                  'persona_capturas_fuente_ck', 'persona_capturas_nivel_ck')) <> 4 then
    raise exception '219 ABORTADA: persona_capturas no tiene las cuatro restricciones de fuente/nivel con los nombres de la 214.';
  end if;
  if v_v1 and exists (select 1 from public.persona_capturas c where c.fuente not in ('captura_interna', 'contrato_pasajero')) then
    raise exception '219 ABORTADA: hay capturas con una fuente que la 214 no admite.';
  end if;
end $$;

-- 1) Foto de lo que la 219 cambia de la 214 (solo la primera vez; el rollback la usa).
create table if not exists p214_priv.r219_foto_214 (
  objeto      text primary key,
  tipo        text not null check (tipo in ('funcion', 'restriccion')),
  definicion  text not null,
  huella      text not null,
  acl         text null,
  tomada_en   timestamptz not null default now()
);
comment on table p214_priv.r219_foto_214 is
  '219 (#42): definiciones EXACTAS de la 214 que la 219 reemplaza (pg_get_functiondef / pg_get_constraintdef) y su ACL. Las usa rollback_219 para restaurarlas y comprobarlas. Sin datos personales.';
alter table p214_priv.r219_foto_214 enable row level security;
revoke all on table p214_priv.r219_foto_214 from public, anon, authenticated, service_role;

do $$
declare
  f text;
begin
  if to_regprocedure('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text)') is null then
    return; -- ya en la forma 219: la foto se tomó en la primera aplicación
  end if;
  foreach f in array array[
    'p214_priv.validar_entrada_captura(uuid,text,text,text,text,text,bigint)',
    'p214_priv.captura_coincide(uuid,uuid,text,text,text,text,text,text,bigint,jsonb)',
    'p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text)',
    'p214_priv.captura_visible(text,text,text,text,text)',
    'public.buscar_personas_documento(text,text,text,integer,integer)'] loop
    insert into p214_priv.r219_foto_214 (objeto, tipo, definicion, huella, acl)
    select f, 'funcion', pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid)), p.proacl::text
      from pg_proc p where p.oid = to_regprocedure(f)
    on conflict (objeto) do nothing;
  end loop;
  insert into p214_priv.r219_foto_214 (objeto, tipo, definicion, huella, acl)
  select c.conname, 'restriccion', pg_get_constraintdef(c.oid), md5(pg_get_constraintdef(c.oid)), null
    from pg_constraint c
   where c.conrelid = 'public.persona_capturas'::regclass
     and c.conname in ('persona_capturas_fuente_check', 'persona_capturas_nivel_check',
                       'persona_capturas_fuente_ck', 'persona_capturas_nivel_ck')
  on conflict (objeto) do nothing;
  if (select count(*) from p214_priv.r219_foto_214) <> 9 then
    raise exception '219 ABORTADA: la foto de la 214 quedó incompleta (% de 9).', (select count(*) from p214_priv.r219_foto_214);
  end if;
end $$;

-- 2) Origen tipado de la fuente `cotizacion` en persona_capturas (C1).
alter table public.persona_capturas
  add column if not exists cotizacion_id bigint null,
  add column if not exists participante_ref uuid null,
  add column if not exists rol text null;

comment on column public.persona_capturas.cotizacion_id is
  '219 (#42): cotización de origen de una captura `cotizacion` (sin FK: procedencia append-only). NULL en las demás fuentes.';
comment on column public.persona_capturas.participante_ref is
  '219 (#42): puesto (cotizacion_participantes.id) al que pertenece la captura. Nunca índice, orden ni documento.';
comment on column public.persona_capturas.rol is
  '219 (#42): titular | pasajero, solo en capturas `cotizacion`.';

alter table public.persona_capturas
  drop constraint if exists persona_capturas_fuente_check,
  drop constraint if exists persona_capturas_nivel_check,
  drop constraint if exists persona_capturas_fuente_ck,
  drop constraint if exists persona_capturas_nivel_ck,
  add constraint persona_capturas_fuente_check
    check (fuente in ('captura_interna', 'contrato_pasajero', 'cotizacion')),
  add constraint persona_capturas_nivel_check
    check (nivel in ('comercial', 'pasajero_contrato', 'pasajero_cotizacion')),
  add constraint persona_capturas_fuente_ck check (
       (fuente = 'captura_interna'   and contrato_numero is null     and contrato_pasajero_id is null
                                     and cotizacion_id is null and participante_ref is null and rol is null)
    or (fuente = 'contrato_pasajero' and contrato_numero is not null and contrato_pasajero_id is not null
                                     and cotizacion_id is null and participante_ref is null and rol is null)
    or (fuente = 'cotizacion'        and contrato_numero is null     and contrato_pasajero_id is null
                                     and cotizacion_id is not null and participante_ref is not null
                                     and rol is not null and rol in ('titular', 'pasajero'))),
  add constraint persona_capturas_nivel_ck check (
       (fuente = 'captura_interna'   and nivel = 'comercial')
    or (fuente = 'contrato_pasajero' and nivel = 'pasajero_contrato')
    or (fuente = 'cotizacion' and rol is not null
        and ((rol = 'titular' and nivel = 'comercial') or (rol = 'pasajero' and nivel = 'pasajero_cotizacion'))));

-- Destino de la FK compuesta del vínculo (el id ya es único: esto solo lo hace referenciable).
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.persona_capturas'::regclass and conname = 'persona_capturas_puesto_uk') then
    alter table public.persona_capturas
      add constraint persona_capturas_puesto_uk unique (id, persona_id, tenant, cotizacion_id, participante_ref, rol);
  end if;
end $$;

create index if not exists idx_persona_capturas_cotizacion
  on public.persona_capturas (cotizacion_id, participante_ref)
  where cotizacion_id is not null;

-- 3) Vínculo cotización - persona - rol (C3).
create table if not exists public.cotizacion_participantes (
  id            uuid primary key,
  cotizacion_id bigint not null,
  tenant        text not null check (tenant in ('mayorista', 'minorista')),
  rol           text not null check (rol in ('titular', 'pasajero')),
  orden         smallint null check (orden is null or orden between 0 and 999),
  persona_id    uuid not null,
  captura_id    uuid not null,
  activo        boolean not null default true,
  retirado_en   timestamptz null,
  retirado_por  uuid null,
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint cotizacion_participantes_cotizacion_fk
    foreign key (cotizacion_id, tenant) references public.cotizaciones (id, tenant) on delete restrict,
  constraint cotizacion_participantes_captura_fk
    foreign key (captura_id, persona_id, tenant, cotizacion_id, id, rol)
    references public.persona_capturas (id, persona_id, tenant, cotizacion_id, participante_ref, rol),
  constraint cotizacion_participantes_retiro_ck check (
       (activo and retirado_en is null and retirado_por is null)
    or (not activo and retirado_en is not null))
);

comment on table public.cotizacion_participantes is
  '219 (#42): puesto (titular/pasajero) de una cotización y su captura VIGENTE. id = participante_ref, inmutable. Sin borrado; la traza son las capturas append-only por participante_ref más version/retirado_*. NO adjuntar trg_auditoria (087): copiaría PII a auditoria sin el filtro de la consulta.';

create unique index if not exists uq_cotizacion_participantes_titular_activo
  on public.cotizacion_participantes (cotizacion_id)
  where rol = 'titular' and activo;
create index if not exists idx_cotizacion_participantes_cotizacion
  on public.cotizacion_participantes (cotizacion_id, rol);
create index if not exists idx_cotizacion_participantes_captura
  on public.cotizacion_participantes (captura_id);

create or replace function p214_priv.trg_participante_guardas()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.cotizacion_id is distinct from old.cotizacion_id
     or new.tenant is distinct from old.tenant or new.rol is distinct from old.rol
     or new.created_at is distinct from old.created_at then
    raise exception 'cotizacion_participantes: id, cotización, tenant y rol no se cambian' using errcode = '23514';
  end if;
  if new.version is distinct from old.version then
    raise exception 'cotizacion_participantes: la versión la sube el sistema' using errcode = '23514';
  end if;
  if old.activo is false and new.activo is true then
    raise exception 'cotizacion_participantes: un puesto retirado no se reactiva' using errcode = '23514';
  end if;
  if (new.captura_id, new.persona_id, new.activo, new.retirado_en, new.retirado_por, new.orden)
     is distinct from (old.captura_id, old.persona_id, old.activo, old.retirado_en, old.retirado_por, old.orden) then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create or replace function p214_priv.trg_participante_sin_borrado()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'cotizacion_participantes: un puesto no se borra (% bloqueado)', tg_op using errcode = '23514';
end;
$$;

drop trigger if exists trg_cotizacion_participantes_guardas on public.cotizacion_participantes;
create trigger trg_cotizacion_participantes_guardas
  before insert or update on public.cotizacion_participantes
  for each row execute function p214_priv.trg_participante_guardas();

drop trigger if exists trg_cotizacion_participantes_sin_borrado on public.cotizacion_participantes;
create trigger trg_cotizacion_participantes_sin_borrado
  before delete on public.cotizacion_participantes
  for each row execute function p214_priv.trg_participante_sin_borrado();

drop trigger if exists trg_cotizacion_participantes_sin_truncate on public.cotizacion_participantes;
create trigger trg_cotizacion_participantes_sin_truncate
  before truncate on public.cotizacion_participantes
  for each statement execute function p214_priv.trg_participante_sin_borrado();

-- 4) Escritores de la 214 generalizados (C8 punto 3). Mismos errores y resultados en V1.
drop function if exists p214_priv.validar_entrada_captura(uuid, text, text, text, text, text, bigint);
create or replace function p214_priv.validar_entrada_captura(
  p_captura_id uuid,
  p_tenant text,
  p_fuente text,
  p_tipo text,
  p_numero text,
  p_contrato_numero text,
  p_contrato_pasajero_id bigint,
  p_cotizacion_id bigint default null,
  p_participante_ref uuid default null,
  p_rol text default null)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_captura_id is null then
    raise exception 'captura_id_obligatorio' using errcode = '22023';
  end if;
  if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
    raise exception 'tenant_invalido' using errcode = '22023';
  end if;
  if p_fuente is null or p_fuente not in ('captura_interna', 'contrato_pasajero', 'cotizacion') then
    raise exception 'fuente_invalida' using errcode = '22023';
  end if;
  if (p_tipo is not null and char_length(p_tipo) > 64) or (p_numero is not null and char_length(p_numero) > 64) then
    raise exception 'original_demasiado_largo' using errcode = '22023',
      detail = 'Un original admite hasta 64 puntos de código; no se trunca.';
  end if;
  if (p_fuente = 'captura_interna'
      and (p_contrato_numero is not null or p_contrato_pasajero_id is not null
           or p_cotizacion_id is not null or p_participante_ref is not null or p_rol is not null))
     or (p_fuente = 'contrato_pasajero'
      and (p_contrato_numero is null or p_contrato_pasajero_id is null
           or p_cotizacion_id is not null or p_participante_ref is not null or p_rol is not null))
     or (p_fuente = 'cotizacion'
      and (p_contrato_numero is not null or p_contrato_pasajero_id is not null
           or p_cotizacion_id is null or p_participante_ref is null or p_rol is null
           or p_rol not in ('titular', 'pasajero'))) then
    raise exception 'origen_invalido' using errcode = '22023',
      detail = 'captura_interna no lleva contrato ni cotización; contrato_pasajero exige contrato y pasajero; cotizacion exige cotización, puesto y rol.';
  end if;
end;
$$;

drop function if exists p214_priv.captura_coincide(uuid, uuid, text, text, text, text, text, text, bigint, jsonb);
create or replace function p214_priv.captura_coincide(
  p_captura_id uuid,
  p_persona_id uuid,
  p_tenant text,
  p_fuente text,
  p_nivel text,
  p_tipo text,
  p_numero text,
  p_contrato_numero text,
  p_contrato_pasajero_id bigint,
  p_esperadas jsonb,
  p_cotizacion_id bigint default null,
  p_participante_ref uuid default null,
  p_rol text default null)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce((
    select (p_persona_id is null or c.persona_id = p_persona_id)
       and c.tenant = p_tenant
       and c.fuente = p_fuente
       and c.nivel = p_nivel
       and c.tipo_doc_capturado is not distinct from p_tipo
       and c.documento_capturado is not distinct from p_numero
       and c.contrato_numero is not distinct from p_contrato_numero
       and c.contrato_pasajero_id is not distinct from p_contrato_pasajero_id
       and c.cotizacion_id is not distinct from p_cotizacion_id
       and c.participante_ref is not distinct from p_participante_ref
       and c.rol is not distinct from p_rol
       and (select coalesce(jsonb_agg(jsonb_build_array(o.campo, o.valor) order by o.campo collate "C", o.valor collate "C"), '[]'::jsonb)
              from public.persona_observaciones o
             where o.captura_id = c.id) = p_esperadas
      from public.persona_capturas c
     where c.id = p_captura_id), false)
$$;

drop function if exists p214_priv.upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text);
create or replace function p214_priv.upsert_persona(
  p_captura_id uuid,
  p_tenant text,
  p_fuente text,
  p_tipo text,
  p_numero text,
  p_nit_dv text default null,
  p_observaciones jsonb default '[]'::jsonb,
  p_contrato_numero text default null,
  p_contrato_pasajero_id bigint default null,
  p_actor_id uuid default null,
  p_actor_rol text default null,
  p_cotizacion_id bigint default null,
  p_participante_ref uuid default null,
  p_rol text default null,
  out persona_id uuid,
  out resultado text)
language plpgsql
volatile
set search_path = pg_catalog, pg_temp
as $$
declare
  v_marca boolean;
  v_norm record;
  v_nivel text;
  v_obs jsonb;
  v_dv text;
  v_esperadas jsonb;
  v_cap record;
  v_cap_id uuid;
  v_ficha record;
  v_persona uuid;
  v_resultado text;
  v_intento integer;
begin
  perform p214_priv.exigir_read_committed();
  perform p214_priv.validar_entrada_captura(p_captura_id, p_tenant, p_fuente, p_tipo, p_numero,
                                            p_contrato_numero, p_contrato_pasajero_id,
                                            p_cotizacion_id, p_participante_ref, p_rol);
  -- La fuente `cotizacion` solo entra por las fachadas de la 219 (que corren como su dueño):
  -- nunca directo desde un rol de la API, aunque sea service_role.
  if p_fuente = 'cotizacion' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      raise exception 'fuente_solo_por_fachada' using errcode = '42501',
        detail = 'Las capturas de cotización se registran con registrar_personas_cotizacion / actualizar_titular_cotizacion.';
    end if;
    if not exists (select 1 from public.cotizaciones q where q.id = p_cotizacion_id and q.tenant = p_tenant) then
      raise exception 'cotizacion_inexistente' using errcode = '22023';
    end if;
  end if;
  v_obs := p214_priv.observaciones_de_entrada(p_observaciones);
  v_marca := p214_priv.marca_nit(p_tipo, p_numero, p_nit_dv);
  v_dv := case when v_marca then btrim(p_nit_dv, ' ') end;
  v_nivel := case when p_fuente = 'contrato_pasajero' then 'pasajero_contrato'
                  when p_fuente = 'cotizacion' and p_rol = 'pasajero' then 'pasajero_cotizacion'
                  else 'comercial' end;
  v_esperadas := p214_priv.carga_esperada(v_obs, v_dv);

  -- Reintento del MISMO evento: la captura ya existe. Misma carga = mismo resultado, sin escribir.
  select c.* into v_cap from public.persona_capturas c where c.id = p_captura_id;
  if found then
    if p214_priv.captura_coincide(p_captura_id, null, p_tenant, p_fuente, v_nivel, p_tipo, p_numero,
                                  p_contrato_numero, p_contrato_pasajero_id, v_esperadas,
                                  p_cotizacion_id, p_participante_ref, p_rol) then
      persona_id := v_cap.persona_id;
      resultado := 'reintento';
      return;
    end if;
    raise exception 'captura_inconsistente' using errcode = 'P0001',
      detail = 'Ese id de captura ya existe con otro contenido; no se sobrescribe ni se mezcla.';
  end if;

  select n.* into v_norm from p214_priv.norm_documento(p_tipo, p_numero, v_marca, 'alta') n;

  v_persona := null;
  for v_intento in 1..2 loop
    if v_norm.estado = 'documentada' then
      insert into public.personas as p (tenant, tipo_doc_original, documento_original, nit_dv_estructurado)
      values (p_tenant, p_tipo, p_numero, v_marca)
      on conflict (tenant, tipo_doc, numero_norm) where estado_doc = 'documentada' do nothing
      returning p.id into v_persona;
      if v_persona is not null then
        v_resultado := 'creada';
        exit;
      end if;
      -- Conflicto contra una fila ya confirmada: relectura en una sentencia nueva (READ COMMITTED).
      select p.id into v_persona
        from public.personas p
       where p.tenant = p_tenant and p.estado_doc = 'documentada'
         and p.tipo_doc = v_norm.tipo_doc and p.numero_norm = v_norm.numero_norm;
      if v_persona is not null then
        v_resultado := 'existente';
        exit;
      end if;
    else
      insert into public.personas as p (tenant, tipo_doc_original, documento_original, nit_dv_estructurado, clave_alta)
      values (p_tenant, p_tipo, p_numero, v_marca, p_captura_id)
      on conflict (tenant, clave_alta) where clave_alta is not null do nothing
      returning p.id into v_persona;
      if v_persona is not null then
        v_resultado := 'creada';
        exit;
      end if;
      select p.id, p.tipo_doc_original, p.documento_original, p.nit_dv_estructurado into v_ficha
        from public.personas p
       where p.tenant = p_tenant and p.clave_alta = p_captura_id;
      if found then
        if v_ficha.tipo_doc_original is not distinct from p_tipo
           and v_ficha.documento_original is not distinct from p_numero
           and v_ficha.nit_dv_estructurado = v_marca then
          v_persona := v_ficha.id;
          v_resultado := 'existente';
          exit;
        end if;
        raise exception 'clave_alta_reutilizada' using errcode = 'P0001',
          detail = 'Esa clave de alta ya creó una ficha con otros originales; no se sobrescribe.';
      end if;
    end if;
  end loop;
  if v_persona is null then
    raise exception 'alta_inconsistente' using errcode = 'P0001',
      detail = 'La relectura no encontró la ficha en conflicto; no se dio nada por creado.';
  end if;

  insert into public.persona_capturas as c (id, persona_id, tenant, fuente, nivel, tipo_doc_capturado,
                                            documento_capturado, contrato_numero, contrato_pasajero_id,
                                            actor_id, actor_rol, cotizacion_id, participante_ref, rol)
  values (p_captura_id, v_persona, p_tenant, p_fuente, v_nivel, p_tipo, p_numero, p_contrato_numero,
          p_contrato_pasajero_id, p_actor_id, p_actor_rol, p_cotizacion_id, p_participante_ref, p_rol)
  on conflict (id) do nothing
  returning c.id into v_cap_id;
  if v_cap_id is null then
    -- Otra transacción registró el MISMO evento y ya confirmó (este INSERT la esperó).
    if p214_priv.captura_coincide(p_captura_id, v_persona, p_tenant, p_fuente, v_nivel, p_tipo, p_numero,
                                  p_contrato_numero, p_contrato_pasajero_id, v_esperadas,
                                  p_cotizacion_id, p_participante_ref, p_rol) then
      persona_id := v_persona;
      resultado := 'reintento';
      return;
    end if;
    raise exception 'captura_inconsistente' using errcode = 'P0001',
      detail = 'Ese id de captura se registró a la vez con otro contenido.';
  end if;

  insert into public.persona_observaciones (captura_id, persona_id, tenant, campo, valor)
  select p_captura_id, v_persona, p_tenant, e.value ->> 0, e.value ->> 1
    from jsonb_array_elements(v_esperadas) e
  on conflict (captura_id, campo, valor) do nothing;

  persona_id := v_persona;
  resultado := v_resultado;
end;
$$;

comment on function p214_priv.upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text, bigint, uuid, text) is
  '214 generalizada por la 219: alta idempotente por id de captura (READ COMMITTED). Fuentes captura_interna | contrato_pasajero | cotizacion (esta última solo desde las fachadas de la 219). Resultado: creada | existente | reintento.';

-- 5) Visibilidad: UNA sola función para todas las lecturas (C6).
drop function if exists p214_priv.captura_visible(text, text, text, text, text);
create or replace function p214_priv.captura_visible(
  p_captura_id uuid,
  p_captura_tenant text,
  p_fuente text,
  p_nivel text,
  p_contrato_numero text,
  p_cotizacion_id bigint,
  p_t_aut text,
  p_rol text,
  p_actor uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    p_captura_tenant = p_t_aut
    and case p_fuente
          when 'captura_interna' then p_rol in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta')
          when 'contrato_pasajero' then p_rol in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta')
            and exists (
              select 1
                from public.ventas v
               where v.numero_contrato = p_contrato_numero
                 and v.tenant = p_captura_tenant
                 and v.tenant = p_t_aut
                 and (p_rol <> 'venta' or public.soy_ese_asesor(v.asesor)))
          when 'cotizacion' then exists (
              -- Solo la captura VIGENTE de un puesto: una corrección deja de mostrar la anterior.
              select 1
                from public.cotizacion_participantes cp
                join public.cotizaciones q on q.id = cp.cotizacion_id and q.tenant = cp.tenant
               where cp.captura_id = p_captura_id
                 and cp.cotizacion_id = p_cotizacion_id
                 and cp.tenant = p_captura_tenant
                 and q.tenant = p_t_aut
                 and case
                       when p_rol in ('superadmin', 'gerencia', 'administracion', 'operaciones') then true
                       when p_rol = 'venta' then p_nivel = 'comercial' or q.creado_por_id = p_actor
                       when p_rol in ('agencia', 'freelance') then cp.activo and q.creado_por_id = p_actor
                       else false
                     end)
          else false
        end, false)
$$;

comment on function p214_priv.captura_visible(uuid, text, text, text, text, bigint, text, text, uuid) is
  '219: único filtro de visibilidad de una captura. captura_interna/contrato_pasajero igual que la 214 (solo internos); cotizacion: captura vigente de un puesto del tenant autorizado; venta ve lo comercial del tenant y lo restringido solo en cotizaciones propias (D-3=N2); agencia/freelance solo puestos activos de cotizaciones creadas por su usuario (D-4).';

-- 6) Consulta exacta de la 214 re-creada con la MISMA firma para usar el filtro nuevo.
create or replace function public.buscar_personas_documento(
  p_tenant text,
  p_tipo_doc text,
  p_numero text,
  p_limite integer default 20,
  p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  c_vacio constant jsonb := jsonb_build_object(
    'persona', null, 'observaciones', '[]'::jsonb, 'total', 0,
    'has_more', false, 'divergencia', false, 'variantes', '[]'::jsonb);
  v_uid uuid;
  v_rol text;
  v_tenant_usuario text;
  v_t_aut text;
  v_norm record;
  v_persona record;
  v_total integer;
  v_filas integer;
  v_pagina jsonb;
  v_variantes jsonb;
  v_divergencia boolean;
begin
  -- 0. Parámetros: el error depende solo de ellos, no de los datos.
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'limite_invalido' using errcode = '22023', detail = 'p_limite debe estar entre 1 y 50.';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'offset_invalido' using errcode = '22023', detail = 'p_offset debe ser 0 o mayor.';
  end if;

  -- 1. Actor activo, rol y tenant, leídos de `usuarios` dentro de la función. B2B sigue fuera.
  v_uid := auth.uid();
  if v_uid is null then
    return c_vacio;
  end if;
  select u.rol::text, u.tenant into v_rol, v_tenant_usuario
    from public.usuarios u
   where u.id = v_uid and u.activo is true;
  if not found
     or v_rol is null or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta')
     or v_tenant_usuario is null or v_tenant_usuario not in ('mayorista', 'minorista') then
    return c_vacio;
  end if;
  if v_rol in ('superadmin', 'gerencia') then
    if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
      return c_vacio;
    end if;
    v_t_aut := p_tenant;
  else
    if p_tenant is not null and p_tenant <> v_tenant_usuario then
      return c_vacio;
    end if;
    v_t_aut := v_tenant_usuario;
  end if;

  -- 2. Clave de consulta (misma gramática, sin DV).
  if (p_tipo_doc is not null and char_length(p_tipo_doc) > 64)
     or (p_numero is not null and char_length(p_numero) > 64) then
    return c_vacio || jsonb_build_object('error', 'formato_no_admitido');
  end if;
  select n.* into v_norm from p214_priv.norm_documento(p_tipo_doc, p_numero, null, 'consulta') n;
  if v_norm.estado is distinct from 'documentada' then
    return c_vacio || jsonb_build_object('error', 'formato_no_admitido');
  end if;

  -- 3. Candidata: como mucho una documentada con esa clave en el tenant autorizado.
  select p.id, p.tenant, p.tipo_doc, p.numero_norm into v_persona
    from public.personas p
   where p.tenant = v_t_aut and p.estado_doc = 'documentada'
     and p.tipo_doc = v_norm.tipo_doc and p.numero_norm = v_norm.numero_norm;
  if not found then
    return c_vacio;
  end if;

  -- 4-6. Filtro por captura ANTES de contar; total, página y variantes solo sobre lo autorizado.
  with a as (
    select o.id, o.campo, o.valor, o.created_at,
           c.id as captura_id, c.fuente, c.created_at as capturado_en, c.contrato_numero, c.actor_rol,
           c.cotizacion_id, c.rol as rol_puesto, pq.activo as puesto_activo,
           (c.fuente = 'cotizacion' and (v_rol <> 'venta' or pq.creado_por_id = v_uid)) as cotizacion_visible
      from public.persona_observaciones o
      join public.persona_capturas c on c.id = o.captura_id
      left join lateral (
        select cp.activo, q.creado_por_id
          from public.cotizacion_participantes cp
          join public.cotizaciones q on q.id = cp.cotizacion_id and q.tenant = cp.tenant
         where c.fuente = 'cotizacion' and cp.captura_id = c.id and cp.cotizacion_id = c.cotizacion_id
         limit 1) pq on true
     where o.persona_id = v_persona.id
       and o.tenant = v_t_aut
       and c.persona_id = v_persona.id
       and p214_priv.captura_visible(c.id, c.tenant, c.fuente, c.nivel, c.contrato_numero, c.cotizacion_id,
                                     v_t_aut, v_rol, v_uid)
  ),
  pagina as (
    select * from a
     order by a.campo collate "C", a.created_at, a.id
    offset p_offset
     limit p_limite
  ),
  por_valor as (
    select a.campo, a.valor, count(distinct a.captura_id)::integer as n_capturas
      from a
     group by a.campo, a.valor
  ),
  muestra as (
    select pv.campo, pv.valor, pv.n_capturas,
           row_number() over (partition by pv.campo order by pv.n_capturas desc, pv.valor collate "C") as rn
      from por_valor pv
  ),
  por_campo as (
    select pv.campo, count(*)::integer as n_valores
      from por_valor pv
     group by pv.campo
  )
  select (select count(*)::integer from a),
         (select count(*)::integer from pagina),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'campo', pg.campo,
                            'valor', pg.valor,
                            'captura_id', pg.captura_id,
                            'fuente', pg.fuente,
                            'capturado_en', pg.capturado_en,
                            'contrato_numero', pg.contrato_numero,
                            'actor_rol', case when v_rol = 'venta' then null else pg.actor_rol end,
                            'cotizacion_id', case when pg.cotizacion_visible then pg.cotizacion_id end,
                            'rol', pg.rol_puesto,
                            'activo', pg.puesto_activo)
                          order by pg.campo collate "C", pg.created_at, pg.id)
                     from pagina pg), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'campo', pc.campo,
                            'n_valores', pc.n_valores,
                            'divergencia', pc.n_valores > 1,
                            'valores', coalesce((select jsonb_agg(jsonb_build_object('valor', m.valor, 'n_capturas', m.n_capturas)
                                                                  order by m.rn)
                                                   from muestra m
                                                  where m.campo = pc.campo and m.rn <= 10), '[]'::jsonb),
                            'valores_omitidos', greatest(pc.n_valores - 10, 0))
                          order by pc.campo collate "C")
                     from por_campo pc), '[]'::jsonb),
         coalesce((select bool_or(pc.n_valores > 1) from por_campo pc), false)
    into v_total, v_filas, v_pagina, v_variantes, v_divergencia;

  if v_total = 0 then
    return c_vacio;
  end if;

  return jsonb_build_object(
    'persona', jsonb_build_object('id', v_persona.id, 'tenant', v_persona.tenant,
                                  'tipo_doc', v_persona.tipo_doc, 'numero_norm', v_persona.numero_norm),
    'observaciones', v_pagina,
    'total', v_total,
    'has_more', (p_offset + v_filas) < v_total,
    'divergencia', v_divergencia,
    'variantes', v_variantes);
end;
$$;

comment on function public.buscar_personas_documento(text, text, text, integer, integer) is
  '214 (#32), re-creada por la 219 (#42) con la misma firma: búsqueda EXACTA por tenant + tipo + número, filtro único p214_priv.captura_visible. Procedencia nueva: cotizacion_id (a venta solo de cotizaciones propias), rol y activo del puesto. Respuesta vacía idéntica para "no existe", "sin permiso" y "nada autorizado". Sigue cerrada a B2B.';

-- 7) Ayudantes privados de las fachadas.
-- Cotización del checkout público sin sesión: sin creador, propietario ni aliado, y mayorista.
create or replace function p214_priv.cotizacion_anonima(
  p_tenant text, p_tipo text, p_creado_por_id uuid, p_propietario_id uuid, p_aliado_id bigint)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(p_creado_por_id is null and p_propietario_id is null and p_aliado_id is null
                  and p_tenant = 'mayorista' and p_tipo in ('carrito', 'comparativa_carrito'), false)
$$;

-- Defensa en profundidad del actor (C5): devuelve su rol, o NULL para el checkout anónimo.
create or replace function p214_priv.autorizar_actor_cotizacion(
  p_usuario_id uuid, p_tenant text, p_creado_por_id uuid, p_anonima boolean, p_solo_internos boolean)
returns text
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_rol text;
  v_tenant text;
  v_activo boolean;
begin
  if p_usuario_id is null then
    if p_anonima and not p_solo_internos then
      return null;
    end if;
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  select u.rol::text, u.tenant, u.activo into v_rol, v_tenant, v_activo
    from public.usuarios u where u.id = p_usuario_id;
  if not found or v_activo is not true or v_rol is null then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if v_rol = 'superadmin' then
    return v_rol;
  end if;
  if v_rol in ('gerencia', 'administracion', 'operaciones', 'venta') then
    if v_tenant is distinct from p_tenant then
      raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return v_rol;
  end if;
  if v_rol in ('agencia', 'freelance') and not p_solo_internos then
    if v_tenant is distinct from p_tenant or p_creado_por_id is null or p_creado_por_id <> p_usuario_id then
      raise exception 'no_autorizado' using errcode = '42501';
    end if;
    return v_rol;
  end if;
  raise exception 'no_autorizado' using errcode = '42501';
end;
$$;

-- Campos admitidos por puesto (C1) y forma de las observaciones.
create or replace function p214_priv.validar_campos_participante(p_rol text, p_observaciones jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_elem jsonb;
  v_permitidos text[];
begin
  v_permitidos := case p_rol
                    when 'titular' then array['nombres', 'apellidos', 'telefono', 'email', 'fecha_nacimiento']
                    when 'pasajero' then array['nombres', 'apellidos', 'fecha_nacimiento', 'nacionalidad']
                  end;
  if v_permitidos is null then
    raise exception 'participantes_invalidos' using errcode = '22023', detail = 'El rol del puesto es titular o pasajero.';
  end if;
  if p_observaciones is null then
    return;
  end if;
  if jsonb_typeof(p_observaciones) <> 'array' then
    raise exception 'observaciones_invalidas' using errcode = '22023', detail = 'observaciones debe ser un arreglo.';
  end if;
  for v_elem in select x.value from jsonb_array_elements(p_observaciones) x loop
    if jsonb_typeof(v_elem) <> 'object' or jsonb_typeof(v_elem -> 'campo') is distinct from 'string' then
      raise exception 'observaciones_invalidas' using errcode = '22023';
    end if;
    if not ((v_elem ->> 'campo') = any (v_permitidos)) then
      raise exception 'campo_no_admitido' using errcode = '22023',
        detail = 'Ese campo no corresponde a este puesto.';
    end if;
  end loop;
end;
$$;

-- Texto de un campo de entrada: string o null; '' cuenta como ausente. Nada se transforma.
create or replace function p214_priv.texto_entrada(p_obj jsonb, p_clave text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_obj is null or not (p_obj ? p_clave) or jsonb_typeof(p_obj -> p_clave) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_obj -> p_clave) <> 'string' then
    raise exception 'participantes_invalidos' using errcode = '22023', detail = 'Los datos del puesto son textos.';
  end if;
  return nullif(p_obj ->> p_clave, '');
end;
$$;

-- Puesto identificado: documento, nombres o apellidos no vacíos tras quitar espacios ASCII.
create or replace function p214_priv.participante_identificado(p_numero text, p_observaciones jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(btrim(p_numero, ' ') <> '', false)
      or exists (select 1 from jsonb_array_elements(coalesce(p_observaciones, '[]'::jsonb)) o
                  where jsonb_typeof(o) = 'object'
                    and o ->> 'campo' in ('nombres', 'apellidos')
                    and coalesce(btrim(o ->> 'valor', ' '), '') <> '')
$$;

-- 8) Fachada de alta y reintento (C5): titular y pasajeros de una cotización abierta.
-- p_participantes: [{rol, ref?, orden?, tipo_doc, numero_doc, observaciones:[{campo, valor}]}]
-- El titular NO lleva ref (se encuentra por el índice de titular activo); el pasajero lleva el
-- ref que la acción asignó en el payload ANTES de insertar la cotización.
create or replace function public.registrar_personas_cotizacion(
  p_cotizacion_id bigint,
  p_usuario_id uuid,
  p_participantes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  q record;
  v_rol text;
  v_anonima boolean;
  e jsonb;
  v_rol_p text;
  v_ref uuid;
  v_tipo text;
  v_numero text;
  v_obs jsonb;
  v_nivel text;
  v_cap uuid;
  v_puesto record;
  v_res record;
  v_orden integer;
  v_refs uuid[] := '{}';
  v_titulares integer := 0;
  v_nuevos integer := 0;
  v_reintentos integer := 0;
  v_omitidos integer := 0;
  v_pasajeros jsonb;
begin
  perform p214_priv.exigir_read_committed();
  if p_cotizacion_id is null then
    raise exception 'cotizacion_inexistente' using errcode = '22023';
  end if;
  if p_participantes is null or jsonb_typeof(p_participantes) <> 'array' or jsonb_array_length(p_participantes) > 60 then
    raise exception 'participantes_invalidos' using errcode = '22023', detail = 'Un arreglo de hasta 60 puestos.';
  end if;

  -- Primer candado: el mismo que pagos previos y conversión (cotización -> vínculo -> personas).
  select c.id, c.tenant, c.estado, c.tipo, c.modo, c.payload, c.creado_por_id, c.propietario_id, c.aliado_id
    into q
    from public.cotizaciones c
   where c.id = p_cotizacion_id
     for update;
  if not found then
    raise exception 'cotizacion_inexistente' using errcode = 'P0001';
  end if;
  if q.estado is distinct from 'abierta' then
    raise exception 'cotizacion_no_abierta' using errcode = 'P0001';
  end if;
  if q.tenant is null or q.tenant not in ('mayorista', 'minorista') then
    raise exception 'tenant_invalido' using errcode = '22023';
  end if;

  v_anonima := p214_priv.cotizacion_anonima(q.tenant, q.tipo, q.creado_por_id, q.propietario_id, q.aliado_id);
  v_rol := p214_priv.autorizar_actor_cotizacion(p_usuario_id, q.tenant, q.creado_por_id, v_anonima, false);
  v_pasajeros := case when jsonb_typeof(q.payload -> 'pasajeros') = 'array' then q.payload -> 'pasajeros' else '[]'::jsonb end;

  for e in select x.value from jsonb_array_elements(p_participantes) x loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'participantes_invalidos' using errcode = '22023';
    end if;
    v_rol_p := p214_priv.texto_entrada(e, 'rol');
    v_tipo := p214_priv.texto_entrada(e, 'tipo_doc');
    v_numero := p214_priv.texto_entrada(e, 'numero_doc');
    v_obs := coalesce(e -> 'observaciones', '[]'::jsonb);
    perform p214_priv.validar_campos_participante(v_rol_p, v_obs);
    if not p214_priv.participante_identificado(v_numero, v_obs) then
      raise exception 'participante_vacio' using errcode = '22023',
        detail = 'Una cantidad de viajeros sin datos no crea personas.';
    end if;
    -- D-6: toda captura anónima es provisional (el tipo no viene de una sesión).
    if v_anonima and v_tipo is not null then
      raise exception 'tipo_no_admitido' using errcode = '22023',
        detail = 'En una cotización anónima el tipo de documento no se registra.';
    end if;
    if jsonb_typeof(e -> 'orden') = 'number' then
      if (e ->> 'orden')::numeric < 0 or (e ->> 'orden')::numeric > 999
         or (e ->> 'orden')::numeric <> trunc((e ->> 'orden')::numeric) then
        raise exception 'participantes_invalidos' using errcode = '22023', detail = 'orden: entero entre 0 y 999.';
      end if;
      v_orden := (e ->> 'orden')::numeric::integer;
    elsif e ? 'orden' and jsonb_typeof(e -> 'orden') <> 'null' then
      raise exception 'participantes_invalidos' using errcode = '22023';
    else
      v_orden := null;
    end if;
    v_nivel := case v_rol_p when 'titular' then 'comercial' else 'pasajero_cotizacion' end;

    if v_rol_p = 'titular' then
      v_titulares := v_titulares + 1;
      if v_titulares > 1 or (e ? 'ref' and jsonb_typeof(e -> 'ref') <> 'null') then
        raise exception 'participantes_invalidos' using errcode = '22023', detail = 'Un solo titular, sin ref.';
      end if;
      select cp.* into v_puesto
        from public.cotizacion_participantes cp
       where cp.cotizacion_id = q.id and cp.rol = 'titular' and cp.activo
         for update;
      if found then
        v_ref := v_puesto.id;
      else
        v_ref := gen_random_uuid();
      end if;
    else
      begin
        v_ref := p214_priv.texto_entrada(e, 'ref')::uuid;
      exception when invalid_text_representation then
        raise exception 'ref_invalido' using errcode = '22023';
      end;
      if v_ref is null then
        raise exception 'ref_invalido' using errcode = '22023', detail = 'Cada pasajero lleva el ref de su fila.';
      end if;
      if v_ref = any (v_refs) then
        raise exception 'participantes_invalidos' using errcode = '22023', detail = 'Ref repetido.';
      end if;
      v_refs := v_refs || v_ref;
      -- El ref debe ser el de una fila del payload de ESTA cotización.
      if not exists (select 1 from jsonb_array_elements(v_pasajeros) pj
                      where jsonb_typeof(pj) = 'object' and pj ->> 'ref' = v_ref::text) then
        raise exception 'ref_inconsistente' using errcode = 'P0001';
      end if;
      select cp.* into v_puesto from public.cotizacion_participantes cp where cp.id = v_ref for update;
      if found and (v_puesto.cotizacion_id <> q.id or v_puesto.rol <> 'pasajero') then
        raise exception 'ref_inconsistente' using errcode = 'P0001';
      end if;
      if not found and exists (select 1 from public.persona_capturas c
                                where c.participante_ref = v_ref and c.cotizacion_id is distinct from q.id) then
        raise exception 'ref_inconsistente' using errcode = 'P0001';
      end if;
    end if;

    v_cap := md5(v_ref::text || ':alta:' || v_nivel)::uuid;
    if v_puesto.id is not null and v_puesto.id = v_ref then
      -- Puesto ya creado: un alta repetida no escribe. Si su captura vigente sigue siendo la del
      -- alta se compara (otra carga con la misma clave = captura_inconsistente); si el editor ya
      -- lo corrigió (o lo creó), el alta no tiene nada que repetir.
      if v_puesto.captura_id = v_cap then
        select r.* into v_res
          from p214_priv.upsert_persona(v_cap, q.tenant, 'cotizacion', v_tipo, v_numero, null, v_obs, null, null,
                                        p_usuario_id, v_rol, q.id, v_ref, v_rol_p) r;
        v_reintentos := v_reintentos + 1;
      else
        v_omitidos := v_omitidos + 1;
      end if;
    else
      select r.* into v_res
        from p214_priv.upsert_persona(v_cap, q.tenant, 'cotizacion', v_tipo, v_numero, null, v_obs, null, null,
                                      p_usuario_id, v_rol, q.id, v_ref, v_rol_p) r;
      insert into public.cotizacion_participantes (id, cotizacion_id, tenant, rol, orden, persona_id, captura_id)
      values (v_ref, q.id, q.tenant, v_rol_p, v_orden, v_res.persona_id, v_cap);
      v_nuevos := v_nuevos + 1;
    end if;
  end loop;

  -- Nunca persona_id, ni si la ficha ya existía (D-4: el alta no informa coincidencias).
  return jsonb_build_object('cotizacion_id', q.id, 'nuevos', v_nuevos, 'reintentos', v_reintentos,
                            'omitidos', v_omitidos);
end;
$$;

comment on function public.registrar_personas_cotizacion(bigint, uuid, jsonb) is
  '219 (#42): alta idempotente de titular y pasajeros de una cotización abierta. Solo service_role (Server Actions). Bloquea la cotización primero; captura id = md5(ref:alta:nivel). Devuelve conteos, nunca ids de persona ni si la ficha existía.';

-- 9) Corrección del titular (C4/C5): sustituye el UPDATE directo del editor.
-- p_titular: {nombres, apellidos, tipo_doc, numero_doc, fecha_nacimiento, telefono, email}
create or replace function public.actualizar_titular_cotizacion(
  p_cotizacion_id bigint,
  p_usuario_id uuid,
  p_titular jsonb,
  p_version_esperada integer,
  p_clave uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  q record;
  v_rol text;
  v_puesto record;
  v_hay_puesto boolean;
  v_ref uuid;
  v_cap uuid;
  v_nombres text;
  v_apellidos text;
  v_tipo text;
  v_numero text;
  v_nacimiento text;
  v_telefono text;
  v_email text;
  v_nombre text;
  v_obs jsonb;
  v_esperadas jsonb;
  v_res record;
  v_version integer;
  v_cliente jsonb;
  v_detalle jsonb;
begin
  perform p214_priv.exigir_read_committed();
  if p_clave is null then
    raise exception 'clave_obligatoria' using errcode = '22023';
  end if;
  if p_titular is null or jsonb_typeof(p_titular) <> 'object' then
    raise exception 'participantes_invalidos' using errcode = '22023';
  end if;
  v_nombres := p214_priv.texto_entrada(p_titular, 'nombres');
  v_apellidos := p214_priv.texto_entrada(p_titular, 'apellidos');
  v_tipo := p214_priv.texto_entrada(p_titular, 'tipo_doc');
  v_numero := p214_priv.texto_entrada(p_titular, 'numero_doc');
  v_nacimiento := p214_priv.texto_entrada(p_titular, 'fecha_nacimiento');
  v_telefono := p214_priv.texto_entrada(p_titular, 'telefono');
  v_email := p214_priv.texto_entrada(p_titular, 'email');
  v_nombre := btrim(coalesce(v_nombres, '') || ' ' || coalesce(v_apellidos, ''), ' ');
  if v_nombre = '' then
    raise exception 'titular_sin_nombre' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('campo', x.campo, 'valor', x.valor) order by x.n), '[]'::jsonb)
    into v_obs
    from (values (1, 'nombres', v_nombres), (2, 'apellidos', v_apellidos), (3, 'fecha_nacimiento', v_nacimiento),
                 (4, 'telefono', v_telefono), (5, 'email', v_email)) as x(n, campo, valor)
   where x.valor is not null;

  select c.id, c.tenant, c.estado, c.tipo, c.modo, c.creado_por_id, c.payload, c.detalle
    into q
    from public.cotizaciones c
   where c.id = p_cotizacion_id
     for update;
  if not found then
    raise exception 'cotizacion_inexistente' using errcode = 'P0001';
  end if;
  if q.estado is distinct from 'abierta' then
    raise exception 'cotizacion_no_abierta' using errcode = 'P0001';
  end if;
  if q.tipo is distinct from 'manual' or q.modo is distinct from 'simple' then
    raise exception 'cotizacion_no_editable' using errcode = 'P0001';
  end if;
  if q.tenant is null or q.tenant not in ('mayorista', 'minorista') then
    raise exception 'tenant_invalido' using errcode = '22023';
  end if;
  v_rol := p214_priv.autorizar_actor_cotizacion(p_usuario_id, q.tenant, q.creado_por_id, false, true);

  select cp.* into v_puesto
    from public.cotizacion_participantes cp
   where cp.cotizacion_id = q.id and cp.rol = 'titular' and cp.activo
     for update;
  v_hay_puesto := found;
  v_ref := case when v_hay_puesto then v_puesto.id else gen_random_uuid() end;
  v_cap := md5(v_ref::text || ':' || p_clave::text || ':comercial')::uuid;

  -- Reintento del MISMO envío ya aplicado: misma carga = mismo resultado, sin escribir.
  if v_hay_puesto and v_puesto.captura_id = v_cap then
    select r.* into v_res
      from p214_priv.upsert_persona(v_cap, q.tenant, 'cotizacion', v_tipo, v_numero, null, v_obs, null, null,
                                    p_usuario_id, v_rol, q.id, v_ref, 'titular') r;
    return jsonb_build_object('resultado', 'reintento', 'version', v_puesto.version);
  end if;
  if v_hay_puesto and exists (select 1 from public.persona_capturas c where c.id = v_cap) then
    raise exception 'version_obsoleta' using errcode = 'P0001';
  end if;

  -- CAS sobre la versión del puesto (0 o NULL = "aún no hay puesto").
  if v_hay_puesto then
    if p_version_esperada is distinct from v_puesto.version then
      raise exception 'version_obsoleta' using errcode = 'P0001';
    end if;
  elsif coalesce(p_version_esperada, 0) <> 0 then
    raise exception 'version_obsoleta' using errcode = 'P0001';
  end if;

  -- Mismo contenido que la captura vigente: sin cambios, sin escribir.
  v_esperadas := p214_priv.carga_esperada(p214_priv.observaciones_de_entrada(v_obs), null);
  if v_hay_puesto
     and p214_priv.captura_coincide(v_puesto.captura_id, v_puesto.persona_id, q.tenant, 'cotizacion', 'comercial',
                                    v_tipo, v_numero, null, null, v_esperadas, q.id, v_ref, 'titular') then
    return jsonb_build_object('resultado', 'sin_cambios', 'version', v_puesto.version);
  end if;

  select r.* into v_res
    from p214_priv.upsert_persona(v_cap, q.tenant, 'cotizacion', v_tipo, v_numero, null, v_obs, null, null,
                                  p_usuario_id, v_rol, q.id, v_ref, 'titular') r;
  if v_hay_puesto then
    update public.cotizacion_participantes cp
       set captura_id = v_cap, persona_id = v_res.persona_id
     where cp.id = v_ref
    returning cp.version into v_version;
  else
    insert into public.cotizacion_participantes (id, cotizacion_id, tenant, rol, orden, persona_id, captura_id)
    values (v_ref, q.id, q.tenant, 'titular', 0, v_res.persona_id, v_cap)
    returning version into v_version;
  end if;

  -- La misma transacción reescribe lo que ve la cotización; tipo y número CRUDOS (sin "CC").
  v_cliente := jsonb_build_object(
    'nombres', coalesce(v_nombres, ''), 'apellidos', coalesce(v_apellidos, ''),
    'tipoDoc', coalesce(v_tipo, ''), 'numeroDoc', coalesce(v_numero, ''),
    'nacimiento', coalesce(v_nacimiento, ''), 'telefono', coalesce(v_telefono, ''), 'email', coalesce(v_email, ''));
  v_detalle := case when jsonb_typeof(q.detalle) = 'object' then q.detalle else '{}'::jsonb end;
  v_detalle := jsonb_set(v_detalle, '{venta}',
                         (case when jsonb_typeof(v_detalle -> 'venta') = 'object' then v_detalle -> 'venta' else '{}'::jsonb end)
                           || jsonb_build_object('cliente', v_nombre),
                         true);
  update public.cotizaciones c
     set payload = jsonb_set(case when jsonb_typeof(c.payload) = 'object' then c.payload else '{}'::jsonb end,
                             '{cliente}', v_cliente, true),
         detalle = v_detalle,
         cliente = v_nombre,
         cliente_documento = v_numero
   where c.id = q.id;

  return jsonb_build_object('resultado', 'actualizado', 'version', v_version);
end;
$$;

comment on function public.actualizar_titular_cotizacion(bigint, uuid, jsonb, integer, uuid) is
  '219 (#42): corrige el titular de una cotización dinámica abierta en UNA transacción (captura nueva, vínculo re-apuntado, payload/detalle/cliente/cliente_documento con el tipo crudo). CAS por versión del puesto; clave de idempotencia por envío. Solo service_role.';

-- 10) Sello NUEVO de autor para Reservar y checkout con sesión (G4: el manual es de #39).
-- Solo la cotización recién creada por ESE usuario (su correo en creado_por) y sin sello: un
-- histórico o una cotización ajena nunca se vuelve "propia" por esta vía.
create or replace function public.sellar_creador_cotizacion(
  p_cotizacion_id bigint,
  p_usuario_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  q record;
  u record;
begin
  if p_usuario_id is null or p_cotizacion_id is null then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  select c.id, c.tenant, c.estado, c.tipo, c.modo, c.creado_por, c.creado_por_id, c.cotizacion_origen_id, c.created_at
    into q
    from public.cotizaciones c
   where c.id = p_cotizacion_id
     for update;
  if not found then
    raise exception 'cotizacion_inexistente' using errcode = 'P0001';
  end if;
  select x.id, x.rol::text as rol, x.tenant, x.activo, x.email into u
    from public.usuarios x where x.id = p_usuario_id;
  if not found or u.activo is not true
     or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'agencia', 'freelance')
     or (u.rol <> 'superadmin' and u.tenant is distinct from q.tenant) then
    raise exception 'no_autorizado' using errcode = '42501';
  end if;
  if q.creado_por_id is not null then
    if q.creado_por_id = p_usuario_id then
      return 'ya_sellada';
    end if;
    raise exception 'sello_ajeno' using errcode = '42501';
  end if;
  if q.estado is distinct from 'abierta' then
    raise exception 'cotizacion_no_abierta' using errcode = 'P0001';
  end if;
  if q.modo is distinct from 'simple' or q.cotizacion_origen_id is not null
     or q.tipo not in ('tarifario', 'carrito') then
    raise exception 'sello_no_admitido' using errcode = '42501';
  end if;
  if q.creado_por is null or u.email is null
     or lower(btrim(q.creado_por, ' ')) <> lower(btrim(u.email, ' ')) then
    raise exception 'sello_no_admitido' using errcode = '42501';
  end if;
  if q.created_at < now() - interval '15 minutes' then
    raise exception 'sello_vencido' using errcode = '42501';
  end if;
  update public.cotizaciones c set creado_por_id = p_usuario_id where c.id = q.id;
  return 'sellada';
end;
$$;

comment on function public.sellar_creador_cotizacion(bigint, uuid) is
  '219 (#42): estampa creado_por_id en una cotización de Reservar (tarifario) o del checkout (carrito) recién creada por ese mismo usuario (creado_por = su correo, menos de 15 minutos, sin sello previo). Idempotente. Solo service_role. No aplica a manuales (216) ni a comparativas/hijas (211).';

-- 11) Lectura del CRM: puestos de cotizaciones (C6). EXECUTE authenticated; actor desde auth.uid().
create or replace function public.crm_personas_cotizacion_buscar(
  p_tenant text,
  p_texto text default null,
  p_limite integer default 20,
  p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  c_vacio constant jsonb := jsonb_build_object('items', '[]'::jsonb, 'total', 0, 'has_more', false);
  v_uid uuid;
  v_rol text;
  v_tenant_usuario text;
  v_t_aut text;
  v_texto text;
  v_total integer;
  v_filas integer;
  v_items jsonb;
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'limite_invalido' using errcode = '22023', detail = 'p_limite debe estar entre 1 y 50.';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'offset_invalido' using errcode = '22023', detail = 'p_offset debe ser 0 o mayor.';
  end if;
  if p_texto is not null and char_length(p_texto) > 100 then
    raise exception 'texto_invalido' using errcode = '22023', detail = 'Hasta 100 caracteres.';
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    return c_vacio;
  end if;
  select u.rol::text, u.tenant into v_rol, v_tenant_usuario
    from public.usuarios u
   where u.id = v_uid and u.activo is true;
  if not found
     or v_rol is null
     or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta', 'agencia', 'freelance')
     or v_tenant_usuario is null or v_tenant_usuario not in ('mayorista', 'minorista') then
    return c_vacio;
  end if;
  if v_rol in ('superadmin', 'gerencia') then
    if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
      return c_vacio;
    end if;
    v_t_aut := p_tenant;
  else
    if p_tenant is not null and p_tenant <> v_tenant_usuario then
      return c_vacio;
    end if;
    v_t_aut := v_tenant_usuario;
  end if;

  v_texto := nullif(btrim(coalesce(p_texto, ''), ' '), '');
  if v_texto is not null then
    v_texto := replace(replace(replace(v_texto, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  with puestos as (
    select cp.id, cp.rol, cp.orden, cp.activo, cp.persona_id, cp.created_at,
           q.id as cot_id, q.codigo, q.estado as cot_estado, q.created_at as cot_creada, q.tenant,
           c.id as captura_id, c.tipo_doc_capturado, c.documento_capturado, c.created_at as capturado_en,
           p.estado_doc
      from public.cotizacion_participantes cp
      join public.cotizaciones q on q.id = cp.cotizacion_id and q.tenant = cp.tenant
      join public.persona_capturas c on c.id = cp.captura_id
      join public.personas p on p.id = cp.persona_id and p.tenant = cp.tenant
     where cp.tenant = v_t_aut
       and cp.activo
       -- Alcance de la lista: venta y B2B, solo cotizaciones propias (como la 188 con contratos).
       and (v_rol not in ('venta', 'agencia', 'freelance') or q.creado_por_id = v_uid)
       and p214_priv.captura_visible(c.id, c.tenant, c.fuente, c.nivel, c.contrato_numero, c.cotizacion_id,
                                     v_t_aut, v_rol, v_uid)
       and (v_texto is null
            or q.codigo ilike ('%' || v_texto || '%') escape '\'
            or c.documento_capturado ilike ('%' || v_texto || '%') escape '\'
            or exists (select 1 from public.persona_observaciones o
                        where o.captura_id = c.id and o.campo in ('nombres', 'apellidos')
                          and o.valor ilike ('%' || v_texto || '%') escape '\'))
  ),
  pagina as (
    select * from puestos
     order by cot_creada desc, cot_id desc, (rol <> 'titular'), orden nulls last, id
    offset p_offset
     limit p_limite
  )
  select (select count(*)::integer from puestos),
         (select count(*)::integer from pagina),
         coalesce((select jsonb_agg(jsonb_build_object(
                            'participante_ref', pg.id,
                            'rol', pg.rol,
                            'orden', pg.orden,
                            'activo', pg.activo,
                            'estado_ficha', pg.estado_doc,
                            'persona_id', case when v_rol in ('agencia', 'freelance') then null else pg.persona_id end,
                            'tipo_doc', pg.tipo_doc_capturado,
                            'numero_doc', pg.documento_capturado,
                            'capturado_en', pg.capturado_en,
                            'datos', coalesce((select jsonb_agg(jsonb_build_object('campo', o.campo, 'valor', o.valor)
                                                                order by o.campo collate "C", o.valor collate "C")
                                                 from public.persona_observaciones o
                                                where o.captura_id = pg.captura_id and o.campo <> 'nit_dv'), '[]'::jsonb),
                            'cotizacion', jsonb_build_object('id', pg.cot_id, 'codigo', pg.codigo, 'estado', pg.cot_estado,
                                                             'fecha', pg.cot_creada, 'tenant', pg.tenant))
                          order by pg.cot_creada desc, pg.cot_id desc, (pg.rol <> 'titular'), pg.orden nulls last, pg.id)
                     from pagina pg), '[]'::jsonb)
    into v_total, v_filas, v_items;

  if v_total = 0 then
    return c_vacio;
  end if;
  return jsonb_build_object('items', v_items, 'total', v_total, 'has_more', (p_offset + v_filas) < v_total);
end;
$$;

comment on function public.crm_personas_cotizacion_buscar(text, text, integer, integer) is
  '219 (#42): lista paginada (máx. 50, con error) de puestos activos de cotizaciones con su captura vigente, estado de ficha y cotización de origen. Filtro único p214_priv.captura_visible; venta y agencia/freelance solo cotizaciones propias (creado_por_id). Gerencia/superadmin con p_tenant explícito. Vacío idéntico para "sin permiso" y "nada".';

-- 12) Dueño, RLS y privilegios (Supabase concede por defecto a anon/authenticated/service_role
--     sobre objetos nuevos: se revoca explícitamente y se concede solo lo necesario).
alter function public.buscar_personas_documento(text, text, text, integer, integer) owner to current_user;
alter function public.registrar_personas_cotizacion(bigint, uuid, jsonb) owner to current_user;
alter function public.actualizar_titular_cotizacion(bigint, uuid, jsonb, integer, uuid) owner to current_user;
alter function public.sellar_creador_cotizacion(bigint, uuid) owner to current_user;
alter function public.crm_personas_cotizacion_buscar(text, text, integer, integer) owner to current_user;

alter table public.cotizacion_participantes enable row level security;
revoke all on table public.cotizacion_participantes from public, anon, authenticated, service_role;
grant select, insert, update on table public.cotizacion_participantes to service_role;

revoke all on all functions in schema p214_priv from public, anon, authenticated, service_role;
grant execute on function
  p214_priv.norm_documento(text, text, boolean, text),
  p214_priv.dv_nit_valido(text),
  p214_priv.exigir_read_committed(),
  p214_priv.validar_entrada_captura(uuid, text, text, text, text, text, bigint, bigint, uuid, text),
  p214_priv.observaciones_de_entrada(jsonb),
  p214_priv.carga_esperada(jsonb, text),
  p214_priv.marca_nit(text, text, text),
  p214_priv.captura_coincide(uuid, uuid, text, text, text, text, text, text, bigint, jsonb, bigint, uuid, text),
  p214_priv.upsert_persona(uuid, text, text, text, text, text, jsonb, text, bigint, uuid, text, bigint, uuid, text),
  p214_priv.promover_persona(uuid, uuid, text, text, text, jsonb, text, text, bigint, uuid, text)
  to service_role;

revoke all on function public.buscar_personas_documento(text, text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.buscar_personas_documento(text, text, text, integer, integer) to authenticated;

revoke all on function public.registrar_personas_cotizacion(bigint, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.actualizar_titular_cotizacion(bigint, uuid, jsonb, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sellar_creador_cotizacion(bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.registrar_personas_cotizacion(bigint, uuid, jsonb),
  public.actualizar_titular_cotizacion(bigint, uuid, jsonb, integer, uuid),
  public.sellar_creador_cotizacion(bigint, uuid)
  to service_role;

revoke all on function public.crm_personas_cotizacion_buscar(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_personas_cotizacion_buscar(text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
