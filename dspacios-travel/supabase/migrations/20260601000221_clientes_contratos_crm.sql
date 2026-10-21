-- ───────────────────────────────────────────────────────────────────────────
-- MIGRACIÓN 221 · CRM — Clientes de contratos (#68)
--
-- Número reservado por el Coordinador (WORKSTREAMS.md, "GO LOCAL #68", 2026-10-20). En Producción la 220
-- (#67, destinos aéreos) debe aplicarse ANTES que esta: es un orden operativo, no una dependencia de
-- objetos (la 221 no usa nada de la 220; el preflight avisa si no la detecta).
-- Scripts: supabase/scripts/{preflight,postcheck,rollback,test}_221_clientes_contratos_crm.*
--
-- QUÉ HACE (solo LECTURA de datos existentes; sin tablas, sin columnas, sin backfill)
--   Dos funciones para la sección «Clientes de contratos» del CRM, UNA FILA POR CONTRATO:
--     · public.crm_contratos_clientes_buscar(p_tenant, p_busqueda, p_cursor, p_tam)  — lista paginada
--     · public.crm_contrato_cliente_ficha(p_numero_contrato)                          — un contrato
--
-- AUTORIDAD (lo que decide la base, nunca el navegador)
--   · El actor sale de auth.uid() y de SU fila de public.usuarios con activo is true (rol y tenant). Sin fila,
--     inactivo, rol fuera de superadmin/gerencia/administracion/operaciones/venta, o tenant propio fuera de
--     mayorista/minorista (para quien no es superadmin): resultado VACÍO. NO se usan mi_tenant() (cae a
--     'mayorista') ni puede_ver_tenant() (deja ver ambos tenants a gerencia y superadmin) como autoridad.
--   · p_tenant NO es autoridad: solo el superadmin lo elige (obligatorio, mayorista o minorista; nulo = vacío).
--     gerencia, administración, operaciones y venta quedan en el tenant de su propia fila; si p_tenant llega y es
--     distinto del suyo, el resultado es vacío (falla cerrado, igual que un contrato inexistente).
--   · La ficha no recibe tenant ni usuario: busca el contrato y aplica el mismo predicado.
--   · venta solo ve contratos PROPIOS (public.soy_asesor_del_contrato) y, además, NO ve un contrato si el texto
--     de su asesor equivale a MÁS DE UN usuario activo del mismo tenant (homónimos): la atribución por nombre no
--     queda clara y falla cerrada. Esa cuenta se hace aquí, con permisos del dueño de la función, porque venta
--     no puede leer las filas de otros usuarios.
--   · Lee public.ventas_basica (rol, tenant y enmascarado vigentes quedan debajo como defensa en profundidad).
--     Nunca la tabla base, ni crm_contactos, ni columnas financieras, direcciones, firmas o share_token.
--   · Respuestas VACÍAS idénticas para «ajeno», «otro tenant», «inexistente» y «sin permiso»: sin errores
--     distintos ni conteos que revelen existencia.
--
-- QUÉ NO HACE
--   · No edita ventas_basica, soy_asesor_del_contrato, soy_ese_asesor, mi_rol, RLS, ninguna política ni ninguna
--     función existente. No agrupa clientes por documento (ventas no guarda el tipo documental).
--   · No concede nada a anon, a PUBLIC ni a service_role.
--
-- Idempotente: re-ejecutarla no cambia nada. Rollback: rollback_221_clientes_contratos_crm.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

set local lock_timeout = '10s';

-- 0) Guardas: la cadena debe tener lo que la 221 lee, y nadie más puede usar estos nombres.
do $$
declare
  v_falta text;
begin
  select string_agg(c, ', ') into v_falta
    from unnest(array['numero_contrato', 'fecha_venta', 'asesor', 'cliente', 'cliente_documento', 'cliente_email',
                      'cliente_telefono', 'destino', 'fecha_salida', 'fecha_regreso', 'estado', 'tipo_asesor',
                      'agencia_nombre', 'freelance_nombre', 'tenant']) c
   where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.ventas_basica') and a.attname = c
                        and a.attnum > 0 and not a.attisdropped);
  if v_falta is not null then
    raise exception '221 ABORTADA: public.ventas_basica no existe o le faltan columnas: %.', v_falta;
  end if;

  select string_agg(c, ', ') into v_falta
    from unnest(array['id', 'rol', 'activo', 'tenant', 'nombre', 'email']) c
   where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.usuarios') and a.attname = c
                        and a.attnum > 0 and not a.attisdropped);
  if v_falta is not null then
    raise exception '221 ABORTADA: public.usuarios no existe o le faltan columnas: %.', v_falta;
  end if;

  if to_regprocedure('public.soy_asesor_del_contrato(text)') is null or to_regprocedure('auth.uid()') is null then
    raise exception '221 ABORTADA: faltan public.soy_asesor_del_contrato(text) o auth.uid().';
  end if;

  if exists (select 1
               from pg_catalog.pg_proc p
               join pg_catalog.pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('crm_contratos_clientes_buscar', 'crm_contrato_cliente_ficha')
                and p.oid not in (coalesce(to_regprocedure('public.crm_contratos_clientes_buscar(text,text,text,integer)')::oid, 0::oid),
                                  coalesce(to_regprocedure('public.crm_contrato_cliente_ficha(text)')::oid, 0::oid))) then
    raise exception '221 ABORTADA: ya existe una función con ese nombre y OTRA firma en public.';
  end if;
end $$;

-- 1) Lista paginada: una fila por contrato.
create or replace function public.crm_contratos_clientes_buscar(
  p_tenant    text    default null,
  p_busqueda  text    default null,
  p_cursor    text    default null,
  p_tam       integer default 50)
returns table (
  numero_contrato   text,
  fecha_venta       date,
  cliente           text,
  cliente_documento text,
  cliente_email     text,
  cliente_telefono  text,
  destino           text,
  fecha_salida      date,
  fecha_regreso     date,
  estado            text,
  tipo_asesor       text,
  agencia_nombre    text,
  freelance_nombre  text,
  tenant            text,
  hay_mas           boolean)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid      uuid;
  v_rol      text;
  v_tenant_u text;
  v_t        text;
  v_tam      integer;
  v_q        text;
begin
  -- 1. Actor: SU fila activa de usuarios. Sin ella, nada.
  v_uid := auth.uid();
  if v_uid is null then
    return;
  end if;
  select u.rol::text, u.tenant into v_rol, v_tenant_u
    from public.usuarios u
   where u.id = v_uid and u.activo is true;
  if not found or v_rol is null
     or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') then
    return;
  end if;

  -- 2. Tenant efectivo: p_tenant solo lo elige el superadmin; el resto, el de su fila.
  if v_rol = 'superadmin' then
    if p_tenant is null or p_tenant not in ('mayorista', 'minorista') then
      return;
    end if;
    v_t := p_tenant;
  else
    if v_tenant_u is null or v_tenant_u not in ('mayorista', 'minorista') then
      return;
    end if;
    if p_tenant is not null and p_tenant <> v_tenant_u then
      return;
    end if;
    v_t := v_tenant_u;
  end if;

  -- 3. Parámetros: fuera de rango = vacío (nunca un error distinto).
  v_tam := least(greatest(coalesce(p_tam, 50), 1), 50);
  v_q := nullif(btrim(p_busqueda), '');
  if v_q is not null then
    if char_length(v_q) < 3 or char_length(v_q) > 100 then
      return;
    end if;
    -- Comodines de ILIKE escapados: backslash primero, luego % y _.
    v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  end if;
  if p_cursor is not null and char_length(p_cursor) > 60 then
    return;
  end if;

  -- 4. Filas: el filtro de tenant y de propiedad va en el MISMO WHERE que la búsqueda, sobre la salida de
  --    la vista (nunca se filtra por una columna que el rol no pueda ver).
  return query
    with base as (
      select b.numero_contrato::text as numero_contrato,
             b.fecha_venta::date as fecha_venta,
             b.cliente::text as cliente,
             b.cliente_documento::text as cliente_documento,
             b.cliente_email::text as cliente_email,
             b.cliente_telefono::text as cliente_telefono,
             b.destino::text as destino,
             b.fecha_salida::date as fecha_salida,
             b.fecha_regreso::date as fecha_regreso,
             b.estado::text as estado,
             b.tipo_asesor::text as tipo_asesor,
             b.agencia_nombre::text as agencia_nombre,
             b.freelance_nombre::text as freelance_nombre,
             b.tenant::text as tenant
        from public.ventas_basica b
       where b.tenant = v_t
         and (v_rol <> 'venta'
              or (public.soy_asesor_del_contrato(b.numero_contrato)
                  and (select count(*)
                         from public.usuarios u2
                        where u2.activo is true
                          and u2.tenant = v_t
                          and lower(btrim(b.asesor)) in (lower(btrim(u2.nombre)), lower(btrim(u2.email)))) = 1))
         and (p_cursor is null or b.numero_contrato < p_cursor)
         and (v_q is null
              or b.cliente ilike ('%' || v_q || '%') escape '\'
              or b.cliente_documento ilike ('%' || v_q || '%') escape '\'
              or b.cliente_email ilike ('%' || v_q || '%') escape '\'
              or b.cliente_telefono ilike ('%' || v_q || '%') escape '\'
              or b.numero_contrato ilike ('%' || v_q || '%') escape '\')
       order by b.numero_contrato desc
       limit v_tam + 1
    )
    select ba.numero_contrato, ba.fecha_venta, ba.cliente, ba.cliente_documento, ba.cliente_email,
           ba.cliente_telefono, ba.destino, ba.fecha_salida, ba.fecha_regreso, ba.estado, ba.tipo_asesor,
           ba.agencia_nombre, ba.freelance_nombre, ba.tenant,
           ((select count(*) from base) > v_tam) as hay_mas
      from base ba
     order by ba.numero_contrato desc
     limit v_tam;
end;
$$;

comment on function public.crm_contratos_clientes_buscar(text, text, text, integer) is
  '221 (#68): lista paginada (cursor por numero_contrato, página máxima 50) de contratos con los datos de su cliente, UNA FILA POR CONTRATO. Actor y tenant salen de auth.uid() y de la fila activa de usuarios; p_tenant solo lo elige el superadmin. venta solo ve contratos propios y ninguno cuyo asesor equivalga a más de un usuario activo del tenant. Vacío idéntico para ajeno, otro tenant, inexistente y sin permiso. Lee ventas_basica; no lee crm_contactos.';

-- 2) Ficha de UN contrato (sin tenant ni usuario como parámetros).
create or replace function public.crm_contrato_cliente_ficha(p_numero_contrato text)
returns table (
  numero_contrato   text,
  fecha_venta       date,
  cliente           text,
  cliente_documento text,
  cliente_email     text,
  cliente_telefono  text,
  destino           text,
  fecha_salida      date,
  fecha_regreso     date,
  estado            text,
  tipo_asesor       text,
  agencia_nombre    text,
  freelance_nombre  text,
  tenant            text)
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid      uuid;
  v_rol      text;
  v_tenant_u text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return;
  end if;
  select u.rol::text, u.tenant into v_rol, v_tenant_u
    from public.usuarios u
   where u.id = v_uid and u.activo is true;
  if not found or v_rol is null
     or v_rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') then
    return;
  end if;
  if v_rol <> 'superadmin' and (v_tenant_u is null or v_tenant_u not in ('mayorista', 'minorista')) then
    return;
  end if;
  if p_numero_contrato is null or char_length(p_numero_contrato) = 0 or char_length(p_numero_contrato) > 60 then
    return;
  end if;

  return query
    select b.numero_contrato::text,
           b.fecha_venta::date,
           b.cliente::text,
           b.cliente_documento::text,
           b.cliente_email::text,
           b.cliente_telefono::text,
           b.destino::text,
           b.fecha_salida::date,
           b.fecha_regreso::date,
           b.estado::text,
           b.tipo_asesor::text,
           b.agencia_nombre::text,
           b.freelance_nombre::text,
           b.tenant::text
      from public.ventas_basica b
     where b.numero_contrato = p_numero_contrato
       and (v_rol = 'superadmin' or b.tenant = v_tenant_u)
       and (v_rol <> 'venta'
            or (public.soy_asesor_del_contrato(b.numero_contrato)
                and (select count(*)
                       from public.usuarios u2
                      where u2.activo is true
                        and u2.tenant = b.tenant
                        and lower(btrim(b.asesor)) in (lower(btrim(u2.nombre)), lower(btrim(u2.email)))) = 1));
end;
$$;

comment on function public.crm_contrato_cliente_ficha(text) is
  '221 (#68): los datos de cliente de UN contrato. Sin parámetros de tenant ni de usuario: el actor sale de auth.uid() y de la fila activa de usuarios; no superadmin solo ve contratos de su tenant; venta solo propios y no ambiguos por homónimos. Vacío idéntico para ajeno, otro tenant, inexistente y sin permiso.';

-- 3) Dueño y privilegios: solo authenticated ejecuta (y la lógica de arriba decide quién ve algo).
alter function public.crm_contratos_clientes_buscar(text, text, text, integer) owner to current_user;
alter function public.crm_contrato_cliente_ficha(text) owner to current_user;

revoke all on function public.crm_contratos_clientes_buscar(text, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.crm_contrato_cliente_ficha(text)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_contratos_clientes_buscar(text, text, text, integer) to authenticated;
grant execute on function public.crm_contrato_cliente_ficha(text) to authenticated;

commit;
