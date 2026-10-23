-- 202 · CRM leads manuales
--
-- MVP manual y aislado para registrar leads originados en WhatsApp/Instagram.
-- No toca crm_contactos, cotizaciones, ventas ni tablas operativas existentes.
-- El lead es entidad propia, con tenant obligatorio, responsable uuid y RLS
-- estricta por tenant/responsable. Sin borrado fisico: cerrar por etapa
-- terminal y conservar bitacora.

begin;

create or replace function public.crm_lead_normalizar_telefono(p text)
returns text
language sql
immutable
set search_path = public
as $$
  with d as (
    select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as v
  )
  select nullif(
    case
      when length(v) = 10 then '57' || v
      when length(v) = 12 and left(v, 2) = '57' then v
      else v
    end,
    ''
  )
  from d;
$$;

create or replace function public.crm_lead_normalizar_email(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(p, ''))), '');
$$;

create or replace function public.crm_lead_normalizar_documento(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '[^a-z0-9]', '', 'g'), '');
$$;

create table if not exists public.crm_leads (
  id bigserial primary key,
  tenant text not null default 'mayorista' check (tenant in ('mayorista', 'minorista')),
  etapa text not null default 'nuevo' check (etapa in ('nuevo', 'en_contacto', 'calificado', 'descartado', 'archivado')),
  canal text not null check (canal in ('whatsapp', 'instagram', 'otro')),
  nombre text not null check (btrim(nombre) <> ''),
  telefono text null,
  email text null,
  documento text null,
  telefono_norm text generated always as (public.crm_lead_normalizar_telefono(telefono)) stored,
  email_norm text generated always as (public.crm_lead_normalizar_email(email)) stored,
  documento_norm text generated always as (public.crm_lead_normalizar_documento(documento)) stored,
  interes text null,
  origen_detalle text null,
  notas text null,
  responsable_id uuid null references public.usuarios(id) on delete set null,
  creado_por uuid null references public.usuarios(id) on delete set null,
  proxima_accion_at timestamptz null,
  cerrado_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (etapa in ('descartado', 'archivado') and cerrado_at is not null)
    or (etapa in ('nuevo', 'en_contacto', 'calificado') and cerrado_at is null)
  )
);

comment on table public.crm_leads is
  'Leads manuales del CRM. Entidad propia, aislada por tenant, sin conversion a contactos/cotizaciones en el MVP.';

create table if not exists public.crm_lead_actividades (
  id bigserial primary key,
  lead_id bigint not null references public.crm_leads(id) on delete cascade,
  tipo text not null check (tipo in ('nota', 'llamada', 'whatsapp', 'instagram', 'email', 'reunion', 'cambio_etapa', 'reasignacion', 'cierre')),
  cuerpo text null,
  proxima_accion_at timestamptz null,
  actor_id uuid null references public.usuarios(id) on delete set null,
  actor_email text null,
  created_at timestamptz not null default now(),
  check (tipo in ('cambio_etapa', 'reasignacion') or nullif(btrim(coalesce(cuerpo, '')), '') is not null)
);

comment on table public.crm_lead_actividades is
  'Bitacora append-only de leads: notas, seguimientos y eventos de negocio. No se edita ni borra.';

create index if not exists idx_crm_leads_tenant_etapa on public.crm_leads (tenant, etapa, updated_at desc);
create index if not exists idx_crm_leads_responsable on public.crm_leads (responsable_id, updated_at desc);
create index if not exists idx_crm_leads_proxima_accion on public.crm_leads (proxima_accion_at) where proxima_accion_at is not null;
create index if not exists idx_crm_lead_actividades_lead on public.crm_lead_actividades (lead_id, created_at desc);

create unique index if not exists uq_crm_leads_tenant_telefono
  on public.crm_leads (tenant, telefono_norm)
  where telefono_norm is not null;

create unique index if not exists uq_crm_leads_tenant_email
  on public.crm_leads (tenant, email_norm)
  where email_norm is not null;

create unique index if not exists uq_crm_leads_tenant_documento
  on public.crm_leads (tenant, documento_norm)
  where documento_norm is not null;

create or replace function public.crm_leads_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_crm_leads_touch_updated_at on public.crm_leads;
create trigger trg_crm_leads_touch_updated_at
  before update on public.crm_leads
  for each row execute function public.crm_leads_touch_updated_at();

create or replace function public.crm_leads_bloquear_cambio_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant is distinct from old.tenant then
    raise exception 'No se puede cambiar el tenant de un lead existente (id=%, % -> %).', old.id, old.tenant, new.tenant;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_leads_bloquear_cambio_tenant on public.crm_leads;
create trigger trg_crm_leads_bloquear_cambio_tenant
  before update on public.crm_leads
  for each row execute function public.crm_leads_bloquear_cambio_tenant();

create or replace function public.crm_leads_bloquear_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Los leads no se eliminan fisicamente; usa descartado o archivado.';
end;
$$;

drop trigger if exists trg_crm_leads_bloquear_delete on public.crm_leads;
create trigger trg_crm_leads_bloquear_delete
  before delete on public.crm_leads
  for each row execute function public.crm_leads_bloquear_delete();

create or replace function public.crm_lead_actividades_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'La bitacora de leads es append-only.';
end;
$$;

drop trigger if exists trg_crm_lead_actividades_append_only_update on public.crm_lead_actividades;
create trigger trg_crm_lead_actividades_append_only_update
  before update on public.crm_lead_actividades
  for each row execute function public.crm_lead_actividades_append_only();

drop trigger if exists trg_crm_lead_actividades_append_only_delete on public.crm_lead_actividades;
create trigger trg_crm_lead_actividades_append_only_delete
  before delete on public.crm_lead_actividades
  for each row execute function public.crm_lead_actividades_append_only();

create or replace function public.crm_lead_responsable_valido(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_usuario is null or exists (
    select 1
      from public.usuarios u
     where u.id = p_usuario
       and u.activo is true
       and u.rol in ('gerencia', 'administracion', 'venta')
  );
$$;

create or replace function public.crm_lead_puede_ver(p_tenant text, p_responsable uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.mi_rol() = 'superadmin' then true
    when public.mi_rol() = 'gerencia' then public.puede_ver_tenant(p_tenant)
    when public.mi_rol() = 'administracion' then public.mi_tenant() = p_tenant
    when public.mi_rol() = 'venta' then public.mi_tenant() = p_tenant and (p_responsable is null or p_responsable = auth.uid())
    else false
  end;
$$;

create or replace function public.crm_lead_puede_insertar(p_tenant text, p_responsable uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_lead_responsable_valido(p_responsable)
     and case
      when public.mi_rol() = 'superadmin' then true
      when public.mi_rol() = 'gerencia' then public.puede_ver_tenant(p_tenant)
      when public.mi_rol() = 'administracion' then public.mi_tenant() = p_tenant
      when public.mi_rol() = 'venta' then public.mi_tenant() = p_tenant and (p_responsable is null or p_responsable = auth.uid())
      else false
    end;
$$;

create or replace function public.crm_lead_puede_actualizar(p_tenant text, p_responsable_anterior uuid, p_responsable_nuevo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_lead_responsable_valido(p_responsable_nuevo)
     and case
      when public.mi_rol() = 'superadmin' then true
      when public.mi_rol() = 'gerencia' then public.puede_ver_tenant(p_tenant)
      when public.mi_rol() = 'administracion' then public.mi_tenant() = p_tenant
      when public.mi_rol() = 'venta' then
        public.mi_tenant() = p_tenant
        and (p_responsable_anterior is null or p_responsable_anterior = auth.uid())
        and p_responsable_nuevo = auth.uid()
      else false
    end;
$$;

revoke all on function public.crm_lead_responsable_valido(uuid) from public, anon;
revoke all on function public.crm_lead_puede_ver(text, uuid) from public, anon;
revoke all on function public.crm_lead_puede_insertar(text, uuid) from public, anon;
revoke all on function public.crm_lead_puede_actualizar(text, uuid, uuid) from public, anon;
grant execute on function public.crm_lead_responsable_valido(uuid) to authenticated;
grant execute on function public.crm_lead_puede_ver(text, uuid) to authenticated;
grant execute on function public.crm_lead_puede_insertar(text, uuid) to authenticated;
grant execute on function public.crm_lead_puede_actualizar(text, uuid, uuid) to authenticated;

alter table public.crm_leads enable row level security;
alter table public.crm_lead_actividades enable row level security;

revoke all on table public.crm_leads from anon;
revoke all on table public.crm_lead_actividades from anon;
grant select, insert, update, delete on table public.crm_leads to authenticated;
grant select, insert, update, delete on table public.crm_lead_actividades to authenticated;
grant usage, select on sequence public.crm_leads_id_seq to authenticated;
grant usage, select on sequence public.crm_lead_actividades_id_seq to authenticated;

drop policy if exists "crm_leads: lectura" on public.crm_leads;
drop policy if exists "crm_leads: insertar" on public.crm_leads;
drop policy if exists "crm_leads: actualizar" on public.crm_leads;

create policy "crm_leads: lectura" on public.crm_leads for select to authenticated
  using (public.crm_lead_puede_ver(tenant, responsable_id));

create policy "crm_leads: insertar" on public.crm_leads for insert to authenticated
  with check (public.crm_lead_puede_insertar(tenant, responsable_id));

create policy "crm_leads: actualizar" on public.crm_leads for update to authenticated
  using (public.crm_lead_puede_ver(tenant, responsable_id))
  with check (public.crm_lead_puede_actualizar(tenant, responsable_id, responsable_id));

drop policy if exists "crm_lead_actividades: lectura" on public.crm_lead_actividades;
drop policy if exists "crm_lead_actividades: insertar" on public.crm_lead_actividades;

create policy "crm_lead_actividades: lectura" on public.crm_lead_actividades for select to authenticated
  using (
    exists (
      select 1 from public.crm_leads l
       where l.id = lead_id
         and public.crm_lead_puede_ver(l.tenant, l.responsable_id)
    )
  );

create policy "crm_lead_actividades: insertar" on public.crm_lead_actividades for insert to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.crm_leads l
       where l.id = lead_id
         and public.crm_lead_puede_ver(l.tenant, l.responsable_id)
    )
  );

-- La auditoria generica (087) se adjunto antes de que estas tablas existieran.
-- Recorremos de nuevo el mismo bloque para cubrir crm_leads y actividades.
do $$
declare
  r record;
  excluidas text[] := array['auditoria', 'tarifario_resultado'];
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> all (excluidas)
  loop
    execute format('drop trigger if exists trg_auditoria on public.%I;', r.tablename);
    execute format(
      'create trigger trg_auditoria after insert or update or delete on public.%I
         for each row execute function public.fn_auditoria();',
      r.tablename
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
