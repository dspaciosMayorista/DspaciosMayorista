-- 328 · #103 — Supplier service requests (structured email built from reservation data) and supplier PAYMENT notices, with reply tracking, internal notices and required promotion codes. Additive, idempotent.
--
-- Four DISTINCT facts are kept apart (the brief): SENT (our provider accepted the message), DELIVERED (the recipient's server accepted it), REPLIED (a supplier reply was correlated to this request)
-- and CONFIRMED/REJECTED (a business decision recorded by an internal user after reading the reply: a reply is NOT a confirmation).
--   · `solicitudes_proveedor`  one row per (request content, recipients, version); `tipo` = solicitud (one contract) or pago (supplier payment notice). `clave_envio` UNIQUE = no duplicate send; `token_respuesta` UNIQUE = the correlation key carried in Reply-To.
--   · `solicitud_proveedor_eventos`  every provider/internal event, UNIQUE (solicitud, tipo, dedupe) = a duplicate webhook delivery is stored once and notifies once.
--   · `solicitud_proveedor_avisos`  one in-app notice per (event, internal user), UNIQUE = no duplicate notice.
--   · State only moves FORWARD (rank), under a row lock, so out-of-order events (delivery before «sent» is recorded, duplicates, retries) can never regress it.
-- Writes happen only through service_role (Server Actions / webhook route authorise in code); authenticated users can only READ what their role/tenant may see, and mark their own notices read.
--
-- CONTRACT IDENTITY (284 · H103-1). The table carries `numero_contrato` (FK → ventas), so it is CLASSIFIED in `contrato_guardas_config` (estricto) and its guard is installed at the end of this file; without that row the
--   installer `contrato_instalar_guardas()` aborts with GUARDA_SIN_CLASIFICAR. Each request stores `contrato_uid` = the contract LIFE the screen opened (declared by the screen in `x-contratos`, checked against the live
--   contract on INSERT, immutable afterwards; fn_renumerar_contrato moves the row by FK and the uid never changes). ASYNCHRONOUS events (provider webhook, no screen) declare the request's OWN stored uid inside the
--   SECURITY DEFINER function — never the contract's current uid substituted for a stale screen — and are IGNORED if that life no longer exists. A screen that sends a different uid is rejected by the same guard (CONTRATO_CAMBIO).
--   · Reuse of a DTM number: a contract that has a supplier request is NOT a reuse candidate (an email already left the building). `dtm_reuso_bloqueos` fails closed on any table that is not in its preparation list,
--     so no change to it is needed (proved in pruebas/solicitudProveedor103.pg.ts).
--   · Renumbering: the request, its token and its events follow the contract (the FK update is allowed by the guard because the uid is the same); `asunto` keeps the number the supplier actually received.
--   · Deleting a contract (eliminar_contrato without reuse) cascades the requests, like every other child table.
-- SEND CLAIM (H103-3). `enviando` is a LEASE (`envio_iniciado_en`), not a lock for ever. A claim older than the lease is taken over by exactly ONE caller (compare-and-swap on the database clock).
--   `incierta` = the outcome of the send is unknown (the worker died after claiming, or the provider's answer was lost). It is NEVER resent blindly: it leaves that state by a late provider event (delivery / reply)
--   or by an explicit resend decided by a person. Providers with idempotency keys (Resend) are re-asked with the SAME key, so the provider itself prevents a second message.
-- NOTHING is sent by this migration. Live sending is off until the owner configures sender/reply address, event and recipients (environment flags; see docs).
-- Rollback: supabase/scripts/rollback_328_solicitudes_proveedor.sql · Preflight/postcheck: supabase/scripts/preflight_328_solicitudes_proveedor.sql / postcheck_328_solicitudes_proveedor.sql

do $$
begin
  if to_regclass('public.ventas') is null then raise exception '328 ABORTADA: falta ventas.'; end if;
  if to_regprocedure('public.mi_rol()') is null then raise exception '328 ABORTADA: falta mi_rol().'; end if;
  if to_regprocedure('public.puede_ver_tenant(text)') is null then raise exception '328 ABORTADA: falta puede_ver_tenant(text) (migración 107).'; end if;
  if to_regclass('public.hoteles') is null or to_regclass('public.hotel_temporadas') is null or to_regprocedure('public.puede_escribir_catalogo_global()') is null then raise exception '328 ABORTADA: faltan hoteles / hotel_temporadas / puede_escribir_catalogo_global() (migraciones 016/237).'; end if;
  if to_regclass('public.contrato_guardas_config') is null or to_regprocedure('public.contrato_instalar_guardas()') is null or to_regprocedure('public.contrato_declarar_identidad(text,uuid)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid') then
    raise exception '328 ABORTADA: falta la 284 (identidad del contrato y guardas).';
  end if;
end $$;

create table if not exists public.solicitudes_proveedor (
  id               bigint generated always as identity primary key,
  tenant           text not null default 'mayorista',
  tipo             text not null default 'solicitud' check (tipo in ('solicitud', 'pago')),   -- solicitud = request of ONE contract; pago = payment notice (may relate several contracts, kept in `snapshot` + the join table of 329)
  numero_contrato  text references public.ventas(numero_contrato) on delete cascade,
  contrato_uid     uuid,
  hotel_id         bigint references public.hoteles(id) on delete set null,
  codigo_id        bigint,                 -- hotel_codigos_promocion(id): FK added below (the table is created after this one)
  codigo_texto     text,                   -- the code AS SENT (snapshot)
  codigo_promocion text,                   -- name of the validity/promotion the code belongs to, AS SENT
  sin_promocion    boolean not null default false,   -- the sender declared that this stay does not use the coded promotion
  referencia       text check (referencia is null or length(referencia) <= 120),   -- free reference typed when composing a payment notice (the payment itself stores none)
  snapshot         jsonb not null default '{}'::jsonb,   -- the exact data the email was built from (request fields / payment relation)
  payload          jsonb not null default '{}'::jsonb,   -- the FROZEN outbound message ({html, texto, adjuntos:[{soporteId,nombre,sha256,contentType,bytes}], pagoIds}): a retry re-sends THIS, never a rebuild from current data
  ambiguo          boolean not null default false,       -- some attempt may have reached the provider although its outcome is unknown: retries are bounded by the provider's idempotency window
  proveedor        text,
  destinatarios    text[] not null check (cardinality(destinatarios) between 1 and 5),
  asunto           text not null,
  token_respuesta  text not null unique check (token_respuesta ~ '^[A-Za-z0-9_-]{16,64}$'),
  clave_envio      text not null unique,
  estado           text not null default 'enviando' check (estado in ('enviando', 'incierta', 'enviada', 'entregada', 'respondida', 'confirmada', 'rechazada', 'fallida')),
  mensaje_id       text,
  error_envio      text,
  envio_iniciado_en timestamptz not null default now(),
  intentos         integer not null default 1,
  enviada_en       timestamptz,
  entregada_en     timestamptz,
  respondida_en    timestamptz,
  confirmada_en    timestamptz,
  confirmacion     text check (confirmacion in ('confirmada', 'rechazada')),
  creado_por       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint solicitudes_proveedor_contrato_chk check ((tipo = 'solicitud' and numero_contrato is not null and contrato_uid is not null) or (tipo = 'pago' and numero_contrato is null and contrato_uid is null and proveedor is not null))
);
create index if not exists solicitudes_proveedor_contrato_idx on public.solicitudes_proveedor (numero_contrato, created_at desc);
create index if not exists solicitudes_proveedor_mensaje_idx on public.solicitudes_proveedor (mensaje_id) where mensaje_id is not null;

create table if not exists public.solicitud_proveedor_eventos (
  id            bigint generated always as identity primary key,
  solicitud_id  bigint not null references public.solicitudes_proveedor(id) on delete cascade,
  tipo          text not null check (tipo in ('envio', 'error_envio', 'envio_incierto', 'entrega', 'rebote', 'respuesta', 'confirmacion', 'rechazo')),
  dedupe        text not null check (length(dedupe) between 1 and 200),
  externo_id    text,
  resumen       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (solicitud_id, tipo, dedupe)
);

create table if not exists public.solicitud_proveedor_avisos (
  id            bigint generated always as identity primary key,
  solicitud_id  bigint not null references public.solicitudes_proveedor(id) on delete cascade,
  evento_id     bigint not null references public.solicitud_proveedor_eventos(id) on delete cascade,
  user_id       uuid not null,
  creado_en     timestamptz not null default now(),
  leido_en      timestamptz,
  unique (evento_id, user_id)
);
create index if not exists solicitud_proveedor_avisos_user_idx on public.solicitud_proveedor_avisos (user_id) where leido_en is null;
create index if not exists solicitud_proveedor_avisos_solicitud_idx on public.solicitud_proveedor_avisos (solicitud_id);

create or replace function public.solicitud_proveedor_rango(p text) returns integer language sql immutable as $f$
  select case p when 'enviando' then 1 when 'incierta' then 1 when 'fallida' then 1 when 'enviada' then 2 when 'entregada' then 3 when 'respondida' then 4 when 'confirmada' then 5 when 'rechazada' then 5 else 0 end
$f$;

-- The request belongs to ONE contract life: on INSERT the declared uid must be the live contract's; afterwards it can never change (a renumbering changes the NUMBER, never the uid).
create or replace function public.fn_solicitud_proveedor_uid() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $f$
declare v uuid;
begin
  if new.tipo = 'pago' then return new; end if;                                   -- a payment notice belongs to no single contract
  if tg_op = 'INSERT' then
    select contrato_uid into v from public.ventas where numero_contrato = new.numero_contrato for key share;
    if v is null or new.contrato_uid is distinct from v then
      raise exception 'CONTRATO_CAMBIO: el contrato % que abriste ya no es el vigente (otra persona lo eliminó o lo reemplazó). No se envió nada.', new.numero_contrato using errcode = 'F4601';
    end if;
  elsif new.contrato_uid is distinct from old.contrato_uid then
    raise exception 'IDENTIDAD_INMUTABLE: la solicitud % pertenece a otra vida del contrato.', old.id using errcode = 'F4603';
  end if;
  return new;
end
$f$;
revoke all on function public.fn_solicitud_proveedor_uid() from public, anon, authenticated;
drop trigger if exists trg_solicitud_proveedor_uid on public.solicitudes_proveedor;
create trigger trg_solicitud_proveedor_uid before insert or update on public.solicitudes_proveedor for each row execute function public.fn_solicitud_proveedor_uid();

-- Registers ONE event and advances the state. Idempotent per (solicitud, tipo, dedupe): a repeat returns nuevo=false and changes/notifies nothing.
-- Identity: the request declares ITS OWN contract life (stored uid). If that life is gone the event is ignored; a screen header with another uid is rejected by the guard (CONTRATO_CAMBIO).
create or replace function public.registrar_evento_solicitud_proveedor(p_solicitud bigint, p_tipo text, p_dedupe text, p_externo text, p_resumen jsonb, p_avisar uuid[])
returns table (nuevo boolean, estado_nuevo text, id_evento bigint)
language plpgsql security definer set search_path = public, pg_temp as $f$
declare s public.solicitudes_proveedor%rowtype; v_evento bigint; v_nuevo_estado text;
begin
  select * into s from public.solicitudes_proveedor where id = p_solicitud for update;     -- serialises every event of this request
  if not found then return query select false, null::text, null::bigint; return; end if;
  if s.numero_contrato is not null then
    if not exists (select 1 from public.ventas v where v.numero_contrato = s.numero_contrato and v.contrato_uid = s.contrato_uid) then
      return query select false, null::text, null::bigint; return;                          -- the contract life this request belongs to no longer exists: nothing is written
    end if;
    perform public.contrato_declarar_identidad(s.numero_contrato, s.contrato_uid);
  end if;

  insert into public.solicitud_proveedor_eventos (solicitud_id, tipo, dedupe, externo_id, resumen)
  values (p_solicitud, p_tipo, p_dedupe, p_externo, coalesce(p_resumen, '{}'::jsonb))
  on conflict (solicitud_id, tipo, dedupe) do nothing
  returning id into v_evento;
  if v_evento is null then return query select false, s.estado, null::bigint; return; end if;   -- duplicate delivery: stored once, nothing else happens

  v_nuevo_estado := s.estado;
  if p_tipo = 'envio' then
    if public.solicitud_proveedor_rango(s.estado) < 2 then v_nuevo_estado := 'enviada'; end if;
    update public.solicitudes_proveedor set estado = v_nuevo_estado, enviada_en = coalesce(enviada_en, now()), mensaje_id = coalesce(p_externo, mensaje_id), error_envio = null, ambiguo = false, updated_at = now() where id = p_solicitud;
  elsif p_tipo = 'error_envio' then
    if s.estado in ('enviando', 'fallida') then v_nuevo_estado := 'fallida'; end if;           -- a late error never regresses a delivered/replied/uncertain request
    -- `ambiguo` only ever turns ON here (a later CLEAR rejection does not prove an earlier ambiguous attempt never reached the provider); it turns off only when a send is recorded.
    update public.solicitudes_proveedor set estado = v_nuevo_estado, error_envio = left(coalesce(p_resumen ->> 'error', 'error de envío'), 300), ambiguo = ambiguo or coalesce((p_resumen ->> 'ambiguo')::boolean, false), updated_at = now() where id = p_solicitud;
  elsif p_tipo = 'envio_incierto' then
    if s.estado = 'enviando' or (s.estado = 'fallida' and s.ambiguo) then v_nuevo_estado := 'incierta'; end if;   -- a claim in progress, or an ambiguous failure whose safe window expired, becomes uncertain
    update public.solicitudes_proveedor set estado = v_nuevo_estado, error_envio = left(coalesce(p_resumen ->> 'error', 'resultado del envío desconocido'), 300), ambiguo = true, updated_at = now() where id = p_solicitud;
  elsif p_tipo = 'entrega' then
    if public.solicitud_proveedor_rango(s.estado) < 3 then v_nuevo_estado := 'entregada'; end if;   -- may arrive before «envio» is recorded (or while uncertain): still moves forward
    update public.solicitudes_proveedor set estado = v_nuevo_estado, entregada_en = coalesce(entregada_en, now()), updated_at = now() where id = p_solicitud;
  elsif p_tipo = 'rebote' then
    if public.solicitud_proveedor_rango(s.estado) < 4 then v_nuevo_estado := 'fallida'; end if;     -- a bounce means NOT delivered, unless the supplier already replied
    update public.solicitudes_proveedor set estado = v_nuevo_estado, error_envio = left(coalesce(p_resumen ->> 'error', 'rebote'), 300), ambiguo = ambiguo or v_nuevo_estado = 'fallida', updated_at = now() where id = p_solicitud;   -- a bounced message WAS sent: a blind re-send would duplicate it
  elsif p_tipo = 'respuesta' then
    if public.solicitud_proveedor_rango(s.estado) < 4 then v_nuevo_estado := 'respondida'; end if;
    update public.solicitudes_proveedor set estado = v_nuevo_estado, respondida_en = coalesce(respondida_en, now()), updated_at = now() where id = p_solicitud;
    if p_avisar is not null then
      insert into public.solicitud_proveedor_avisos (solicitud_id, evento_id, user_id) select p_solicitud, v_evento, u from unnest(p_avisar) u on conflict (evento_id, user_id) do nothing;
    end if;
  elsif p_tipo in ('confirmacion', 'rechazo') then
    if public.solicitud_proveedor_rango(s.estado) >= 2 then
      v_nuevo_estado := case when p_tipo = 'confirmacion' then 'confirmada' else 'rechazada' end;
      update public.solicitudes_proveedor set estado = v_nuevo_estado, confirmacion = v_nuevo_estado, confirmada_en = now(), updated_at = now() where id = p_solicitud;
    end if;
  end if;
  return query select true, v_nuevo_estado, v_evento;
end
$f$;
revoke all on function public.registrar_evento_solicitud_proveedor(bigint, text, text, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.registrar_evento_solicitud_proveedor(bigint, text, text, text, jsonb, uuid[]) to service_role;

-- Takes over a send claim, once. `p_estado_visto`/`p_visto` are what the caller READ (state + lease start, passed back verbatim): exactly one concurrent caller wins (compare-and-swap under the row lock).
--   · fallida  → enviando (a failed attempt is retried at once).
--   · enviando → enviando only when the lease (database clock, `p_segundos`) has expired: the previous worker is presumed dead. The caller must then reconcile (provider idempotency) or mark `incierta`.
-- Returns the new `intentos` (>0) when the caller won, 0 when somebody else did / the claim is still alive.
create or replace function public.reclamar_envio_solicitud_proveedor(p_solicitud bigint, p_estado_visto text, p_visto timestamptz, p_segundos integer)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $f$
declare s public.solicitudes_proveedor%rowtype;
begin
  select * into s from public.solicitudes_proveedor where id = p_solicitud for update;
  if not found or s.estado is distinct from p_estado_visto or s.envio_iniciado_en is distinct from p_visto then return 0; end if;
  if s.estado = 'enviando' and s.envio_iniciado_en > now() - make_interval(secs => greatest(coalesce(p_segundos, 120), 30)) then return 0; end if;
  if s.estado not in ('enviando', 'fallida') then return 0; end if;
  if s.numero_contrato is not null then
    if not exists (select 1 from public.ventas v where v.numero_contrato = s.numero_contrato and v.contrato_uid = s.contrato_uid) then return 0; end if;
    perform public.contrato_declarar_identidad(s.numero_contrato, s.contrato_uid);
  end if;
  update public.solicitudes_proveedor set estado = 'enviando', error_envio = null, envio_iniciado_en = now(), intentos = intentos + 1, updated_at = now() where id = p_solicitud;
  return s.intentos + 1;
end
$f$;
revoke all on function public.reclamar_envio_solicitud_proveedor(bigint, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclamar_envio_solicitud_proveedor(bigint, text, timestamptz, integer) to service_role;


-- REQUIRED PROMOTION CODES (C). Some hotels require a promotion code in the supplier request. The requirement is configured PER VALIDITY/PROMOTION (a `hotel_temporadas` row) of a hotel: never one permanent code per
-- hotel and never derived from a promotion's display name. `requerido` with `codigo` null = «a code is required but nobody entered it yet»: sending is blocked until it is entered. Pure configuration: pricing is not read or changed.
create table if not exists public.hotel_codigos_promocion (
  id          bigint generated always as identity primary key,
  hotel_id    bigint not null references public.hoteles(id) on delete cascade,
  vigencia_id bigint not null unique references public.hotel_temporadas(id) on delete cascade,
  requerido   boolean not null default true,
  codigo      text check (codigo is null or length(btrim(codigo)) between 1 and 60),
  nota        text check (nota is null or length(nota) <= 300),
  creado_por  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists hotel_codigos_promocion_hotel_idx on public.hotel_codigos_promocion (hotel_id);

create or replace function public.fn_codigo_promocion_coherente() returns trigger language plpgsql set search_path = public, pg_temp as $f$
begin
  if not exists (select 1 from public.hotel_temporadas t where t.id = new.vigencia_id and t.hotel_id = new.hotel_id) then
    raise exception 'CODIGO_PROMOCION: la vigencia % no pertenece al hotel %.', new.vigencia_id, new.hotel_id using errcode = '23514';
  end if;
  new.codigo := nullif(btrim(new.codigo), ''); new.updated_at := now();
  return new;
end
$f$;
drop trigger if exists trg_codigo_promocion_coherente on public.hotel_codigos_promocion;
create trigger trg_codigo_promocion_coherente before insert or update on public.hotel_codigos_promocion for each row execute function public.fn_codigo_promocion_coherente();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'solicitudes_proveedor_codigo_fk') then
    alter table public.solicitudes_proveedor add constraint solicitudes_proveedor_codigo_fk foreign key (codigo_id) references public.hotel_codigos_promocion(id) on delete set null;
  end if;
end $$;

-- A request that carries a code must carry EXACTLY the configured code of ITS hotel (another hotel's or promotion's code can never be stored). «Missing» is decided by the app from the stay dates (it needs the coverage rule).
create or replace function public.fn_solicitud_proveedor_codigo() returns trigger language plpgsql set search_path = public, pg_temp as $f$
declare c public.hotel_codigos_promocion%rowtype;
begin
  if new.codigo_id is null then
    if new.codigo_texto is not null then raise exception 'CODIGO_PROMOCION: hay un código sin la configuración que lo respalda.' using errcode = '23514'; end if;
    return new;
  end if;
  select * into c from public.hotel_codigos_promocion where id = new.codigo_id;
  if not found or c.hotel_id is distinct from new.hotel_id or not c.requerido or c.codigo is null or c.codigo is distinct from new.codigo_texto then
    raise exception 'CODIGO_PROMOCION: el código no corresponde a la promoción configurada de este hotel.' using errcode = '23514';
  end if;
  return new;
end
$f$;
drop trigger if exists trg_solicitud_proveedor_codigo on public.solicitudes_proveedor;
create trigger trg_solicitud_proveedor_codigo before insert on public.solicitudes_proveedor for each row execute function public.fn_solicitud_proveedor_codigo();

alter table public.hotel_codigos_promocion enable row level security;
drop policy if exists "codigos_promocion: lectura" on public.hotel_codigos_promocion;
create policy "codigos_promocion: lectura" on public.hotel_codigos_promocion for select to authenticated using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop policy if exists "codigos_promocion: escritura" on public.hotel_codigos_promocion;
create policy "codigos_promocion: escritura" on public.hotel_codigos_promocion for all to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones')) with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));
drop policy if exists "catalogo global: insertar solo Mayorista" on public.hotel_codigos_promocion;
create policy "catalogo global: insertar solo Mayorista" on public.hotel_codigos_promocion as restrictive for insert to public with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: actualizar solo Mayorista" on public.hotel_codigos_promocion;
create policy "catalogo global: actualizar solo Mayorista" on public.hotel_codigos_promocion as restrictive for update to public using ((select public.puede_escribir_catalogo_global())) with check ((select public.puede_escribir_catalogo_global()));
drop policy if exists "catalogo global: borrar solo Mayorista" on public.hotel_codigos_promocion;
create policy "catalogo global: borrar solo Mayorista" on public.hotel_codigos_promocion as restrictive for delete to public using ((select public.puede_escribir_catalogo_global()));
revoke all on public.hotel_codigos_promocion from anon;
grant select, insert, update, delete on public.hotel_codigos_promocion to authenticated;

do $$ begin
  if to_regprocedure('public.fn_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.hotel_codigos_promocion';
    execute 'create trigger trg_auditoria after insert or update or delete on public.hotel_codigos_promocion for each row execute function public.fn_auditoria()';
  end if;
end $$;

alter table public.solicitudes_proveedor enable row level security;
alter table public.solicitud_proveedor_eventos enable row level security;
alter table public.solicitud_proveedor_avisos enable row level security;

drop policy if exists "solicitudes_proveedor: lectura" on public.solicitudes_proveedor;
create policy "solicitudes_proveedor: lectura" on public.solicitudes_proveedor for select to authenticated
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones') and public.puede_ver_tenant(tenant));
drop policy if exists "solicitud_proveedor_eventos: lectura" on public.solicitud_proveedor_eventos;
create policy "solicitud_proveedor_eventos: lectura" on public.solicitud_proveedor_eventos for select to authenticated
  using (exists (select 1 from public.solicitudes_proveedor s where s.id = solicitud_id and public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones') and public.puede_ver_tenant(s.tenant)));
drop policy if exists "solicitud_proveedor_avisos: propios" on public.solicitud_proveedor_avisos;
create policy "solicitud_proveedor_avisos: propios" on public.solicitud_proveedor_avisos for select to authenticated using (user_id = auth.uid());
drop policy if exists "solicitud_proveedor_avisos: marcar leído" on public.solicitud_proveedor_avisos;
create policy "solicitud_proveedor_avisos: marcar leído" on public.solicitud_proveedor_avisos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.solicitudes_proveedor, public.solicitud_proveedor_eventos, public.solicitud_proveedor_avisos from anon, authenticated;
grant select on public.solicitudes_proveedor, public.solicitud_proveedor_eventos to authenticated;
grant select on public.solicitud_proveedor_avisos to authenticated;
grant update (leido_en) on public.solicitud_proveedor_avisos to authenticated;

do $$ begin
  if to_regprocedure('public.fn_auditoria()') is not null then
    execute 'drop trigger if exists trg_auditoria on public.solicitudes_proveedor';
    execute 'create trigger trg_auditoria after insert or update or delete on public.solicitudes_proveedor for each row execute function public.fn_auditoria()';
  end if;
end $$;

-- Identity guard (284): the table is written by contract number → STRICT mode like every other child table. Without this row `contrato_instalar_guardas()` aborts for the whole database.
insert into public.contrato_guardas_config (tabla, modo, motivo)
values ('solicitudes_proveedor', 'estricto', 'solicitud de servicio enviada por correo a un proveedor (#103): se escribe con la identidad del contrato que la pantalla abrió; los eventos asíncronos declaran la identidad GUARDADA en la solicitud')
on conflict (tabla) do nothing;
select public.contrato_instalar_guardas();

comment on table public.solicitudes_proveedor is '#103: solicitud de servicio enviada por correo a un proveedor (correo estructurado armado con los datos de la reserva; tipo pago = aviso de pago a proveedor). estado: enviando→enviada→entregada→respondida→confirmada/rechazada (fallida e incierta aparte). Enviada ≠ entregada ≠ respondida ≠ confirmada. incierta = resultado del envío desconocido, nunca se reenvía a ciegas. Escrituras solo por service_role.';
