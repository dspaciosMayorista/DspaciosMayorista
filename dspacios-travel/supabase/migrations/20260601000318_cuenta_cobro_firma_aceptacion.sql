-- 318 · #98: imagen de firma del aliado FREELANCE + aceptación electrónica de una versión CONGELADA de la cuenta de cobro (decisión del dueño, ADL-039).
-- NO es una firma digital certificada: es una imagen + el evento «el aliado aceptó ESTA versión» (quién, cuándo, hash del contenido, hash de la imagen).
-- Aditiva: dos tablas nuevas, un bucket privado y dos RPC. No toca ninguna fila existente ni cambia importes de comisión (#97 sigue apagado).
--
--   aliado_firmas              imágenes de firma por ficha de aliado; una sola VIGENTE; las anteriores se conservan (la versión aceptada conserva la suya).
--   cuenta_cobro_aceptaciones  una fila = una versión aceptada (snapshot jsonb + hash). INMUTABLE: ni UPDATE ni DELETE.
--
-- `clave` identifica la comisión: 'ab:<aliados_b2b.id>' (comisión manual / reservar) o 'cu:<ventas.contrato_uid>' (comisión del flujo tarifario). Sin columna de número de
-- contrato y SIN FK a ventas/aliados_b2b A PROPÓSITO: la evidencia sobrevive a la eliminación del contrato y no depende de un número reutilizable (#75).
-- Solo service_role (código de servidor, que autoriza antes): sin políticas RLS; anon/authenticated no leen ni escriben. El bucket es PRIVADO y sin políticas.
do $$ begin
  if to_regclass('public.aliados') is null then raise exception '318: falta la tabla public.aliados.'; end if;
  if to_regprocedure('public.fn_auditoria()') is null then raise exception '318: falta public.fn_auditoria() (migración 087).'; end if;
end $$;

-- ── Firmas ────────────────────────────────────────────────────────────────
create table if not exists public.aliado_firmas (
  id bigserial primary key,
  aliado_id bigint not null references public.aliados(id) on delete restrict,
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  bytes integer not null check (bytes between 1 and 524288),
  vigente boolean not null default true,
  creado_por uuid,
  creado_en timestamptz not null default now()
);
create unique index if not exists aliado_firmas_una_vigente on public.aliado_firmas (aliado_id) where vigente;
comment on table public.aliado_firmas is '#98: imagen de firma por ficha de aliado (freelance). Una vigente; las anteriores se conservan porque cada versión aceptada referencia la suya. Solo service_role.';

create or replace function public.tg_aliado_firmas_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- Única mutación permitida: retirar la vigencia (true → false) sin tocar nada más.
  if tg_op = 'UPDATE' then
    if old.vigente and not new.vigente and (to_jsonb(new) - 'vigente') = (to_jsonb(old) - 'vigente') then return new; end if;
  end if;
  raise exception using errcode = 'P0001', message = 'Una firma registrada no se modifica ni se borra: sube una nueva (queda el historial).';
end $$;
revoke all on function public.tg_aliado_firmas_inmutable() from public, anon, authenticated;
drop trigger if exists trg_aliado_firmas_inmutable on public.aliado_firmas;
create trigger trg_aliado_firmas_inmutable before update or delete on public.aliado_firmas
  for each row execute function public.tg_aliado_firmas_inmutable();
drop trigger if exists trg_auditoria on public.aliado_firmas;
create trigger trg_auditoria after insert or update or delete on public.aliado_firmas
  for each row execute function public.fn_auditoria();

-- ── Aceptaciones ──────────────────────────────────────────────────────────
create table if not exists public.cuenta_cobro_aceptaciones (
  id bigserial primary key,
  clave text not null,
  aliado_id bigint not null references public.aliados(id) on delete restrict,
  version integer not null check (version >= 1),
  snapshot jsonb not null,
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  firma_id bigint not null references public.aliado_firmas(id) on delete restrict,
  firma_sha256 text not null,
  aceptada_por uuid not null,
  aceptada_en timestamptz not null default now(),
  constraint cuenta_cobro_aceptaciones_version_uk unique (clave, version),
  constraint cuenta_cobro_aceptaciones_hash_uk unique (clave, snapshot_hash)
);
comment on table public.cuenta_cobro_aceptaciones is '#98: versión congelada de una cuenta de cobro aceptada electrónicamente por el aliado. INMUTABLE. Solo service_role.';

create or replace function public.tg_cuenta_cobro_aceptaciones_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = 'Una aceptación registrada no se modifica ni se borra: una versión nueva requiere una aceptación nueva (queda el historial).';
end $$;
revoke all on function public.tg_cuenta_cobro_aceptaciones_inmutable() from public, anon, authenticated;
drop trigger if exists trg_cuenta_cobro_aceptaciones_inmutable on public.cuenta_cobro_aceptaciones;
create trigger trg_cuenta_cobro_aceptaciones_inmutable before update or delete on public.cuenta_cobro_aceptaciones
  for each row execute function public.tg_cuenta_cobro_aceptaciones_inmutable();
drop trigger if exists trg_auditoria on public.cuenta_cobro_aceptaciones;
create trigger trg_auditoria after insert or update or delete on public.cuenta_cobro_aceptaciones
  for each row execute function public.fn_auditoria();

alter table public.aliado_firmas enable row level security;
alter table public.cuenta_cobro_aceptaciones enable row level security;
revoke all on table public.aliado_firmas, public.cuenta_cobro_aceptaciones from public, anon, authenticated;
grant select on table public.aliado_firmas, public.cuenta_cobro_aceptaciones to service_role;
revoke all on sequence public.aliado_firmas_id_seq, public.cuenta_cobro_aceptaciones_id_seq from public, anon, authenticated;

-- ── Bucket privado, sin políticas (solo service_role) ─────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aliado-firmas', 'aliado-firmas', false, 524288, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- ── RPC: registrar una firma (atómico, idempotente por hash) ──────────────
create or replace function public.registrar_firma_aliado(p_aliado_id bigint, p_path text, p_sha text, p_mime text, p_bytes integer, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.aliado_firmas; v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('firma:' || p_aliado_id::text));
  if not exists (select 1 from public.aliados where id = p_aliado_id) then return jsonb_build_object('ok', false, 'codigo', 'sin_aliado'); end if;
  select * into v from public.aliado_firmas where aliado_id = p_aliado_id and vigente;
  if found and v.sha256 = p_sha then return jsonb_build_object('ok', true, 'id', v.id, 'repetida', true); end if;
  update public.aliado_firmas set vigente = false where aliado_id = p_aliado_id and vigente;
  insert into public.aliado_firmas (aliado_id, storage_path, sha256, mime, bytes, creado_por)
  values (p_aliado_id, p_path, p_sha, p_mime, p_bytes, p_user) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetida', false);
end $$;

-- ── RPC: aceptar una versión (atómico: versión asignada bajo bloqueo; idempotente por hash) ─
create or replace function public.aceptar_cuenta_cobro(p_clave text, p_aliado_id bigint, p_snapshot jsonb, p_hash text, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.cuenta_cobro_aceptaciones; f public.aliado_firmas; n integer; v_id bigint;
begin
  if p_clave is null or p_clave !~ '^(ab|cu):.+' or p_hash !~ '^[0-9a-f]{64}$' or p_user is null
     or coalesce(p_snapshot ->> 'v', '') <> '1' or (p_snapshot ->> 'clave') is distinct from p_clave
     or (p_snapshot #>> '{aliado,id}') is distinct from p_aliado_id::text then
    return jsonb_build_object('ok', false, 'codigo', 'datos');
  end if;
  perform pg_advisory_xact_lock(hashtext('ccc:' || p_clave));
  select * into a from public.cuenta_cobro_aceptaciones where clave = p_clave and snapshot_hash = p_hash;
  if found then return jsonb_build_object('ok', true, 'repetida', true, 'version', a.version, 'id', a.id); end if;
  select * into f from public.aliado_firmas where aliado_id = p_aliado_id and vigente;
  if not found then return jsonb_build_object('ok', false, 'codigo', 'sin_firma'); end if;
  select coalesce(max(version), 0) + 1 into n from public.cuenta_cobro_aceptaciones where clave = p_clave;
  insert into public.cuenta_cobro_aceptaciones (clave, aliado_id, version, snapshot, snapshot_hash, firma_id, firma_sha256, aceptada_por)
  values (p_clave, p_aliado_id, n, p_snapshot, p_hash, f.id, f.sha256, p_user) returning id into v_id;
  return jsonb_build_object('ok', true, 'repetida', false, 'version', n, 'id', v_id);
end $$;

revoke all on function public.registrar_firma_aliado(bigint, text, text, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.aceptar_cuenta_cobro(text, bigint, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.registrar_firma_aliado(bigint, text, text, text, integer, uuid) to service_role;
grant execute on function public.aceptar_cuenta_cobro(text, bigint, jsonb, text, uuid) to service_role;
