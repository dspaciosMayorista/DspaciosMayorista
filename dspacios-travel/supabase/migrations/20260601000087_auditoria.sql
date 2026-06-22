-- ───────────────────────────────────────────────────────────────────────────
-- 087 · AUDITORÍA — log de trazabilidad de TODO el CRUD
--
--  Registra cada INSERT / UPDATE / DELETE de las tablas de negocio mediante un
--  trigger genérico, capturando:
--    · QUIÉN  → auth.uid() + snapshot de email/nombre/rol (sobrevive aunque
--               luego se borre o renombre al usuario).
--    · QUÉ    → tabla + registro (numero_contrato / record / id) + operación.
--    · CAMBIOS→ fila antes/después (jsonb) y, en updates, solo los campos que
--               cambiaron (`cambios`).
--
--  Cobertura automática: el trigger se adjunta a todas las tablas base de
--  `public` (menos una pequeña lista de exclusión), así que cubre todo el CRUD
--  sin instrumentar el código de cada acción, e incluye tablas futuras al
--  re-correr el bloque de adjuntar.
--
--  Nota: las escrituras hechas con la llave `service_role` (p. ej. sillas/costos
--  al reservar) NO traen `auth.uid()`, por lo que el actor queda nulo
--  ("Sistema") aunque el cambio de datos sí se registra.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.auditoria (
  id            bigserial primary key,
  creado_en     timestamptz not null default now(),
  actor_id      uuid,                 -- auth.users(id); null = service_role/sistema
  actor_email   text,
  actor_nombre  text,
  actor_rol     text,
  accion        text not null,        -- INSERT | UPDATE | DELETE
  tabla         text not null,
  registro_id   text,                 -- numero_contrato / record / id de la fila
  antes         jsonb,                -- fila previa (UPDATE/DELETE)
  despues       jsonb,                -- fila nueva (INSERT/UPDATE)
  cambios       jsonb                 -- solo campos que cambiaron (UPDATE)
);

create index if not exists idx_auditoria_creado_en on public.auditoria (creado_en desc);
create index if not exists idx_auditoria_tabla_reg on public.auditoria (tabla, registro_id);
create index if not exists idx_auditoria_actor      on public.auditoria (actor_id);

-- RLS: solo lectura para superadmin y gerencia. La escritura la hace el trigger
-- (SECURITY DEFINER), nunca los clientes directamente.
alter table public.auditoria enable row level security;

drop policy if exists auditoria_select on public.auditoria;
create policy auditoria_select on public.auditoria
  for select to authenticated
  using (exists (
    select 1 from public.usuarios u
    where u.id = auth.uid() and u.rol in ('superadmin', 'gerencia')
  ));

-- ── Función genérica del trigger ───────────────────────────────────────────
create or replace function public.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_email  text;
  v_nombre text;
  v_rol    text;
  v_old    jsonb;
  v_new    jsonb;
  v_id     text;
  v_cambios jsonb;
begin
  if v_actor is not null then
    select u.email, u.nombre, u.rol::text
      into v_email, v_nombre, v_rol
      from public.usuarios u
      where u.id = v_actor;
  end if;

  if (tg_op = 'DELETE') then
    v_old := to_jsonb(old); v_new := null;
  elsif (tg_op = 'INSERT') then
    v_old := null; v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old); v_new := to_jsonb(new);
  end if;

  -- Llave legible de la fila: contrato → record → id → codigo.
  v_id := coalesce(
    v_new->>'numero_contrato', v_old->>'numero_contrato',
    v_new->>'record',          v_old->>'record',
    v_new->>'id',              v_old->>'id',
    v_new->>'codigo',          v_old->>'codigo'
  );

  -- En updates, solo los campos que cambiaron.
  if (tg_op = 'UPDATE') then
    select jsonb_object_agg(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k))
      into v_cambios
      from jsonb_object_keys(v_new) as t(k)
      where v_old->k is distinct from v_new->k;
    -- Si nada cambió de verdad, no registres ruido.
    if v_cambios is null then
      return new;
    end if;
  end if;

  insert into public.auditoria(
    actor_id, actor_email, actor_nombre, actor_rol,
    accion, tabla, registro_id, antes, despues, cambios
  ) values (
    v_actor, v_email, v_nombre, v_rol,
    tg_op, tg_table_name, v_id, v_old, v_new, v_cambios
  );

  return coalesce(new, old);
end;
$$;

-- ── Adjuntar el trigger a todas las tablas base de `public` ────────────────
-- Excluye la propia tabla de auditoría (evita recursión) y tablas derivadas de
-- alto volumen / re-generación masiva (ruido sin valor de trazabilidad).
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
