-- ───────────────────────────────────────────────────────────────────────────
-- 294 · Mantenimiento: suspensión de escrituras para la ventana #75+#97 — SIN APLICAR
--
-- NUMERACIÓN: la 293 (`vigencia_grupos_dias_inactivos`, #43/#60) ya está aplicada y fusionada en main (#446). 294 verificado libre en origin/main y en todos los worktrees
-- y ramas locales (2026-11-11). Si otro frente la toma antes de fusionar, renumerar ESTE archivo (aún no está aplicado).
--
-- QUÉ ES: piezas INERTES (mantenimiento APAGADO al aplicar). No registra ningún filtro ni pausa nada: eso lo hace `mant_priv.activar` en la ventana.
--   · `public.mantenimiento_pre_request()` — filtro para `pgrst.db_pre_request`. SECURITY INVOKER y SIN cláusulas SET: el filtro que ya existiera se
--     ejecuta PRIMERO y con el mismo rol, JWT, search_path y RLS que si PostgREST lo llamara directo. Solo la decisión de mantenimiento corre como
--     DEFINER (`mant_priv.decidir`), porque la configuración no es legible por los roles de la API.
--   · trigger `mantenimiento_storage` en `storage.objects` (subir, sobrescribir y borrar; un trigger y no una política porque service_role tiene BYPASSRLS).
--   · EXCEPCIÓN de validación: secreto de SERVIDOR (cabecera x-dspacios-mantenimiento; la base guarda solo su sha256) + operador AUTORIZADO
--     (cabecera x-dspacios-operador con el usuario que el servidor verificó; debe estar en la lista de la ventana y, si la petición trae JWT de
--     usuario, ser ese mismo usuario). Tener la cabecera NO abre la operación a otros usuarios del despliegue nuevo. No toca permisos ni RLS.
--   · `mant_priv.activar / habilitar_excepcion / desactivar / cortar_en_curso / estado`: solo el dueño de la base (sin EXECUTE para la API). Activar y
--     desactivar son atómicos y restauran EXACTAMENTE la configuración previa de `pgrst.db_pre_request` (nivel de rol y nivel de base) y el estado de
--     los jobs de pg_cron.
--   · `public.mantenimiento_sonda()`: RPC que NO escribe; un POST a ella responde 200 sin mantenimiento y 503 con él (comprobación desde fuera).
-- Sin filtro permanente: al desactivar no queda ningún filtro nuevo registrado.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$ begin
  if to_regnamespace('mant_priv') is not null then raise exception '294: ya aplicada (existe mant_priv).'; end if;
  if to_regclass('storage.objects') is null then raise exception '294 ABORTADA SIN MODIFICAR NADA: no existe storage.objects.'; end if;
end $$;

create schema mant_priv;
revoke all on schema mant_priv from public;
grant usage on schema mant_priv to anon, authenticated, service_role;   -- solo para ejecutar las 3 funciones que se otorgan abajo

create table mant_priv.config (
  id               boolean primary key default true check (id),
  activo           boolean not null default false,
  desde            timestamptz,
  rol_filtro       name,                      -- rol de PostgREST (en Supabase: authenticator)
  nivel            text check (nivel in ('rol', 'base')),   -- dónde se registró el filtro de mantenimiento
  previo_rol       text,                      -- valor previo de pgrst.db_pre_request a nivel de ROL (NULL = no había)
  previo_base      text,                      -- valor previo a nivel de BASE (alter role … in database <esta>) (NULL = no había)
  previo_efectivo  regproc,                   -- el filtro previo que rige (base > rol); se ejecuta primero
  clave_sha256     text check (clave_sha256 ~ '^[0-9a-f]{64}$'),
  operadores       uuid[] not null default '{}',
  cron_pausados    bigint[] not null default '{}',   -- jobs de pg_cron que ESTA activación pausó (se reactivan solo esos)
  activado_por     text
);
insert into mant_priv.config (id) values (true);
revoke all on mant_priv.config from public, anon, authenticated, service_role;

-- ── decisión (DEFINER: lee la configuración) ─────────────────────────────────────────────────────────────
create or replace function mant_priv.excepcion(p_headers text, p_claims text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare c mant_priv.config; h json; v_clave text; v_op text; v_uid uuid; v_sub text; v_rol text;
begin
  select * into c from mant_priv.config where id;
  if not c.activo or c.clave_sha256 is null or coalesce(cardinality(c.operadores), 0) = 0 then return false; end if;
  begin h := nullif(p_headers, '')::json; exception when others then return false; end;
  v_clave := h ->> 'x-dspacios-mantenimiento'; v_op := h ->> 'x-dspacios-operador';
  if v_clave is null or length(v_clave) < 32 or encode(sha256(convert_to(v_clave, 'UTF8')), 'hex') <> c.clave_sha256 then return false; end if;
  begin v_uid := v_op::uuid; exception when others then return false; end;
  if v_uid is null or not (v_uid = any (c.operadores)) then return false; end if;
  -- en CADA petición (no solo al activar): un operador desactivado o al que se le retiró el rol pierde la excepción en el acto
  if not exists (select 1 from public.usuarios u where u.id = v_uid and u.activo and u.rol::text in ('superadmin', 'administracion')) then return false; end if;
  begin v_sub := nullif(p_claims, '')::json ->> 'sub'; v_rol := nullif(p_claims, '')::json ->> 'role'; exception when others then return false; end;
  if v_rol is distinct from 'service_role' and v_rol is distinct from 'authenticated' then return false; end if;   -- anon nunca
  if v_rol = 'authenticated' and v_sub is distinct from v_uid::text then return false; end if;                       -- JWT de otro usuario: no
  return true;
end $$;
revoke all on function mant_priv.excepcion(text, text) from public, anon, authenticated, service_role;

create or replace function mant_priv.decidir() returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not coalesce((select activo from mant_priv.config where id), false) then return; end if;
  if upper(coalesce(current_setting('request.method', true), '')) in ('GET', 'HEAD', 'OPTIONS') then return; end if;   -- PostgREST: transacción de solo lectura
  if mant_priv.excepcion(current_setting('request.headers', true), current_setting('request.jwt.claims', true)) then return; end if;
  raise exception using errcode = 'PT503', message = 'Mantenimiento: las escrituras están suspendidas temporalmente.', hint = 'Reintenta cuando termine la ventana de mantenimiento.';
end $$;
revoke all on function mant_priv.decidir() from public;
grant execute on function mant_priv.decidir() to anon, authenticated, service_role;

create or replace function mant_priv.previo() returns regproc
language sql stable security definer set search_path = pg_catalog, pg_temp as $$ select previo_efectivo from mant_priv.config where id and activo $$;
revoke all on function mant_priv.previo() from public;
grant execute on function mant_priv.previo() to anon, authenticated, service_role;

-- ── filtro para pgrst.db_pre_request: INVOKER y sin SET (el previo corre en el contexto de la petición) ─────────────
create or replace function public.mantenimiento_pre_request() returns void language plpgsql as $$
declare p regproc := mant_priv.previo();
begin
  if p is not null then execute 'select ' || p::text || '()'; end if;   -- el filtro que ya existía, primero y con el mismo rol/JWT/search_path/RLS
  perform mant_priv.decidir();
end $$;
revoke all on function public.mantenimiento_pre_request() from public;
grant execute on function public.mantenimiento_pre_request() to anon, authenticated, service_role;

create or replace function public.mantenimiento_sonda() returns text language sql volatile as $$ select 'sin mantenimiento'::text $$;   -- no escribe
revoke all on function public.mantenimiento_sonda() from public;
grant execute on function public.mantenimiento_sonda() to anon, authenticated, service_role;

-- ── Storage ─────────────────────────────────────────────────────────────────────────────────
create or replace function mant_priv.tg_storage() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce((select activo from mant_priv.config where id), false)
     and not mant_priv.excepcion(current_setting('request.headers', true), current_setting('request.jwt.claims', true)) then
    raise exception using errcode = 'P0001', message = 'Mantenimiento: Storage no admite escrituras temporalmente.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function mant_priv.tg_storage() from public, anon, authenticated, service_role;
create trigger mantenimiento_storage before insert or update or delete on storage.objects for each row execute function mant_priv.tg_storage();

-- ── administración (solo el dueño de la base; atómicas) ─────────────────────────────────────────────────────
create or replace function mant_priv.valor_filtro(p_rol name, p_base oid) returns text language sql stable set search_path = pg_catalog, pg_temp as $$
  select substr(s, length('pgrst.db_pre_request=') + 1) from pg_db_role_setting d, unnest(d.setconfig) s
   where d.setrole = (select oid from pg_roles where rolname = p_rol) and d.setdatabase = p_base and s like 'pgrst.db_pre_request=%' $$;

create or replace function mant_priv.activar(p_operadores uuid[], p_rol name default 'authenticator') returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare c mant_priv.config; v_rol text; v_base text; v_ef text; v_efp regproc; v_nivel text; v_db oid := (select oid from pg_database where datname = current_database());
  v_malos int; v_cron bigint[] := '{}';
begin
  select * into c from mant_priv.config where id for update;
  if c.activo then raise exception 'mant: ya está ACTIVO desde %; desactívalo antes de volver a activar.', c.desde; end if;
  if not exists (select 1 from pg_roles where rolname = p_rol) then raise exception 'mant: no existe el rol %.', p_rol; end if;
  if coalesce(cardinality(p_operadores), 0) = 0 then raise exception 'mant: indica al menos un operador autorizado.'; end if;
  select count(*) into v_malos from unnest(p_operadores) o
   where not exists (select 1 from public.usuarios u where u.id = o and u.activo and u.rol::text in ('superadmin', 'administracion'));
  if v_malos > 0 then raise exception 'mant: % operador(es) no son usuarios activos superadmin/administracion.', v_malos; end if;
  v_rol := mant_priv.valor_filtro(p_rol, 0); v_base := mant_priv.valor_filtro(p_rol, v_db);
  v_ef := coalesce(v_base, v_rol);
  if v_ef is not null then
    if trim(both '"' from v_ef) in ('public.mantenimiento_pre_request', 'mantenimiento_pre_request') then
      raise exception 'mant: el filtro registrado ya es el de mantenimiento (activación previa sin desactivar): revisar a mano, no se encadena consigo mismo.';
    end if;
    v_efp := to_regproc(v_ef);
    if v_efp is null then raise exception 'mant: el filtro previo «%» no existe como función; revisar antes de activar (no se oculta un filtro roto).', v_ef; end if;
  end if;
  v_nivel := case when v_base is not null then 'base' else 'rol' end;   -- el de base manda sobre el de rol: se reemplaza donde rige
  if v_nivel = 'base' then execute format('alter role %I in database %I set pgrst.db_pre_request = %L', p_rol, current_database(), 'public.mantenimiento_pre_request');
  else execute format('alter role %I set pgrst.db_pre_request = %L', p_rol, 'public.mantenimiento_pre_request'); end if;
  if to_regclass('cron.job') is not null then
    select coalesce(array_agg(jobid), '{}') into v_cron from cron.job where active and jobname in ('tarifario_cola_correr', 'tarifario_cola_purga');
    perform cron.alter_job(j, active := false) from unnest(v_cron) j;
  end if;
  update mant_priv.config set activo = true, desde = now(), rol_filtro = p_rol, nivel = v_nivel, previo_rol = v_rol, previo_base = v_base, previo_efectivo = v_efp,
         clave_sha256 = null, operadores = p_operadores, cron_pausados = v_cron, activado_por = session_user where id;
  perform pg_notify('pgrst', 'reload config');
  return jsonb_build_object('activo', true, 'nivel', v_nivel, 'previo_rol', v_rol, 'previo_base', v_base, 'cron_pausados', v_cron, 'operadores', cardinality(p_operadores));
end $$;

create or replace function mant_priv.habilitar_excepcion(p_clave_sha256 text) returns void
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if p_clave_sha256 is null or p_clave_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'mant: se espera el sha256 en hexadecimal (64 caracteres), nunca el secreto.'; end if;
  update mant_priv.config set clave_sha256 = p_clave_sha256 where id and activo;
  if not found then raise exception 'mant: el mantenimiento no está activo.'; end if;
end $$;

create or replace function mant_priv.desactivar() returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare c mant_priv.config;
begin
  select * into c from mant_priv.config where id for update;
  if not c.activo then return jsonb_build_object('activo', false, 'nota', 'ya estaba desactivado: no se cambió nada'); end if;
  -- restaurar EXACTAMENTE los dos niveles
  if c.nivel = 'base' then execute format('alter role %I in database %I set pgrst.db_pre_request = %L', c.rol_filtro, current_database(), c.previo_base);
  elsif c.previo_rol is null then execute format('alter role %I reset pgrst.db_pre_request', c.rol_filtro);
  else execute format('alter role %I set pgrst.db_pre_request = %L', c.rol_filtro, c.previo_rol); end if;
  if to_regclass('cron.job') is not null then perform cron.alter_job(j, active := true) from unnest(c.cron_pausados) j where exists (select 1 from cron.job where jobid = j); end if;
  update mant_priv.config set activo = false, desde = null, nivel = null, previo_rol = null, previo_base = null, previo_efectivo = null, clave_sha256 = null,
         operadores = '{}', cron_pausados = '{}', activado_por = null where id;
  perform pg_notify('pgrst', 'reload config');
  return jsonb_build_object('activo', false, 'restaurado_rol', c.previo_rol, 'restaurado_base', c.previo_base, 'cron_reactivados', c.cron_pausados);
end $$;

-- corta las transacciones de PostgREST/Storage abiertas ANTES de la activación (peticiones en curso que ya pasaron el filtro)
create or replace function mant_priv.cortar_en_curso() returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare c mant_priv.config; n int;
begin
  select * into c from mant_priv.config where id;
  if not c.activo then raise exception 'mant: el mantenimiento no está activo.'; end if;
  select count(*) filter (where pg_terminate_backend(pid)) into n from pg_stat_activity
   where usename in (c.rol_filtro, 'supabase_storage_admin') and state <> 'idle' and xact_start < c.desde and pid <> pg_backend_pid();
  return n;
end $$;

revoke all on function mant_priv.valor_filtro(name, oid), mant_priv.activar(uuid[], name), mant_priv.habilitar_excepcion(text), mant_priv.desactivar(), mant_priv.cortar_en_curso()
  from public, anon, authenticated, service_role;

comment on schema mant_priv is 'Migración 294 (#75+#97, provisional): suspensión de escrituras para la ventana de mantenimiento. Apagado por defecto.';
commit;
