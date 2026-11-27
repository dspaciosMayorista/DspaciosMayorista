-- ROLLBACK 342 (#76: código de referido en el registro B2B). Se NIEGA si ya hay códigos de referido capturados (candidatos o decididos): no se destruye esa información en silencio.
-- Restaura `registro_b2b_completar` EXACTAMENTE como quedó en la 324 (copia literal) y quita lo que agregó la 342. Una sola transacción, con espera acotada de candados (5 s) y candado exclusivo antes de contar.
-- Las asignaciones ya hechas (aliado_referidores, 341) NO se tocan: eso lo decide el rollback de la 341.
begin;
set local lock_timeout = '5s';
lock table public.b2b_solicitudes in access exclusive mode;
do $$ begin
  if exists (select 1 from public.b2b_solicitudes where codigo_referido is not null) then
    raise exception 'ROLLBACK 342 detenido: hay registros con código de referido (candidatos o decididos). Revisar con el dueño antes de borrar esa información.';
  end if;
end $$;
drop function if exists public.referidos_candidatos(uuid);
drop function if exists public.referido_decidir_solicitud(uuid, bigint, text, bigint, numeric);

create or replace function public.registro_b2b_completar(p_usuario uuid, p_datos jsonb default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.registro_b2b_estado%rowtype; u record; d jsonb; doc text; cand integer; sug bigint; marcada boolean; correo text;
begin
  if not exists (select 1 from auth.users where id = p_usuario) then return 'sin_cuenta'; end if;
  begin
    insert into public.registro_b2b_estado (usuario_id) values (p_usuario) on conflict (usuario_id) do nothing;
  exception when foreign_key_violation then return 'sin_cuenta';
  end;
  select * into r from public.registro_b2b_estado where usuario_id = p_usuario for update;
  if not found then return 'sin_cuenta'; end if;
  if not public.p324_correo_confirmado(p_usuario) then return 'sin_verificar'; end if;
  select coalesce((raw_app_meta_data ->> 'registro_b2b_codigo') = 'true', false), lower(btrim(email)) into marcada, correo from auth.users where id = p_usuario;
  select id, rol, nombre, activo into u from public.usuarios where id = p_usuario;
  if not found or not marcada or u.activo is distinct from false or u.rol not in ('agencia', 'freelance') then return 'no_aplica'; end if;
  if exists (select 1 from public.b2b_solicitudes where usuario_id = p_usuario) then
    update public.registro_b2b_estado set estado = 'completado', datos = null, actualizado_en = now() where usuario_id = p_usuario;
    return 'ya_existia';
  end if;
  d := coalesce(r.datos, p_datos, '{}'::jsonb);
  doc := nullif(btrim(coalesce(d ->> 'nit', '')), '');
  -- SUGERENCIA (no enlace) de la ficha del catálogo por documento, solo si es inequívoca (migración 143).
  if doc is not null then
    select count(*), min(id) into cand, sug from public.aliados where nit = doc;
    if cand <> 1 then sug := null; end if;
  end if;
  insert into public.b2b_solicitudes (tipo, nombre, nit, tipo_documento, aliado_sugerido_id, contacto, email, telefono, ciudad, notas, acepta_notificaciones, estado, usuario_id)
  values (
    u.rol, btrim(coalesce(u.nombre, d ->> 'nombre', '')), doc,
    coalesce(nullif(btrim(coalesce(d ->> 'tipo_documento', '')), ''), case when u.rol = 'agencia' then 'NIT' else 'CC' end),
    sug, nullif(btrim(coalesce(d ->> 'contacto', '')), ''), correo,
    nullif(btrim(coalesce(d ->> 'telefono', '')), ''), nullif(btrim(coalesce(d ->> 'ciudad', '')), ''), nullif(btrim(coalesce(d ->> 'notas', '')), ''),
    coalesce((d ->> 'acepta_notificaciones') = 'true', false), 'pendiente', p_usuario
  );
  update public.registro_b2b_estado set estado = 'completado', datos = null, actualizado_en = now() where usuario_id = p_usuario;
  return 'creada';
end $$;

alter table public.b2b_solicitudes drop constraint if exists b2b_solicitudes_referido_coherente;
alter table public.b2b_solicitudes drop column if exists referido_decidido_en, drop column if exists referido_decidido_por, drop column if exists referido_estado, drop column if exists codigo_referido;
revoke all on function public.registro_b2b_completar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.registro_b2b_completar(uuid, jsonb) to service_role;
commit;
