-- ═════════════════════════════════════════════════════════════════════════
-- 211 · #35 — COTIZACIONES COMPARATIVAS (elegir UN hotel entre hasta tres).
--
-- Número reservado por el Coordinador (WORKSTREAMS.md, 2026-10-15). Scripts:
-- supabase/scripts/{preflight,postcheck,rollback}_211_cotizaciones_comparativas.sql
-- y test_211_*.sql / test_211_*.sh (SOLO base local desechable).
--
-- Orden de despliegue: preflight → 211 → postcheck → código. El código viejo
-- ignora las columnas nuevas (todas con default) y nunca ve una madre.
--
-- NO redefine ni toca ninguna función existente. En particular el RPC 198
-- `convertir_cotizacion_a_contrato`, `registrar_pago_previo`, la 206 y la 208
-- quedan EXACTAMENTE como están (el postcheck compara el hash del cuerpo del
-- 198). Decisión del dueño: la hija manual se convierte por el 198 en PVP;
-- NETO en esa conversión es un hotfix posterior y separado.
--
-- ── Modelo ─────────────────────────────────────────────────────────────────
-- · MADRE: una cotización con modo='comparativa' y tipo 'comparativa_manual' /
--   'comparativa_carrito'. Nunca se cobra ni se convierte: precio_venta es NULL,
--   estado solo 'abierta' | 'descartada' (NO existe estado 'elegida'), y tres
--   triggers sin excepción impiden pagos previos, condiciones congeladas y
--   ventas sobre ella. Es económicamente inmutable (sello sha256).
-- · OPCIONES: (opcion_ref A|B|C, acomodacion_ref) con su total y snapshot.
-- · HIJA: cotización SIMPLE (tipo 'manual' | 'carrito') con solo lo común y la
--   opción elegida, precio numérico y vigencia ≤ la de la madre. A lo sumo UNA
--   hija activa (no descartada) por madre. "Hija activa" se deriva; el historial
--   vive en cotizacion_comparativa_eventos (solo inserción).
--
-- ── Frontera de autorización (sin GUC) ─────────────────────────────────────
-- Todas las escrituras protegidas pasan por funciones SECURITY DEFINER. Los
-- triggers rechazan a los roles de la API (authenticated, anon, service_role)
-- y dejan pasar a quien NO lo es (el dueño de la función, es decir, el cuerpo
-- de la propia RPC; patrón de la 206). No hay variable de sesión que un
-- authenticated pueda falsificar: current_user no se puede suplantar.
-- Cuatro tablas nuevas, todas con RLS activo y grants explícitos; ninguna
-- "hereda" acceso de otra.
-- ═════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

-- Guarda de dependencias: sin las piezas que usa, no se aplica.
do $$
begin
  if to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is null
     or to_regprocedure('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)') is null
     or to_regprocedure('public.fecha_negocio(timestamptz)') is null
     or to_regprocedure('public.puede_ver_tenant_cotizacion(text)') is null
     or to_regclass('public.cotizacion_pagos_previos') is null
     or to_regclass('public.cotizacion_condiciones') is null then
    raise exception '211: faltan piezas de las migraciones 054/084/154/164/198. No se aplicó nada.';
  end if;
end $$;

create schema if not exists f211_priv;
revoke all on schema f211_priv from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Columnas nuevas (aditivas; defaults que no cambian ninguna fila vieja)
-- ═════════════════════════════════════════════════════════════════════════
alter table public.cotizaciones
  add column if not exists modo text not null default 'simple',
  add column if not exists version integer not null default 1,
  add column if not exists sello_economico text,
  add column if not exists aliado_id bigint references public.aliados(id) on delete restrict,
  add column if not exists propietario_id uuid references public.usuarios(id) on delete restrict,
  add column if not exists creado_por_id uuid,
  add column if not exists cotizacion_origen_id bigint references public.cotizaciones(id) on delete restrict,
  add column if not exists opcion_ref text,
  add column if not exists acomodacion_ref text,
  add column if not exists madre_version integer,
  add column if not exists madre_sello text,
  add column if not exists vigencia_tope date;

alter table public.cotizacion_servicios
  add column if not exists opcion_ref text;

-- Identidad (id, tenant) única: la usan las claves foráneas compuestas de las
-- tablas nuevas para que su `tenant` copiado NO pueda divergir del de la madre.
create unique index if not exists uq_cotizaciones_id_tenant on public.cotizaciones (id, tenant);

alter table public.cotizaciones
  drop constraint if exists cotizaciones_modo_check,
  add constraint cotizaciones_modo_check check (modo in ('simple','comparativa')),
  drop constraint if exists cotizaciones_comparativa_forma,
  add constraint cotizaciones_comparativa_forma check (
    (modo = 'comparativa') = (tipo in ('comparativa_manual','comparativa_carrito'))
    and (modo <> 'comparativa' or (
          precio_venta is null
          and vigencia_hasta is not null
          and cotizacion_origen_id is null
          and estado in ('abierta','descartada')
          and numero_contrato is null))
  ),
  drop constraint if exists cotizaciones_hija_forma,
  add constraint cotizaciones_hija_forma check (
    (cotizacion_origen_id is null
       and opcion_ref is null and acomodacion_ref is null
       and madre_version is null and madre_sello is null and vigencia_tope is null)
    or
    (cotizacion_origen_id is not null
       and modo = 'simple'
       and tipo in ('manual','carrito')
       and precio_venta is not null and precio_venta > 0
       and opcion_ref is not null and acomodacion_ref is not null
       and madre_version is not null and madre_sello is not null and vigencia_tope is not null)
  );

alter table public.cotizacion_servicios
  drop constraint if exists cotizacion_servicios_opcion_solo_hotel,
  add constraint cotizacion_servicios_opcion_solo_hotel
    check (opcion_ref is null or (tipo_servicio = 'hotel' and opcion_ref in ('A','B','C')));

-- A lo sumo UNA hija activa (no descartada) por madre. Nada se borra: la
-- reelección exige descartar la anterior (que queda como historial).
create unique index if not exists uq_cotizaciones_hija_activa
  on public.cotizaciones (cotizacion_origen_id)
  where cotizacion_origen_id is not null and estado <> 'descartada';

create index if not exists idx_cotizaciones_aliado on public.cotizaciones (aliado_id) where aliado_id is not null;
create index if not exists idx_cotizaciones_modo on public.cotizaciones (modo) where modo <> 'simple';

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Tablas nuevas — RLS activo y grants explícitos en CADA una
-- ═════════════════════════════════════════════════════════════════════════

-- 2.1 Opciones: (opcion_ref, acomodacion_ref) con total y snapshots. Inmutable.
create table public.cotizacion_opciones (
  id             bigserial primary key,
  cotizacion_id  bigint not null,
  tenant         text   not null,
  opcion_ref     text   not null check (opcion_ref in ('A','B','C')),
  acomodacion_ref text  not null check (acomodacion_ref ~ '^[a-z0-9_]{1,30}$'),
  version        integer not null default 1,
  orden          integer not null,
  etiqueta       text   not null check (length(btrim(etiqueta)) between 1 and 160),
  moneda         text   not null check (moneda in ('COP','USD')),
  tarifa_persona numeric(15,2) check (tarifa_persona is null or tarifa_persona > 0),
  total          numeric(15,2) not null check (total > 0),
  -- Sin netos ni proveedores: lo leen documentos, enlace público y portal.
  resumen_publico jsonb not null,
  -- Cuerpo que se copia a la hija (payload/detalle/columnas denormalizadas).
  plantilla_hija  jsonb not null,
  created_at     timestamptz not null default now(),
  constraint cotizacion_opciones_unica unique (cotizacion_id, opcion_ref, acomodacion_ref),
  constraint cotizacion_opciones_madre_fk foreign key (cotizacion_id, tenant)
    references public.cotizaciones (id, tenant) on delete restrict
);
create index idx_cotizacion_opciones_cot on public.cotizacion_opciones (cotizacion_id);
alter table public.cotizacion_opciones enable row level security;

-- 2.2 Eventos: historial inmutable (solo inserción) de la comparativa.
create table public.cotizacion_comparativa_eventos (
  id             bigserial primary key,
  cotizacion_id  bigint not null,
  tenant         text   not null,
  tipo           text   not null check (tipo in
    ('creada','elegida','hija_descartada','solicitud_registrada','solicitud_actualizada',
     'solicitud_atendida','solicitud_rechazada','solicitud_superada')),
  hija_id        bigint,
  opcion_ref     text,
  acomodacion_ref text,
  version        integer,
  actor_tipo     text check (actor_tipo in ('interno','b2b','publico','sistema')),
  actor_id       uuid,
  validacion_id  uuid,
  solicitud_id   bigint,
  clave          text,
  huella         text,
  detalle        jsonb,
  created_at     timestamptz not null default now(),
  constraint cotizacion_comparativa_eventos_madre_fk foreign key (cotizacion_id, tenant)
    references public.cotizaciones (id, tenant) on delete restrict
);
create index idx_comparativa_eventos_cot on public.cotizacion_comparativa_eventos (cotizacion_id, id);
-- Idempotencia de la elección: una clave por madre.
create unique index uq_comparativa_eventos_clave
  on public.cotizacion_comparativa_eventos (cotizacion_id, clave)
  where tipo = 'elegida' and clave is not null;
alter table public.cotizacion_comparativa_eventos enable row level security;

-- 2.3 Recibos de validación (checkout / sesión): un solo uso, con vencimiento.
create table public.cotizacion_comparativa_validaciones (
  id             uuid primary key default gen_random_uuid(),
  cotizacion_id  bigint not null,
  tenant         text   not null,
  opcion_ref     text   not null check (opcion_ref in ('A','B','C')),
  acomodacion_ref text  not null check (acomodacion_ref ~ '^[a-z0-9_]{1,30}$'),
  version        integer not null,
  moneda         text   not null check (moneda in ('COP','USD')),
  canal          text   not null check (canal in ('interno','b2b','publico')),
  actor_id       uuid,
  precio_reliquidado numeric(15,2) not null check (precio_reliquidado > 0),
  disponibilidad_ok boolean not null check (disponibilidad_ok),
  datos_cliente  jsonb,
  huella         text   not null,
  expira_en      timestamptz not null,
  consumida_en   timestamptz,
  hija_id        bigint,
  clave          text,
  created_at     timestamptz not null default now(),
  constraint comparativa_validaciones_madre_fk foreign key (cotizacion_id, tenant)
    references public.cotizaciones (id, tenant) on delete restrict,
  -- Canal público ⇔ sin actor autenticado.
  constraint comparativa_validaciones_actor check ((canal = 'publico') = (actor_id is null)),
  -- Datos mínimos del checkout público (los exige la base, no solo la app).
  -- Tras consumir, datos_cliente se anula y se conserva la huella.
  constraint comparativa_validaciones_datos check (
    consumida_en is not null
    or canal <> 'publico'
    or (   length(btrim(coalesce(datos_cliente->>'nombres',''))) > 0
       and length(btrim(coalesce(datos_cliente->>'numeroDoc',''))) > 0
       and length(btrim(coalesce(datos_cliente->>'telefono',''))) > 0)
  ),
  constraint comparativa_validaciones_consumo check ((consumida_en is null) = (hija_id is null))
);
create index idx_comparativa_validaciones_cot on public.cotizacion_comparativa_validaciones (cotizacion_id);
alter table public.cotizacion_comparativa_validaciones enable row level security;

-- 2.4 Solicitudes (manual / madres no anónimas): coexistentes, sin reservar nada.
create table public.cotizacion_comparativa_solicitudes (
  id             bigserial primary key,
  cotizacion_id  bigint not null,
  tenant         text   not null,
  opcion_ref     text   not null check (opcion_ref in ('A','B','C')),
  acomodacion_ref text  not null check (acomodacion_ref ~ '^[a-z0-9_]{1,30}$'),
  version        integer not null,
  estado         text   not null default 'pendiente'
                 check (estado in ('pendiente','atendida','rechazada','cancelada','superada')),
  contacto_nombre   text not null check (length(btrim(contacto_nombre)) between 2 and 120),
  contacto_telefono text check (contacto_telefono is null or length(contacto_telefono) <= 40),
  contacto_email    text check (contacto_email is null or length(contacto_email) <= 160),
  nota           text check (nota is null or length(nota) <= 500),
  contacto_huella_tel  text,
  contacto_huella_mail text,
  ip_huella      text,
  clave          text not null check (length(clave) between 8 and 80),
  hija_id        bigint,
  verificada_por uuid,
  motivo         text check (motivo is null or length(motivo) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  atendida_en    timestamptz,
  constraint comparativa_solicitudes_madre_fk foreign key (cotizacion_id, tenant)
    references public.cotizaciones (id, tenant) on delete restrict,
  constraint comparativa_solicitudes_contacto check (contacto_huella_tel is not null or contacto_huella_mail is not null),
  constraint comparativa_solicitudes_clave unique (cotizacion_id, clave)
);
-- Una pendiente por PERSONA (no por madre): coexisten las de personas distintas.
create unique index uq_comparativa_sol_tel
  on public.cotizacion_comparativa_solicitudes (cotizacion_id, contacto_huella_tel)
  where estado = 'pendiente' and contacto_huella_tel is not null;
create unique index uq_comparativa_sol_mail
  on public.cotizacion_comparativa_solicitudes (cotizacion_id, contacto_huella_mail)
  where estado = 'pendiente' and contacto_huella_mail is not null;
create index idx_comparativa_sol_cot on public.cotizacion_comparativa_solicitudes (cotizacion_id, estado, created_at);
create index idx_comparativa_sol_ip on public.cotizacion_comparativa_solicitudes (ip_huella, created_at) where ip_huella is not null;
alter table public.cotizacion_comparativa_solicitudes enable row level security;

-- ── Grants explícitos (los de Supabase por defecto dan ALL a la API) ───────
revoke all on public.cotizacion_opciones, public.cotizacion_comparativa_eventos,
              public.cotizacion_comparativa_validaciones, public.cotizacion_comparativa_solicitudes
  from public, anon, authenticated, service_role;
revoke all on sequence public.cotizacion_opciones_id_seq, public.cotizacion_comparativa_eventos_id_seq,
                       public.cotizacion_comparativa_solicitudes_id_seq
  from public, anon, authenticated, service_role;

-- Lectura de personal interno, acotada por rol y tenant, con policies PROPIAS
-- (no dependen de que otra tabla "herede" nada).
grant select on public.cotizacion_opciones, public.cotizacion_comparativa_eventos,
                public.cotizacion_comparativa_solicitudes to authenticated;
-- Lectura del servidor (documentos, enlace público, portal): service_role omite RLS.
-- NINGUNA escritura directa: toda escritura pasa por las RPC SECURITY DEFINER.
grant select on public.cotizacion_opciones, public.cotizacion_comparativa_eventos,
                public.cotizacion_comparativa_solicitudes, public.cotizacion_comparativa_validaciones
  to service_role;

create policy "comparativa_opciones: lectura interna" on public.cotizacion_opciones
  for select to authenticated
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_tenant_cotizacion(tenant));
create policy "comparativa_eventos: lectura interna" on public.cotizacion_comparativa_eventos
  for select to authenticated
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_tenant_cotizacion(tenant));
create policy "comparativa_solicitudes: lectura interna" on public.cotizacion_comparativa_solicitudes
  for select to authenticated
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
         and public.puede_ver_tenant_cotizacion(tenant));
-- cotizacion_comparativa_validaciones: SIN policy y SIN grant para anon/authenticated
-- (contiene datos personales del checkout y el estado del recibo).

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Funciones privadas (esquema f211_priv: la Data API no lo expone)
-- ═════════════════════════════════════════════════════════════════════════

-- Sello sha256 de TODO lo económico de la madre. jsonb ya normaliza el orden de
-- claves y los números, así que el texto es canónico.
create or replace function f211_priv.sello_madre(p_id bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'c', (select jsonb_build_object('tipo', c.tipo, 'tenant', c.tenant, 'moneda', c.moneda, 'pax', c.pax,
             'destino', c.destino, 'ida', c.fecha_salida, 'regreso', c.fecha_regreso,
             'payload', c.payload, 'detalle', c.detalle, 'aliado', c.aliado_id,
             'prop', c.propietario_id, 'creador', c.creado_por_id, 'version', c.version,
             'cliente', c.cliente, 'doc', c.cliente_documento, 'asesor', c.asesor)
          from public.cotizaciones c where c.id = p_id),
    's', (select coalesce(jsonb_agg(jsonb_build_object('orden', s.orden, 'tipo', s.tipo_servicio,
             'plataforma', s.plataforma, 'nombre', s.nombre_servicio, 'proveedor', s.proveedor,
             'costo', s.costo_neto, 'modo', s.modo, 'mk', s.pct_markup, 'ta', s.ta, 'valor', s.valor,
             'opcion', s.opcion_ref) order by s.orden, s.id), '[]'::jsonb)
          from public.cotizacion_servicios s where s.cotizacion_id = p_id),
    'o', (select coalesce(jsonb_agg(jsonb_build_object('opcion', o.opcion_ref, 'acom', o.acomodacion_ref,
             'orden', o.orden, 'etiqueta', o.etiqueta, 'moneda', o.moneda, 'tarifa', o.tarifa_persona,
             'total', o.total, 'resumen', o.resumen_publico, 'plantilla', o.plantilla_hija)
             order by o.opcion_ref, o.acomodacion_ref), '[]'::jsonb)
          from public.cotizacion_opciones o where o.cotizacion_id = p_id)
  )::text, 'UTF8')), 'hex')
$$;

-- Usuario interno activo (superadmin global; el resto, de SU tenant).
create or replace function f211_priv.interno_activo(p_uid uuid, p_tenant text) returns public.usuarios
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = p_uid;
  if not found or u.activo is not true
     or u.rol not in ('superadmin','gerencia','administracion','operaciones','venta') then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
  end if;
  if u.rol <> 'superadmin' and u.tenant is distinct from p_tenant then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
  end if;
  return u;
end $$;

-- Propiedad B2B AUTORITATIVA: por vínculo de aliado aprobado (usuarios.aliado_id)
-- o, solo si la cotización no tiene aliado, por su propietario. Jamás por nombre,
-- email ni creado_por. Mismo tenant; usuario activo con rol agencia/freelance.
create or replace function f211_priv.b2b_propietario(p_uid uuid, p_madre_id bigint) returns public.usuarios
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios; c public.cotizaciones;
begin
  select * into c from public.cotizaciones where id = p_madre_id;
  select * into u from public.usuarios where id = p_uid;
  if c.id is null or u.id is null or u.activo is not true or u.rol not in ('agencia','freelance')
     or u.tenant is distinct from c.tenant then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
  end if;
  if c.aliado_id is not null then
    if u.aliado_id is distinct from c.aliado_id then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
    end if;
  elsif c.propietario_id is null or c.propietario_id <> u.id then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
  end if;
  return u;
end $$;

-- Madre anónima = creada en el checkout público sin sesión ni aliado.
create or replace function f211_priv.madre_anonima(c public.cotizaciones) returns boolean
language sql immutable set search_path = '' as $$
  select c.creado_por_id is null and c.propietario_id is null and c.aliado_id is null
$$;

-- Vencimiento de IP/limpieza: el hash de IP solo sirve para limitar la tasa;
-- se anula a las 24 h (y al resolver la solicitud).
create or replace function f211_priv.purgar_ip_huella() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.cotizacion_comparativa_solicitudes
     set ip_huella = null
   where ip_huella is not null and created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Triggers (invoker: current_user es el de quien escribe)
-- ═════════════════════════════════════════════════════════════════════════

-- 4.1 cotizaciones: la madre es inmutable; las columnas de comparativa solo las
-- escribe una RPC; nada de borrar madres/hijas por la API.
create or replace function f211_priv.tg_cotizaciones_guarda() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  m public.cotizaciones;
  v_api boolean := current_user in ('authenticated', 'anon', 'service_role');
begin
  if tg_op = 'DELETE' then
    if v_api and (old.modo = 'comparativa' or old.cotizacion_origen_id is not null) then
      raise exception 'COMPARATIVA_INMUTABLE: una comparativa o su hija no se borra (conserva el historial).' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_api and (new.modo <> 'simple' or new.tipo like 'comparativa\_%' or new.version <> 1
        or new.sello_economico is not null or new.aliado_id is not null or new.propietario_id is not null
        or new.creado_por_id is not null or new.cotizacion_origen_id is not null or new.opcion_ref is not null
        or new.acomodacion_ref is not null or new.madre_version is not null or new.madre_sello is not null
        or new.vigencia_tope is not null) then
      raise exception 'COMPARATIVA_SOLO_RPC: las comparativas y sus hijas solo se crean con la operación de comparativa.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.modo = 'comparativa' then
    -- Descartar una madre con hija activa deja una hija huérfana: no (todos los roles).
    if new.estado = 'descartada' and old.estado is distinct from 'descartada'
       and exists (select 1 from public.cotizaciones h
                    where h.cotizacion_origen_id = old.id and h.estado <> 'descartada') then
      raise exception 'COMPARATIVA_HIJA_ACTIVA: descarta primero la cotización elegida antes de descartar la comparativa.' using errcode = 'P0001';
    end if;
    if v_api then
      if (to_jsonb(new) - 'estado' - 'vigencia_hasta') is distinct from (to_jsonb(old) - 'estado' - 'vigencia_hasta') then
        raise exception 'COMPARATIVA_INMUTABLE: los datos económicos de una comparativa no se modifican.' using errcode = '42501';
      end if;
      if new.estado is distinct from old.estado and not (old.estado = 'abierta' and new.estado = 'descartada') then
        raise exception 'COMPARATIVA_INMUTABLE: una comparativa solo puede pasar de abierta a descartada.' using errcode = '42501';
      end if;
      if new.vigencia_hasta is distinct from old.vigencia_hasta and (new.vigencia_hasta is null or new.vigencia_hasta > old.vigencia_hasta) then
        raise exception 'COMPARATIVA_INMUTABLE: la vigencia de una comparativa solo puede reducirse.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- Cotización simple o hija: nadie con rol de API cambia las columnas de comparativa.
  if v_api and (
       (new.modo, new.tipo, new.version, new.sello_economico, new.aliado_id, new.propietario_id, new.creado_por_id,
        new.cotizacion_origen_id, new.opcion_ref, new.acomodacion_ref, new.madre_version, new.madre_sello, new.vigencia_tope)
       is distinct from
       (old.modo, old.tipo, old.version, old.sello_economico, old.aliado_id, old.propietario_id, old.creado_por_id,
        old.cotizacion_origen_id, old.opcion_ref, old.acomodacion_ref, old.madre_version, old.madre_sello, old.vigencia_tope)) then
    raise exception 'COMPARATIVA_SOLO_RPC: esas columnas solo las escribe la operación de comparativa.' using errcode = '42501';
  end if;
  -- La hija nunca extiende su vigencia más allá de la madre (tope al elegir).
  if new.cotizacion_origen_id is not null and new.vigencia_tope is not null
     and (new.vigencia_hasta is null or new.vigencia_hasta > new.vigencia_tope) then
    raise exception 'COMPARATIVA_VIGENCIA: la vigencia de la cotización elegida no puede superar la de la comparativa (%).', new.vigencia_tope using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_cotizaciones_comparativa_guarda on public.cotizaciones;
create trigger trg_cotizaciones_comparativa_guarda
  before insert or update or delete on public.cotizaciones
  for each row execute function f211_priv.tg_cotizaciones_guarda();

-- 4.2 Descartar una hija deja constancia en el historial, venga de donde venga.
create or replace function f211_priv.tg_hija_descartada() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.cotizacion_comparativa_eventos
    (cotizacion_id, tenant, tipo, hija_id, opcion_ref, acomodacion_ref, version, actor_tipo, actor_id)
  values (new.cotizacion_origen_id, new.tenant, 'hija_descartada', new.id, new.opcion_ref,
          new.acomodacion_ref, new.madre_version, 'sistema', auth.uid());
  return null;
end $$;
drop trigger if exists trg_cotizaciones_hija_descartada on public.cotizaciones;
create trigger trg_cotizaciones_hija_descartada
  after update of estado on public.cotizaciones
  for each row when (new.cotizacion_origen_id is not null and new.estado = 'descartada'
                     and old.estado is distinct from 'descartada')
  execute function f211_priv.tg_hija_descartada();

-- 4.3 cotizacion_servicios: la madre no se toca; la etiqueta de opción, tampoco.
create or replace function f211_priv.tg_servicios_guarda() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_cot bigint; v_modo text;
begin
  if current_user not in ('authenticated', 'anon', 'service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_cot := case when tg_op = 'DELETE' then old.cotizacion_id else new.cotizacion_id end;
  select modo into v_modo from public.cotizaciones where id = v_cot;
  if v_modo = 'comparativa'
     or (tg_op <> 'DELETE' and new.opcion_ref is not null)
     or (tg_op = 'UPDATE' and old.cotizacion_id <> new.cotizacion_id) then
    raise exception 'COMPARATIVA_INMUTABLE: los servicios de una comparativa no se modifican.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_cot_servicios_comparativa_guarda on public.cotizacion_servicios;
create trigger trg_cot_servicios_comparativa_guarda
  before insert or update or delete on public.cotizacion_servicios
  for each row execute function f211_priv.tg_servicios_guarda();

-- 4.4 Una madre NUNCA recibe pagos previos, condiciones congeladas ni ventas.
-- Sin excepción por rol: protege también las llamadas directas a los RPC de dinero.
create or replace function f211_priv.tg_madre_sin_dinero() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id bigint; v_modo text;
begin
  v_id := case tg_table_name when 'ventas' then new.cotizacion_id else new.cotizacion_id end;
  if v_id is null then return new; end if;
  select modo into v_modo from public.cotizaciones where id = v_id;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no admite pagos, condiciones ni contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_madre_sin_pagos on public.cotizacion_pagos_previos;
create trigger trg_madre_sin_pagos before insert or update of cotizacion_id on public.cotizacion_pagos_previos
  for each row execute function f211_priv.tg_madre_sin_dinero();
drop trigger if exists trg_madre_sin_condiciones on public.cotizacion_condiciones;
create trigger trg_madre_sin_condiciones before insert or update of cotizacion_id on public.cotizacion_condiciones
  for each row execute function f211_priv.tg_madre_sin_dinero();
drop trigger if exists trg_madre_sin_venta on public.ventas;
create trigger trg_madre_sin_venta before insert or update of cotizacion_id on public.ventas
  for each row execute function f211_priv.tg_madre_sin_dinero();

-- 4.5 Opciones: inmutables. Eventos: solo inserción.
create or replace function f211_priv.tg_inmutable() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  raise exception 'COMPARATIVA_INMUTABLE: % es de solo inserción.', tg_table_name using errcode = '42501';
end $$;
drop trigger if exists trg_opciones_inmutables on public.cotizacion_opciones;
create trigger trg_opciones_inmutables before update or delete on public.cotizacion_opciones
  for each row execute function f211_priv.tg_inmutable();
drop trigger if exists trg_opciones_truncate on public.cotizacion_opciones;
create trigger trg_opciones_truncate before truncate on public.cotizacion_opciones
  for each statement execute function f211_priv.tg_inmutable();
drop trigger if exists trg_eventos_inmutables on public.cotizacion_comparativa_eventos;
create trigger trg_eventos_inmutables before update or delete on public.cotizacion_comparativa_eventos
  for each row execute function f211_priv.tg_inmutable();
drop trigger if exists trg_eventos_truncate on public.cotizacion_comparativa_eventos;
create trigger trg_eventos_truncate before truncate on public.cotizacion_comparativa_eventos
  for each statement execute function f211_priv.tg_inmutable();

-- 4.6 Solicitudes: transiciones válidas; identidad inmutable; el hash de IP solo se anula.
create or replace function f211_priv.tg_solicitudes_guarda() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'COMPARATIVA_INMUTABLE: las solicitudes no se borran.' using errcode = '42501';
  end if;
  if (new.cotizacion_id, new.tenant, new.version, new.contacto_nombre, new.contacto_telefono, new.contacto_email,
      new.contacto_huella_tel, new.contacto_huella_mail, new.clave, new.created_at)
     is distinct from
     (old.cotizacion_id, old.tenant, old.version, old.contacto_nombre, old.contacto_telefono, old.contacto_email,
      old.contacto_huella_tel, old.contacto_huella_mail, old.clave, old.created_at) then
    raise exception 'COMPARATIVA_INMUTABLE: los datos de la solicitud no se editan.' using errcode = '42501';
  end if;
  if new.ip_huella is distinct from old.ip_huella and new.ip_huella is not null then
    raise exception 'COMPARATIVA_INMUTABLE: el hash de IP solo puede anularse.' using errcode = '42501';
  end if;
  if old.estado <> 'pendiente' and (new.estado, new.hija_id, new.verificada_por, new.motivo, new.opcion_ref, new.acomodacion_ref)
     is distinct from (old.estado, old.hija_id, old.verificada_por, old.motivo, old.opcion_ref, old.acomodacion_ref) then
    raise exception 'COMPARATIVA_INMUTABLE: una solicitud resuelta no cambia.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_solicitudes_guarda on public.cotizacion_comparativa_solicitudes;
create trigger trg_solicitudes_guarda before update or delete on public.cotizacion_comparativa_solicitudes
  for each row execute function f211_priv.tg_solicitudes_guarda();
drop trigger if exists trg_solicitudes_truncate on public.cotizacion_comparativa_solicitudes;
create trigger trg_solicitudes_truncate before truncate on public.cotizacion_comparativa_solicitudes
  for each statement execute function f211_priv.tg_inmutable();

-- 4.7 Recibos: identidad inmutable; solo se consumen (una vez).
create or replace function f211_priv.tg_validaciones_guarda() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'COMPARATIVA_INMUTABLE: los recibos no se borran.' using errcode = '42501';
  end if;
  if (new.id, new.cotizacion_id, new.tenant, new.opcion_ref, new.acomodacion_ref, new.version, new.moneda, new.canal,
      new.actor_id, new.precio_reliquidado, new.huella, new.expira_en, new.created_at)
     is distinct from
     (old.id, old.cotizacion_id, old.tenant, old.opcion_ref, old.acomodacion_ref, old.version, old.moneda, old.canal,
      old.actor_id, old.precio_reliquidado, old.huella, old.expira_en, old.created_at) then
    raise exception 'COMPARATIVA_INMUTABLE: un recibo no se edita.' using errcode = '42501';
  end if;
  if old.consumida_en is not null and (new.consumida_en, new.hija_id, new.clave) is distinct from (old.consumida_en, old.hija_id, old.clave) then
    raise exception 'COMPARATIVA_RECIBO_CONSUMIDO: el recibo ya fue consumido.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_validaciones_guarda on public.cotizacion_comparativa_validaciones;
create trigger trg_validaciones_guarda before update or delete on public.cotizacion_comparativa_validaciones
  for each row execute function f211_priv.tg_validaciones_guarda();
drop trigger if exists trg_validaciones_truncate on public.cotizacion_comparativa_validaciones;
create trigger trg_validaciones_truncate before truncate on public.cotizacion_comparativa_validaciones
  for each statement execute function f211_priv.tg_inmutable();

-- ═════════════════════════════════════════════════════════════════════════
-- 5. RPC (todas SECURITY DEFINER, search_path fijo, lock_timeout)
-- ═════════════════════════════════════════════════════════════════════════

-- 5.1 Crear la madre (atómico: cabecera + servicios + opciones + sello + evento).
-- p_cabecera: {tipo, tenant, moneda, vigencia_hasta, cliente, cliente_documento,
--   destino, hotel, plan_nombre, pax, asesor, fecha_salida, fecha_regreso, payload, detalle}
-- p_servicios: [{orden,tipo_servicio,plataforma,nombre_servicio,proveedor,costo_neto,modo,
--   pct_markup,ta,valor,opcion_ref}]   (solo manual)
-- p_opciones: [{opcion_ref,acomodacion_ref,orden,etiqueta,tarifa_persona,total,
--   resumen_publico,plantilla_hija}]
create or replace function public.crear_cotizacion_comparativa(
  p_usuario_id uuid, p_cabecera jsonb, p_servicios jsonb, p_opciones jsonb, p_aliado_id bigint
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  v_tipo text := p_cabecera->>'tipo';
  v_tenant text := coalesce(nullif(p_cabecera->>'tenant',''), 'mayorista');
  v_moneda text := upper(coalesce(p_cabecera->>'moneda',''));
  v_vig date := nullif(p_cabecera->>'vigencia_hasta','')::date;
  v_u public.usuarios;
  v_al public.aliados;
  v_tipo_asesor text := coalesce(p_cabecera#>>'{payload,tipoAsesor}', 'interno');
  v_id bigint;
  o jsonb; s jsonb;
  v_refs text[];
  v_pares text[] := '{}';
  v_par text;
begin
  if v_tipo not in ('comparativa_manual','comparativa_carrito') then
    raise exception 'COMPARATIVA_DATOS: tipo de comparativa inválido.' using errcode = 'P0001';
  end if;
  if v_moneda not in ('COP','USD') then
    raise exception 'COMPARATIVA_DATOS: moneda inválida.' using errcode = 'P0001';
  end if;
  if v_vig is null or v_vig < public.fecha_negocio() then
    raise exception 'COMPARATIVA_DATOS: la vigencia debe ser hoy o posterior.' using errcode = 'P0001';
  end if;

  -- Actor: manual = interno; carrito = anónimo, B2B o interno (identidad releída).
  if p_usuario_id is not null then
    select * into v_u from public.usuarios where id = p_usuario_id;
    if not found or v_u.activo is not true then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para crear la comparativa.' using errcode = '42501';
    end if;
  end if;
  if v_tipo = 'comparativa_manual' then
    if v_u.id is null or v_u.rol not in ('superadmin','gerencia','administracion','operaciones','venta') then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: solo personal interno crea una comparativa manual.' using errcode = '42501';
    end if;
    if v_u.rol = 'superadmin' then
      if v_tenant not in ('mayorista','minorista') then
        raise exception 'COMPARATIVA_DATOS: agencia inválida.' using errcode = 'P0001';
      end if;
    else
      v_tenant := v_u.tenant;      -- ignora lo que diga el cliente
    end if;
  else
    v_tenant := 'mayorista';       -- el tarifario público es exclusivo de mayorista
    if v_u.id is not null and v_u.rol not in ('superadmin','gerencia','administracion','operaciones','venta','agencia','freelance') then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: tu rol no crea comparativas.' using errcode = '42501';
    end if;
  end if;

  -- Aliado: vínculo del catálogo (nunca texto libre).
  if p_aliado_id is not null then
    select * into v_al from public.aliados where id = p_aliado_id;
    if not found then
      raise exception 'COMPARATIVA_DATOS: el aliado no existe.' using errcode = 'P0001';
    end if;
    if v_tipo_asesor = 'interno' or v_tipo_asesor not in ('agencia','freelance') then
      raise exception 'COMPARATIVA_DATOS: el tipo de venta no admite aliado.' using errcode = 'P0001';
    end if;
    if v_al.tipo is not null and lower(v_al.tipo) not like '%' || (case v_tipo_asesor when 'agencia' then 'agencia' else 'free' end) || '%' then
      raise exception 'COMPARATIVA_DATOS: el aliado es de otro tipo que la venta.' using errcode = 'P0001';
    end if;
  elsif v_tipo_asesor <> 'interno' and v_tipo = 'comparativa_manual' then
    -- Sin aliado del catálogo solo personal interno podrá resolverla: se permite, queda sin propietario B2B.
    null;
  end if;

  -- Opciones: 2..3 hoteles (opcion_ref), una moneda, totales positivos, pares únicos.
  if jsonb_typeof(p_opciones) <> 'array' or jsonb_array_length(p_opciones) < 2 or jsonb_array_length(p_opciones) > 9 then
    raise exception 'COMPARATIVA_DATOS: una comparativa necesita entre 2 y 3 hoteles.' using errcode = 'P0001';
  end if;
  select array_agg(distinct x->>'opcion_ref') into v_refs from jsonb_array_elements(p_opciones) x;
  if array_length(v_refs, 1) < 2 or array_length(v_refs, 1) > 3 then
    raise exception 'COMPARATIVA_DATOS: una comparativa necesita entre 2 y 3 hoteles.' using errcode = 'P0001';
  end if;
  for o in select * from jsonb_array_elements(p_opciones) loop
    v_par := (o->>'opcion_ref') || '/' || (o->>'acomodacion_ref');
    if v_par = any (v_pares) then
      raise exception 'COMPARATIVA_DATOS: opción y acomodación repetidas (%).', v_par using errcode = 'P0001';
    end if;
    v_pares := v_pares || v_par;
    if upper(o->>'moneda') <> v_moneda then
      raise exception 'COMPARATIVA_DATOS: todas las opciones deben estar en la misma moneda.' using errcode = 'P0001';
    end if;
    if coalesce((o->>'total')::numeric, 0) <= 0 then
      raise exception 'COMPARATIVA_DATOS: cada opción necesita un total positivo.' using errcode = 'P0001';
    end if;
  end loop;

  -- v_id fijo antes de insertar: así la madre nace con su propio id en el payload si hiciera falta.
  insert into public.cotizaciones (
    tenant, tipo, modo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo,
    plan_nombre, pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por,
    aliado_id, propietario_id, creado_por_id
  ) values (
    v_tenant, v_tipo, 'comparativa', 'abierta', p_cabecera->'payload', p_cabecera->'detalle',
    p_cabecera->>'cliente', p_cabecera->>'cliente_documento', p_cabecera->>'destino', null,
    case when v_tipo = 'comparativa_manual' then 'manual' else 'carrito' end,
    p_cabecera->>'plan_nombre', nullif(p_cabecera->>'pax','')::int, null, v_moneda,
    nullif(p_cabecera->>'fecha_salida','')::date, nullif(p_cabecera->>'fecha_regreso','')::date,
    v_vig, p_cabecera->>'asesor', p_cabecera->>'creado_por',
    p_aliado_id,
    case when v_u.rol in ('agencia','freelance') then v_u.id else null end,
    v_u.id
  ) returning id into v_id;

  for s in select * from jsonb_array_elements(coalesce(p_servicios, '[]'::jsonb)) loop
    insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio,
        proveedor, costo_neto, modo, pct_markup, ta, valor, opcion_ref)
    values (v_id, coalesce((s->>'orden')::int, 0), s->>'tipo_servicio', s->>'plataforma', s->>'nombre_servicio',
        s->>'proveedor', coalesce((s->>'costo_neto')::numeric, 0), coalesce(s->>'modo','mk'),
        coalesce((s->>'pct_markup')::numeric, 0), coalesce((s->>'ta')::numeric, 0),
        coalesce((s->>'valor')::numeric, 0), nullif(s->>'opcion_ref',''));
  end loop;

  for o in select * from jsonb_array_elements(p_opciones) loop
    insert into public.cotizacion_opciones (cotizacion_id, tenant, opcion_ref, acomodacion_ref, orden, etiqueta,
        moneda, tarifa_persona, total, resumen_publico, plantilla_hija)
    values (v_id, v_tenant, o->>'opcion_ref', o->>'acomodacion_ref', coalesce((o->>'orden')::int, 0),
        o->>'etiqueta', v_moneda, nullif(o->>'tarifa_persona','')::numeric, (o->>'total')::numeric,
        o->'resumen_publico', o->'plantilla_hija');
  end loop;

  update public.cotizaciones set sello_economico = f211_priv.sello_madre(v_id) where id = v_id;

  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, actor_tipo, actor_id, version, detalle)
  values (v_id, v_tenant, 'creada',
          case when v_u.id is null then 'publico' when v_u.rol in ('agencia','freelance') then 'b2b' else 'interno' end,
          v_u.id, 1, jsonb_build_object('opciones', jsonb_array_length(p_opciones)));
  return v_id;
end $$;

-- 5.2 Recibo de validación (lo emite el servidor DESPUÉS de revalidar el checkout).
create or replace function public.registrar_validacion_comparativa(
  p_madre_id bigint, p_opcion_ref text, p_acomodacion_ref text, p_version integer,
  p_canal text, p_actor_id uuid, p_precio_reliquidado numeric, p_moneda text,
  p_disponibilidad_ok boolean, p_datos_cliente jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  c public.cotizaciones; op public.cotizacion_opciones; v_id uuid;
begin
  select * into c from public.cotizaciones where id = p_madre_id;
  if not found or c.modo <> 'comparativa' or c.estado <> 'abierta' then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la comparativa ya no está disponible.' using errcode = 'P0001';
  end if;
  if p_version is distinct from c.version then
    raise exception 'COMPARATIVA_VERSION: la comparativa cambió; recárgala.' using errcode = 'P0001';
  end if;
  if c.vigencia_hasta < public.fecha_negocio() then
    raise exception 'COMPARATIVA_VENCIDA: la comparativa venció.' using errcode = 'P0001';
  end if;
  select * into op from public.cotizacion_opciones
   where cotizacion_id = c.id and opcion_ref = p_opcion_ref and acomodacion_ref = p_acomodacion_ref;
  if not found then
    raise exception 'COMPARATIVA_OPCION: la opción o la acomodación no existen.' using errcode = 'P0001';
  end if;
  if upper(p_moneda) <> op.moneda or p_precio_reliquidado is distinct from op.total then
    raise exception 'COMPARATIVA_PRECIO_CAMBIO: el precio de la opción cambió.' using errcode = 'P0001';
  end if;

  -- Autoridad del canal contra la base (no contra lo que declare el servidor).
  if p_canal = 'interno' then
    perform f211_priv.interno_activo(p_actor_id, c.tenant);
  elsif p_canal = 'b2b' then
    perform f211_priv.b2b_propietario(p_actor_id, c.id);
  elsif p_canal = 'publico' then
    if p_actor_id is not null or c.tipo <> 'comparativa_carrito' or c.tenant <> 'mayorista'
       or not f211_priv.madre_anonima(c) then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: esta comparativa no admite el canal público.' using errcode = '42501';
    end if;
  else
    raise exception 'COMPARATIVA_DATOS: canal inválido.' using errcode = 'P0001';
  end if;

  insert into public.cotizacion_comparativa_validaciones
    (cotizacion_id, tenant, opcion_ref, acomodacion_ref, version, moneda, canal, actor_id,
     precio_reliquidado, disponibilidad_ok, datos_cliente, huella, expira_en)
  values (c.id, c.tenant, p_opcion_ref, p_acomodacion_ref, c.version, op.moneda, p_canal, p_actor_id,
     p_precio_reliquidado, coalesce(p_disponibilidad_ok, false), p_datos_cliente,
     encode(sha256(convert_to(concat_ws('|', c.id, p_opcion_ref, p_acomodacion_ref, c.version, p_canal,
            coalesce(p_actor_id::text,'-'), p_precio_reliquidado, op.moneda, c.sello_economico,
            coalesce(p_datos_cliente::text,'-')), 'UTF8')), 'hex'),
     now() + interval '10 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- 5.3 Núcleo: crea la hija (lo llaman las RPC de elección y resolver_solicitud).
create or replace function f211_priv.crear_hija(
  p_madre_id bigint, p_opcion text, p_acom text, p_version integer, p_canal text,
  p_actor_id uuid, p_validacion uuid, p_solicitud bigint, p_clave text, p_huella text,
  p_datos_cliente jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones; op public.cotizacion_opciones; pl jsonb; v_pay jsonb; v_det jsonb;
  v_hija bigint; v_vig date; v_suma numeric; v_esperado numeric; v_email text; n int;
begin
  select * into c from public.cotizaciones where id = p_madre_id for update;
  if not found or c.modo <> 'comparativa' or c.estado <> 'abierta' then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la comparativa ya no está disponible.' using errcode = 'P0001';
  end if;
  if p_version is distinct from c.version then
    raise exception 'COMPARATIVA_VERSION: la comparativa cambió; recárgala.' using errcode = 'P0001';
  end if;
  if c.vigencia_hasta < public.fecha_negocio() then
    raise exception 'COMPARATIVA_VENCIDA: la comparativa venció.' using errcode = 'P0001';
  end if;
  -- Integridad: nadie alteró lo económico (ni siquiera fuera de la API).
  if c.sello_economico is null or c.sello_economico <> f211_priv.sello_madre(c.id) then
    raise exception 'COMPARATIVA_MADRE_ALTERADA: la comparativa fue alterada; no se puede elegir.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cotizaciones h where h.cotizacion_origen_id = c.id and h.estado <> 'descartada') then
    raise exception 'COMPARATIVA_HIJA_ACTIVA: ya hay una opción elegida; descártala (sin pagos) para elegir otra.' using errcode = 'P0001';
  end if;
  select * into op from public.cotizacion_opciones
   where cotizacion_id = c.id and opcion_ref = p_opcion and acomodacion_ref = p_acom;
  if not found then
    raise exception 'COMPARATIVA_OPCION: la opción o la acomodación no existen.' using errcode = 'P0001';
  end if;

  pl := op.plantilla_hija;
  v_vig := least(c.vigencia_hasta, case when p_canal = 'publico' then public.fecha_negocio() + 1 else c.vigencia_hasta end);
  v_pay := pl->'payload';
  v_det := pl->'detalle';
  if p_datos_cliente is not null then
    v_pay := jsonb_set(coalesce(v_pay, '{}'::jsonb), '{cliente}', p_datos_cliente, true);
    v_det := jsonb_set(coalesce(v_det, '{}'::jsonb), '{venta,cliente}',
               to_jsonb(btrim(coalesce(p_datos_cliente->>'nombres','') || ' ' || coalesce(p_datos_cliente->>'apellidos',''))), true);
    v_det := jsonb_set(v_det, '{venta,cliente_documento}', to_jsonb(coalesce(p_datos_cliente->>'numeroDoc','')), true);
    v_det := jsonb_set(v_det, '{venta,cliente_telefono}', to_jsonb(coalesce(p_datos_cliente->>'telefono','')), true);
  end if;
  if p_actor_id is not null then select email into v_email from public.usuarios where id = p_actor_id; end if;

  insert into public.cotizaciones (
    tenant, tipo, modo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre,
    pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por,
    aliado_id, propietario_id, creado_por_id,
    cotizacion_origen_id, opcion_ref, acomodacion_ref, madre_version, madre_sello, vigencia_tope
  ) values (
    c.tenant, case c.tipo when 'comparativa_manual' then 'manual' else 'carrito' end, 'simple', 'abierta',
    v_pay, v_det,
    coalesce(nullif(btrim(coalesce(p_datos_cliente->>'nombres','') || ' ' || coalesce(p_datos_cliente->>'apellidos','')), ''), pl->>'cliente', c.cliente),
    coalesce(nullif(p_datos_cliente->>'numeroDoc',''), pl->>'cliente_documento', c.cliente_documento),
    coalesce(pl->>'destino', c.destino), pl->>'hotel',
    case c.tipo when 'comparativa_manual' then 'manual' else 'carrito' end,
    coalesce(pl->>'plan_nombre', c.plan_nombre), coalesce(nullif(pl->>'pax','')::int, c.pax),
    op.total, op.moneda,
    coalesce(nullif(pl->>'fecha_salida','')::date, c.fecha_salida), coalesce(nullif(pl->>'fecha_regreso','')::date, c.fecha_regreso),
    v_vig, c.asesor, c.creado_por,
    c.aliado_id, c.propietario_id, c.creado_por_id,
    c.id, p_opcion, p_acom, c.version, c.sello_economico, c.vigencia_hasta
  ) returning id into v_hija;

  if c.tipo = 'comparativa_manual' then
    insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio,
        proveedor, costo_neto, modo, pct_markup, ta, valor, opcion_ref)
    -- `orden` se renumera 0..n-1 (igual que una cotización dinámica común).
    select v_hija, (row_number() over (order by s.orden, s.id) - 1)::int, s.tipo_servicio, s.plataforma, s.nombre_servicio,
           s.proveedor, s.costo_neto, s.modo, s.pct_markup, s.ta, s.valor, null
      from public.cotizacion_servicios s
     where s.cotizacion_id = c.id and (s.opcion_ref is null or s.opcion_ref = p_opcion)
     order by s.orden, s.id;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'COMPARATIVA_INCOHERENTE: la opción no tiene servicios.' using errcode = 'P0001';
    end if;
    select coalesce(sum(valor), 0) into v_suma from public.cotizacion_servicios where cotizacion_id = v_hija;
    v_esperado := v_suma + greatest(coalesce((v_pay->>'recobro')::numeric, 0), 0)
                  + greatest(floor(coalesce((v_pay->>'ninos')::numeric, 0)), 0) * greatest(coalesce((v_pay->>'tarifaNino')::numeric, 0), 0);
  else
    select coalesce(sum((i->>'precio')::numeric), 0) into v_suma from jsonb_array_elements(coalesce(v_pay->'items','[]'::jsonb)) i;
    v_esperado := v_suma + coalesce((select sum((t->>'precio')::numeric) from jsonb_array_elements(coalesce(v_pay->'tours','[]'::jsonb)) t), 0);
  end if;
  if abs(v_esperado - op.total) > 0.5 then
    raise exception 'COMPARATIVA_INCOHERENTE: el total de la opción no coincide con sus componentes (% vs %).', v_esperado, op.total using errcode = 'P0001';
  end if;

  insert into public.cotizacion_comparativa_eventos
    (cotizacion_id, tenant, tipo, hija_id, opcion_ref, acomodacion_ref, version, actor_tipo, actor_id,
     validacion_id, solicitud_id, clave, huella, detalle)
  values (c.id, c.tenant, 'elegida', v_hija, p_opcion, p_acom, c.version, p_canal, p_actor_id,
     p_validacion, p_solicitud, p_clave, p_huella, jsonb_build_object('total', op.total, 'moneda', op.moneda));

  -- Las demás solicitudes pendientes quedan "superadas" (con evento).
  with sup as (
    update public.cotizacion_comparativa_solicitudes
       set estado = 'superada', ip_huella = null
     where cotizacion_id = c.id and estado = 'pendiente' and id is distinct from p_solicitud
    returning id)
  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, hija_id, actor_tipo)
  select c.id, c.tenant, 'solicitud_superada', id, v_hija, 'sistema' from sup;
  return v_hija;
end $$;

-- 5.4 Elegir con sesión (interno / B2B): la identidad sale de auth.uid().
create or replace function public.elegir_opcion_comparativa_sesion(p_validacion uuid, p_clave text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  r public.cotizacion_comparativa_validaciones; v_uid uuid := auth.uid(); v_hija bigint; v_prev public.cotizacion_comparativa_eventos;
begin
  if v_uid is null then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: inicia sesión para continuar.' using errcode = '42501';
  end if;
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave de idempotencia inválida.' using errcode = 'P0001';
  end if;
  select * into r from public.cotizacion_comparativa_validaciones where id = p_validacion for update;
  if not found or r.canal = 'publico' or r.actor_id is distinct from v_uid then
    raise exception 'COMPARATIVA_RECIBO: recibo inválido.' using errcode = 'P0001';
  end if;
  -- Identidad y propiedad releídas desde la base con auth.uid() (no desde el recibo),
  -- ANTES de cualquier respuesta: tampoco un reintento devuelve datos a quien ya no puede actuar.
  if r.canal = 'interno' then
    perform f211_priv.interno_activo(v_uid, r.tenant);
  else
    perform f211_priv.b2b_propietario(v_uid, r.cotizacion_id);
  end if;
  if r.consumida_en is not null then
    if r.clave = p_clave then return r.hija_id; end if;
    raise exception 'COMPARATIVA_RECIBO: el recibo ya fue usado.' using errcode = 'P0001';
  end if;
  if r.expira_en <= now() then
    raise exception 'COMPARATIVA_RECIBO: el recibo venció; vuelve a intentarlo.' using errcode = 'P0001';
  end if;
  -- Idempotencia por clave de madre (otro recibo, misma clave → misma hija o rechazo).
  select * into v_prev from public.cotizacion_comparativa_eventos
   where cotizacion_id = r.cotizacion_id and tipo = 'elegida' and clave = p_clave;
  if found then
    if v_prev.huella = r.huella then return v_prev.hija_id; end if;
    raise exception 'COMPARATIVA_CLAVE: la clave ya se usó con otros datos.' using errcode = 'P0001';
  end if;
  v_hija := f211_priv.crear_hija(r.cotizacion_id, r.opcion_ref, r.acomodacion_ref, r.version, r.canal,
                                 v_uid, r.id, null, p_clave, r.huella, null);
  update public.cotizacion_comparativa_validaciones
     set consumida_en = now(), hija_id = v_hija, clave = p_clave, datos_cliente = null
   where id = r.id;
  return v_hija;
end $$;

-- 5.5 Elegir por checkout público (anónimo): solo service_role.
create or replace function public.elegir_opcion_comparativa_publica(p_validacion uuid, p_clave text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  r public.cotizacion_comparativa_validaciones; c public.cotizaciones; v_hija bigint; v_prev public.cotizacion_comparativa_eventos;
begin
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave de idempotencia inválida.' using errcode = 'P0001';
  end if;
  select * into r from public.cotizacion_comparativa_validaciones where id = p_validacion for update;
  if not found or r.canal <> 'publico' or r.actor_id is not null then
    raise exception 'COMPARATIVA_RECIBO: recibo inválido.' using errcode = 'P0001';
  end if;
  if r.consumida_en is not null then
    if r.clave = p_clave then return r.hija_id; end if;
    raise exception 'COMPARATIVA_RECIBO: el recibo ya fue usado.' using errcode = 'P0001';
  end if;
  if r.expira_en <= now() then
    raise exception 'COMPARATIVA_RECIBO: el recibo venció; vuelve a intentarlo.' using errcode = 'P0001';
  end if;
  select * into c from public.cotizaciones where id = r.cotizacion_id;
  if c.tipo <> 'comparativa_carrito' or c.tenant <> 'mayorista' or not f211_priv.madre_anonima(c) then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: esta comparativa no admite el canal público.' using errcode = '42501';
  end if;
  select * into v_prev from public.cotizacion_comparativa_eventos
   where cotizacion_id = r.cotizacion_id and tipo = 'elegida' and clave = p_clave;
  if found then
    if v_prev.huella = r.huella then return v_prev.hija_id; end if;
    raise exception 'COMPARATIVA_CLAVE: la clave ya se usó con otros datos.' using errcode = 'P0001';
  end if;
  v_hija := f211_priv.crear_hija(r.cotizacion_id, r.opcion_ref, r.acomodacion_ref, r.version, 'publico',
                                 null, r.id, null, p_clave, r.huella, r.datos_cliente);
  update public.cotizacion_comparativa_validaciones
     set consumida_en = now(), hija_id = v_hija, clave = p_clave, datos_cliente = null
   where id = r.id;
  return v_hija;
end $$;

-- 5.6 Solicitud pública (manual / madres no anónimas). Coexisten; no reservan nada.
-- Topes: bajo el MISMO bloqueo de la madre → exactos aun con concurrencia.
create or replace function public.registrar_solicitud_comparativa(
  p_madre_id bigint, p_opcion_ref text, p_acomodacion_ref text, p_version integer,
  p_nombre text, p_telefono text, p_email text, p_nota text, p_clave text, p_ip_huella text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  c public.cotizaciones; v_tel text; v_mail text; v_ht text; v_hm text; v_ip text := coalesce(nullif(p_ip_huella,''), 'sin-ip');
  v_prev public.cotizacion_comparativa_solicitudes; v_id bigint; n int; v_cap int;
  c_tope_pendientes constant int := 50;
  c_ip_hora constant int := 3;
  c_sinip_hora constant int := 10;
  c_contacto_dia constant int := 3;
begin
  perform f211_priv.purgar_ip_huella();
  v_tel := nullif(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), '');
  v_mail := nullif(lower(btrim(coalesce(p_email,''))), '');
  if length(btrim(coalesce(p_nombre,''))) < 2 or length(p_nombre) > 120 then
    raise exception 'COMPARATIVA_DATOS: indica tu nombre.' using errcode = 'P0001';
  end if;
  if v_tel is not null and (length(v_tel) < 7 or length(v_tel) > 15) then
    raise exception 'COMPARATIVA_DATOS: el teléfono no es válido.' using errcode = 'P0001';
  end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'COMPARATIVA_DATOS: el correo no es válido.' using errcode = 'P0001';
  end if;
  if v_tel is null and v_mail is null then
    raise exception 'COMPARATIVA_DATOS: indica un teléfono o un correo de contacto.' using errcode = 'P0001';
  end if;
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave inválida.' using errcode = 'P0001';
  end if;

  -- Bloqueo de la madre: serializa solicitudes entre sí y con la elección.
  select * into c from public.cotizaciones where id = p_madre_id for update;
  if not found or c.modo <> 'comparativa' or c.estado <> 'abierta' or c.vigencia_hasta < public.fecha_negocio() then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la comparativa ya no está disponible.' using errcode = 'P0001';
  end if;
  if p_version is distinct from c.version then
    raise exception 'COMPARATIVA_VERSION: la comparativa cambió; recárgala.' using errcode = 'P0001';
  end if;
  if f211_priv.madre_anonima(c) and c.tipo = 'comparativa_carrito' then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: esta comparativa continúa por el checkout.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cotizacion_opciones where cotizacion_id = c.id
                  and opcion_ref = p_opcion_ref and acomodacion_ref = p_acomodacion_ref) then
    raise exception 'COMPARATIVA_OPCION: la opción o la acomodación no existen.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cotizaciones h where h.cotizacion_origen_id = c.id and h.estado <> 'descartada') then
    raise exception 'COMPARATIVA_HIJA_ACTIVA: ya hay una opción elegida para esta comparativa.' using errcode = 'P0001';
  end if;

  v_ht := case when v_tel is null then null else encode(sha256(convert_to('tel:' || v_tel, 'UTF8')), 'hex') end;
  v_hm := case when v_mail is null then null else encode(sha256(convert_to('mail:' || v_mail, 'UTF8')), 'hex') end;

  -- Reintento idempotente (misma clave).
  select * into v_prev from public.cotizacion_comparativa_solicitudes where cotizacion_id = c.id and clave = p_clave;
  if found then
    return jsonb_build_object('id', v_prev.id, 'estado', v_prev.estado, 'repetida', true);
  end if;

  -- Misma persona (mismo teléfono o correo) con solicitud pendiente: se actualiza su opción.
  select * into v_prev from public.cotizacion_comparativa_solicitudes
   where cotizacion_id = c.id and estado = 'pendiente'
     and ((v_ht is not null and contacto_huella_tel = v_ht) or (v_hm is not null and contacto_huella_mail = v_hm))
   order by id limit 1 for update;
  if found then
    update public.cotizacion_comparativa_solicitudes
       set opcion_ref = p_opcion_ref, acomodacion_ref = p_acomodacion_ref
     where id = v_prev.id;
    insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, opcion_ref, acomodacion_ref, version, actor_tipo, clave)
    values (c.id, c.tenant, 'solicitud_actualizada', v_prev.id, p_opcion_ref, p_acomodacion_ref, c.version, 'publico', p_clave);
    return jsonb_build_object('id', v_prev.id, 'estado', 'pendiente', 'actualizada', true);
  end if;

  -- Topes (exactos: ya tenemos la madre bloqueada).
  select count(*) into n from public.cotizacion_comparativa_solicitudes where cotizacion_id = c.id and estado = 'pendiente';
  if n >= c_tope_pendientes then
    raise exception 'COMPARATIVA_LIMITE: no pudimos registrar tu solicitud ahora.' using errcode = 'P0001';
  end if;
  v_cap := case when v_ip = 'sin-ip' then c_sinip_hora else c_ip_hora end;
  select count(*) into n from public.cotizacion_comparativa_solicitudes
   where cotizacion_id = c.id and ip_huella = v_ip and created_at > now() - interval '1 hour';
  if n >= v_cap then
    raise exception 'COMPARATIVA_LIMITE: no pudimos registrar tu solicitud ahora.' using errcode = 'P0001';
  end if;
  select count(*) into n from public.cotizacion_comparativa_solicitudes
   where cotizacion_id = c.id and created_at > now() - interval '1 day'
     and ((v_ht is not null and contacto_huella_tel = v_ht) or (v_hm is not null and contacto_huella_mail = v_hm));
  if n >= c_contacto_dia then
    raise exception 'COMPARATIVA_LIMITE: no pudimos registrar tu solicitud ahora.' using errcode = 'P0001';
  end if;

  insert into public.cotizacion_comparativa_solicitudes
    (cotizacion_id, tenant, opcion_ref, acomodacion_ref, version, contacto_nombre, contacto_telefono, contacto_email,
     nota, contacto_huella_tel, contacto_huella_mail, ip_huella, clave)
  values (c.id, c.tenant, p_opcion_ref, p_acomodacion_ref, c.version, btrim(p_nombre), v_tel, v_mail,
     nullif(btrim(coalesce(p_nota,'')), ''), v_ht, v_hm, v_ip, p_clave)
  returning id into v_id;
  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, opcion_ref, acomodacion_ref, version, actor_tipo, clave)
  values (c.id, c.tenant, 'solicitud_registrada', v_id, p_opcion_ref, p_acomodacion_ref, c.version, 'publico', p_clave);
  return jsonb_build_object('id', v_id, 'estado', 'pendiente');
end $$;

-- 5.7 Resolver una solicitud (personal interno, identidad por JWT).
create or replace function public.resolver_solicitud_comparativa(p_solicitud bigint, p_decision text, p_motivo text, p_clave text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  v_uid uuid := auth.uid(); sol public.cotizacion_comparativa_solicitudes; c public.cotizaciones;
  v_hija bigint; v_prev public.cotizacion_comparativa_eventos; v_cot bigint;
begin
  if v_uid is null then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: inicia sesión para continuar.' using errcode = '42501';
  end if;
  perform f211_priv.purgar_ip_huella();
  -- ORDEN DE BLOQUEOS ÚNICO en toda la comparativa: MADRE primero, luego solicitud
  -- (así lo hacen registrar_solicitud y crear_hija). Bloquear primero la solicitud
  -- provocaba un deadlock entre dos confirmaciones de solicitudes distintas.
  select cotizacion_id into v_cot from public.cotizacion_comparativa_solicitudes where id = p_solicitud;
  if v_cot is null then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud no existe.' using errcode = 'P0001';
  end if;
  select * into c from public.cotizaciones where id = v_cot for update;
  select * into sol from public.cotizacion_comparativa_solicitudes where id = p_solicitud for update;
  if not found then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud no existe.' using errcode = 'P0001';
  end if;
  perform f211_priv.interno_activo(v_uid, sol.tenant);
  if p_decision not in ('confirmar','rechazar') then
    raise exception 'COMPARATIVA_DATOS: decisión inválida.' using errcode = 'P0001';
  end if;
  if sol.estado <> 'pendiente' then
    if p_decision = 'confirmar' and sol.estado = 'atendida' and sol.hija_id is not null then return sol.hija_id; end if;
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud ya fue resuelta.' using errcode = 'P0001';
  end if;
  if p_decision = 'rechazar' then
    update public.cotizacion_comparativa_solicitudes
       set estado = 'rechazada', verificada_por = v_uid, motivo = left(p_motivo, 300), ip_huella = null, atendida_en = now()
     where id = sol.id;
    insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, actor_tipo, actor_id)
    values (sol.cotizacion_id, sol.tenant, 'solicitud_rechazada', sol.id, 'interno', v_uid);
    return null;
  end if;
  -- Confirmar: vencimiento efectivo (72 h o vigencia de la madre).
  if sol.created_at < now() - interval '72 hours' then
    raise exception 'COMPARATIVA_VENCIDA: la solicitud venció (72 h).' using errcode = 'P0001';
  end if;
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave de idempotencia inválida.' using errcode = 'P0001';
  end if;
  select * into v_prev from public.cotizacion_comparativa_eventos
   where cotizacion_id = sol.cotizacion_id and tipo = 'elegida' and clave = p_clave;
  if found then return v_prev.hija_id; end if;
  v_hija := f211_priv.crear_hija(sol.cotizacion_id, sol.opcion_ref, sol.acomodacion_ref, sol.version, 'interno',
              v_uid, null, sol.id, p_clave,
              encode(sha256(convert_to(concat_ws('|', sol.id, sol.opcion_ref, sol.acomodacion_ref, v_uid), 'UTF8')), 'hex'), null);
  update public.cotizacion_comparativa_solicitudes
     set estado = 'atendida', hija_id = v_hija, verificada_por = v_uid, ip_huella = null, atendida_en = now()
   where id = sol.id;
  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, hija_id, actor_tipo, actor_id)
  values (sol.cotizacion_id, sol.tenant, 'solicitud_atendida', sol.id, v_hija, 'interno', v_uid);
  return v_hija;
end $$;

-- 5.8 Listado B2B: la identidad es la de la SESIÓN (auth.uid()); un solo predicado.
create or replace function public.comparativas_b2b_visibles()
returns table (id bigint, codigo text, share_token uuid, estado text, tipo text, destino text,
               fecha_salida date, fecha_regreso date, moneda text, vigencia_hasta date, created_at timestamptz,
               opciones jsonb, hija jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v_uid uuid := auth.uid();
begin
  select * into u from public.usuarios where usuarios.id = v_uid;
  if v_uid is null or u.id is null or u.activo is not true or u.rol not in ('agencia','freelance') then
    return;
  end if;
  return query
  select c.id, c.codigo, c.share_token, c.estado, c.tipo, c.destino, c.fecha_salida, c.fecha_regreso, c.moneda,
         c.vigencia_hasta, c.created_at,
         (select coalesce(jsonb_agg(jsonb_build_object('opcion', o.opcion_ref, 'acomodacion', o.acomodacion_ref,
                 'etiqueta', o.etiqueta, 'tarifa_persona', o.tarifa_persona, 'total', o.total, 'moneda', o.moneda)
                 order by o.opcion_ref, o.acomodacion_ref), '[]'::jsonb)
            from public.cotizacion_opciones o where o.cotizacion_id = c.id),
         (select jsonb_build_object('id', h.id, 'codigo', h.codigo, 'estado', h.estado, 'numero_contrato', h.numero_contrato,
                                    'opcion', h.opcion_ref, 'acomodacion', h.acomodacion_ref, 'share_token', h.share_token)
            from public.cotizaciones h where h.cotizacion_origen_id = c.id and h.estado <> 'descartada' limit 1)
    from public.cotizaciones c
   where c.modo = 'comparativa' and c.tenant = u.tenant and c.estado <> 'descartada'
     and ((c.aliado_id is not null and c.aliado_id = u.aliado_id)
          or (c.aliado_id is null and c.propietario_id = u.id))
   order by c.created_at desc;
end $$;

-- ── ACL de funciones ──────────────────────────────────────────────────────
revoke all on function public.crear_cotizacion_comparativa(uuid, jsonb, jsonb, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.registrar_validacion_comparativa(bigint, text, text, integer, text, uuid, numeric, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.elegir_opcion_comparativa_publica(uuid, text) from public, anon, authenticated;
revoke all on function public.registrar_solicitud_comparativa(bigint, text, text, integer, text, text, text, text, text, text) from public, anon, authenticated;
-- Las RPC «con sesión» toman la identidad de auth.uid(): solo una sesión AUTÉNTICA las ejecuta. Se revoca también a
-- service_role (Supabase se lo concede por defecto a toda función nueva) para que la llave de servicio no pueda
-- hablar en nombre de un usuario ni siquiera con un JWT falsificado.
revoke all on function public.elegir_opcion_comparativa_sesion(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolver_solicitud_comparativa(bigint, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.comparativas_b2b_visibles() from public, anon, authenticated, service_role;
grant execute on function public.crear_cotizacion_comparativa(uuid, jsonb, jsonb, jsonb, bigint) to service_role;
grant execute on function public.registrar_validacion_comparativa(bigint, text, text, integer, text, uuid, numeric, text, boolean, jsonb) to service_role;
grant execute on function public.elegir_opcion_comparativa_publica(uuid, text) to service_role;
grant execute on function public.registrar_solicitud_comparativa(bigint, text, text, integer, text, text, text, text, text, text) to service_role;
grant execute on function public.elegir_opcion_comparativa_sesion(uuid, text) to authenticated;
grant execute on function public.resolver_solicitud_comparativa(bigint, text, text, text) to authenticated;
grant execute on function public.comparativas_b2b_visibles() to authenticated;
revoke all on all functions in schema f211_priv from public, anon, authenticated, service_role;

-- ── Verificación en la misma transacción ──────────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in
     ('cotizacion_opciones','cotizacion_comparativa_eventos','cotizacion_comparativa_validaciones','cotizacion_comparativa_solicitudes')
     and c.relrowsecurity;
  if v_n <> 4 then raise exception '211: RLS no quedó activo en las 4 tablas nuevas (%).', v_n; end if;
  if has_table_privilege('anon', 'public.cotizacion_comparativa_validaciones', 'select')
     or has_table_privilege('authenticated', 'public.cotizacion_comparativa_validaciones', 'select')
     or has_table_privilege('authenticated', 'public.cotizacion_opciones', 'insert') then
    raise exception '211: grants inesperados sobre las tablas nuevas.';
  end if;
end $$;

commit;
