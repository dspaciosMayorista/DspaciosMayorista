-- ───────────────────────────────────────────────────────────────────────────
-- 237 · #5 D8/D9 · Frontera de escritura de catálogos globales: solo Mayorista
--
-- DECISIONES DEL DUEÑO. D8: los catálogos globales solo se escriben operando
-- desde Mayorista, también para superadmin (que debe entrar por Mayorista).
-- D9: aliados, asesores, formas_pago, rangos_edad y parametros_tributarios se
-- LEEN y USAN en ambas agencias; solo Mayorista los crea o edita.
--
-- POR QUÉ NO BASTABA `mi_tenant_real()`. Devuelve el tenant "home" del perfil.
-- Un superadmin cuyo perfil es Mayorista pero que opera en Minorista (cookie de
-- agencia activa, que NUNCA llega a Postgres) seguía pasando cualquier policy y
-- podía escribir por la Data API directa. La frontera necesita la agencia
-- ACTIVA vinculada de forma confiable al usuario y a la SESIÓN.
--
-- DISEÑO.
--  1. `sesion_agencia(session_id, user_id, tenant)`: agencia activa por sesión
--     de Auth. Solo la escribe service_role vía RPC; ningún rol de cliente la ve.
--  2. `sesion_agencia_inicio(session_id)`: registro ÚNICO de que esa sesión ya
--     fue iniciada. Se conserva mientras la sesión exista, así un contexto
--     perdido o anulado NO puede recrearse (nada se reinicializa solo).
--  3. `agencia_activa_sesion()` (stable, definer): usuario activo + sesión viva
--     en auth.sessions (el logout/revocación la mata al instante, aunque el JWT
--     siga vigente) + claim `session_id` del JWT + fila de contexto. Devuelve
--     NULL si algo falta, es inválido o está desincronizado -> FALLA CERRADO.
--     Un rol DISTINTO de superadmin no puede operar en otra agencia (la app ya
--     lo impide), así que su agencia efectiva es su perfil leído en vivo; solo el
--     superadmin necesita fila de contexto. TODOS exigen session_id y sesión viva.
--  4. `puede_escribir_catalogo_global()`: agencia activa = mayorista.
--  5. Policies RESTRICTIVAS de INSERT/UPDATE/DELETE en cada catálogo (se suman
--     con AND a las policies de rol vigentes, que NO se tocan: la matriz de
--     roles por catálogo queda exactamente como estaba).
--  6. RPC de contexto SOLO service_role: iniciar (exige sesión viva, usuario
--     activo, inicio reciente y no registrado antes) y cambiar (exige fila
--     previa y superadmin). La sesión la deriva el servidor del JWT ya
--     verificado; el cliente no puede invocar estas funciones.
--  7. Las 4 funciones SECURITY DEFINER que escriben catálogos (corren como
--     dueño y se saltan RLS) reciben la misma guarda por dentro.
--
-- NO CAMBIA la lectura de ningún catálogo ni la matriz de proveedores
-- (catálogo base: personal interno de ambas agencias; datos sensibles: los
-- roles de las 189/191). Sesiones previas a esta migración: un superadmin debe
-- volver a iniciar sesión para escribir catálogos (no se inicializa solo).
--
-- REGISTRO DE CATÁLOGOS. La lista vive en `catalogos_globales_registro()`:
-- añadir una tabla = una migración nueva que la agregue y cree sus policies.
-- Rollback: supabase/scripts/rollback_237_catalogos_globales_frontera.sql
-- ───────────────────────────────────────────────────────────────────────────

-- Transaccion EXPLICITA: en la ruta manual (editor SQL) un fallo en cualquier punto, incluido el
-- final, no deja objetos ni policies a medias (el COMMIT de un bloque abortado equivale a ROLLBACK).
begin;
set local lock_timeout = '5s';

-- 1. Contexto por sesión -----------------------------------------------------
create table public.sesion_agencia (
  session_id     uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  tenant         text not null check (tenant in ('mayorista', 'minorista')),
  creada_en      timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);
create index sesion_agencia_user_idx on public.sesion_agencia(user_id);

create table public.sesion_agencia_inicio (
  session_id  uuid primary key,
  user_id     uuid not null,
  iniciada_en timestamptz not null default now()
);

alter table public.sesion_agencia enable row level security;
alter table public.sesion_agencia_inicio enable row level security;
alter table public.sesion_agencia force row level security;
alter table public.sesion_agencia_inicio force row level security;
revoke all on table public.sesion_agencia, public.sesion_agencia_inicio from public, anon, authenticated;
grant select, insert, update, delete on table public.sesion_agencia, public.sesion_agencia_inicio to service_role;

-- 2. Lectura confiable de la agencia activa -----------------------------------
create function public.agencia_activa_sesion()
returns text
language sql stable security definer set search_path = ''
as $$
  -- Toda lectura exige session_id en el JWT y esa sesión VIVA en auth.sessions, también para
  -- los roles que no son superadmin: un JWT anterior a un logout deja de valer al instante.
  -- Regla de agencia: no superadmin = su agencia de perfil (fija); superadmin = la de su
  -- contexto de sesión (NULL si no hay fila).
  select case when u.rol::text <> 'superadmin' then u.tenant else c.tenant end
  from public.usuarios u
  join auth.sessions s
    on s.id::text = (auth.jwt() ->> 'session_id')
   and s.user_id = u.id
   and (s.not_after is null or s.not_after > now())
  left join public.sesion_agencia c
    on c.session_id = s.id and c.user_id = u.id
  where u.id = auth.uid() and u.activo
$$;

create function public.puede_escribir_catalogo_global()
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(public.agencia_activa_sesion() = 'mayorista', false)
$$;

revoke all on function public.agencia_activa_sesion() from public;
revoke all on function public.puede_escribir_catalogo_global() from public;
grant execute on function public.agencia_activa_sesion() to anon, authenticated, service_role;
grant execute on function public.puede_escribir_catalogo_global() to anon, authenticated, service_role;

-- 3. RPC de contexto (solo service_role) -------------------------------------
create function public.iniciar_contexto_agencia(
  p_session uuid, p_tenant text, p_ventana interval default interval '10 minutes'
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid; v_creada timestamptz; v_rol text; v_home text;
begin
  if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
    raise exception 'agencia_invalida' using errcode = '22023';
  end if;
  select s.user_id, s.created_at into v_user, v_creada
  from auth.sessions s
  where s.id = p_session and (s.not_after is null or s.not_after > now());
  if not found then
    raise exception 'sesion_inexistente' using errcode = 'P0002';
  end if;
  select u.rol::text, u.tenant into v_rol, v_home
  from public.usuarios u where u.id = v_user and u.activo;
  if not found then
    raise exception 'usuario_inactivo' using errcode = '42501';
  end if;
  if v_rol <> 'superadmin' and p_tenant is distinct from v_home then
    raise exception 'agencia_no_permitida' using errcode = '42501';
  end if;
  if v_creada < now() - p_ventana then
    raise exception 'fuera_de_ventana' using errcode = '55000';
  end if;
  -- Higiene: contextos/inicios de sesiones que ya no existen (no vuelven a usarse).
  delete from public.sesion_agencia c
   where not exists (select 1 from auth.sessions s where s.id = c.session_id);
  delete from public.sesion_agencia_inicio i
   where i.iniciada_en < now() - interval '1 day'
     and not exists (select 1 from auth.sessions s where s.id = i.session_id);
  begin
    insert into public.sesion_agencia_inicio (session_id, user_id) values (p_session, v_user);
  exception when unique_violation then
    raise exception 'ya_iniciada' using errcode = '23505';
  end;
  insert into public.sesion_agencia (session_id, user_id, tenant) values (p_session, v_user, p_tenant);
end;
$$;

create function public.cambiar_contexto_agencia(p_session uuid, p_tenant text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid; v_rol text;
begin
  if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
    raise exception 'agencia_invalida' using errcode = '22023';
  end if;
  select s.user_id into v_user from auth.sessions s
  where s.id = p_session and (s.not_after is null or s.not_after > now());
  if not found then
    raise exception 'sesion_inexistente' using errcode = 'P0002';
  end if;
  select u.rol::text into v_rol from public.usuarios u where u.id = v_user and u.activo;
  if not found then
    raise exception 'usuario_inactivo' using errcode = '42501';
  end if;
  if v_rol <> 'superadmin' then
    raise exception 'agencia_no_permitida' using errcode = '42501';
  end if;
  update public.sesion_agencia
     set tenant = p_tenant, actualizada_en = now()
   where session_id = p_session and user_id = v_user;
  if not found then
    raise exception 'sin_contexto' using errcode = '55000';
  end if;
end;
$$;

revoke all on function public.iniciar_contexto_agencia(uuid, text, interval) from public, anon, authenticated;
revoke all on function public.cambiar_contexto_agencia(uuid, text) from public, anon, authenticated;
grant execute on function public.iniciar_contexto_agencia(uuid, text, interval) to service_role;
grant execute on function public.cambiar_contexto_agencia(uuid, text) to service_role;

-- Un cambio de rol/estado/agencia del usuario invalida sus contextos: tras una
-- promoción a superadmin (o una degradación) hay que iniciar sesión de nuevo.
create function public.invalidar_contexto_agencia_usuario()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.rol is distinct from old.rol
     or new.activo is distinct from old.activo
     or new.tenant is distinct from old.tenant then
    delete from public.sesion_agencia where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.invalidar_contexto_agencia_usuario() from public, anon, authenticated;
create trigger usuarios_invalidar_contexto_agencia
  after update of rol, activo, tenant on public.usuarios
  for each row execute function public.invalidar_contexto_agencia_usuario();

-- 4. Registro de catálogos globales y guardas RESTRICTIVAS --------------------
create function public.catalogos_globales_registro()
returns text[]
language sql immutable set search_path = ''
as $$
  select array[
    -- D9 (configuración compartida)
    'aliados', 'asesores', 'formas_pago', 'rangos_edad', 'parametros_tributarios',
    -- Producto / catálogo base
    'destinos', 'hoteles', 'hotel_acomodaciones', 'hotel_blackouts', 'hotel_calculadora',
    'hotel_categorias', 'hotel_documentos', 'hotel_fotos', 'hotel_regimenes',
    'hotel_temporadas', 'hotel_tarifas_unidad', 'tarifa_hotel', 'categorias_habitacion',
    'planes_alimentacion', 'aerolineas', 'aerolinea_tarifas',
    'proveedores', 'proveedores_datos_sensibles',
    'servicios_adicionales', 'servicio_tarifa_pax', 'servicio_temporadas'
  ]::text[]
$$;
revoke all on function public.catalogos_globales_registro() from public, anon;
grant execute on function public.catalogos_globales_registro() to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array public.catalogos_globales_registro() loop
    if to_regclass('public.' || t) is null then
      raise exception '237: el catálogo % no existe', t;
    end if;
    -- (select ...) fuerza un initplan: la compuerta se evalúa UNA vez por sentencia, no por fila.
    execute format('create policy %I on public.%I as restrictive for insert to public with check ((select public.puede_escribir_catalogo_global()))',
                   'catalogo global: insertar solo Mayorista', t);
    execute format('create policy %I on public.%I as restrictive for update to public using ((select public.puede_escribir_catalogo_global())) with check ((select public.puede_escribir_catalogo_global()))',
                   'catalogo global: actualizar solo Mayorista', t);
    execute format('create policy %I on public.%I as restrictive for delete to public using ((select public.puede_escribir_catalogo_global()))',
                   'catalogo global: borrar solo Mayorista', t);
  end loop;
end;
$$;

-- 5. Respaldo EXACTO de las 4 funciones que se van a reemplazar (para el rollback) -------
-- Guarda la definición tal como está HOY en esta base (texto completo + md5 del cuerpo). El
-- rollback la vuelve a ejecutar y verifica el md5: restaura byte a byte lo que había, sea cual
-- sea su formato (p. ej. en Producción reemplazar_tarifas_hotel_calculadora tiene el mismo código
-- que la migración 179 con otro formato: cuerpo md5 d7e05c96e1260a76fbad22784e881c77).
create table public.catalogos_funciones_previas_237 (
  firma      text primary key,
  md5_prosrc text not null,
  definicion text not null,
  guardada_en timestamptz not null default now()
);
alter table public.catalogos_funciones_previas_237 enable row level security;
alter table public.catalogos_funciones_previas_237 force row level security;
revoke all on table public.catalogos_funciones_previas_237 from public, anon, authenticated;

insert into public.catalogos_funciones_previas_237 (firma, md5_prosrc, definicion)
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(p.prosrc), pg_get_functiondef(p.oid)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('fn_fusionar_destino', 'generar_tarifas_hotel_calculadora',
                    'reemplazar_tarifas_hotel_calculadora', 'aprobar_solicitud_b2b');

do $$
begin
  if (select count(*) from public.catalogos_funciones_previas_237) <> 4 then
    raise exception '237: el respaldo de funciones previas no quedó con 4 filas';
  end if;
end;
$$;

-- 6. SECURITY DEFINER que escriben catálogos: misma guarda por dentro ---------
-- (reemplazar_tarifas_hotel_calculadora parte de la definición VIGENTE en Producción,
-- tokens idénticos a la 179: ver supabase/scripts/pruebas_237/comparar_funcion_tokens.mjs)
CREATE OR REPLACE FUNCTION public.fn_fusionar_destino(p_origen bigint, p_destino bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fk record;
begin
  if public.mi_rol() not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'No autorizado para fusionar destinos.';
  end if;
  if not public.puede_escribir_catalogo_global() then
    raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
  end if;
  if p_origen = p_destino then
    raise exception 'El origen y el destino no pueden ser el mismo.';
  end if;
  if not exists (select 1 from public.destinos where id = p_destino) then
    raise exception 'El destino de llegada no existe.';
  end if;
  if not exists (select 1 from public.destinos where id = p_origen) then
    return; -- ya no existe, nada que fusionar
  end if;

  -- Re-apunta cada columna con FK a destinos(id), del origen al destino.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.destinos'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
      using p_destino, p_origen;
  end loop;

  delete from public.destinos where id = p_origen;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generar_tarifas_hotel_calculadora(p_hotel_id bigint, p_filas jsonb, p_previas jsonb, p_reemplazar_todo boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hoy         date := public.fecha_negocio();   -- regla común (migración 198)
  v_protegidas  text[];
  v_promos_pct  text[];
  v_tipo_calc   text;
  v_claves      text[];
  v_fila        jsonb;
  v_hotel_fila  bigint;
  v_choque      text;
  v_borradas    integer;
  v_insertadas  integer := 0;
  v_motivo      text := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''),
                                 case when p_reemplazar_todo then 'calculadora_reemplazar_todo' else 'calculadora_generar' end);
  v_recargar    constant text := 'Recarga la página y vuelve a revisar la vista previa antes de generar.';
begin
  -- Mismo candado que la 179 (coalesce: un rol NULL nunca pasa).
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'generar_tarifas_hotel_calculadora: rol sin permiso de escritura sobre tarifa_hotel';
  end if;
  if not public.puede_escribir_catalogo_global() then
    raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
  end if;
  if p_hotel_id is null then
    raise exception 'generar_tarifas_hotel_calculadora: hotel_id requerido';
  end if;
  if v_motivo not in ('calculadora_generar', 'calculadora_reemplazar_todo', 'calculadora_sustituir_manual') then
    raise exception 'generar_tarifas_hotel_calculadora: motivo no permitido: %', v_motivo;
  end if;
  -- El motivo es una etiqueta: debe coincidir con lo que la llamada hace.
  if p_reemplazar_todo and v_motivo <> 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: reemplazar todo solo admite el motivo calculadora_reemplazar_todo';
  end if;
  if not p_reemplazar_todo and v_motivo = 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: el motivo calculadora_reemplazar_todo exige p_reemplazar_todo';
  end if;
  if p_previas is null or jsonb_typeof(p_previas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: falta la foto de las tarifas cargadas (p_previas). %', v_recargar;
  end if;
  if not exists (select 1 from public.hoteles where id = p_hotel_id) then
    raise exception 'generar_tarifas_hotel_calculadora: el hotel % no existe', p_hotel_id;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas debe ser un arreglo jsonb';
  end if;
  if jsonb_array_length(p_filas) = 0 then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas no puede ser un arreglo vacío';
  end if;

  -- Validación COMPLETA del lote antes de borrar nada.
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'generar_tarifas_hotel_calculadora: cada elemento de p_filas debe ser un objeto jsonb';
    end if;
    if v_fila ? 'hotel_id' and v_fila->>'hotel_id' is not null then
      begin
        v_hotel_fila := (v_fila->>'hotel_id')::bigint;
      exception when others then
        raise exception 'generar_tarifas_hotel_calculadora: hotel_id de una fila no es numérico: %', v_fila->>'hotel_id';
      end;
      if v_hotel_fila <> p_hotel_id then
        raise exception 'generar_tarifas_hotel_calculadora: una fila declara hotel_id % distinto al solicitado (%)', v_hotel_fila, p_hotel_id;
      end if;
    end if;
    if coalesce(btrim(v_fila->>'tipo_habitacion'), '') = ''
       or coalesce(btrim(v_fila->>'alimentacion'), '') = ''
       or coalesce(btrim(v_fila->>'temporada'), '') = '' then
      raise exception 'generar_tarifas_hotel_calculadora: cada fila necesita categoría, régimen y temporada';
    end if;
  end loop;

  select k into v_choque
  from (
    select btrim(f->>'tipo_habitacion') || ' / ' || btrim(f->>'alimentacion') || ' / ' || btrim(f->>'temporada') as k
    from jsonb_array_elements(p_filas) f
  ) x
  group by k having count(*) > 1
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la combinación % viene repetida en el lote', v_choque;
  end if;

  -- ── Bloqueos: TODO lo que sigue (comprobar y escribir) ocurre con el hotel
  -- bloqueado, en esta misma transacción. Orden fijo hotel → vigencias →
  -- tarifas. `FOR UPDATE` sobre `hoteles` choca con el `FOR KEY SHARE` que toma
  -- cualquier INSERT concurrente en `tarifa_hotel` de este hotel (FK), así que
  -- una fila nueva escrita a mano espera o hace esperar; `FOR UPDATE` sobre las
  -- tarifas cubre ediciones y borrados concurrentes de filas existentes. En
  -- READ COMMITTED cada sentencia siguiente ve lo que la otra sesión confirmó.
  perform 1 from public.hoteles where id = p_hotel_id for update;
  perform 1 from public.hotel_temporadas where hotel_id = p_hotel_id for share;
  perform 1 from public.tarifa_hotel where hotel_id = p_hotel_id for update;

  -- Vigencias con compra cerrada = histórico: no se reescriben ni se recrean.
  select coalesce(array_agg(nombre), '{}') into v_protegidas
  from (
    select btrim(nombre) as nombre
    from public.hotel_temporadas
    where hotel_id = p_hotel_id and nombre is not null
    group by btrim(nombre)
    having bool_and(compra_fin is not null and compra_fin < v_hoy)
  ) p;

  select btrim(f->>'temporada') into v_choque
  from jsonb_array_elements(p_filas) f
  where btrim(f->>'temporada') = any(v_protegidas)
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la vigencia "%" tiene la compra cerrada; sus tarifas se conservan y no se regeneran', v_choque;
  end if;

  -- ── Concurrencia: lo que hay HOY (bajo bloqueo) debe ser lo que se vio en la
  -- vista previa. Reemplazar todo: todo el hotel. Agregar/sustituir: las
  -- claves del lote (una clave que no existía debe seguir sin existir).
  select array_agg(distinct public._tarifa_clave(f)) into v_claves from jsonb_array_elements(p_filas) f;
  if p_reemplazar_todo then
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t where t.hotel_id = p_hotel_id))
       <> public._tarifa_huella(p_previas) then
      raise exception 'generar_tarifas_hotel_calculadora: las tarifas del hotel cambiaron después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  else
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t
                              where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)))
       <> public._tarifa_huella((select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(p_previas) f
                                 where public._tarifa_clave(f) = any(v_claves))) then
      raise exception 'generar_tarifas_hotel_calculadora: alguna de las tarifas que se iban a escribir cambió después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  end if;

  -- ── Promos escritas a mano (Mixta + vigencia descuento_pct + sin precio
  -- final): misma definición que la calculadora (`analizarMixta`). Nunca las
  -- borra "generar" ni "reemplazar todo"; "sustituir" solo con sus condiciones.
  select tipo into v_tipo_calc from public.hotel_calculadora where hotel_id = p_hotel_id;
  select coalesce(array_agg(distinct btrim(nombre)), '{}') into v_promos_pct
  from public.hotel_temporadas where hotel_id = p_hotel_id and tipo = 'descuento_pct' and nombre is not null;

  if v_motivo = 'calculadora_sustituir_manual' then
    v_fila := p_filas -> 0;
    if jsonb_array_length(p_filas) <> 1 then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir reemplaza UNA sola fila por llamada';
    end if;
    if coalesce(v_tipo_calc, '') <> 'mixta' or not (btrim(v_fila->>'temporada') = any(v_promos_pct)) then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir solo aplica a una promoción %% de un hotel con calculadora Mixta';
    end if;
    if not coalesce((v_fila->>'precio_final_autoritativo')::boolean, false)
       or not exists (select 1 from public.hotel_temporadas t
                      where t.hotel_id = p_hotel_id and btrim(t.nombre) = btrim(coalesce(v_fila->>'temporada_base', ''))
                        and coalesce(t.tipo, 'tarifa') = 'tarifa') then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir exige una fila marcada como precio final y con temporada_base en una vigencia ''tarifa'' del hotel';
    end if;
    if not exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves))
       or exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)
                  and coalesce(t.precio_final_autoritativo, false)) then
      raise exception 'generar_tarifas_hotel_calculadora: no hay una promoción escrita a mano que sustituir en esa celda; usa "Generar"';
    end if;
  else
    select btrim(t.temporada) || ' · ' || btrim(t.tipo_habitacion) || ' · ' || btrim(t.alimentacion) into v_choque
    from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and coalesce(v_tipo_calc, '') = 'mixta'
      and not coalesce(t.precio_final_autoritativo, false)
      and btrim(t.temporada) = any(v_promos_pct)
      and case when p_reemplazar_todo
               then not (btrim(t.temporada) = any(v_protegidas))
               else public._tarifa_clave(to_jsonb(t)) = any(v_claves) end
    limit 1;
    if v_choque is not null then
      raise exception 'generar_tarifas_hotel_calculadora: % es una promoción escrita a mano; no se sobrescribe al generar. Sustitúyela celda por celda o déjala como está. %', v_choque, v_recargar;
    end if;
  end if;

  perform set_config('app.tarifa_motivo', v_motivo, true);

  if p_reemplazar_todo then
    delete from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and (t.temporada is null or not (btrim(t.temporada) = any(v_protegidas)));
  else
    delete from public.tarifa_hotel t
    using (
      select distinct btrim(f->>'tipo_habitacion') as tipo, btrim(f->>'alimentacion') as alim, btrim(f->>'temporada') as temp
      from jsonb_array_elements(p_filas) f
    ) k
    where t.hotel_id = p_hotel_id
      and btrim(t.tipo_habitacion) = k.tipo
      and btrim(t.alimentacion) = k.alim
      and btrim(t.temporada) = k.temp;
  end if;
  get diagnostics v_borradas = row_count;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    insert into public.tarifa_hotel (
      hotel_id, tipo_habitacion, alimentacion, temporada,
      neto_sencilla, neto_doble, neto_triple, neto_multiple,
      neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max,
      precio_final_autoritativo, temporada_base
    ) values (
      p_hotel_id,
      btrim(v_fila->>'tipo_habitacion'),
      btrim(v_fila->>'alimentacion'),
      btrim(v_fila->>'temporada'),
      (v_fila->>'neto_sencilla')::numeric,
      (v_fila->>'neto_doble')::numeric,
      (v_fila->>'neto_triple')::numeric,
      (v_fila->>'neto_multiple')::numeric,
      (v_fila->>'neto_nino')::numeric,
      (v_fila->>'neto_nino2')::numeric,
      (v_fila->>'neto_infante')::numeric,
      v_fila->>'nota_infante',
      v_fila->>'notas',
      (v_fila->>'edad_infante_min')::integer,
      (v_fila->>'edad_infante_max')::integer,
      (v_fila->>'edad_nino_min')::integer,
      (v_fila->>'edad_nino_max')::integer,
      coalesce((v_fila->>'precio_final_autoritativo')::boolean, false),
      v_fila->>'temporada_base'
    );
    v_insertadas := v_insertadas + 1;
  end loop;

  return jsonb_build_object(
    'borradas', v_borradas,
    'insertadas', v_insertadas,
    'protegidas', to_jsonb(v_protegidas)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reemplazar_tarifas_hotel_calculadora(p_hotel_id bigint, p_regimenes text[], p_filas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_borradas integer;
  v_insertadas integer;
  v_fila jsonb;
  v_hotel_fila bigint;
begin
  if coalesce(public.mi_rol()::text, '') not in (
    'superadmin',
    'gerencia',
    'administracion',
    'operaciones'
  ) then
    raise exception
      'reemplazar_tarifas_hotel_calculadora: rol sin permiso de escritura sobre tarifa_hotel';
  end if;
  if not public.puede_escribir_catalogo_global() then
    raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
  end if;

  if p_hotel_id is null then
    raise exception
      'reemplazar_tarifas_hotel_calculadora: hotel_id requerido';
  end if;

  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception
      'reemplazar_tarifas_hotel_calculadora: p_filas debe ser un arreglo jsonb';
  end if;

  if jsonb_array_length(p_filas) = 0 then
    raise exception
      'reemplazar_tarifas_hotel_calculadora: p_filas no puede ser un arreglo vacío';
  end if;

  for v_fila in
    select * from jsonb_array_elements(p_filas)
  loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception
        'reemplazar_tarifas_hotel_calculadora: cada elemento de p_filas debe ser un objeto jsonb';
    end if;

    if v_fila ? 'hotel_id'
       and v_fila->>'hotel_id' is not null then
      begin
        v_hotel_fila := (v_fila->>'hotel_id')::bigint;
      exception
        when others then
          raise exception
            'reemplazar_tarifas_hotel_calculadora: hotel_id de una fila no es numérico: %',
            v_fila->>'hotel_id';
      end;

      if v_hotel_fila <> p_hotel_id then
        raise exception
          'reemplazar_tarifas_hotel_calculadora: una fila declara hotel_id % distinto al solicitado (%)',
          v_hotel_fila,
          p_hotel_id;
      end if;
    end if;
  end loop;

  if p_regimenes is null
     or array_length(p_regimenes, 1) is null then
    delete from public.tarifa_hotel
    where hotel_id = p_hotel_id;
  else
    delete from public.tarifa_hotel
    where hotel_id = p_hotel_id
      and alimentacion = any(p_regimenes);
  end if;

  get diagnostics v_borradas = row_count;
  v_insertadas := 0;

  for v_fila in
    select * from jsonb_array_elements(p_filas)
  loop
    insert into public.tarifa_hotel (
      hotel_id,
      tipo_habitacion,
      alimentacion,
      temporada,
      neto_sencilla,
      neto_doble,
      neto_triple,
      neto_multiple,
      neto_nino,
      neto_nino2,
      neto_infante,
      nota_infante,
      notas,
      edad_infante_min,
      edad_infante_max,
      edad_nino_min,
      edad_nino_max,
      precio_final_autoritativo,
      temporada_base
    )
    values (
      p_hotel_id,
      v_fila->>'tipo_habitacion',
      v_fila->>'alimentacion',
      v_fila->>'temporada',
      (v_fila->>'neto_sencilla')::numeric,
      (v_fila->>'neto_doble')::numeric,
      (v_fila->>'neto_triple')::numeric,
      (v_fila->>'neto_multiple')::numeric,
      (v_fila->>'neto_nino')::numeric,
      (v_fila->>'neto_nino2')::numeric,
      (v_fila->>'neto_infante')::numeric,
      v_fila->>'nota_infante',
      v_fila->>'notas',
      (v_fila->>'edad_infante_min')::integer,
      (v_fila->>'edad_infante_max')::integer,
      (v_fila->>'edad_nino_min')::integer,
      (v_fila->>'edad_nino_max')::integer,
      coalesce(
        (v_fila->>'precio_final_autoritativo')::boolean,
        false
      ),
      v_fila->>'temporada_base'
    );

    v_insertadas := v_insertadas + 1;
  end loop;

  return jsonb_build_object(
    'borradas', v_borradas,
    'insertadas', v_insertadas
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.aprobar_solicitud_b2b(p_id bigint, p_modo text DEFAULT 'sugerido'::text, p_aliado_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sol        public.b2b_solicitudes%rowtype;
  v_email_perf text;
  v_rol_perf   public.rol_usuario;
  v_act_perf   boolean;
  v_email_auth text;
  v_aliado     bigint;
  v_quien      text;
  v_n          integer;
begin
  if public.mi_rol() is null or public.mi_rol() not in ('superadmin', 'administracion', 'gerencia') then
    raise exception 'No tienes permiso para aprobar registros B2B.' using errcode = '42501';
  end if;

  select * into v_sol from public.b2b_solicitudes where id = p_id for update;
  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = 'P0002';
  end if;
  if v_sol.estado is distinct from 'pendiente' then
    raise exception 'La solicitud ya fue procesada (estado: %).', v_sol.estado using errcode = '55000';
  end if;
  if v_sol.tipo not in ('agencia', 'freelance') then
    raise exception 'Tipo de solicitud inválido.' using errcode = '22023';
  end if;
  if v_sol.usuario_id is null then
    raise exception 'La solicitud no tiene una cuenta asociada; no se puede aprobar. Pide al aliado que se registre de nuevo.' using errcode = '55000';
  end if;

  select email, rol, activo into v_email_perf, v_rol_perf, v_act_perf
    from public.usuarios where id = v_sol.usuario_id for update;
  if not found then
    raise exception 'La cuenta asociada a la solicitud ya no existe.' using errcode = '55000';
  end if;
  select email into v_email_auth from auth.users where id = v_sol.usuario_id;
  if lower(btrim(coalesce(v_email_perf, ''))) <> lower(btrim(v_sol.email))
     or lower(btrim(coalesce(v_email_auth, ''))) <> lower(btrim(v_sol.email)) then
    raise exception 'El correo de la cuenta no coincide con el de la solicitud; no se aprueba.' using errcode = '55000';
  end if;
  if v_rol_perf::text <> v_sol.tipo then
    raise exception 'La cuenta asociada no es un aliado B2B pendiente (rol %); no se reasigna.', v_rol_perf using errcode = '55000';
  end if;
  if v_act_perf then
    raise exception 'La cuenta asociada ya está activa; no se aprueba desde esta solicitud.' using errcode = '55000';
  end if;

  if p_modo = 'sugerido' then
    v_aliado := v_sol.aliado_sugerido_id;
  elsif p_modo = 'ficha' then
    if p_aliado_id is null or not exists (select 1 from public.aliados where id = p_aliado_id) then
      raise exception 'La ficha de aliado elegida no existe.' using errcode = '22023';
    end if;
    v_aliado := p_aliado_id;
  elsif p_modo = 'nueva' then
    if not public.puede_escribir_catalogo_global() then
      raise exception 'Los catalogos globales solo se editan desde la agencia Mayorista.' using errcode = '42501';
    end if;
    insert into public.aliados (nombre, nit, tipo_documento, tipo, email, telefono, contacto)
    values (
      v_sol.nombre, v_sol.nit,
      coalesce(nullif(btrim(v_sol.tipo_documento), ''), case when v_sol.tipo = 'agencia' then 'NIT' else 'CC' end),
      v_sol.tipo, v_sol.email, v_sol.telefono, v_sol.contacto
    )
    returning id into v_aliado;
  elsif p_modo = 'ninguno' then
    v_aliado := null;
  else
    raise exception 'Modo de enlace inválido.' using errcode = '22023';
  end if;

  -- El enlace queda EXACTAMENTE como lo eligió quien aprueba: con 'ninguno'
  -- (o 'sugerido' sin sugerencia) `aliado_id` queda NULL aunque la cuenta
  -- trajera uno de antes. Y nunca se concede el respaldo legacy por nombre.
  update public.usuarios
     set activo = true,
         aliado_id = v_aliado,
         acceso_legacy_nombre = false
   where id = v_sol.usuario_id
     and activo = false
     and rol::text = v_sol.tipo;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No se pudo activar la cuenta (filas afectadas: %).', v_n using errcode = '55000';
  end if;

  select coalesce(nullif(btrim(nombre), ''), email) into v_quien
    from public.usuarios where id = auth.uid();

  update public.b2b_solicitudes
     set estado = 'aprobada',
         revisado_por = v_quien,
         revisado_at = now(),
         aliado_sugerido_id = coalesce(v_aliado, aliado_sugerido_id)
   where id = p_id
     and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No se pudo marcar la solicitud como aprobada (filas afectadas: %).', v_n using errcode = '55000';
  end if;

  return jsonb_build_object('usuario_id', v_sol.usuario_id, 'aliado_id', v_aliado);
end;
$function$;

-- 7. Autoverificación: si algo no cuadra, se revierte TODA la migración -------
do $$
declare
  t text;
  v_malas text;
begin
  foreach t in array public.catalogos_globales_registro() loop
    if (select count(*) from pg_policy p
         where p.polrelid = ('public.' || t)::regclass
           and not p.polpermissive
           and p.polname like 'catalogo global:%') <> 3 then
      raise exception '237: % no quedó con las 3 policies restrictivas', t;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '237: % sin RLS activa', t;
    end if;
  end loop;

  select string_agg(p.proname, ', ') into v_malas
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('fn_fusionar_destino', 'generar_tarifas_hotel_calculadora',
                      'reemplazar_tarifas_hotel_calculadora', 'aprobar_solicitud_b2b')
    and p.prosrc not like '%puede_escribir_catalogo_global()%';
  if v_malas is not null then
    raise exception '237: funciones definer sin guarda: %', v_malas;
  end if;

  if (select count(*) from public.catalogos_funciones_previas_237) <> 4
     or has_table_privilege('authenticated', 'public.catalogos_funciones_previas_237', 'select')
     or has_table_privilege('anon', 'public.catalogos_funciones_previas_237', 'select') then
    raise exception '237: respaldo de funciones previas ausente o legible por roles de cliente';
  end if;

  if has_function_privilege('authenticated', 'public.iniciar_contexto_agencia(uuid,text,interval)', 'execute')
     or has_function_privilege('anon', 'public.iniciar_contexto_agencia(uuid,text,interval)', 'execute')
     or has_function_privilege('authenticated', 'public.cambiar_contexto_agencia(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.cambiar_contexto_agencia(uuid,text)', 'execute') then
    raise exception '237: RPC de contexto ejecutable por un rol de cliente';
  end if;
  if not has_function_privilege('service_role', 'public.iniciar_contexto_agencia(uuid,text,interval)', 'execute')
     or not has_function_privilege('service_role', 'public.cambiar_contexto_agencia(uuid,text)', 'execute') then
    raise exception '237: service_role sin acceso a las RPC de contexto';
  end if;
  if has_table_privilege('authenticated', 'public.sesion_agencia', 'select')
     or has_table_privilege('anon', 'public.sesion_agencia_inicio', 'select') then
    raise exception '237: tablas de contexto legibles por roles de cliente';
  end if;
end;
$$;

commit;
