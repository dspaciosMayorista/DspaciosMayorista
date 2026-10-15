-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT (SOLO LECTURA) · hotfix de acceso a `crm_contactos`
--
-- Se corre en el editor SQL de Supabase ANTES de la migración. No escribe
-- nada: un solo SELECT con varias filas `seccion | chequeo | valor`.
-- Devuelve SOLO metadatos y CONTEOS: ningún nombre, documento, email,
-- teléfono, id de contacto ni id de usuario.
--
-- Qué responde:
--   A. Estado actual de permisos (lo que la migración va a cambiar).
--   B. Si algo más depende de la tabla (vistas/funciones/triggers) y podría
--      romperse o saltarse la RLS.
--   C. Atribución: cuántas filas históricas tienen EVIDENCIA de a qué agencia
--      pertenecen y de qué tipo. Esto NO atribuye: alimenta la decisión del
--      dueño para `atribuir_207_crm_contactos_acceso.sql`.
--   D. Impacto: cuántos usuarios internos por rol/agencia dejarán de ver las
--      filas sin atribuir hasta que se decida la atribución.
--
-- Categorías de evidencia (por fila, usando el INSERT registrado en
-- `auditoria` — migración 087 en adelante):
--   E1 creador interno de agencia fija (administracion/operaciones/venta) y su
--      `usuarios.tenant` actual válido → candidata = agencia del creador.
--   E2 sin actor (service_role) con origen 'Cotización tarifario (B2C)' en el
--      INSERT → candidata = mayorista (el checkout público estampa
--      tenant='mayorista' en la cotización, checkout/actions.ts).
--   E3 creador superadmin o gerencia → AMBIGUA (superadmin alterna agencias
--      por cookie; gerencia opera sobre ambas). Sin candidata.
--   E4 sin INSERT auditado (creada antes de la 087, o el log no está) → sin
--      evidencia.
--   E5 cualquier otro caso (actor sin perfil, rol externo, tenant inválido).
--   Además: cuántas filas fueron CREADAS O EDITADAS por personal de las dos agencias
--   (señal de base compartida de hecho; atribuirlas a una sola es decisión).
-- ───────────────────────────────────────────────────────────────────────────

with
tabla as (
  select 'public.crm_contactos'::regclass as rel
),
ins as (
  -- Último INSERT auditado de cada fila existente.
  select distinct on (a.registro_id)
         a.registro_id, a.actor_id, a.actor_rol, a.despues->>'origen' as origen_ins
    from public.auditoria a
   where a.tabla = 'crm_contactos' and a.accion = 'INSERT'
   order by a.registro_id, a.creado_en desc
),
clasif as (
  select c.id,
         case
           when i.registro_id is null then 'E4'
           when i.actor_id is null and i.origen_ins = 'Cotización tarifario (B2C)' then 'E2'
           when i.actor_rol in ('superadmin','gerencia') then 'E3'
           when i.actor_rol in ('administracion','operaciones','venta')
                and u.tenant in ('mayorista','minorista') then 'E1-' || u.tenant
           else 'E5'
         end as cat
    from public.crm_contactos c
    left join ins i on i.registro_id = c.id::text
    left join public.usuarios u on u.id = i.actor_id
),
tocadas as (
  -- Filas existentes creadas o editadas por personal de MÁS de una agencia.
  select a.registro_id
    from public.auditoria a
    join public.usuarios u on u.id = a.actor_id
   where a.tabla = 'crm_contactos' and a.accion in ('INSERT', 'UPDATE')
     and a.registro_id in (select id::text from public.crm_contactos)
   group by a.registro_id
  having count(distinct u.tenant) > 1
)
select seccion, chequeo, valor from (
  -- ── A. Permisos actuales ──────────────────────────────────────────────
  select 1 as o, 'A' as seccion, 'RLS activo' as chequeo,
         (select relrowsecurity::text from pg_class where oid = (select rel from tabla)) as valor
  union all
  select 2, 'A', 'RLS forzado',
         (select relforcerowsecurity::text from pg_class where oid = (select rel from tabla))
  union all
  select 3, 'A', 'policies (nombre · cmd · roles · using)',
         (select string_agg(policyname || ' · ' || cmd || ' · ' || roles::text || ' · ' || coalesce(qual, '-'), ' || ' order by policyname)
            from pg_policies where schemaname = 'public' and tablename = 'crm_contactos')
  union all
  select 4, 'A', 'privilegios anon',
         coalesce((select string_agg(privilege_type, ',' order by privilege_type)
            from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'crm_contactos' and grantee = 'anon'), '(ninguno)')
  union all
  select 5, 'A', 'privilegios authenticated',
         coalesce((select string_agg(privilege_type, ',' order by privilege_type)
            from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'crm_contactos' and grantee = 'authenticated'), '(ninguno)')
  union all
  select 6, 'A', 'columna tenant ya existe (debe ser false)',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'crm_contactos' and column_name = 'tenant')::text
  union all
  select 7, 'A', 'helpers mi_rol/mi_tenant/puede_ver_tenant presentes (debe ser true)',
         (to_regprocedure('public.mi_rol()') is not null
          and to_regprocedure('public.mi_tenant()') is not null
          and to_regprocedure('public.puede_ver_tenant(text)') is not null)::text

  -- ── B. Dependencias ───────────────────────────────────────────────────
  union all
  select 10, 'B', 'vistas que leen crm_contactos',
         coalesce((select string_agg(distinct v.relname, ',')
            from pg_depend d
            join pg_rewrite r on r.oid = d.objid
            join pg_class v on v.oid = r.ev_class
           where d.refobjid = (select rel from tabla) and v.oid <> (select rel from tabla)), '(ninguna)')
  union all
  select 11, 'B', 'funciones public que mencionan crm_contactos (nombre · security definer)',
         coalesce((select string_agg(p.proname || ' · ' || p.prosecdef::text, ', ' order by p.proname)
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosrc ilike '%crm_contactos%'), '(ninguna)')
  union all
  select 12, 'B', 'triggers sobre crm_contactos',
         coalesce((select string_agg(tgname, ',' order by tgname)
            from pg_trigger where tgrelid = (select rel from tabla) and not tgisinternal), '(ninguno)')
  union all
  select 13, 'B', 'índices únicos (047) — siguen globales',
         coalesce((select string_agg(indexrelid::regclass::text, ',' order by indexrelid::regclass::text)
            from pg_index where indrelid = (select rel from tabla) and indisunique and not indisprimary), '(ninguno)')

  -- ── C. Atribución (conteos) ──────────────────────────────────────────
  union all
  select 20, 'C', 'filas totales', (select count(*)::text from public.crm_contactos)
  union all
  select 21, 'C', 'auditoria disponible para crm_contactos (INSERTs registrados)',
         (select count(*)::text from public.auditoria where tabla = 'crm_contactos' and accion = 'INSERT')
  union all
  select 22, 'C', 'por categoría de evidencia',
         coalesce((select string_agg(cat || '=' || n, ', ' order by cat)
            from (select cat, count(*) n from clasif group by cat) x), '(sin filas)')
  union all
  select 23, 'C', 'filas creadas o editadas por personal de las DOS agencias',
         (select count(*)::text from tocadas)
  union all
  select 24, 'C', 'origen (agrupado; texto libre fuera de lista = "otro")',
         coalesce((select string_agg(o || '=' || n, ', ' order by o)
            from (select case
                           when origen is null then '(vacío)'
                           when origen in ('cargue B2B', 'Cotización tarifario (B2C)') then origen
                           else 'otro'
                         end as o, count(*) n
                    from public.crm_contactos group by 1) x), '(sin filas)')
  union all
  select 25, 'C', 'categoría del contacto',
         coalesce((select string_agg(categoria || '=' || n, ', ' order by categoria)
            from (select categoria, count(*) n from public.crm_contactos group by 1) x), '(sin filas)')

  -- ── D. Impacto mientras haya filas sin atribuir ─────────────────────
  union all
  select 30, 'D', 'usuarios internos activos por rol·agencia (los que NO son superadmin/gerencia dejan de ver lo no atribuido)',
         coalesce((select string_agg(rol::text || '·' || tenant || '=' || n, ', ' order by rol::text, tenant)
            from (select rol, tenant, count(*) n from public.usuarios
                   where activo and rol in ('superadmin','gerencia','administracion','operaciones','venta')
                   group by 1, 2) x), '(ninguno)')
  union all
  select 31, 'D', 'usuarios con rol externo o control_vuelo activos (hoy alcanzan la tabla por la policy abierta)',
         coalesce((select string_agg(rol::text || '=' || n, ', ' order by rol::text)
            from (select rol, count(*) n from public.usuarios
                   where activo and rol in ('agencia','freelance','cliente_final','control_vuelo')
                   group by 1) x), '(ninguno)')
  union all
  select 32, 'D', 'contactos elegibles para campaña hoy (acepta_publicidad y no no_contactar, con email)',
         (select count(*)::text from public.crm_contactos
           where acepta_publicidad and not no_contactar and email is not null)
) r
order by o;
