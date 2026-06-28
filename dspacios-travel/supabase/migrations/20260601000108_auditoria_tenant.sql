-- ───────────────────────────────────────────────────────────────────────────
-- 108 · MULTITENANT — auditoría por agencia
--
--  La auditoría pasa a estampar la agencia (tenant) de la fila modificada, para
--  que el log se filtre por agencia. Si la tabla no tiene columna tenant, queda
--  'mayorista' (todo lo legado).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.auditoria add column if not exists tenant text not null default 'mayorista';

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
  v_tenant text;
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

  v_id := coalesce(
    v_new->>'numero_contrato', v_old->>'numero_contrato',
    v_new->>'record',          v_old->>'record',
    v_new->>'id',              v_old->>'id',
    v_new->>'codigo',          v_old->>'codigo'
  );
  -- Agencia de la fila (si la tabla la tiene); por defecto mayorista.
  v_tenant := coalesce(v_new->>'tenant', v_old->>'tenant', 'mayorista');

  if (tg_op = 'UPDATE') then
    select jsonb_object_agg(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k))
      into v_cambios
      from jsonb_object_keys(v_new) as t(k)
      where v_old->k is distinct from v_new->k;
    if v_cambios is null then
      return new;
    end if;
  end if;

  insert into public.auditoria(
    actor_id, actor_email, actor_nombre, actor_rol,
    accion, tabla, registro_id, antes, despues, cambios, tenant
  ) values (
    v_actor, v_email, v_nombre, v_rol,
    tg_op, tg_table_name, v_id, v_old, v_new, v_cambios, v_tenant
  );

  return coalesce(new, old);
end;
$$;
