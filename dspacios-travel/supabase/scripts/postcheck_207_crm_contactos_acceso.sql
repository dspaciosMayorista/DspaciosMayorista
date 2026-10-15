-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK (SOLO SELECT) · hotfix de acceso a `crm_contactos`
--
-- Correr en el editor SQL de Supabase DESPUÉS de la migración. Es UNA sola
-- consulta SELECT sobre el catálogo (pg_policies, pg_class, privilegios):
-- no abre transacción, no crea tablas temporales, no cambia de rol y no
-- intenta escribir. Todas las filas deben salir `ok = true`.
-- Salida: solo metadatos y conteos (ningún contacto, id ni dato personal).
--
-- El comportamiento por sesión (anon, B2B, internos de cada agencia,
-- gerencia, superadmin) se verifica aparte, también en solo lectura, con la
-- sonda HEAD `supabase/scripts/pruebas/api_207_crm_contactos_acceso.mjs --fase=post`.
-- ───────────────────────────────────────────────────────────────────────────

with
pol as (
  select policyname, cmd, roles::text as roles,
         coalesce(qual, '') as qual, coalesce(with_check, '') as wc
    from pg_policies
   where schemaname = 'public' and tablename = 'crm_contactos'
),
col as (
  select is_nullable, column_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'crm_contactos' and column_name = 'tenant'
)
select o, chequeo, ok, coalesce(detalle, '') as detalle from (
  select 1 as o, 'RLS activo' as chequeo,
         (select relrowsecurity from pg_class where oid = 'public.crm_contactos'::regclass) as ok,
         null::text as detalle
  union all
  select 2, 'columna tenant existe y es nullable (históricos sin atribuir)',
         coalesce((select is_nullable = 'YES' from col), false), null
  union all
  select 3, 'default de tenant = crm_contactos_tenant_default()',
         coalesce((select column_default ilike '%crm_contactos_tenant_default()%' from col), false), null
  union all
  select 4, 'CHECK de valores de tenant',
         exists (select 1 from pg_constraint
                  where conrelid = 'public.crm_contactos'::regclass and conname = 'crm_contactos_tenant_valido'), null
  union all
  select 5, 'trigger que bloquea reasignar un tenant atribuido (habilitado)',
         exists (select 1 from pg_trigger
                  where tgrelid = 'public.crm_contactos'::regclass
                    and tgname = 'trg_crm_contactos_bloquear_cambio_tenant' and tgenabled <> 'D'), null
  union all
  select 6, 'no quedan las policies de la 042 ni las de recuperación',
         not exists (select 1 from pol where policyname in ('crm_contactos: lectura', 'crm_contactos: escritura')
                                         or policyname like 'crm_contactos: recuperacion %'),
         (select string_agg(policyname, ', ' order by policyname) from pol)
  union all
  select 7, 'exactamente 4 policies: select/insert/update/delete, solo authenticated',
         (select count(*) = 4 and count(distinct cmd) = 4 and bool_and(roles = '{authenticated}')
                 and bool_and(policyname like 'crm_contactos: interno %') from pol),
         (select string_agg(policyname || ':' || cmd || ':' || roles, ', ' order by policyname) from pol)
  union all
  select 8, 'ninguna policy basada solo en auth.uid() ni en true',
         not exists (select 1 from pol where qual ilike '%uid()%' or wc ilike '%uid()%'
                                          or qual ~* '^\(?\s*true\s*\)?$' or wc ~* '^\(?\s*true\s*\)?$'), null
  union all
  select 9, 'toda policy exige rol interno y agencia (mi_rol + puede_ver_tenant)',
         not exists (select 1 from pol
                      where not ((qual || wc) ilike '%mi_rol()%' and (qual || wc) ilike '%puede_ver_tenant(tenant)%')), null
  union all
  select 10, 'ninguna policy menciona roles externos ni control_vuelo',
         not exists (select 1 from pol where (qual || wc) ~ '(agencia|freelance|cliente_final|control_vuelo)'), null
  union all
  select 11, 'insertar exige tenant no nulo',
         coalesce((select wc ilike '%tenant IS NOT NULL%' from pol where cmd = 'INSERT'), false), null
  union all
  select 12, 'anon sin ningún privilegio de tabla',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public' and table_name = 'crm_contactos' and grantee = 'anon'),
         (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'crm_contactos' and grantee = 'anon')
  union all
  select 13, 'anon sin privilegios sobre la secuencia del id',
         not has_sequence_privilege('anon', pg_get_serial_sequence('public.crm_contactos', 'id'), 'USAGE,SELECT,UPDATE'), null
  union all
  select 14, 'authenticated conserva SELECT/INSERT/UPDATE/DELETE (CRM interno)',
         has_table_privilege('authenticated', 'public.crm_contactos', 'SELECT')
         and has_table_privilege('authenticated', 'public.crm_contactos', 'INSERT')
         and has_table_privilege('authenticated', 'public.crm_contactos', 'UPDATE')
         and has_table_privilege('authenticated', 'public.crm_contactos', 'DELETE'), null
  union all
  select 15, 'authenticated sin TRUNCATE/REFERENCES/TRIGGER',
         not (has_table_privilege('authenticated', 'public.crm_contactos', 'TRUNCATE')
           or has_table_privilege('authenticated', 'public.crm_contactos', 'REFERENCES')
           or has_table_privilege('authenticated', 'public.crm_contactos', 'TRIGGER')), null
  union all
  select 16, 'anon no ejecuta crm_contactos_tenant_default()',
         not has_function_privilege('anon', 'public.crm_contactos_tenant_default()', 'EXECUTE'), null
  union all
  select 17, 'service_role conserva INSERT (checkout público, servidor)',
         has_table_privilege('service_role', 'public.crm_contactos', 'INSERT'), null
  union all
  select 18, 'ninguna vista ni función SECURITY DEFINER expone la tabla',
         not exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
                      where d.refobjid = 'public.crm_contactos'::regclass and r.ev_class <> 'public.crm_contactos'::regclass)
         and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.prosecdef and p.prosrc ilike '%crm_contactos%'), null
  union all
  select 19, 'índices únicos de la 047 intactos (no se tocan en este hotfix)',
         (select count(*) = 3 from pg_indexes where schemaname = 'public' and tablename = 'crm_contactos'
             and indexname in ('uq_crm_documento', 'uq_crm_email', 'uq_crm_telefono')), null
  union all
  select 20, 'informativo: filas sin atribuir / mayorista / minorista (no falla)', true,
         (select count(*) filter (where tenant is null) || ' / ' || count(*) filter (where tenant = 'mayorista')
                 || ' / ' || count(*) filter (where tenant = 'minorista') from public.crm_contactos)
) r
order by o;
