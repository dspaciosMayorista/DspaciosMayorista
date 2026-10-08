-- 202 · CRM leads manuales
--
-- MVP manual y aislado para registrar leads originados en WhatsApp/Instagram.
-- No toca crm_contactos, cotizaciones, ventas ni tablas operativas existentes.
-- El lead es entidad propia, con tenant obligatorio, responsable uuid y RLS
-- estricta por tenant/responsable. Sin borrado fisico: cerrar por etapa
-- terminal y conservar bitacora.
--
-- Dos decisiones que la separan del resto de migraciones del repositorio:
--
-- 1) La auditoria generica (087/108) se adjunta SOLO a las DOS tablas que esta
--    migracion crea. No se recorre `public`: las tablas de historial de la 203
--    (`tarifa_hotel_historial`, `hotel_temporadas_historial`) ya son inmutables
--    y auditarlas duplicaria cada version en `auditoria`. Re-correr el postcheck
--    de la 203 despues de esta migracion debe seguir dando `true`.
--
-- 2) `authenticated` SOLO LEE las dos tablas; toda escritura pasa por las cinco
--    funciones SQL (RPC) de abajo. Con el DML abierto, un asesor podria editar un
--    lead sin dejar actividad y escribir en la bitacora con un `actor_email`
--    inventado, es decir, fabricar la traza comercial. Cerrado el DML, la bitacora
--    solo la escriben esas funciones, y las tres cosas que hacen falta se
--    resuelven juntas:
--      · el cambio de negocio y su bitacora se escriben en la MISMA
--        transaccion: si la bitacora falla, el cambio tampoco queda;
--      · ninguna operacion devuelve exito si su UPDATE afecta cero filas;
--      · `venta` toma un lead sin responsable con un UPDATE condicional
--        (`responsable_id is null`), de modo que la carrera entre dos asesores
--        la resuelve el bloqueo de fila: gana uno y el otro recibe error.
--    Las funciones son SECURITY DEFINER porque ya no pueden apoyarse en la RLS
--    para autorizar escrituras (la RLS sigue protegiendo la LECTURA). La
--    contrapartida es que cada RPC valida por su cuenta, en este orden: que el
--    usuario exista y este activo y su rol entre en el modulo
--    (`crm_lead_actor`), que el lead sea visible para el, que la transicion
--    pedida este permitida sobre el responsable vigente y que el responsable
--    resultante sea valido y de la misma agencia. Los helpers que usa son
--    internos: sin EXECUTE para `authenticated`, que solo puede invocar las RPC,
--    el helper de lectura que necesitan las policies y los normalizadores.
--
-- 3) La identidad documental es la pareja TIPO + NUMERO de documento, nunca el
--    numero solo: "CC 1020304" y "TI 1020304" son dos personas distintas. La
--    unica regla de unicidad es `(tenant, documento_norm, tipo_doc)`; un numero
--    exige un tipo explicito (no se asume CC) y un lead sin documento sigue
--    siendo valido. Telefono y correo NO son unicos: una familia comparte el
--    WhatsApp del papa o el correo de la casa, asi que esos datos solo SUGIEREN
--    una coincidencia (la RPC la devuelve como aviso) y nunca bloquean el alta.
--    Un rechazo por documento repetido no fusiona registros: solo dice cual es.

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

-- Tipo de documento a su codigo de catalogo. La UNICA variante de puntuacion
-- admitida es la de las siglas con punto: letras separadas por un punto, con
-- punto final opcional ("c.c.", "C.C", "p.a.s."), mas espacios alrededor y
-- cualquier combinacion de mayusculas/minusculas. Esa forma se reduce a letras
-- en mayuscula ("CC").
--
-- Cualquier otra cosa se devuelve SIN limpiar (solo recortada y en mayuscula)
-- para que caiga fuera del catalogo y se rechace: "CC2", "C-C", "C C", "..CC",
-- "C..C" o "." no son un tipo. Quitarles los caracteres sobrantes los
-- convertiria en "CC" y cambiaria la identidad de la persona en silencio. Por
-- lo mismo no traduce sinonimos ("cedula" no pasa a "CC").
create or replace function public.crm_lead_normalizar_tipo_doc(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when v = '' then null
           when v ~ '^[A-Za-z]+(\.[A-Za-z]+)*\.?$' then upper(replace(v, '.', ''))
           else upper(v)
         end
    from (select btrim(coalesce(p, '')) as v) t;
$$;

create table if not exists public.crm_leads (
  id bigserial primary key,
  tenant text not null default 'mayorista' check (tenant in ('mayorista', 'minorista')),
  etapa text not null default 'nuevo' check (etapa in ('nuevo', 'en_contacto', 'calificado', 'descartado', 'archivado')),
  canal text not null check (canal in ('whatsapp', 'instagram', 'otro')),
  nombre text not null check (btrim(nombre) <> ''),
  telefono text null,
  email text null,
  tipo_doc text null,
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
  ),
  -- Las tres reglas documentales viven en el dato, no solo en la RPC: si alguien
  -- escribiera por `service_role` o restituyera el DML, tampoco podria guardar un
  -- numero sin tipo, un tipo fuera del catalogo o un "numero" sin letras ni
  -- digitos (que quedaria fuera del indice unico por tener `documento_norm` nulo).
  constraint crm_leads_tipo_doc_catalogo
    check (tipo_doc is null or tipo_doc in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT')),
  constraint crm_leads_documento_con_tipo
    check ((documento is null) = (tipo_doc is null)),
  constraint crm_leads_documento_normalizable
    check (documento is null or public.crm_lead_normalizar_documento(documento) is not null)
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

-- Unica regla de unicidad: tenant + tipo + numero. El numero va antes que el
-- tipo en el indice para que el mismo indice sirva tambien a la busqueda por
-- numero sin tipo (sugerencia "mismo numero, otro tipo"); el orden de columnas
-- no cambia lo que se considera repetido. `tipo_doc` nunca es nulo cuando
-- `documento_norm` no lo es (`crm_leads_documento_con_tipo`), asi que el indice
-- parcial cubre todos los leads con documento.
create unique index if not exists uq_crm_leads_tenant_tipo_documento
  on public.crm_leads (tenant, documento_norm, tipo_doc)
  where documento_norm is not null;

-- Telefono y correo: indices de BUSQUEDA, no unicos. Varias personas pueden
-- compartirlos; sirven para sugerir coincidencias, nunca para rechazar.
create index if not exists idx_crm_leads_tenant_telefono
  on public.crm_leads (tenant, telefono_norm)
  where telefono_norm is not null;

create index if not exists idx_crm_leads_tenant_email
  on public.crm_leads (tenant, email_norm)
  where email_norm is not null;

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

-- ---------------------------------------------------------------------------
-- Matriz de permisos
--
-- `authenticated` solo LEE estas tablas. Todas las escrituras pasan por las cinco
-- RPC de abajo, que son SECURITY DEFINER: la RLS ya no autoriza escrituras, asi
-- que cada RPC comprueba por su cuenta que el actor existe y esta activo, que su
-- rol esta permitido, que el lead es de un tenant que puede ver y que la
-- transicion (tomar, reasignar, cambiar etapa) esta permitida.
--
-- La consecuencia buscada es que no exista forma de cambiar un lead o escribir en
-- la bitacora sin pasar por la logica de negocio: con DML abierto, `authenticated`
-- podia editar `crm_leads` sin dejar actividad y podia insertar en
-- `crm_lead_actividades` con un `actor_email` inventado, es decir, fabricar la
-- traza comercial. Cerrado el DML, la bitacora solo la escriben estas funciones.
--
-- Los helpers de la matriz son internos: `revoke ... from public, anon,
-- authenticated`. Se ejecutan desde dentro de las RPC (que corren como el
-- propietario), asi que no necesitan permiso para `authenticated`.
-- ---------------------------------------------------------------------------

-- Identidad del actor, leida de `usuarios` (no de los claims): un JWT vigente no
-- basta si el usuario fue desactivado o su rol esta fuera del modulo.
create or replace function public.crm_lead_actor()
returns table (actor_id uuid, actor_rol text, actor_tenant text, actor_email text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  select u.id, u.rol::text, u.tenant, u.email
    into actor_id, actor_rol, actor_tenant, actor_email
    from public.usuarios u
   where u.id = auth.uid()
     and u.activo is true;
  if not found then
    raise exception 'Sesion no valida: el usuario no existe o esta inactivo.';
  end if;
  if actor_rol not in ('superadmin', 'gerencia', 'administracion', 'venta') then
    raise exception 'Tu rol no tiene acceso a los leads del CRM.';
  end if;
  return next;
end;
$$;

-- El responsable debe ser un usuario ACTIVO de rol comercial y del MISMO tenant
-- del lead: asignar entre agencias no es una operacion valida ni para superadmin.
create or replace function public.crm_lead_responsable_valido(p_usuario uuid, p_tenant text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_usuario is null or exists (
    select 1
      from public.usuarios u
     where u.id = p_usuario
       and u.activo is true
       and u.rol in ('gerencia', 'administracion', 'venta')
       and u.tenant = p_tenant
  );
$$;

-- Matriz de lectura. Recibe la identidad del actor como parametros en vez de
-- leer `auth.uid()`, para que la autorizacion de una escritura SECURITY DEFINER
-- no dependa de una segunda lectura de sesion.
create or replace function public.crm_lead_permite_ver(
  p_tenant text, p_responsable uuid,
  p_actor_id uuid, p_rol text, p_actor_tenant text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_rol = 'superadmin' then true
    when p_rol = 'gerencia' then public.puede_ver_tenant(p_tenant)
    when p_rol = 'administracion' then p_actor_tenant = p_tenant
    when p_rol = 'venta' then p_actor_tenant = p_tenant and (p_responsable is null or p_responsable = p_actor_id)
    else false
  end;
$$;

-- Alta: la misma matriz de lectura mas la validez del responsable.
create or replace function public.crm_lead_permite_crear(
  p_tenant text, p_responsable uuid,
  p_actor_id uuid, p_rol text, p_actor_tenant text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.crm_lead_responsable_valido(p_responsable, p_tenant)
     and public.crm_lead_permite_ver(p_tenant, p_responsable, p_actor_id, p_rol, p_actor_tenant);
$$;

-- Quien puede dejar el lead a SU nombre. `venta` solo puede tomar uno que este
-- SIN responsable y de su propio tenant: una vez tomado ya no puede volver a
-- quitarselo ni quitarselo a otro asesor, porque `p_anterior` deja de ser nulo.
create or replace function public.crm_lead_permite_cambiar_responsable(
  p_tenant text, p_anterior uuid, p_nuevo uuid,
  p_actor_id uuid, p_rol text, p_actor_tenant text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_nuevo is not distinct from p_anterior then true
    when p_rol = 'superadmin' then true
    when p_rol = 'gerencia' then public.puede_ver_tenant(p_tenant)
    when p_rol = 'administracion' then p_actor_tenant = p_tenant
    when p_rol = 'venta' then
      p_actor_tenant = p_tenant
      and p_anterior is null
      and p_nuevo = p_actor_id
    else false
  end;
$$;

-- Envoltura para las policies de SOLO LECTURA: delega en la matriz anterior con
-- la identidad de la sesion. Es la unica de este bloque con EXECUTE para
-- `authenticated`, y no toma ningun dato como entrada aparte del tenant y el
-- responsable que la propia fila ya expone.
create or replace function public.crm_lead_puede_ver(p_tenant text, p_responsable uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.crm_lead_permite_ver(
    p_tenant, p_responsable, auth.uid(), public.mi_rol()::text, public.mi_tenant()
  );
$$;

-- Valida la pareja documental de una escritura y devuelve el tipo ya
-- normalizado. Las reglas son las mismas que los CHECK de la tabla; aqui estan
-- para dar un mensaje claro en vez del nombre de una restriccion:
--   · numero sin tipo -> error: el numero solo no identifica a nadie y no se
--     asume CC;
--   · tipo sin numero -> error: un tipo suelto no es un dato;
--   · tipo fuera del catalogo -> error;
--   · "numero" sin letras ni digitos -> error.
-- Sin ninguno de los dos, el lead sigue siendo valido (todavia sin documento).
create or replace function public.crm_lead_tipo_doc_validado(p_tipo_doc text, p_documento text)
returns text
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo text := public.crm_lead_normalizar_tipo_doc(p_tipo_doc);
  v_doc  text := nullif(btrim(coalesce(p_documento, '')), '');
begin
  if v_doc is null and v_tipo is null then
    return null;
  end if;
  if v_doc is null then
    raise exception 'Escribe el numero de documento o quita el tipo.';
  end if;
  if public.crm_lead_normalizar_documento(v_doc) is null then
    raise exception 'El numero de documento debe tener letras o digitos.';
  end if;
  if v_tipo is null then
    raise exception 'Indica el tipo de documento: el numero solo no identifica a la persona.';
  end if;
  if v_tipo not in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT') then
    raise exception 'Tipo de documento invalido.';
  end if;
  return v_tipo;
end;
$$;

-- Id del lead que choca por tenant + tipo + numero, para poder decir cual es en
-- el rechazo de duplicado. Telefono y correo ya no entran: no son unicos.
--
-- Solo devuelve el id si el actor PUEDE VER ese lead: si el duplicado pertenece
-- a otro asesor, el mensaje sale generico. Decir "ya existe el lead #7" seria
-- filtrar la cartera ajena justo en el intento de verla. `p_excluir` es el
-- propio lead cuando se edita.
create or replace function public.crm_lead_duplicado_id(
  p_tenant text, p_tipo_doc text, p_documento_norm text, p_excluir bigint,
  p_actor_id uuid, p_rol text, p_actor_tenant text
)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id
    from public.crm_leads l
   where l.tenant = p_tenant
     and l.documento_norm = p_documento_norm
     and l.tipo_doc = p_tipo_doc
     and l.id is distinct from p_excluir
     and public.crm_lead_permite_ver(l.tenant, l.responsable_id, p_actor_id, p_rol, p_actor_tenant)
   order by l.id
   limit 1;
$$;

-- Coincidencias que NO bloquean: mismo telefono, mismo correo o mismo numero de
-- documento con OTRO tipo, en la misma agencia. Se devuelven como aviso para que
-- el asesor revise si es la misma persona; la decision es suya, no de la base.
--
-- Igual que el duplicado, solo se listan leads que el actor PUEDE VER: un aviso
-- sobre la cartera de otro asesor seria una forma de consultarla. Formato:
-- `[{"id": 7, "por": ["telefono", "email"]}, ...]`, como mucho cinco.
create or replace function public.crm_lead_coincidencias(
  p_tenant text, p_telefono_norm text, p_email_norm text,
  p_tipo_doc text, p_documento_norm text, p_excluir bigint,
  p_actor_id uuid, p_rol text, p_actor_tenant text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'por', c.por) order by c.id), '[]'::jsonb)
    from (
      select l.id,
             to_jsonb(array_remove(array[
               case when p_telefono_norm is not null and l.telefono_norm = p_telefono_norm then 'telefono' end,
               case when p_email_norm is not null and l.email_norm = p_email_norm then 'email' end,
               case when p_documento_norm is not null and l.documento_norm = p_documento_norm
                         and l.tipo_doc is distinct from p_tipo_doc then 'numero_documento' end
             ], null)) as por
        from public.crm_leads l
       where l.tenant = p_tenant
         and l.id is distinct from p_excluir
         and (
           (p_telefono_norm is not null and l.telefono_norm = p_telefono_norm)
           or (p_email_norm is not null and l.email_norm = p_email_norm)
           or (p_documento_norm is not null and l.documento_norm = p_documento_norm
               and l.tipo_doc is distinct from p_tipo_doc)
         )
         and public.crm_lead_permite_ver(l.tenant, l.responsable_id, p_actor_id, p_rol, p_actor_tenant)
       order by l.id
       limit 5
    ) c;
$$;

-- Correo de un usuario, SOLO para componer el texto de la bitacora de una
-- reasignacion. No se expone a `authenticated`: su salida seria el correo de
-- cualquier usuario de cualquier agencia. La RPC que la usa ya ha comprobado
-- que ese usuario es el responsable anterior o el nuevo del lead, o sea que es
-- alguien de la MISMA agencia y con un rol comercial.
create or replace function public.crm_lead_email_de(p_usuario uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (select u.email from public.usuarios u where u.id = p_usuario);
$$;

revoke all on function public.crm_lead_actor() from public, anon, authenticated;
revoke all on function public.crm_lead_responsable_valido(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_lead_permite_ver(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_lead_permite_crear(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_lead_permite_cambiar_responsable(text, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_lead_tipo_doc_validado(text, text) from public, anon, authenticated;
revoke all on function public.crm_lead_duplicado_id(text, text, text, bigint, uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_lead_coincidencias(text, text, text, text, text, bigint, uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_lead_email_de(uuid) from public, anon, authenticated;
revoke all on function public.crm_lead_puede_ver(text, uuid) from public, anon;
grant execute on function public.crm_lead_puede_ver(text, uuid) to authenticated;

-- Las funciones auxiliares (normalizadores y las de trigger) son
-- `SECURITY DEFINER` porque las crea la migración con el propietario de la base
-- y las usa `fn_auditoria` o los propios triggers. No filtran nada —normalizan
-- texto o son disparadores—, pero `anon` no tiene por qué ver ninguna de este
-- módulo, así que se le cierra el EXECUTE a todas.
revoke all on function public.crm_lead_normalizar_telefono(text) from public, anon;
revoke all on function public.crm_lead_normalizar_email(text) from public, anon;
revoke all on function public.crm_lead_normalizar_documento(text) from public, anon;
-- El de tipo no alimenta ninguna columna generada: solo lo usan las RPC (que
-- corren como propietario) a traves de `crm_lead_tipo_doc_validado`.
revoke all on function public.crm_lead_normalizar_tipo_doc(text) from public, anon, authenticated;
revoke all on function public.crm_leads_touch_updated_at() from public, anon;
revoke all on function public.crm_leads_bloquear_cambio_tenant() from public, anon;
revoke all on function public.crm_leads_bloquear_delete() from public, anon;
revoke all on function public.crm_lead_actividades_append_only() from public, anon;
grant execute on function public.crm_lead_normalizar_telefono(text) to authenticated;
grant execute on function public.crm_lead_normalizar_email(text) to authenticated;
grant execute on function public.crm_lead_normalizar_documento(text) to authenticated;

alter table public.crm_leads enable row level security;
alter table public.crm_lead_actividades enable row level security;

revoke all on table public.crm_leads from anon;
revoke all on table public.crm_lead_actividades from anon;
-- SOLO lectura para `authenticated`. INSERT/UPDATE/DELETE pasan a las RPC: asi no
-- hay forma de tocar un lead sin su actividad, ni de escribir en la bitacora con
-- un `actor_id`/`actor_email` que no sea el del usuario conectado. Los triggers
-- (anti-delete y append-only) siguen siendo la segunda capa.
grant select on table public.crm_leads to authenticated;
grant select on table public.crm_lead_actividades to authenticated;
revoke insert, update, delete on table public.crm_leads from authenticated;
revoke insert, update, delete on table public.crm_lead_actividades from authenticated;
-- Los `bigserial` solo los necesitan las RPC (que corren como propietario).
revoke all on sequence public.crm_leads_id_seq from anon, authenticated;
revoke all on sequence public.crm_lead_actividades_id_seq from anon, authenticated;

drop policy if exists "crm_leads: lectura" on public.crm_leads;
drop policy if exists "crm_leads: insertar" on public.crm_leads;
drop policy if exists "crm_leads: actualizar" on public.crm_leads;
drop policy if exists "crm_lead_actividades: lectura" on public.crm_lead_actividades;
drop policy if exists "crm_lead_actividades: insertar" on public.crm_lead_actividades;

-- Solo lectura. Sin policies de escritura a proposito: `authenticated` ya no
-- tiene esos privilegios sobre las tablas, y si alguien los restituyera por
-- error, la ausencia de policy lo denegaria en vez de dejarlo pasar.
create policy "crm_leads: lectura" on public.crm_leads for select to authenticated
  using (public.crm_lead_puede_ver(tenant, responsable_id));

create policy "crm_lead_actividades: lectura" on public.crm_lead_actividades for select to authenticated
  using (
    exists (
      select 1 from public.crm_leads l
       where l.id = lead_id
         and public.crm_lead_puede_ver(l.tenant, l.responsable_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Escrituras de negocio: cambio + bitacora en la misma transaccion
--
-- Son SECURITY DEFINER (la RLS no autoriza escrituras) y por eso cada una
-- comprueba, en este orden y con el estado ACTUAL del lead ya bloqueado:
--   1. quien es el actor y si su rol entra en el modulo (`crm_lead_actor`);
--   2. que el lead existe y es visible para el (si no, no se distingue de uno
--      inexistente: mismo mensaje);
--   3. que la transicion pedida esta permitida sobre el responsable vigente;
--   4. que el responsable resultante es valido y de la misma agencia.
-- `for update` bloquea la fila ANTES de leerla: dos ediciones concurrentes se
-- serializan, la segunda ve el estado ya escrito y decide sobre ese, no sobre
-- una foto obsoleta. Asi un asesor no puede modificar un lead que otro acaba de
-- tomar (la fila cambia de responsable y la comprobacion de visibilidad corre
-- contra el valor nuevo), y la bitacora describe el antes real.
--
-- Todas pasan por `get diagnostics ... row_count`: cero filas afectadas es un
-- error, nunca un exito silencioso. Los eventos de bitacora (`reasignacion`,
-- `cambio_etapa`, `cierre`) solo se insertan cuando el dato cambio de verdad, con
-- el mismo cuerpo que describe la operacion: no hay actividades duplicadas.
-- ---------------------------------------------------------------------------

create or replace function public.crm_lead_crear(p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    record;
  v_tenant    text := coalesce(nullif(btrim(coalesce(p_datos->>'tenant', '')), ''), 'mayorista');
  v_canal     text := lower(btrim(coalesce(nullif(p_datos->>'canal', ''), 'whatsapp')));
  v_nombre    text := btrim(coalesce(p_datos->>'nombre', ''));
  v_responsable uuid := nullif(btrim(coalesce(p_datos->>'responsable_id', '')), '')::uuid;
  v_proxima   timestamptz := nullif(btrim(coalesce(p_datos->>'proxima_accion_at', '')), '')::timestamptz;
  v_telefono  text := nullif(btrim(coalesce(p_datos->>'telefono', '')), '');
  v_email     text := nullif(btrim(coalesce(p_datos->>'email', '')), '');
  v_documento text := nullif(btrim(coalesce(p_datos->>'documento', '')), '');
  v_tipo_doc  text;
  v_notas     text := nullif(btrim(coalesce(p_datos->>'notas', '')), '');
  v_dup       bigint;
  v_id        bigint;
begin
  select * into v_actor from public.crm_lead_actor();

  if v_nombre = '' then
    raise exception 'El nombre es obligatorio; usa ''Desconocido'' si aun no lo tienes.';
  end if;
  if v_canal not in ('whatsapp', 'instagram', 'otro') then
    raise exception 'Canal invalido.';
  end if;
  if not public.crm_lead_permite_crear(v_tenant, v_responsable, v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant) then
    raise exception 'No puedes crear leads en esta agencia.';
  end if;
  v_tipo_doc := public.crm_lead_tipo_doc_validado(p_datos->>'tipo_doc', v_documento);

  -- El unico indice unico (ademas de la PK) es el documental, asi que una
  -- `unique_violation` aqui solo puede ser "mismo tenant + tipo + numero". Se
  -- rechaza sin tocar el lead existente: no hay fusion.
  begin
    insert into public.crm_leads (
      tenant, canal, nombre, telefono, email, tipo_doc, documento, interes, origen_detalle, notas,
      responsable_id, creado_por, proxima_accion_at
    ) values (
      v_tenant, v_canal, v_nombre, v_telefono, v_email, v_tipo_doc, v_documento,
      nullif(btrim(coalesce(p_datos->>'interes', '')), ''),
      nullif(btrim(coalesce(p_datos->>'origen_detalle', '')), ''),
      v_notas,
      v_responsable, v_actor.actor_id, v_proxima
    )
    returning id into v_id;
  exception when unique_violation then
    v_dup := public.crm_lead_duplicado_id(
      v_tenant, v_tipo_doc, public.crm_lead_normalizar_documento(v_documento), null,
      v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant
    );
    raise exception 'crm_lead_duplicado:%', coalesce(v_dup::text, '');
  end;

  insert into public.crm_lead_actividades (lead_id, tipo, cuerpo, proxima_accion_at, actor_id, actor_email)
  values (
    v_id,
    case when v_canal in ('instagram', 'whatsapp') then v_canal else 'nota' end,
    'Lead creado desde ' || v_canal || '.' || case when v_notas is null then '' else E'\n\n' || v_notas end,
    v_proxima,
    v_actor.actor_id,
    v_actor.actor_email
  );

  return jsonb_build_object(
    'id', v_id,
    'coincidencias', public.crm_lead_coincidencias(
      v_tenant,
      public.crm_lead_normalizar_telefono(v_telefono),
      public.crm_lead_normalizar_email(v_email),
      v_tipo_doc, public.crm_lead_normalizar_documento(v_documento), v_id,
      v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant
    )
  );
end;
$$;

create or replace function public.crm_lead_actualizar(p_lead bigint, p_datos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      record;
  v_actual     public.crm_leads%rowtype;
  v_responsable uuid;
  v_telefono   text;
  v_email      text;
  v_documento  text;
  v_tipo_doc   text;
  v_filas      integer;
  v_dup        bigint;
  v_claves     text[] := array[
    'canal', 'nombre', 'telefono', 'email', 'tipo_doc', 'documento', 'interes',
    'origen_detalle', 'notas', 'responsable_id', 'proxima_accion_at'];
  v_faltan     text;
begin
  select * into v_actor from public.crm_lead_actor();

  -- Contrato de FORMULARIO COMPLETO. Esta funcion reemplaza todos los campos
  -- editables con lo que recibe (un campo vacio significa "borrarlo"), asi que un
  -- JSON parcial —p. ej. solo `responsable_id`— vaciaria en silencio telefono,
  -- correo, documento y notas. En vez de adivinar si una clave ausente significa
  -- "borrar" o "no tocar", se exigen TODAS y con valor texto o null; si falta
  -- alguna, se rechaza ANTES de bloquear o modificar la fila.
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'crm_lead_payload_incompleto: se esperaba un objeto con todos los campos del lead.';
  end if;
  select string_agg(k, ', ' order by k) into v_faltan
    from unnest(v_claves) k
   where not (p_datos ? k);
  if v_faltan is not null then
    raise exception 'crm_lead_payload_incompleto: faltan %.', v_faltan;
  end if;
  select string_agg(k, ', ' order by k) into v_faltan
    from unnest(v_claves) k
   where jsonb_typeof(p_datos -> k) not in ('string', 'null');
  if v_faltan is not null then
    raise exception 'crm_lead_payload_invalido: % deben ser texto o null.', v_faltan;
  end if;
  -- Recien ahora se leen los valores: un `responsable_id` mal formado falla en
  -- el cast DESPUES de comprobar que el payload esta completo.
  v_responsable := nullif(btrim(coalesce(p_datos->>'responsable_id', '')), '')::uuid;
  v_telefono    := nullif(btrim(coalesce(p_datos->>'telefono', '')), '');
  v_email       := nullif(btrim(coalesce(p_datos->>'email', '')), '');
  v_documento   := nullif(btrim(coalesce(p_datos->>'documento', '')), '');

  -- Bloquea la fila y lee el estado ACTUAL. Si otra transaccion la tiene
  -- bloqueada, aqui se espera: cuando se continua, lo que se lee es lo que quedo
  -- escrito, no una version vieja.
  select * into v_actual from public.crm_leads where id = p_lead for update;
  if not found then
    raise exception 'Lead no encontrado o sin permiso.';
  end if;

  -- Visibilidad y transicion, evaluadas contra el responsable vigente (el que
  -- acaba de quedar tras el bloqueo, no el que el actor vio en pantalla).
  if not public.crm_lead_permite_ver(v_actual.tenant, v_actual.responsable_id, v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant) then
    raise exception 'Lead no encontrado o sin permiso.';
  end if;
  if v_responsable is distinct from v_actual.responsable_id
     and not public.crm_lead_permite_cambiar_responsable(
           v_actual.tenant, v_actual.responsable_id, v_responsable,
           v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant) then
    raise exception 'No puedes cambiar el responsable de este lead.';
  end if;
  if not public.crm_lead_responsable_valido(v_responsable, v_actual.tenant) then
    raise exception 'El responsable debe ser un usuario activo de gerencia, administracion o venta de esta misma agencia.';
  end if;
  v_tipo_doc := public.crm_lead_tipo_doc_validado(p_datos->>'tipo_doc', v_documento);

  -- Como en el alta, la unica `unique_violation` posible es la documental: otro
  -- lead del mismo tenant ya tiene ese tipo y numero. Se rechaza sin fusionar.
  begin
    update public.crm_leads
       set canal             = lower(btrim(coalesce(nullif(p_datos->>'canal', ''), v_actual.canal))),
           nombre            = btrim(coalesce(nullif(p_datos->>'nombre', ''), v_actual.nombre)),
           telefono          = v_telefono,
           email             = v_email,
           tipo_doc          = v_tipo_doc,
           documento         = v_documento,
           interes           = nullif(btrim(coalesce(p_datos->>'interes', '')), ''),
           origen_detalle    = nullif(btrim(coalesce(p_datos->>'origen_detalle', '')), ''),
           notas             = nullif(btrim(coalesce(p_datos->>'notas', '')), ''),
           responsable_id    = v_responsable,
           proxima_accion_at = nullif(btrim(coalesce(p_datos->>'proxima_accion_at', '')), '')::timestamptz
     where id = p_lead;
    get diagnostics v_filas = row_count;
  exception when unique_violation then
    v_dup := public.crm_lead_duplicado_id(
      v_actual.tenant, v_tipo_doc, public.crm_lead_normalizar_documento(v_documento), p_lead,
      v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant
    );
    raise exception 'crm_lead_duplicado:%', coalesce(v_dup::text, '');
  end;

  if v_filas = 0 then
    raise exception 'Lead no encontrado o sin permiso.';
  end if;

  -- Unica bitacora de este camino, y solo si el responsable cambio de verdad.
  -- El "antes" sale de `v_actual`, que es el estado bloqueado: describe la
  -- transicion real, no la que el actor creia ver.
  if v_responsable is distinct from v_actual.responsable_id then
    insert into public.crm_lead_actividades (lead_id, tipo, cuerpo, actor_id, actor_email)
    values (
      p_lead,
      'reasignacion',
      'Responsable: ' || coalesce(public.crm_lead_email_de(v_actual.responsable_id), 'sin responsable')
              || ' -> ' || coalesce(public.crm_lead_email_de(v_responsable), 'sin responsable'),
      v_actor.actor_id,
      v_actor.actor_email
    );
  end if;

  return jsonb_build_object(
    'id', p_lead,
    'coincidencias', public.crm_lead_coincidencias(
      v_actual.tenant,
      public.crm_lead_normalizar_telefono(v_telefono),
      public.crm_lead_normalizar_email(v_email),
      v_tipo_doc, public.crm_lead_normalizar_documento(v_documento), p_lead,
      v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant
    )
  );
end;
$$;

-- Tomar un lead SIN responsable de su propio tenant.
--
-- Aqui la carrera se resuelve con compare-and-set en el propio UPDATE: la
-- condicion `responsable_id is null` se evalua con el bloqueo de fila, asi que
-- de dos asesores que lo intenten a la vez solo uno escribe y el otro recibe
-- cero filas. No hace falta un `select ... for update` previo.
--
-- Las TRES comprobaciones del WHERE son obligatorias y no pueden apoyarse en la
-- RLS: esta funcion es SECURITY DEFINER, asi que la policy de UPDATE ya no
-- autoriza. Sin `responsable_valido`, la toma se colaba para superadmin y
-- para gerencia, que tienen alcada transversal: `permite_cambiar_responsable` y
-- `permite_ver` les dan verde y podian quedarse como responsables de un lead de
-- la OTRA agencia. Como responsable recien asignado, el actor tiene que cumplir
-- la misma regla que si se lo asignara gerencia a mano: activo, rol comercial y
-- del mismo tenant que el lead.
--
-- Efecto de esa comprobacion: tomar es siempre una operacion DENTRO de la propia
-- agencia, para cualquier rol. Asignar un lead a un asesor de otra agencia sigue
-- siendo imposible en todas partes (tambien se comprueba en
-- `crm_lead_actualizar`), pero superadmin y gerencia ya no pueden tomar leads de
-- la otra agencia por su cuenta: si quieren, se los reasigna su propio equipo.
create or replace function public.crm_lead_tomar(p_lead bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
  v_filas integer;
begin
  select * into v_actor from public.crm_lead_actor();

  update public.crm_leads
     set responsable_id = v_actor.actor_id
   where id = p_lead
     and responsable_id is null
     and public.crm_lead_permite_cambiar_responsable(
           tenant, null, v_actor.actor_id, v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant)
     and public.crm_lead_permite_ver(
           tenant, null, v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant)
     -- El actor, como responsable recien asignado, tiene que ser valido en la
     -- agencia del lead. Sin esto, superadmin y gerencia transversales podian
     -- tomar un lead de la otra agencia y quedar como responsables cruzados.
     and public.crm_lead_responsable_valido(v_actor.actor_id, tenant);
  get diagnostics v_filas = row_count;

  if v_filas = 0 then
    raise exception 'Ese lead ya tiene responsable o no te corresponde.';
  end if;

  insert into public.crm_lead_actividades (lead_id, tipo, cuerpo, actor_id, actor_email)
  values (p_lead, 'reasignacion', 'Lead tomado.', v_actor.actor_id, v_actor.actor_email);

  return jsonb_build_object('id', p_lead);
end;
$$;

create or replace function public.crm_lead_cambiar_etapa(p_lead bigint, p_etapa text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   record;
  v_actual  public.crm_leads%rowtype;
  v_etapa   text := lower(btrim(coalesce(p_etapa, '')));
  v_cerrada boolean;
  v_filas   integer;
begin
  if v_etapa not in ('nuevo', 'en_contacto', 'calificado', 'descartado', 'archivado') then
    raise exception 'Etapa invalida.';
  end if;

  select * into v_actor from public.crm_lead_actor();

  select * into v_actual from public.crm_leads where id = p_lead for update;
  if not found
     or not public.crm_lead_permite_ver(v_actual.tenant, v_actual.responsable_id, v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant) then
    raise exception 'Lead no encontrado o sin permiso.';
  end if;

  -- Misma etapa: no se toca la fila ni se duplica la bitacora.
  if v_actual.etapa = v_etapa then
    return jsonb_build_object('id', p_lead, 'etapa', v_actual.etapa, 'sin_cambio', true);
  end if;

  v_cerrada := v_etapa in ('descartado', 'archivado');

  update public.crm_leads
     set etapa = v_etapa,
         cerrado_at = case when v_cerrada then now() else null end
   where id = p_lead;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'Lead no encontrado o sin permiso.';
  end if;

  -- El "antes" viene de la fila bloqueada: si otra transaccion movio la etapa
  -- mientras esta esperaba, el texto refleja el salto real.
  insert into public.crm_lead_actividades (lead_id, tipo, cuerpo, actor_id, actor_email)
  values (
    p_lead,
    case when v_cerrada then 'cierre' else 'cambio_etapa' end,
    'Etapa: ' || v_actual.etapa || ' -> ' || v_etapa || '.',
    v_actor.actor_id,
    v_actor.actor_email
  );

  return jsonb_build_object('id', p_lead, 'etapa', v_etapa);
end;
$$;

-- Registrar una actividad con proxima accion: la actividad y el cambio de
-- proxima_accion_at del lead son la misma operacion. Se bloquea la fila igual
-- que en las demas escrituras, y si la segunda parte falla (lead desaparecido o
-- sin permiso) la exception revierte tambien la actividad: no queda una nota
-- anunciando algo que no ocurrio.
create or replace function public.crm_lead_registrar_actividad(
  p_lead bigint,
  p_tipo text,
  p_cuerpo text,
  p_proxima_accion_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  record;
  v_actual public.crm_leads%rowtype;
  v_tipo   text := lower(btrim(coalesce(nullif(p_tipo, ''), 'nota')));
  v_cuerpo text := btrim(coalesce(p_cuerpo, ''));
  v_filas  integer;
begin
  if v_tipo not in ('nota', 'llamada', 'whatsapp', 'instagram', 'email', 'reunion') then
    raise exception 'Tipo de actividad invalido.';
  end if;
  if v_cuerpo = '' then
    raise exception 'La actividad necesita una nota.';
  end if;

  select * into v_actor from public.crm_lead_actor();

  select * into v_actual from public.crm_leads where id = p_lead for update;
  if not found
     or not public.crm_lead_permite_ver(v_actual.tenant, v_actual.responsable_id, v_actor.actor_id, v_actor.actor_rol, v_actor.actor_tenant) then
    raise exception 'Lead no encontrado o sin permiso.';
  end if;

  if p_proxima_accion_at is not null then
    update public.crm_leads
       set proxima_accion_at = p_proxima_accion_at
     where id = p_lead;
    get diagnostics v_filas = row_count;
    if v_filas = 0 then
      raise exception 'Lead no encontrado o sin permiso.';
    end if;
  end if;

  insert into public.crm_lead_actividades (lead_id, tipo, cuerpo, proxima_accion_at, actor_id, actor_email)
  values (p_lead, v_tipo, v_cuerpo, p_proxima_accion_at, v_actor.actor_id, v_actor.actor_email);

  return jsonb_build_object('id', p_lead);
end;
$$;

revoke all on function public.crm_lead_crear(jsonb) from public, anon;
revoke all on function public.crm_lead_actualizar(bigint, jsonb) from public, anon;
revoke all on function public.crm_lead_tomar(bigint) from public, anon;
revoke all on function public.crm_lead_cambiar_etapa(bigint, text) from public, anon;
revoke all on function public.crm_lead_registrar_actividad(bigint, text, text, timestamptz) from public, anon;
grant execute on function public.crm_lead_crear(jsonb) to authenticated;
grant execute on function public.crm_lead_actualizar(bigint, jsonb) to authenticated;
grant execute on function public.crm_lead_tomar(bigint) to authenticated;
grant execute on function public.crm_lead_cambiar_etapa(bigint, text) to authenticated;
grant execute on function public.crm_lead_registrar_actividad(bigint, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Auditoria generica (087/108) SOLO en las dos tablas de esta migracion.
--
-- No se recorre `public`: hacerlo volveria a colgar `trg_auditoria` de
-- `tarifa_hotel_historial` y `hotel_temporadas_historial` (203), que son
-- historiales inmutables y no deben duplicarse en `auditoria`, ni de cualquier
-- tabla ajena cuyo trigger esta instalado a proposito con otra configuracion.
-- Quien quiera auditar otra tabla lo hace en su propia migracion.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_auditoria on public.crm_leads;
create trigger trg_auditoria after insert or update or delete on public.crm_leads
  for each row execute function public.fn_auditoria();

drop trigger if exists trg_auditoria on public.crm_lead_actividades;
create trigger trg_auditoria after insert or update or delete on public.crm_lead_actividades
  for each row execute function public.fn_auditoria();

notify pgrst, 'reload schema';

commit;