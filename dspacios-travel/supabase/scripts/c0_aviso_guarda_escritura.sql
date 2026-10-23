-- ───────────────────────────────────────────────────────────────────────────
-- C0 (OPCIONAL) · modo AVISO de la fase C — diseño §6.5 y §6.8.3, paso 4.
--
-- NO es una migración: es un script que se corre a mano, con aprobación, en
-- la base compartida (Producción + Preview), DESPUÉS de la barrera B→C y ANTES
-- de la migración 199, durante un ciclo operativo acordado (al menos un día con
-- reservas, una confirmación por abono, una carga masiva y una corrida del cron).
--
-- Qué hace: instala dos triggers con EXACTAMENTE los criterios de la 199, pero
-- en vez de rechazar, DEJAN PASAR la escritura y registran una fila en
-- `public.vuelos_guarda_avisos`. No revoca privilegios ni cambia policies: no
-- rompe nada, tampoco el código anterior a B.
--
-- Cómo se lee (observable, sin depender de los logs de Postgres):
--   select count(*), min(creado_en), max(creado_en) from public.vuelos_guarda_avisos;
--   select tabla, operacion, rol_bd, detalle, count(*) from public.vuelos_guarda_avisos
--    group by 1, 2, 3, 4 order by 5 desc;
-- Cualquier fila = algún despliegue (un Producción viejo o un Preview sin
-- rebasar) sigue escribiendo directo. La 199 NO se corre hasta que el ciclo
-- acordado termine con CERO filas.
--
-- La 199 retira estos triggers al aplicarse; la tabla de avisos se conserva
-- como evidencia. Para retirar C0 sin aplicar la 199:
-- supabase/scripts/c0_retirar_aviso.sql.
-- ───────────────────────────────────────────────────────────────────────────
begin;

create table if not exists public.vuelos_guarda_avisos (
  id         bigserial primary key,
  creado_en  timestamptz not null default now(),
  tabla      text not null,
  operacion  text not null,
  rol_bd     text not null,
  actor_id   uuid,
  fila_id    bigint,
  detalle    text not null
);
comment on table public.vuelos_guarda_avisos is
  'C0 (modo aviso de la fase C): escrituras directas que la 199 rechazaría. Debe quedar vacía durante el ciclo acordado.';
alter table public.vuelos_guarda_avisos enable row level security;   -- sin policies: solo el dueño la lee
revoke all on public.vuelos_guarda_avisos from public, anon, authenticated, service_role;

create or replace function public._c0_registrar_aviso(p_tabla text, p_op text, p_rol text, p_fila bigint, p_detalle text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Solo desde los triggers de C0 (no por RPC: nadie inyecta avisos falsos).
  if pg_trigger_depth() < 1 then
    raise exception using errcode = '42501', message = 'Solo lo invocan los triggers de C0.';
  end if;
  insert into public.vuelos_guarda_avisos (tabla, operacion, rol_bd, actor_id, fila_id, detalle)
  values (p_tabla, p_op, p_rol, auth.uid(), p_fila, p_detalle);
  raise warning 'GUARDA_ESCRITURA (aviso C0): %', p_detalle;
end $$;
revoke all on function public._c0_registrar_aviso(text, text, text, bigint, text) from public, anon, authenticated, service_role;
-- Los triggers corren como el rol que escribe: necesita poder llamar al registro.
grant execute on function public._c0_registrar_aviso(text, text, text, bigint, text) to authenticated, anon;

create or replace function public._c0_sillas_aviso_escritura()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  c_datos constant text[] := array[
    'pasajero_nombres', 'pasajero_apellidos', 'tipo_doc', 'numero_doc', 'nacimiento',
    'asesor', 'agencia', 'hotel', 'acomodacion', 'plazo',
    'inf_nombres', 'inf_apellidos', 'inf_tipo_doc', 'inf_numero', 'inf_nacimiento',
    'responsable_menor', 'updated_at'];
  v_old jsonb; v_new jsonb; v_prohibidas text; v_datos text;
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    perform public._c0_registrar_aviso('sillas', tg_op, current_user, new.id, 'INSERT directo de una silla');
    return new;
  elsif tg_op = 'DELETE' then
    perform public._c0_registrar_aviso('sillas', tg_op, current_user, old.id, 'DELETE directo de una silla');
    return old;
  end if;
  if old.estado::text = 'retirada' then
    perform public._c0_registrar_aviso('sillas', tg_op, current_user, old.id, 'cambio en una silla retirada');
    return new;
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  select string_agg(k, ', ' order by k) filter (where not (k = any (c_datos))),
         string_agg(k, ', ' order by k) filter (where k = any (c_datos))
    into v_prohibidas, v_datos
    from jsonb_object_keys(v_new) as t(k) where v_new -> k is distinct from v_old -> k;
  if v_prohibidas is not null then
    perform public._c0_registrar_aviso('sillas', tg_op, current_user, old.id, 'cambio directo en ' || v_prohibidas);
  elsif v_datos is not null and (nullif(btrim(old.numero_contrato), '') is not null or nullif(btrim(old.contrato_manual), '') is not null) then
    perform public._c0_registrar_aviso('sillas', tg_op, current_user, old.id, 'datos de una silla con contrato: ' || v_datos);
  end if;
  return new;
end $$;

create or replace function public._c0_bloqueos_aviso_cupos()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    perform public._c0_registrar_aviso('bloqueos_vuelo', tg_op, current_user, new.id, 'INSERT directo de un record');
    return new;
  elsif tg_op = 'DELETE' then
    perform public._c0_registrar_aviso('bloqueos_vuelo', tg_op, current_user, old.id, 'DELETE directo de un record');
    return old;
  end if;
  if new.id is distinct from old.id or new.cupos_total is distinct from old.cupos_total then
    perform public._c0_registrar_aviso('bloqueos_vuelo', tg_op, current_user, old.id,
      format('cambio directo de cupos_total (%s → %s) o id', old.cupos_total, new.cupos_total));
  end if;
  return new;
end $$;

revoke all on function public._c0_sillas_aviso_escritura() from public, anon, authenticated, service_role;
revoke all on function public._c0_bloqueos_aviso_cupos() from public, anon, authenticated, service_role;

drop trigger if exists sillas_aviso_escritura on public.sillas;
create trigger sillas_aviso_escritura before insert or update or delete on public.sillas
  for each row execute function public._c0_sillas_aviso_escritura();
drop trigger if exists bloqueos_aviso_cupos on public.bloqueos_vuelo;
create trigger bloqueos_aviso_cupos before insert or update or delete on public.bloqueos_vuelo
  for each row execute function public._c0_bloqueos_aviso_cupos();

commit;
