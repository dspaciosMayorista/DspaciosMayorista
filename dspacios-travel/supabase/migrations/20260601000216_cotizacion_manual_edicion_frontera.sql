-- ═════════════════════════════════════════════════════════════════════════
-- 216 · #39 fase 1 (A, ADITIVA) — cotización manual: edición, frontera y wrappers.
--
-- Número reservado por el Coordinador (WORKSTREAMS.md, 2026-10-18). Scripts:
-- supabase/scripts/{preflight,postcheck,rollback}_216_cotizacion_manual_edicion.sql
-- y test_216_*.sql / test_216_*.sh (SOLO bases desechables: CI o local).
--
-- Orden de despliegue (decisión 2 del dueño):
--   preflight 216 → 216 → postcheck 216 → código nuevo → 217 (cierre) → postcheck 217.
-- Con SOLO la 216 aplicada nada cambia para la app vieja: los disparadores de
-- frontera nacen DESHABILITADOS y la edición de servicios queda apagada
-- (`edicion_cotizaciones_habilitada()` es falsa hasta que la 217 activa la frontera).
--
-- NO redefine ninguna función existente: la 198 (`registrar_pago_previo`,
-- `anular_pago_previo`, `transferir_pagos_previos_a_abonos`,
-- `convertir_cotizacion_a_contrato`), la 164, la 208 y la 211 quedan EXACTAMENTE
-- igual. Los wrappers de dinero son INVOKER: la 198 sigue corriendo como
-- `service_role` (la 208 decide `abonos.contabilizable` por `current_user`).
--
-- ── Qué agrega ─────────────────────────────────────────────────────────────
-- 1. `cotizaciones.economico_rev`: revisión económica propia (la `version` es de
--    la 211). Sube sola ante cualquier cambio económico; la API no la fija.
-- 2. `cotizacion_ediciones`: historial de ediciones con motivo, solo inserción.
-- 3. Esquema privado `p39_priv`: autorización ligada a la TRANSACCIÓN para los
--    wrappers (`emitir` / `cerrar` / `autorizada`), interruptor de suspensión y
--    comprobación de composición del primer pago. El cierre es un EVENTO aparte
--    (`autorizacion_cerrada`, solo inserción): ninguna fila se actualiza.
-- 4. RPC SECURITY DEFINER (solo service_role): crear la manual (estampa
--    `creado_por_id`), editar servicios y editar niños/recobro.
-- 5. Wrappers INVOKER (solo service_role): primer pago con revisión y
--    composición, anulación y conversión. Bloquean la cotización ANTES que el pago.
-- 6. Disparadores de frontera en `cotizaciones` (filas manuales),
--    `cotizacion_pagos_previos` y `cotizacion_condiciones`: creados DESHABILITADOS.
--
-- ── Frontera de autorización ──────────────────────────────────────────────
-- Alcance aceptado (decisión de frontera, 2026-10-17): impedir el desvío por la
-- Data API (`anon`, `authenticated` y REST con `service_role`). Una sesión SQL
-- privilegiada queda fuera; tampoco se defiende una clave service_role
-- comprometida. Los disparadores rechazan a los roles de la API y dejan pasar al
-- dueño de las funciones (el cuerpo de una RPC definer), igual que la 211.
-- `p39_priv` NO se expone: solo `service_role` tiene USAGE (lo necesita el
-- wrapper INVOKER para emitir la autorización); `anon` y `authenticated` nada.
--
-- ── Interruptor (C6) ───────────────────────────────────────────────────────
-- Suspender SOLO la nueva edición (pagos, anulaciones y conversiones siguen):
--   update p39_priv.suspension_edicion set suspendida = true, motivo = '...', actualizado_en = now();
-- Reanudar: lo mismo con `suspendida = false`. Lo cambia el dueño desde el
-- editor SQL; no hay pantalla.
-- ═════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

-- ═════════════════════════════════════════════════════════════════════════
-- 0. Guardas: dependencias presentes y la 217 todavía no aplicada.
-- ═════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is null
     or to_regprocedure('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)') is null
     or to_regprocedure('public.anular_pago_previo(bigint,uuid,text)') is null
     or to_regprocedure('public._autorizado_pago_previo(uuid)') is null
     or to_regprocedure('public.fecha_negocio(timestamptz)') is null
     or to_regprocedure('public.puede_ver_tenant_cotizacion(text)') is null
     or to_regprocedure('public.mi_rol()') is null
     or to_regclass('public.cotizacion_pagos_previos') is null
     or to_regclass('public.cotizacion_condiciones') is null
     or to_regnamespace('f211_priv') is null
     or not exists (select 1 from pg_catalog.pg_attribute a
                     where a.attrelid = 'public.cotizaciones'::regclass and a.attname = 'creado_por_id'
                       and a.attnum > 0 and not a.attisdropped) then
    raise exception '216: faltan piezas de las migraciones 154/164/198/211. No se aplicó nada.';
  end if;
  -- Reaplicar la 216 con la frontera ya activa la apagaría (recrea los disparadores
  -- deshabilitados): se niega. Para volver a A, primero el rollback de la 217.
  if exists (select 1 from pg_catalog.pg_trigger t
              where not t.tgisinternal and t.tgenabled <> 'D'
                and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39')) then
    raise exception '216: la frontera ya está activa (217 aplicada). No se reaplica la 216.';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Revisión económica propia
-- ═════════════════════════════════════════════════════════════════════════
alter table public.cotizaciones
  add column if not exists economico_rev integer not null default 1;

alter table public.cotizaciones
  drop constraint if exists cotizaciones_economico_rev_positiva,
  add constraint cotizaciones_economico_rev_positiva check (economico_rev >= 1);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Esquema privado y sus tablas (RLS activo, sin grants para nadie)
-- ═════════════════════════════════════════════════════════════════════════
create schema if not exists p39_priv;
revoke all on schema p39_priv from public, anon, authenticated, service_role;
grant usage on schema p39_priv to service_role;

-- Autorización emitida por un wrapper para SU transacción (txid) y SU cotización.
create table if not exists p39_priv.autorizacion_emitida (
  id            bigserial primary key,
  txid          bigint not null default txid_current(),
  cotizacion_id bigint not null,
  operacion     text not null check (operacion in ('pago', 'anulacion', 'conversion')),
  actor_id      uuid,
  creado_en     timestamptz not null default now()
);
create index if not exists idx_p39_autorizacion_txid
  on p39_priv.autorizacion_emitida (txid, cotizacion_id, operacion);

-- Cierre: un EVENTO aparte (no un UPDATE de la emitida).
create table if not exists p39_priv.autorizacion_cerrada (
  autorizacion_id bigint primary key references p39_priv.autorizacion_emitida (id),
  cerrada_en      timestamptz not null default now()
);

-- Interruptor de la nueva edición (una sola fila).
create table if not exists p39_priv.suspension_edicion (
  id             boolean primary key default true check (id),
  suspendida     boolean not null default false,
  motivo         text,
  actualizado_en timestamptz not null default now()
);
insert into p39_priv.suspension_edicion (id, suspendida) values (true, false) on conflict (id) do nothing;

alter table p39_priv.autorizacion_emitida enable row level security;
alter table p39_priv.autorizacion_cerrada enable row level security;
alter table p39_priv.suspension_edicion enable row level security;
revoke all on p39_priv.autorizacion_emitida, p39_priv.autorizacion_cerrada, p39_priv.suspension_edicion
  from public, anon, authenticated, service_role;
revoke all on sequence p39_priv.autorizacion_emitida_id_seq from public, anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Historial de ediciones (público, solo lectura por RLS; solo inserción)
-- ═════════════════════════════════════════════════════════════════════════
create table if not exists public.cotizacion_ediciones (
  id              bigserial primary key,
  cotizacion_id   bigint not null references public.cotizaciones (id) on delete restrict,
  tenant          text not null,
  tipo            text not null check (tipo in ('servicios', 'recobro_ninos')),
  actor_id        uuid not null,
  actor_rol       text not null,
  motivo          text not null check (length(btrim(motivo)) between 1 and 500),
  rev_anterior    integer not null,
  rev_nueva       integer not null,
  precio_anterior numeric(15,2),
  precio_nuevo    numeric(15,2),
  antes           jsonb not null,
  despues         jsonb not null,
  creado_en       timestamptz not null default now()
);
create index if not exists idx_cotizacion_ediciones_cotizacion on public.cotizacion_ediciones (cotizacion_id, id);

alter table public.cotizacion_ediciones enable row level security;
revoke all on public.cotizacion_ediciones from public, anon, authenticated, service_role;
revoke all on sequence public.cotizacion_ediciones_id_seq from public, anon, authenticated, service_role;
grant select on public.cotizacion_ediciones to authenticated, service_role;

drop policy if exists "cotizacion_ediciones: lectura" on public.cotizacion_ediciones;
create policy "cotizacion_ediciones: lectura" on public.cotizacion_ediciones for select to authenticated
  using (
    public.puede_ver_tenant_cotizacion(tenant)
    and (
      public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')
      or (public.mi_rol() = 'venta'
          and exists (select 1 from public.cotizaciones c
                       where c.id = cotizacion_ediciones.cotizacion_id and c.creado_por_id = auth.uid()))
    )
  );

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Funciones privadas
-- ═════════════════════════════════════════════════════════════════════════

-- 4.1 Autorización por transacción.
create or replace function p39_priv.emitir(p_cotizacion_id bigint, p_operacion text, p_actor_id uuid)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if p_operacion is null or p_operacion not in ('pago', 'anulacion', 'conversion') then
    raise exception 'FRONTERA_39: operación no reconocida.' using errcode = '22023';
  end if;
  insert into p39_priv.autorizacion_emitida (cotizacion_id, operacion, actor_id)
  values (p_cotizacion_id, p_operacion, p_actor_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function p39_priv.cerrar(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  insert into p39_priv.autorizacion_cerrada (autorizacion_id) values (p_id)
  on conflict (autorizacion_id) do nothing;
end $$;

-- VOLATILE a propósito: debe ver la emisión insertada antes, en la MISMA llamada
-- al wrapper (ver test_216_autorizada_volatil.sql).
create or replace function p39_priv.autorizada(p_cotizacion_id bigint, p_operacion text)
returns boolean
language sql volatile security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from p39_priv.autorizacion_emitida e
     where e.txid = txid_current()
       and e.cotizacion_id = p_cotizacion_id
       and e.operacion = p_operacion
       and not exists (select 1 from p39_priv.autorizacion_cerrada c where c.autorizacion_id = e.id)
  )
$$;

-- 4.2 ¿La frontera está realmente activa? Disparadores habilitados, permisos de
-- la 217 en su sitio y réplica de sesión normal. Cualquier desvío la apaga, y con
-- ella la edición.
create or replace function p39_priv.frontera_activa()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select current_setting('session_replication_role') = 'origin'
     and (select count(*) from pg_catalog.pg_trigger t
           where not t.tgisinternal and t.tgenabled in ('O', 'A')
             and ((t.tgrelid = 'public.cotizaciones'::regclass and t.tgname in ('trg_cot_frontera_39', 'trg_cot_economico_rev_39'))
               or (t.tgrelid = 'public.cotizacion_pagos_previos'::regclass and t.tgname = 'trg_cot_pagos_frontera_39')
               or (t.tgrelid = 'public.cotizacion_condiciones'::regclass and t.tgname = 'trg_cot_condiciones_frontera_39')
               or (t.tgrelid = 'public.cotizacion_servicios'::regclass
                   and t.tgname in ('trg_cot_servicios_rev_39_ins', 'trg_cot_servicios_rev_39_upd', 'trg_cot_servicios_rev_39_del')))) = 7
     and not has_table_privilege('anon', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
     and not has_table_privilege('authenticated', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
     and not has_table_privilege('service_role', 'public.cotizacion_servicios', 'INSERT,UPDATE,DELETE,TRUNCATE')
     and not has_table_privilege('anon', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
     and not has_table_privilege('authenticated', 'public.cotizacion_pagos_previos', 'INSERT,UPDATE,DELETE,TRUNCATE')
     and not has_table_privilege('service_role', 'public.cotizacion_pagos_previos', 'DELETE,TRUNCATE')
     and not has_table_privilege('anon', 'public.cotizacion_condiciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
     and not has_table_privilege('authenticated', 'public.cotizacion_condiciones', 'INSERT,UPDATE,DELETE,TRUNCATE')
     and not has_table_privilege('service_role', 'public.cotizacion_condiciones', 'TRUNCATE')
$$;

-- 4.3 Componentes de una manual, en SQL (mismo mapeo que `componentesDeManual`
-- en lib/cotizacion/componentesManual.ts): solo valor > 0, en orden, aéreo =
-- aereo_empaquetado, hotel = hotel, el resto = servicio; referencia = nombre o
-- etiqueta del tipo; valor a 2 decimales.
create or replace function p39_priv.componentes_manual(p_cotizacion_id bigint)
returns table (orden integer, tipo_componente text, referencia_externa text, valor_componente numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select (row_number() over (order by s.orden, s.id) - 1)::integer,
         case s.tipo_servicio when 'aereo' then 'aereo_empaquetado' when 'hotel' then 'hotel' else 'servicio' end,
         coalesce(nullif(btrim(coalesce(s.nombre_servicio, '')), ''),
                  case s.tipo_servicio when 'aereo' then 'Aéreo' when 'hotel' then 'Hotel' when 'traslado' then 'Traslado'
                                       when 'asistencia' then 'Asistencia médica' when 'otro' then 'Otro' else 'Servicio' end),
         round(coalesce(s.valor, 0), 2)
    from public.cotizacion_servicios s
   where s.cotizacion_id = p_cotizacion_id and coalesce(s.valor, 0) > 0
$$;

-- ¿El snapshot que manda la app corresponde EXACTAMENTE a los servicios de hoy?
create or replace function p39_priv.composicion_coincide(p_cotizacion_id bigint, p_snapshot jsonb)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  with esp as (
    select m.orden, m.tipo_componente, m.referencia_externa, m.valor_componente
      from p39_priv.componentes_manual(p_cotizacion_id) m
  ), rec as (
    select (r->>'orden')::integer as orden,
           r->>'tipo_componente' as tipo_componente,
           nullif(r->>'referencia_externa', '') as referencia_externa,
           round(coalesce((r->>'valor_componente')::numeric, 0), 2) as valor_componente
      from jsonb_array_elements(case when jsonb_typeof(p_snapshot) = 'array' then p_snapshot else '[]'::jsonb end) r
  )
  select coalesce(jsonb_typeof(p_snapshot) = 'array', false)
     and (select count(*) from esp) = (select count(*) from rec)
     and not exists (select * from esp except select * from rec)
     and not exists (select * from rec except select * from esp)
$$;

-- 4.4 Servicios válidos (estructura y números finitos; el precio lo liquida el servidor).
create or replace function p39_priv.validar_servicios(p_servicios jsonb)
returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare e jsonb; v_tipo text; v_modo text;
begin
  if jsonb_typeof(p_servicios) is distinct from 'array' or jsonb_array_length(p_servicios) = 0 then
    raise exception 'EDICION_39_SERVICIOS: la cotización debe tener al menos un servicio.' using errcode = 'P0001';
  end if;
  for e in select x from jsonb_array_elements(p_servicios) x loop
    -- Primero la forma y los tipos; recién después se convierte a numeric (el
    -- orden de evaluación de un OR no está garantizado).
    if jsonb_typeof(e) is distinct from 'object' then
      raise exception 'EDICION_39_SERVICIOS: hay un servicio con datos inválidos (tipo, modo o valores).' using errcode = 'P0001';
    end if;
    v_tipo := e->>'tipo_servicio';
    v_modo := coalesce(e->>'modo', 'mk');
    if v_tipo is null or v_tipo not in ('aereo', 'hotel', 'traslado', 'asistencia', 'otro')
       or v_modo not in ('mk', 'ta') or (v_modo = 'ta' and v_tipo <> 'aereo')
       or jsonb_typeof(e->'costo_neto') is distinct from 'number' or jsonb_typeof(e->'valor') is distinct from 'number'
       or jsonb_typeof(coalesce(e->'pct_markup', '0'::jsonb)) is distinct from 'number'
       or jsonb_typeof(coalesce(e->'ta', '0'::jsonb)) is distinct from 'number' then
      raise exception 'EDICION_39_SERVICIOS: hay un servicio con datos inválidos (tipo, modo o valores).' using errcode = 'P0001';
    end if;
    if (e->>'costo_neto')::numeric < 0 or (e->>'valor')::numeric < 0 then
      raise exception 'EDICION_39_SERVICIOS: hay un servicio con datos inválidos (tipo, modo o valores).' using errcode = 'P0001';
    end if;
  end loop;
end $$;

-- 4.5 Bloqueo + elegibilidad de la edición (C1, C2, C3 y revisión). Devuelve la
-- fila BLOQUEADA. El orden de las verificaciones es parte del contrato.
create or replace function p39_priv.bloquear_para_editar(
  p_cotizacion_id bigint, p_usuario_id uuid, p_rev_esperada integer, p_motivo text
) returns public.cotizaciones
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cotizaciones; u public.usuarios;
begin
  select * into u from public.usuarios where id = p_usuario_id;
  if not found or u.activo is not true
     or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') then
    raise exception 'EDICION_39_NO_AUTORIZADO: no tienes permiso para editar esta cotización.' using errcode = '42501';
  end if;
  select * into c from public.cotizaciones where id = p_cotizacion_id for update;
  if not found or (u.rol <> 'superadmin' and u.tenant is distinct from c.tenant) then
    raise exception 'EDICION_39_NO_AUTORIZADO: no tienes permiso para editar esta cotización.' using errcode = '42501';
  end if;
  if not (p39_priv.frontera_activa()
          and coalesce((select not s.suspendida from p39_priv.suspension_edicion s where s.id), false)) then
    raise exception 'EDICION_39_SUSPENDIDA: la edición de cotizaciones no está habilitada en este momento.' using errcode = 'P0001';
  end if;
  if c.tipo is distinct from 'manual' or c.modo is distinct from 'simple' or c.cotizacion_origen_id is not null then
    raise exception 'EDICION_39_NO_ELEGIBLE: solo se editan cotizaciones dinámicas simples (no comparativas ni opciones elegidas).' using errcode = 'P0001';
  end if;
  if c.estado is distinct from 'abierta' or c.numero_contrato is not null
     or exists (select 1 from public.ventas v where v.cotizacion_id = c.id) then
    raise exception 'EDICION_39_NO_ELEGIBLE: la cotización no está abierta.' using errcode = 'P0001';
  end if;
  if c.condicion_pago_congelada_en is not null then
    raise exception 'EDICION_39_CONGELADA: la cotización ya tiene condiciones congeladas por un pago.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cotizacion_pagos_previos p where p.cotizacion_id = c.id) then
    raise exception 'EDICION_39_CON_PAGOS: la cotización tuvo pagos previos (aunque estén anulados); no se edita.' using errcode = 'P0001';
  end if;
  if c.vigencia_hasta is null or c.vigencia_hasta < public.fecha_negocio() then
    raise exception 'EDICION_39_VENCIDA: la cotización está vencida; renueva su vigencia antes de editarla.' using errcode = 'P0001';
  end if;
  if u.rol = 'venta' and (c.creado_por_id is null or c.creado_por_id <> u.id) then
    raise exception 'EDICION_39_AUTOR: solo puedes editar las cotizaciones que tú creaste.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'EDICION_39_MOTIVO: indica el motivo del cambio.' using errcode = 'P0001';
  end if;
  if length(btrim(p_motivo)) > 500 then
    raise exception 'EDICION_39_MOTIVO: el motivo no puede pasar de 500 caracteres.' using errcode = 'P0001';
  end if;
  if p_rev_esperada is distinct from c.economico_rev then
    raise exception 'EDICION_39_REVISION: la cotización cambió mientras la editabas; recarga la página y vuelve a intentarlo.' using errcode = 'P0001';
  end if;
  return c;
end $$;

-- 4.6 Disparadores.

-- Revisión económica en `cotizaciones`. Nunca toca la madre (la 211 compara la
-- fila completa). Para la API la revisión es derivada (no se puede fijar); el
-- dueño (cuerpo de una RPC) puede subirla, nunca bajarla.
create or replace function p39_priv.tg_cot_economico_rev() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_api boolean := current_user in ('anon', 'authenticated', 'service_role');
  v_econ boolean;
begin
  if tg_op = 'INSERT' then
    if v_api then new.economico_rev := 1; end if;
    return new;
  end if;
  if old.modo = 'comparativa' then
    return new;
  end if;
  v_econ := (new.precio_venta, new.moneda, new.pax, new.destino, new.fecha_salida, new.fecha_regreso,
             new.hotel, new.plan_nombre, new.asesor)
            is distinct from
            (old.precio_venta, old.moneda, old.pax, old.destino, old.fecha_salida, old.fecha_regreso,
             old.hotel, old.plan_nombre, old.asesor)
         or ((coalesce(new.payload, '{}'::jsonb) - 'cliente') - 'incluye' - 'noIncluye')
            is distinct from ((coalesce(old.payload, '{}'::jsonb) - 'cliente') - 'incluye' - 'noIncluye')
         or ((((coalesce(new.detalle, '{}'::jsonb) - 'incluye') - 'noIncluye') #- '{venta,cliente}') #- '{venta,numero_contrato}')
            is distinct from ((((coalesce(old.detalle, '{}'::jsonb) - 'incluye') - 'noIncluye') #- '{venta,cliente}') #- '{venta,numero_contrato}');
  if v_api then
    new.economico_rev := old.economico_rev + case when v_econ then 1 else 0 end;
  else
    new.economico_rev := greatest(coalesce(new.economico_rev, old.economico_rev),
                                  old.economico_rev + case when v_econ then 1 else 0 end);
  end if;
  return new;
end $$;

-- Cualquier cambio en los servicios sube la revisión de su cotización (salvo
-- madres). Se dispara por sentencia: una sola subida por sentencia.
create or replace function p39_priv.tg_servicios_economico_rev() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.cotizaciones c set economico_rev = c.economico_rev + 1
     where c.modo <> 'comparativa' and c.id in (select n.cotizacion_id from nuevas n);
  elsif tg_op = 'DELETE' then
    update public.cotizaciones c set economico_rev = c.economico_rev + 1
     where c.modo <> 'comparativa' and c.id in (select v.cotizacion_id from viejas v);
  else
    update public.cotizaciones c set economico_rev = c.economico_rev + 1
     where c.modo <> 'comparativa'
       and c.id in (select n.cotizacion_id from nuevas n union select v.cotizacion_id from viejas v);
  end if;
  return null;
end $$;

-- Frontera de `cotizaciones` (solo filas manuales, simples o hijas).
create or replace function p39_priv.tg_frontera_cotizaciones() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_rol  text := current_user;
  v_pago boolean := false;
  v_conv boolean := false;
  v_libres text[] := array['vigencia_hasta', 'cliente', 'cliente_documento', 'estado', 'payload', 'detalle', 'economico_rev'];
  v_det_n jsonb;
  v_det_o jsonb;
begin
  if v_rol not in ('anon', 'authenticated', 'service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.tipo = 'manual' then
      raise exception 'FRONTERA_39: una cotización dinámica solo se crea con la operación de creación.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.tipo = 'manual' then
      raise exception 'FRONTERA_39: una cotización dinámica no se borra.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.tipo is distinct from 'manual' and new.tipo is distinct from 'manual' then
    return new;
  end if;
  -- Solo service_role puede tener una autorización (los wrappers corren con él).
  if v_rol = 'service_role' then
    v_pago := p39_priv.autorizada(old.id, 'pago');
    v_conv := p39_priv.autorizada(old.id, 'conversion');
  end if;
  if v_pago then
    v_libres := v_libres || array['condicion_pago_congelada_en', 'moneda_congelada', 'trm_autoritativa', 'precio_total_congelado',
                                  'monto_exigido_total', 'monto_exigido_total_cop', 'pct_efectivo_informativo'];
  end if;
  if v_conv then
    v_libres := v_libres || array['numero_contrato', 'condicion_pago_congelada_en'];
  end if;
  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'FRONTERA_39: los datos económicos de una cotización dinámica solo se cambian con su operación autorizada.' using errcode = '42501';
  end if;
  if ((coalesce(new.payload, '{}'::jsonb) - 'cliente') - 'incluye' - 'noIncluye')
     is distinct from ((coalesce(old.payload, '{}'::jsonb) - 'cliente') - 'incluye' - 'noIncluye') then
    raise exception 'FRONTERA_39: los datos económicos de una cotización dinámica solo se cambian con su operación autorizada.' using errcode = '42501';
  end if;
  v_det_n := (((coalesce(new.detalle, '{}'::jsonb) - 'incluye') - 'noIncluye') #- '{venta,cliente}');
  v_det_o := (((coalesce(old.detalle, '{}'::jsonb) - 'incluye') - 'noIncluye') #- '{venta,cliente}');
  if v_conv then
    v_det_n := v_det_n #- '{venta,numero_contrato}';
    v_det_o := v_det_o #- '{venta,numero_contrato}';
  end if;
  if v_det_n is distinct from v_det_o then
    raise exception 'FRONTERA_39: los datos económicos de una cotización dinámica solo se cambian con su operación autorizada.' using errcode = '42501';
  end if;
  if new.estado is distinct from old.estado
     and not (old.estado = 'abierta' and new.estado = 'descartada')
     and not (v_conv and old.estado = 'abierta' and new.estado = 'convertida') then
    raise exception 'FRONTERA_39: ese cambio de estado solo lo hace la operación autorizada.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Frontera de `cotizacion_pagos_previos`.
create or replace function p39_priv.tg_frontera_pagos() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_rol text := current_user;
begin
  if v_rol not in ('anon', 'authenticated', 'service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'FRONTERA_39: un pago previo no se borra; se anula con su reversa.' using errcode = '42501';
  end if;
  if v_rol <> 'service_role' then
    raise exception 'FRONTERA_39: los pagos previos solo se registran o anulan con la operación autorizada.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not p39_priv.autorizada(new.cotizacion_id, 'pago') then
      raise exception 'FRONTERA_39: los pagos previos solo se registran con la operación autorizada.' using errcode = '42501';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['estado', 'abono_id', 'motivo_anulacion'])
     is distinct from (to_jsonb(old) - array['estado', 'abono_id', 'motivo_anulacion']) then
    raise exception 'FRONTERA_39: los datos de un pago previo no se modifican.' using errcode = '42501';
  end if;
  if (new.estado, new.abono_id, new.motivo_anulacion) is not distinct from (old.estado, old.abono_id, old.motivo_anulacion) then
    return new;
  end if;
  if old.estado = 'activo' and new.estado = 'anulado' and new.abono_id is not distinct from old.abono_id
     and p39_priv.autorizada(old.cotizacion_id, 'anulacion') then
    return new;
  end if;
  if old.estado = 'activo' and new.estado = 'aplicado' and new.motivo_anulacion is not distinct from old.motivo_anulacion
     and p39_priv.autorizada(old.cotizacion_id, 'conversion') then
    return new;
  end if;
  raise exception 'FRONTERA_39: ese cambio de un pago previo solo lo hace la operación autorizada.' using errcode = '42501';
end $$;

-- Frontera de `cotizacion_condiciones`: solo el primer pago autorizado las escribe.
create or replace function p39_priv.tg_frontera_condiciones() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_rol text := current_user; v_cot bigint;
begin
  if v_rol not in ('anon', 'authenticated', 'service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_cot := case when tg_op = 'DELETE' then old.cotizacion_id else new.cotizacion_id end;
  if v_rol = 'service_role' and (tg_op <> 'UPDATE' or old.cotizacion_id = new.cotizacion_id)
     and p39_priv.autorizada(v_cot, 'pago') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'FRONTERA_39: las condiciones de pago solo las escribe el primer pago autorizado.' using errcode = '42501';
end $$;

-- Tablas de solo inserción.
create or replace function p39_priv.tg_solo_insercion() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  raise exception 'EDICION_39_HISTORIAL: % es de solo inserción.', tg_table_name using errcode = '42501';
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Disparadores (la frontera nace DESHABILITADA; la revisión, activa)
-- ═════════════════════════════════════════════════════════════════════════
drop trigger if exists trg_cot_economico_rev_39 on public.cotizaciones;
create trigger trg_cot_economico_rev_39
  before insert or update on public.cotizaciones
  for each row execute function p39_priv.tg_cot_economico_rev();

drop trigger if exists trg_cot_servicios_rev_39_ins on public.cotizacion_servicios;
create trigger trg_cot_servicios_rev_39_ins
  after insert on public.cotizacion_servicios referencing new table as nuevas
  for each statement execute function p39_priv.tg_servicios_economico_rev();
drop trigger if exists trg_cot_servicios_rev_39_upd on public.cotizacion_servicios;
create trigger trg_cot_servicios_rev_39_upd
  after update on public.cotizacion_servicios referencing old table as viejas new table as nuevas
  for each statement execute function p39_priv.tg_servicios_economico_rev();
drop trigger if exists trg_cot_servicios_rev_39_del on public.cotizacion_servicios;
create trigger trg_cot_servicios_rev_39_del
  after delete on public.cotizacion_servicios referencing old table as viejas
  for each statement execute function p39_priv.tg_servicios_economico_rev();

drop trigger if exists trg_cot_frontera_39 on public.cotizaciones;
create trigger trg_cot_frontera_39
  before insert or update or delete on public.cotizaciones
  for each row execute function p39_priv.tg_frontera_cotizaciones();
alter table public.cotizaciones disable trigger trg_cot_frontera_39;

drop trigger if exists trg_cot_pagos_frontera_39 on public.cotizacion_pagos_previos;
create trigger trg_cot_pagos_frontera_39
  before insert or update or delete on public.cotizacion_pagos_previos
  for each row execute function p39_priv.tg_frontera_pagos();
alter table public.cotizacion_pagos_previos disable trigger trg_cot_pagos_frontera_39;

drop trigger if exists trg_cot_condiciones_frontera_39 on public.cotizacion_condiciones;
create trigger trg_cot_condiciones_frontera_39
  before insert or update or delete on public.cotizacion_condiciones
  for each row execute function p39_priv.tg_frontera_condiciones();
alter table public.cotizacion_condiciones disable trigger trg_cot_condiciones_frontera_39;

drop trigger if exists trg_cotizacion_ediciones_inmutable on public.cotizacion_ediciones;
create trigger trg_cotizacion_ediciones_inmutable before update or delete on public.cotizacion_ediciones
  for each row execute function p39_priv.tg_solo_insercion();
drop trigger if exists trg_cotizacion_ediciones_truncate on public.cotizacion_ediciones;
create trigger trg_cotizacion_ediciones_truncate before truncate on public.cotizacion_ediciones
  for each statement execute function p39_priv.tg_solo_insercion();
drop trigger if exists trg_p39_emitida_inmutable on p39_priv.autorizacion_emitida;
create trigger trg_p39_emitida_inmutable before update or delete on p39_priv.autorizacion_emitida
  for each row execute function p39_priv.tg_solo_insercion();
drop trigger if exists trg_p39_emitida_truncate on p39_priv.autorizacion_emitida;
create trigger trg_p39_emitida_truncate before truncate on p39_priv.autorizacion_emitida
  for each statement execute function p39_priv.tg_solo_insercion();
drop trigger if exists trg_p39_cerrada_inmutable on p39_priv.autorizacion_cerrada;
create trigger trg_p39_cerrada_inmutable before update or delete on p39_priv.autorizacion_cerrada
  for each row execute function p39_priv.tg_solo_insercion();
drop trigger if exists trg_p39_cerrada_truncate on p39_priv.autorizacion_cerrada;
create trigger trg_p39_cerrada_truncate before truncate on p39_priv.autorizacion_cerrada
  for each statement execute function p39_priv.tg_solo_insercion();

-- ═════════════════════════════════════════════════════════════════════════
-- 6. RPC de creación y edición (SECURITY DEFINER; solo service_role)
-- ═════════════════════════════════════════════════════════════════════════

-- 6.1 Crear la cotización dinámica de forma ATÓMICA (cabecera + servicios) con
-- autor estable. La liquidación la hace el servidor (TS); aquí se exige que el
-- total cuadre: Σ servicios + recobro + niños × tarifa = precio_venta.
create or replace function public.crear_cotizacion_manual(
  p_usuario_id uuid, p_tenant text, p_cabecera jsonb, p_servicios jsonb
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  u public.usuarios;
  v_tenant text;
  v_pay jsonb := p_cabecera->'payload';
  v_det jsonb := p_cabecera->'detalle';
  v_vig date;
  v_precio numeric;
  v_suma numeric;
  v_esperado numeric;
  v_id bigint;
begin
  select * into u from public.usuarios where id = p_usuario_id;
  if not found or u.activo is not true
     or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') then
    raise exception 'EDICION_39_NO_AUTORIZADO: no tienes permiso para crear cotizaciones.' using errcode = '42501';
  end if;
  -- Solo superadmin elige agencia; el resto queda en la suya (mismo criterio que la 211).
  v_tenant := case when u.rol = 'superadmin' then coalesce(nullif(btrim(coalesce(p_tenant, '')), ''), u.tenant) else u.tenant end;
  if v_tenant is null or v_tenant not in ('mayorista', 'minorista') then
    raise exception 'EDICION_39_NO_AUTORIZADO: la agencia de la cotización no es válida.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_pay) is distinct from 'object' or jsonb_typeof(v_det) is distinct from 'object' then
    raise exception 'EDICION_39_INCOHERENTE: faltan los datos de la cotización.' using errcode = 'P0001';
  end if;
  perform p39_priv.validar_servicios(p_servicios);
  v_vig := nullif(p_cabecera->>'vigencia_hasta', '')::date;
  if v_vig is null or v_vig < public.fecha_negocio() then
    raise exception 'EDICION_39_INCOHERENTE: la vigencia de la cotización no es válida.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_cabecera->'precio_venta') is distinct from 'number' then
    raise exception 'EDICION_39_INCOHERENTE: el precio de la cotización no es válido.' using errcode = 'P0001';
  end if;
  v_precio := (p_cabecera->>'precio_venta')::numeric;
  if v_precio < 0 then
    raise exception 'EDICION_39_INCOHERENTE: el precio de la cotización no es válido.' using errcode = 'P0001';
  end if;
  select coalesce(sum((e->>'valor')::numeric), 0) into v_suma from jsonb_array_elements(p_servicios) e;
  v_esperado := v_suma + greatest(coalesce((v_pay->>'recobro')::numeric, 0), 0)
                + greatest(floor(coalesce((v_pay->>'ninos')::numeric, 0)), 0) * greatest(coalesce((v_pay->>'tarifaNino')::numeric, 0), 0);
  if abs(v_esperado - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: el total no coincide con los servicios (% vs %).', v_precio, v_esperado using errcode = 'P0001';
  end if;

  insert into public.cotizaciones (
    tenant, tipo, estado, payload, detalle, cliente, cliente_documento, destino, hotel, modulo, plan_nombre,
    pax, precio_venta, moneda, fecha_salida, fecha_regreso, vigencia_hasta, asesor, creado_por, creado_por_id
  ) values (
    v_tenant, 'manual', 'abierta', v_pay, v_det,
    nullif(p_cabecera->>'cliente', ''), nullif(p_cabecera->>'cliente_documento', ''),
    nullif(p_cabecera->>'destino', ''), nullif(p_cabecera->>'hotel', ''), 'manual',
    coalesce(nullif(p_cabecera->>'plan_nombre', ''), 'Cotización dinámica'),
    coalesce(nullif(p_cabecera->>'pax', '')::integer, 0), v_precio,
    upper(coalesce(nullif(p_cabecera->>'moneda', ''), 'COP')),
    nullif(p_cabecera->>'fecha_salida', '')::date, nullif(p_cabecera->>'fecha_regreso', '')::date,
    v_vig, nullif(p_cabecera->>'asesor', ''), u.email, u.id
  ) returning id into v_id;

  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor,
                                           costo_neto, modo, pct_markup, ta, valor)
  select v_id, (o.n - 1)::integer, o.e->>'tipo_servicio', nullif(o.e->>'plataforma', ''), nullif(o.e->>'nombre_servicio', ''),
         nullif(o.e->>'proveedor', ''), (o.e->>'costo_neto')::numeric, coalesce(o.e->>'modo', 'mk'),
         coalesce((o.e->>'pct_markup')::numeric, 0), coalesce((o.e->>'ta')::numeric, 0), (o.e->>'valor')::numeric
    from jsonb_array_elements(p_servicios) with ordinality as o(e, n);

  return v_id;
end $$;

-- 6.2 Editar (modificar / quitar / agregar) los servicios de una manual elegible.
-- `p_cambios`: {precio_venta, hotel, aerolinea, items, payload_servicios}.
create or replace function public.editar_servicios_cotizacion_manual(
  p_usuario_id uuid, p_cotizacion_id bigint, p_rev_esperada integer, p_motivo text,
  p_servicios jsonb, p_cambios jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  c public.cotizaciones;
  v_rol text;
  v_antes jsonb;
  v_despues jsonb;
  v_suma numeric;
  v_esperado numeric;
  v_precio numeric;
  v_items jsonb := p_cambios->'items';
  v_det jsonb;
  v_pay jsonb;
  v_rev integer;
begin
  c := p39_priv.bloquear_para_editar(p_cotizacion_id, p_usuario_id, p_rev_esperada, p_motivo);
  select rol into v_rol from public.usuarios where id = p_usuario_id;
  perform p39_priv.validar_servicios(p_servicios);
  if jsonb_typeof(p_cambios->'precio_venta') is distinct from 'number'
     or jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'EDICION_39_INCOHERENTE: faltan el precio o las líneas del documento.' using errcode = 'P0001';
  end if;
  v_precio := (p_cambios->>'precio_venta')::numeric;
  select coalesce(sum((e->>'valor')::numeric), 0) into v_suma from jsonb_array_elements(p_servicios) e;
  v_esperado := v_suma + greatest(coalesce((c.payload->>'recobro')::numeric, 0), 0)
                + greatest(floor(coalesce((c.payload->>'ninos')::numeric, 0)), 0) * greatest(coalesce((c.payload->>'tarifaNino')::numeric, 0), 0);
  if abs(v_esperado - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: el total no coincide con los servicios (% vs %).', v_precio, v_esperado using errcode = 'P0001';
  end if;
  if abs(coalesce((select sum((i->>'valor')::numeric) from jsonb_array_elements(v_items) i), 0) - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: las líneas del documento no suman el total.' using errcode = 'P0001';
  end if;

  select jsonb_build_object('precio_venta', c.precio_venta, 'servicios',
           coalesce(jsonb_agg(to_jsonb(s) - 'created_at' - 'cotizacion_id' order by s.orden, s.id), '[]'::jsonb))
    into v_antes from public.cotizacion_servicios s where s.cotizacion_id = c.id;

  delete from public.cotizacion_servicios where cotizacion_id = c.id;
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor,
                                           costo_neto, modo, pct_markup, ta, valor)
  select c.id, (o.n - 1)::integer, o.e->>'tipo_servicio', nullif(o.e->>'plataforma', ''), nullif(o.e->>'nombre_servicio', ''),
         nullif(o.e->>'proveedor', ''), (o.e->>'costo_neto')::numeric, coalesce(o.e->>'modo', 'mk'),
         coalesce((o.e->>'pct_markup')::numeric, 0), coalesce((o.e->>'ta')::numeric, 0), (o.e->>'valor')::numeric
    from jsonb_array_elements(p_servicios) with ordinality as o(e, n);

  v_det := coalesce(c.detalle, '{}'::jsonb);
  v_det := jsonb_set(v_det, '{items}', v_items, true);
  v_det := jsonb_set(v_det, '{venta}', coalesce(v_det->'venta', '{}'::jsonb)
             || jsonb_build_object('precio_venta', v_precio,
                                   'hotel', coalesce(p_cambios->'hotel', 'null'::jsonb),
                                   'aerolinea', coalesce(p_cambios->'aerolinea', 'null'::jsonb)), true);
  v_pay := jsonb_set(coalesce(c.payload, '{}'::jsonb), '{servicios}', coalesce(p_cambios->'payload_servicios', '[]'::jsonb), true);

  update public.cotizaciones
     set precio_venta = v_precio, hotel = nullif(p_cambios->>'hotel', ''), detalle = v_det, payload = v_pay
   where id = c.id
  returning economico_rev into v_rev;

  select jsonb_build_object('precio_venta', v_precio, 'servicios',
           coalesce(jsonb_agg(to_jsonb(s) - 'created_at' - 'cotizacion_id' order by s.orden, s.id), '[]'::jsonb))
    into v_despues from public.cotizacion_servicios s where s.cotizacion_id = c.id;

  insert into public.cotizacion_ediciones (cotizacion_id, tenant, tipo, actor_id, actor_rol, motivo, rev_anterior, rev_nueva,
                                           precio_anterior, precio_nuevo, antes, despues)
  values (c.id, c.tenant, 'servicios', p_usuario_id, v_rol, btrim(p_motivo), c.economico_rev, v_rev,
          c.precio_venta, v_precio, v_antes, v_despues);
  return v_rev;
end $$;

-- 6.3 Editar niños y recobro (oculto al cliente) de una manual elegible (C5).
-- `p_cambios`: {ninos, tarifaNino, recobro, recobroAliado, precio_venta, items}.
create or replace function public.actualizar_recobro_ninos_manual(
  p_usuario_id uuid, p_cotizacion_id bigint, p_rev_esperada integer, p_motivo text, p_cambios jsonb
) returns integer
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  c public.cotizaciones;
  v_rol text;
  v_ninos numeric;
  v_tarifa numeric;
  v_rec numeric;
  v_rec_ali numeric;
  v_precio numeric;
  v_suma numeric;
  v_pax integer;
  v_items jsonb := p_cambios->'items';
  v_pay jsonb;
  v_det jsonb;
  v_rev integer;
begin
  c := p39_priv.bloquear_para_editar(p_cotizacion_id, p_usuario_id, p_rev_esperada, p_motivo);
  select rol into v_rol from public.usuarios where id = p_usuario_id;
  if jsonb_typeof(p_cambios->'ninos') is distinct from 'number' or jsonb_typeof(p_cambios->'tarifaNino') is distinct from 'number'
     or jsonb_typeof(p_cambios->'recobro') is distinct from 'number' or jsonb_typeof(p_cambios->'recobroAliado') is distinct from 'number'
     or jsonb_typeof(p_cambios->'precio_venta') is distinct from 'number'
     or jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'EDICION_39_INCOHERENTE: faltan los valores de niños y recobro.' using errcode = 'P0001';
  end if;
  v_ninos := (p_cambios->>'ninos')::numeric;
  v_tarifa := (p_cambios->>'tarifaNino')::numeric;
  v_rec := (p_cambios->>'recobro')::numeric;
  v_rec_ali := (p_cambios->>'recobroAliado')::numeric;
  v_precio := (p_cambios->>'precio_venta')::numeric;
  if v_ninos < 0 or v_ninos <> trunc(v_ninos) or v_tarifa < 0 or v_rec < 0 or v_rec_ali < 0 or v_rec_ali > v_rec
     or (coalesce(c.payload->>'tipoAsesor', 'interno') = 'interno' and v_rec_ali <> 0) then
    raise exception 'EDICION_39_INCOHERENTE: los valores de niños o recobro no son válidos.' using errcode = 'P0001';
  end if;
  select coalesce(sum(s.valor), 0) into v_suma from public.cotizacion_servicios s where s.cotizacion_id = c.id;
  if abs(v_suma + v_rec + v_ninos * v_tarifa - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: el total no coincide con los servicios, el recobro y los niños.' using errcode = 'P0001';
  end if;
  if abs(coalesce((select sum((i->>'valor')::numeric) from jsonb_array_elements(v_items) i), 0) - v_precio) > 0.5 then
    raise exception 'EDICION_39_INCOHERENTE: las líneas del documento no suman el total.' using errcode = 'P0001';
  end if;
  v_pax := greatest(coalesce(nullif(c.payload->>'pax', '')::numeric, c.pax, 1)::integer, 1);

  v_pay := coalesce(c.payload, '{}'::jsonb)
           || jsonb_build_object('ninos', v_ninos, 'tarifaNino', v_tarifa, 'recobro', v_rec, 'recobroAliado', v_rec_ali);
  v_det := coalesce(c.detalle, '{}'::jsonb);
  v_det := jsonb_set(v_det, '{venta}', coalesce(v_det->'venta', '{}'::jsonb)
             || jsonb_build_object('pax', v_pax, 'ninos', v_ninos, 'precio_venta', v_precio), true);
  v_det := jsonb_set(v_det, '{recobro}', jsonb_build_object('total', v_rec, 'empresa', v_rec - v_rec_ali, 'aliado', v_rec_ali), true);
  v_det := jsonb_set(v_det, '{items}', v_items, true);

  update public.cotizaciones set payload = v_pay, detalle = v_det, precio_venta = v_precio
   where id = c.id
  returning economico_rev into v_rev;

  insert into public.cotizacion_ediciones (cotizacion_id, tenant, tipo, actor_id, actor_rol, motivo, rev_anterior, rev_nueva,
                                           precio_anterior, precio_nuevo, antes, despues)
  values (c.id, c.tenant, 'recobro_ninos', p_usuario_id, v_rol, btrim(p_motivo), c.economico_rev, v_rev,
          c.precio_venta, v_precio,
          jsonb_build_object('ninos', c.payload->'ninos', 'tarifaNino', c.payload->'tarifaNino',
                             'recobro', c.payload->'recobro', 'recobroAliado', c.payload->'recobroAliado', 'precio_venta', c.precio_venta),
          jsonb_build_object('ninos', v_ninos, 'tarifaNino', v_tarifa, 'recobro', v_rec, 'recobroAliado', v_rec_ali,
                             'precio_venta', v_precio));
  return v_rev;
end $$;

-- 6.4 ¿Se puede editar hoy? (frontera activa y sin suspensión). Para la ficha.
create or replace function public.edicion_cotizaciones_habilitada()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p39_priv.frontera_activa()
     and coalesce((select not s.suspendida from p39_priv.suspension_edicion s where s.id), false)
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Wrappers de dinero (INVOKER, solo service_role): la ÚNICA puerta de pago,
-- anulación y conversión manual. Bloquean la cotización, verifican, emiten la
-- autorización de SU transacción, llaman la 198 SIN CAMBIOS y la cierran.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.registrar_pago_previo_rev(
  p_cotizacion_id bigint, p_valor numeric, p_moneda text, p_trm numeric, p_forma_pago text, p_referencia text,
  p_fecha_pago date, p_usuario_id uuid, p_idempotency_key text, p_rev_esperada integer,
  p_snapshot jsonb default null, p_exigido_total_moneda numeric default null, p_pct_efectivo numeric default null
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tenant text;
  v_tipo text;
  v_modo text;
  v_rev integer;
  v_congelada timestamptz;
  v_rol text;
  v_actor_tenant text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_aut bigint;
  v_res text;
begin
  select c.tenant, c.tipo, c.modo, c.economico_rev, c.condicion_pago_congelada_en
    into v_tenant, v_tipo, v_modo, v_rev, v_congelada
    from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select u.tenant into v_actor_tenant from public.usuarios u where u.id = p_usuario_id;
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_tenant using errcode = '42501';
  end if;
  if v_tipo is distinct from 'manual' or v_modo is distinct from 'simple' then
    raise exception 'Los pagos previos solo aplican a cotizaciones dinámicas.' using errcode = 'P0001';
  end if;
  -- Reintento con una clave ya usada: la 198 devuelve el pago original SIN escribir
  -- (o rechaza si cambió algún dato). No necesita autorización.
  if v_key is not null and exists (select 1 from public.cotizacion_pagos_previos p where p.idempotency_key = v_key) then
    return public.registrar_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_trm, p_forma_pago, p_referencia, p_fecha_pago,
                                        p_usuario_id, p_idempotency_key, p_snapshot, p_exigido_total_moneda, p_pct_efectivo);
  end if;
  -- Primer pago: la misma revisión que leyó la app y la misma composición.
  if v_congelada is null then
    if p_rev_esperada is distinct from v_rev then
      raise exception 'PAGO_39_REVISION: la cotización cambió desde que se preparó el pago; recarga la página e inténtalo de nuevo.' using errcode = 'P0001';
    end if;
    if p_snapshot is null or not p39_priv.composicion_coincide(p_cotizacion_id, p_snapshot) then
      raise exception 'PAGO_39_COMPOSICION: las condiciones enviadas no corresponden a los servicios actuales de la cotización; recarga la página.' using errcode = 'P0001';
    end if;
  end if;
  v_aut := p39_priv.emitir(p_cotizacion_id, 'pago', p_usuario_id);
  v_res := public.registrar_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_trm, p_forma_pago, p_referencia, p_fecha_pago,
                                        p_usuario_id, p_idempotency_key, p_snapshot, p_exigido_total_moneda, p_pct_efectivo);
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

create or replace function public.anular_pago_previo_controlado(
  p_pago_id bigint, p_usuario_id uuid, p_motivo text default null
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_cot bigint;
  v_cot_bloqueada bigint;
  v_tenant text;
  v_rol text;
  v_actor_tenant text;
  v_aut bigint;
  v_res text;
begin
  select p.cotizacion_id, p.tenant into v_cot, v_tenant from public.cotizacion_pagos_previos p where p.id = p_pago_id;
  if not found then
    raise exception 'El pago previo % no existe.', p_pago_id;
  end if;
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select u.tenant into v_actor_tenant from public.usuarios u where u.id = p_usuario_id;
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de este pago.', v_tenant using errcode = '42501';
  end if;
  -- Primero la cotización y después el pago (mismo orden que la conversión).
  perform 1 from public.cotizaciones c where c.id = v_cot for update;
  select p.cotizacion_id into v_cot_bloqueada from public.cotizacion_pagos_previos p where p.id = p_pago_id for update;
  if v_cot_bloqueada is distinct from v_cot then
    raise exception 'El pago previo % cambió mientras se anulaba; reintenta.', p_pago_id;
  end if;
  v_aut := p39_priv.emitir(v_cot, 'anulacion', p_usuario_id);
  v_res := public.anular_pago_previo(p_pago_id, p_usuario_id, p_motivo);
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

create or replace function public.convertir_cotizacion_manual_controlada(
  p_cotizacion_id bigint, p_usuario_id uuid
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tipo text;
  v_modo text;
  v_aut bigint;
  v_res text;
begin
  select c.tipo, c.modo into v_tipo, v_modo from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no se convierte en contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  if v_tipo is distinct from 'manual' then
    raise exception 'Solo las cotizaciones dinámicas se convierten por esta vía.' using errcode = 'P0001';
  end if;
  -- Ya convertida: la 198 devuelve el número existente sin escribir nada.
  if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  end if;
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 8. ACL de funciones
-- ═════════════════════════════════════════════════════════════════════════
revoke all on all functions in schema p39_priv from public, anon, authenticated, service_role;
grant execute on function p39_priv.emitir(bigint, text, uuid) to service_role;
grant execute on function p39_priv.cerrar(bigint) to service_role;
grant execute on function p39_priv.autorizada(bigint, text) to service_role;
grant execute on function p39_priv.composicion_coincide(bigint, jsonb) to service_role;

revoke all on function public.crear_cotizacion_manual(uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.editar_servicios_cotizacion_manual(uuid, bigint, integer, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.actualizar_recobro_ninos_manual(uuid, bigint, integer, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.registrar_pago_previo_rev(bigint, numeric, text, numeric, text, text, date, uuid, text, integer, jsonb, numeric, numeric) from public, anon, authenticated, service_role;
revoke all on function public.anular_pago_previo_controlado(bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
revoke all on function public.edicion_cotizaciones_habilitada() from public, anon, authenticated, service_role;

grant execute on function public.crear_cotizacion_manual(uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.editar_servicios_cotizacion_manual(uuid, bigint, integer, text, jsonb, jsonb) to service_role;
grant execute on function public.actualizar_recobro_ninos_manual(uuid, bigint, integer, text, jsonb) to service_role;
grant execute on function public.registrar_pago_previo_rev(bigint, numeric, text, numeric, text, text, date, uuid, text, integer, jsonb, numeric, numeric) to service_role;
grant execute on function public.anular_pago_previo_controlado(bigint, uuid, text) to service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;
grant execute on function public.edicion_cotizaciones_habilitada() to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 9. Verificación en la misma transacción
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_catalog.pg_trigger t
   where not t.tgisinternal and t.tgenabled = 'D'
     and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39');
  if v_n <> 3 then raise exception '216: los disparadores de frontera no quedaron deshabilitados (%).', v_n; end if;
  if p39_priv.frontera_activa() then raise exception '216: la frontera no debe quedar activa con solo la 216.'; end if;
  if has_schema_privilege('anon', 'p39_priv', 'USAGE') or has_schema_privilege('authenticated', 'p39_priv', 'USAGE') then
    raise exception '216: p39_priv quedó accesible para anon/authenticated.';
  end if;
  if has_function_privilege('authenticated', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.edicion_cotizaciones_habilitada()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception '216: grants inesperados en las funciones nuevas.';
  end if;
  if md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), chr(13), ''))
     <> 'edc9975010746e53e4af6a75ad9763dc' then
    raise exception '216: el cuerpo de la RPC 198 de conversión no es el esperado; no se aplica.';
  end if;
end $$;

commit;
