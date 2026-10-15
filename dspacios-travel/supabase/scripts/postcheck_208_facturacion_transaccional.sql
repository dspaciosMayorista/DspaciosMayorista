-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 208 · facturación transaccional. SOLO LECTURA (catálogo; ROLLBACK).
-- Correr DESPUÉS de aplicar la 208. Cada fila: código | ok | detalle.
-- Todas deben salir ok = true. (Tras una retirada parcial, C4 informa las RPC
-- de emitir/quitar como retiradas y el resto debe seguir en true.)
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
rpc(f) as (values
  ('public.facturar_factura(text,uuid,text,numeric,numeric,numeric,text,text,text,text)'),
  ('public.quitar_factura(text,uuid,text)'),
  ('public.marcar_dian_factura(text,uuid,text,boolean)'),
  ('public.postear_asiento_abono(bigint,text,uuid)'),
  ('public.consultar_factura_fuera_libros(text,uuid,text)')),
rpc_ok as (select f, to_regprocedure(f) as oid from rpc),
helpers as (
  select p.oid, p.proname, p.prosecdef from pg_proc p where p.pronamespace = 'f208_priv'::regnamespace
),
trg(nombre, tabla) as (values
  ('trg_f208_abonos_marca', 'public.abonos'), ('trg_f208_abonos_borrar', 'public.abonos'), ('trg_f208_constancia_guarda', 'public.factura_revision_fuera_libros'),
  ('trg_f208_constancia_truncate', 'public.factura_revision_fuera_libros'), ('trg_f208_cf_bloquear', 'public.contrato_facturacion'),
  ('trg_f208_cf_validar', 'public.contrato_facturacion'), ('trg_f208_cf_borrar', 'public.contrato_facturacion'),
  ('trg_f208_cf_truncate', 'public.contrato_facturacion'), ('trg_f208_asiento_guarda_i', 'public.asientos_contables'),
  ('trg_f208_asiento_guarda_u', 'public.asientos_contables'), ('trg_f208_asiento_guarda_d', 'public.asientos_contables'),
  ('trg_f208_asientos_truncate', 'public.asientos_contables'), ('trg_f208_linea_guarda', 'public.asiento_lineas'),
  ('trg_f208_lineas_truncate', 'public.asiento_lineas'), ('trg_f208_ventas_protector', 'public.ventas')),
c as (
  select 'C1' as codigo, to_regnamespace('f208_priv') is not null and to_regclass('public.factura_revision_fuera_libros') is not null as ok,
         'Esquema f208_priv y tabla de constancias existen' as detalle
  union all
  select 'C2', (select count(*) from trg t join pg_trigger g on g.tgname = t.nombre and g.tgrelid = t.tabla::regclass and g.tgenabled = 'O') = 15,
         'Las 15 guardas existen y están habilitadas: '
         || (select count(*) from trg t join pg_trigger g on g.tgname = t.nombre and g.tgrelid = t.tabla::regclass and g.tgenabled = 'O') || '/15'
  union all
  select 'C3', (select relrowsecurity from pg_class where oid = 'public.factura_revision_fuera_libros'::regclass)
           and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'factura_revision_fuera_libros'),
         'Constancias con RLS activa y SIN policies (solo la consulta contable filtrada)'
  union all
  select 'C4', bool_and(oid is null or (has_function_privilege('service_role', oid, 'execute')
                 and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute'))),
         'RPC solo para service_role: ' || string_agg(split_part(f, '(', 1) || case when oid is null then '=RETIRADA' else '=ok' end, ', ')
    from rpc_ok
  union all
  select 'C5', bool_and(not prosecdef) , 'Las RPC son SECURITY INVOKER (guardas por current_user)'
    from rpc_ok r join pg_proc p on p.oid = r.oid
  union all
  select 'C6', not has_schema_privilege('anon', 'f208_priv', 'usage')
           and not exists (select 1 from helpers h where has_function_privilege('anon', h.oid, 'execute')),
         'anon sin USAGE en f208_priv ni EXECUTE en sus helpers'
  union all
  select 'C7', not exists (select 1 from helpers h where h.proname in ('fotografia_fuera_libros', 'asiento_de_abono', 'actor', 'exigir_agencia', 'importes_factura', 'reversar', 'puc_id')
                             and has_function_privilege('authenticated', h.oid, 'execute')),
         'authenticated sin EXECUTE en los helpers que leen o escriben libros'
  union all
  select 'C8', (select bool_and(prosecdef) from helpers where proname in ('exigir_acceso', 'bloquear_venta', 'factura_vigente_id', 'dian_emitida', 'clase_asiento', 'historia_factura'))
           and (select bool_and(not prosecdef) from helpers where proname in ('es_rpc_factura', 'es_rpc_abono')),
         'Helpers DEFINER solo en f208_priv (con control de rol/agencia); es_rpc_* INVOKER'
  union all
  select 'C9', not has_table_privilege('authenticated', 'public.factura_revision_fuera_libros', 'select')
           and not has_table_privilege('service_role', 'public.factura_revision_fuera_libros', 'update')
           and not has_table_privilege('service_role', 'public.factura_revision_fuera_libros', 'delete'),
         'Constancias: sin lectura para authenticated; service_role sin UPDATE/DELETE'
  union all
  select 'C10', bool_and(not has_table_privilege(r, t, 'truncate')),
         'Sin TRUNCATE para anon/authenticated/service_role en ventas, abonos, contrato_facturacion, asientos y líneas'
    from unnest(array['anon', 'authenticated', 'service_role']) r,
         unnest(array['public.ventas', 'public.abonos', 'public.contrato_facturacion', 'public.asientos_contables', 'public.asiento_lineas']) t
  union all
  select 'C11', not has_table_privilege('anon', 'public.contrato_facturacion', 'insert')
           and not has_table_privilege('anon', 'public.contrato_facturacion', 'select'),
         'anon sin privilegios sobre contrato_facturacion'
  union all
  select 'C12', (select count(*) from information_schema.columns where table_schema = 'public'
                  and ((table_name = 'contrato_facturacion' and column_name in ('asiento_factura_id', 'revision_id'))
                    or (table_name = 'abonos' and column_name in ('contabilizable', 'rev')))) = 4,
         'Columnas nuevas: contrato_facturacion.asiento_factura_id/revision_id y abonos.contabilizable/rev'
  union all
  select 'C13', (select count(*) from f208_priv.corte) = 1
           and coalesce((select max(id) from public.abonos where contabilizable is null), 0) <= (select ultimo_abono_id from f208_priv.corte),
         'Corte registrado (los abonos históricos quedan antes): ' || coalesce((select ultimo_abono_id || ' · ' || instalado_en from f208_priv.corte), 'falta')
  union all
  select 'C14', has_function_privilege('authenticated', 'public.f208_discrepancias_fuera_libros()', 'execute')
           and not has_function_privilege('anon', 'public.f208_discrepancias_fuera_libros()', 'execute'),
         'Consulta de discrepancias: authenticated sí (filtra rol/agencia dentro), anon no'
  union all
  select 'C15', coalesce((select not (cfg ~ 'f208_priv') from (select array_to_string(rolconfig, ',') cfg from pg_roles where rolname = 'authenticator') z), true),
         'authenticator no expone f208_priv en pgrst.db_schemas (si está en rolconfig): '
         || coalesce((select array_to_string(rolconfig, ',') from pg_roles where rolname = 'authenticator'), 'sin rolconfig; revisar panel')
  union all
  -- pg_graphql refleja los esquemas del search_path: f208_priv nunca debe estar en él.
  select 'C16', not exists (select 1 from pg_db_role_setting s where array_to_string(s.setconfig, ',') ~ 'search_path=[^,]*f208_priv')
           and not exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
                             and array_to_string(r.rolconfig, ',') ~ 'search_path=[^,]*f208_priv'),
         'Ningún rol ni base pone f208_priv en su search_path (pg_graphql no refleja los helpers)'
)
select codigo, ok, detalle from (
  select codigo, ok, detalle, 0 as o from c
  union all
  select 'VEREDICTO', bool_and(ok), case when bool_and(ok) then 'POSTCHECK 208: OK' else 'POSTCHECK 208: HAY FALLAS' end, 1 from c
) z order by o, length(codigo), codigo;

rollback;
