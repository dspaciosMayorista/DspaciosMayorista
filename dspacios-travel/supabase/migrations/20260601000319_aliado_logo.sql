-- 319 · #32 (ADL-039): logo del aliado como marca principal de SUS cotizaciones. El emisor legal (agencias) NO cambia: el logo es solo presentación.
-- Aditiva y sin datos previos. Archivo en bucket PRIVADO `aliado-logos` (sin políticas: solo service_role); nunca se sirve por URL pública, solo por rutas
-- de servidor que autorizan primero (`/cot/<token>/logo`, `/cotizacion/<id>/logo`, portal y Aliados interno).
-- Una fila por logo subido (historial); a lo sumo UNO vigente por aliado. Sustituir o retirar conserva la fila anterior (vigente=false); el archivo nunca se borra.
create table if not exists public.aliado_logos (
  id          bigint generated always as identity primary key,
  aliado_id   bigint      not null references public.aliados (id) on delete restrict,
  path        text        not null unique,    -- `<aliado_id>/<sha256>.<ext>`: direccionado por contenido, así que un reemplazo nunca pisa el archivo anterior
  mime        text        not null check (mime in ('image/png', 'image/jpeg')),
  size_bytes  integer     not null check (size_bytes between 1 and 1048576),
  sha256      text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  subido_por  uuid        not null,
  via         text        not null check (via in ('portal', 'interno')),
  subido_en   timestamptz not null default now(),
  vigente     boolean     not null default true,
  retirado_en timestamptz,
  retirado_por uuid,
  constraint aliado_logos_vigencia check ((vigente and retirado_en is null) or (not vigente and retirado_en is not null))
);
create unique index if not exists uq_aliado_logo_vigente on public.aliado_logos (aliado_id) where vigente;
create index if not exists idx_aliado_logos_aliado on public.aliado_logos (aliado_id, subido_en desc);

-- La resolución del aliado de una cotización consulta el plan de comisión POR cotización; la única llave existente es una expresión (cotizacion_id::text / contrato_uid) que esa consulta no usa.
create index if not exists idx_comision_plan_cotizacion on public.comision_plan (cotizacion_id) where cotizacion_id is not null;

alter table public.aliado_logos enable row level security;
revoke all on table public.aliado_logos from public, anon, authenticated;
grant select, insert, update on table public.aliado_logos to service_role;

drop trigger if exists trg_auditoria on public.aliado_logos;
create trigger trg_auditoria after insert or update or delete on public.aliado_logos
  for each row execute function public.fn_auditoria();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aliado-logos', 'aliado-logos', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Autoriza DENTRO de la base (el servidor ya lo hizo; esto es la segunda llave): superadmin/gerencia activos, o el titular activo (sin agencia_id) de ESA ficha.
create or replace function public.p319_actor_puede(p_actor uuid, p_aliado bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when u.id is null or u.activo is not true then null
    when u.rol::text in ('superadmin', 'gerencia') then 'interno'
    when u.rol::text in ('agencia', 'freelance') and u.agencia_id is null and u.aliado_id = p_aliado then 'portal'
    else null end
  from (select 1) x left join public.usuarios u on u.id = p_actor;
$$;

create or replace function public.registrar_logo_aliado(
  p_actor uuid, p_aliado bigint, p_path text, p_mime text, p_size integer, p_sha text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_via text; v_vigente public.aliado_logos;
begin
  v_via := public.p319_actor_puede(p_actor, p_aliado);
  if v_via is null then return jsonb_build_object('ok', false, 'codigo', 'no_autorizado'); end if;
  perform 1 from public.aliados where id = p_aliado for update;   -- serializa subidas concurrentes del mismo aliado
  if not found then return jsonb_build_object('ok', false, 'codigo', 'sin_aliado'); end if;
  select * into v_vigente from public.aliado_logos where aliado_id = p_aliado and vigente;
  if found and v_vigente.sha256 = p_sha then return jsonb_build_object('ok', true, 'sin_cambio', true); end if;
  update public.aliado_logos set vigente = false, retirado_en = now(), retirado_por = p_actor where aliado_id = p_aliado and vigente;
  insert into public.aliado_logos (aliado_id, path, mime, size_bytes, sha256, subido_por, via)
  values (p_aliado, p_path, p_mime, p_size, p_sha, p_actor, v_via)
  on conflict (path) do update set vigente = true, retirado_en = null, retirado_por = null, subido_por = p_actor, via = v_via, subido_en = now();
  return jsonb_build_object('ok', true, 'sin_cambio', false);
end; $$;

create or replace function public.retirar_logo_aliado(p_actor uuid, p_aliado bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if public.p319_actor_puede(p_actor, p_aliado) is null then return jsonb_build_object('ok', false, 'codigo', 'no_autorizado'); end if;
  perform 1 from public.aliados where id = p_aliado for update;
  update public.aliado_logos set vigente = false, retirado_en = now(), retirado_por = p_actor where aliado_id = p_aliado and vigente;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'retirados', v_n);
end; $$;

revoke all on function public.p319_actor_puede(uuid, bigint) from public, anon, authenticated;
revoke all on function public.registrar_logo_aliado(uuid, bigint, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.retirar_logo_aliado(uuid, bigint) from public, anon, authenticated;
grant execute on function public.p319_actor_puede(uuid, bigint) to service_role;
grant execute on function public.registrar_logo_aliado(uuid, bigint, text, text, integer, text) to service_role;
grant execute on function public.retirar_logo_aliado(uuid, bigint) to service_role;

comment on table public.aliado_logos is '#32: logos de aliado (presentación de sus cotizaciones). Privado, solo service_role; a lo sumo uno vigente por aliado; historial conservado. Migración 319.';
