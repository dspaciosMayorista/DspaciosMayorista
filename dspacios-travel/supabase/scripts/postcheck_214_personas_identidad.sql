-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 214 · registro central de personas (#32). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 214. Devuelve UNA sola fila consolidada:
--   veredicto   OK solo si las 20 verificaciones (C1-C20) dan true; si no, FALLA.
--   ok / fallos / chequeos   conteos (esperado: 20 / 0 / 20). Un resultado nulo cuenta como falla.
--   fallidos    códigos que fallaron, o 'ninguno'.
--   resumen     C1=t;C2=t;...;C20=t  (todas, en orden; t = pasa, f = falla).
--   filas       conteos de C18 (informativa, siempre true): personas, capturas y observaciones.
--   detalle     jsonb con cada verificación: codigo, ok y su explicación.
-- No lee datos personales: solo catálogo y conteos. Si la 214 no está aplicada, las verificaciones
-- salen en false (el script no falla).
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
tablas(nombre) as (values ('public.personas'), ('public.persona_capturas'), ('public.persona_observaciones')),
rpc as (select to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') as oid),
escritoras(firma) as (
  values ('p214_priv.norm_documento(text,text,boolean,text)'),
         ('p214_priv.dv_nit_valido(text)'),
         ('p214_priv.exigir_read_committed()'),
         ('p214_priv.validar_entrada_captura(uuid,text,text,text,text,text,bigint)'),
         ('p214_priv.observaciones_de_entrada(jsonb)'),
         ('p214_priv.carga_esperada(jsonb,text)'),
         ('p214_priv.marca_nit(text,text,text)'),
         ('p214_priv.captura_coincide(uuid,uuid,text,text,text,text,text,text,bigint,jsonb)'),
         ('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text)'),
         ('p214_priv.promover_persona(uuid,uuid,text,text,text,jsonb,text,text,bigint,uuid,text)')
),
internas(firma) as (
  values ('p214_priv.captura_visible(text,text,text,text,text)'),
         ('p214_priv.trg_personas_guardas()'),
         ('p214_priv.trg_solo_insercion()'),
         ('p214_priv.trg_captura_contrato_pasajero()'),
         ('p214_priv.trg_personas_nit_dv_observado()')
),
funcs_priv as (
  select p.oid, p.proname, p.proconfig, p.prosrc
    from pg_proc p
   where p.pronamespace = to_regnamespace('p214_priv')
),
restricciones(nombre) as (
  values ('personas_id_tenant_uk'), ('personas_nit_dv_estructurado_ck'),
         ('persona_capturas_persona_fk'), ('persona_capturas_id_persona_tenant_uk'),
         ('persona_capturas_fuente_ck'), ('persona_capturas_nivel_ck'), ('persona_capturas_contrato_numero_ck'),
         ('persona_observaciones_captura_fk'), ('persona_observaciones_nit_dv_ck'), ('persona_observaciones_idem_uk')
),
obligatorias(tabla, columna) as (
  values ('personas', 'tenant'), ('personas', 'nit_dv_estructurado'),
         ('persona_capturas', 'persona_id'), ('persona_capturas', 'tenant'), ('persona_capturas', 'fuente'),
         ('persona_capturas', 'nivel'), ('persona_capturas', 'created_at'),
         ('persona_observaciones', 'captura_id'), ('persona_observaciones', 'persona_id'),
         ('persona_observaciones', 'tenant'), ('persona_observaciones', 'campo'),
         ('persona_observaciones', 'valor'), ('persona_observaciones', 'created_at')
),
disparadores(tabla, nombre) as (
  values ('public.personas', 'trg_personas_guardas'), ('public.personas', 'trg_personas_sin_borrado'),
         ('public.personas', 'trg_personas_sin_truncate'), ('public.personas', 'personas_nit_dv_observado'),
         ('public.persona_capturas', 'trg_persona_capturas_contrato'),
         ('public.persona_capturas', 'trg_persona_capturas_solo_insercion'),
         ('public.persona_capturas', 'trg_persona_capturas_sin_truncate'),
         ('public.persona_observaciones', 'trg_persona_observaciones_solo_insercion'),
         ('public.persona_observaciones', 'trg_persona_observaciones_sin_truncate')
),
dueno as (select pg_get_userbyid(c.relowner) as rol from pg_class c where c.oid = to_regclass('public.personas')),
chequeos as (
  select 'C1' as codigo,
         coalesce(to_regnamespace('p214_priv') is not null
           and has_schema_privilege('service_role', to_regnamespace('p214_priv'), 'usage')
           and not has_schema_privilege('anon', to_regnamespace('p214_priv'), 'usage')
           and not has_schema_privilege('authenticated', to_regnamespace('p214_priv'), 'usage')
           and not has_schema_privilege('public', to_regnamespace('p214_priv'), 'usage'), false) as ok,
         'Esquema p214_priv: USAGE solo para service_role (ni anon, ni authenticated, ni PUBLIC)' as detalle
  union all
  select 'C2', (select count(*) from tablas t where to_regclass(t.nombre) is not null) = 3,
         'Tablas personas, persona_capturas y persona_observaciones presentes'
  union all
  select 'C3',
         (select count(*) from tablas t join pg_class c on c.oid = to_regclass(t.nombre) where c.relrowsecurity) = 3
         and not exists (select 1 from pg_policies where schemaname = 'public'
                          and tablename in ('personas', 'persona_capturas', 'persona_observaciones')),
         'RLS activa en las tres y SIN policies (ningún rol de API las lee directo)'
  union all
  select 'C4',
         (select count(*) from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
           where a.attrelid = to_regclass('public.personas') and a.attgenerated = 's'
             and a.attname in ('tipo_doc', 'numero_norm', 'estado_doc', 'motivo_revision')
             and pg_get_expr(d.adbin, d.adrelid) like '%norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, %alta%') = 4,
         'Cuatro generadas STORED calculadas desde columnas base (tipo_doc_original, documento_original, nit_dv_estructurado)'
  union all
  select 'C5',
         (select count(*) from restricciones r join pg_constraint c on c.conname = r.nombre
           where c.conrelid in (to_regclass('public.personas'), to_regclass('public.persona_capturas'), to_regclass('public.persona_observaciones'))) = 10,
         'Diez restricciones con nombre (UNIQUE, CHECK nulo-seguros y FK compuestas)'
  union all
  select 'C6',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_personas_clave_documentada'
                  and indexdef ilike '%unique%(tenant, tipo_doc, numero_norm)%where%estado_doc = %documentada%')
         and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_personas_clave_alta'
                  and indexdef ilike '%unique%(tenant, clave_alta)%where%clave_alta is not null%'),
         'Índices únicos parciales: clave documentada y clave de alta'
  union all
  select 'C7',
         (select count(*) from obligatorias o join pg_catalog.pg_attribute a
            on a.attrelid = to_regclass('public.' || o.tabla) and a.attname = o.columna
           and a.attnum > 0 and not a.attisdropped and a.attnotnull) = 13,
         'Columnas obligatorias NOT NULL (fuente, nivel, campo, valor, ids, tenant, fechas)'
  union all
  select 'C8',
         (select count(*) from disparadores d join pg_trigger t on t.tgrelid = to_regclass(d.tabla) and t.tgname = d.nombre
           where not t.tgisinternal or t.tgconstraint <> 0) = 9
         and exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.personas')
                      and t.tgname = 'personas_nit_dv_observado' and t.tgdeferrable and t.tginitdeferred),
         'Nueve disparadores (inmutabilidad, append-only, contrato del pasajero) y el diferido nit_dv'
  union all
  select 'C9',
         not exists (select 1 from tablas t, (values ('anon'), ('authenticated'), ('public')) r(rol),
                       (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
                      where coalesce(has_table_privilege(r.rol, to_regclass(t.nombre), p.priv), true))
         and (select count(*) from tablas t where to_regclass(t.nombre) is not null) = 3,
         'anon, authenticated y PUBLIC sin ningún privilegio sobre las tres tablas'
  union all
  select 'C10',
         coalesce(has_table_privilege('service_role', to_regclass('public.personas'), 'select,insert,update')
           and not has_table_privilege('service_role', to_regclass('public.personas'), 'delete')
           and not has_table_privilege('service_role', to_regclass('public.personas'), 'truncate')
           and has_table_privilege('service_role', to_regclass('public.persona_capturas'), 'select,insert')
           and not has_table_privilege('service_role', to_regclass('public.persona_capturas'), 'update')
           and not has_table_privilege('service_role', to_regclass('public.persona_capturas'), 'delete')
           and not has_table_privilege('service_role', to_regclass('public.persona_capturas'), 'truncate')
           and has_table_privilege('service_role', to_regclass('public.persona_observaciones'), 'select,insert')
           and not has_table_privilege('service_role', to_regclass('public.persona_observaciones'), 'update')
           and not has_table_privilege('service_role', to_regclass('public.persona_observaciones'), 'delete')
           and not has_table_privilege('service_role', to_regclass('public.persona_observaciones'), 'truncate'), false),
         'service_role: personas select/insert/update; capturas y observaciones select/insert; nunca delete ni truncate'
  union all
  select 'C11',
         coalesce((select has_function_privilege('authenticated', r.oid, 'execute')
                     and not has_function_privilege('anon', r.oid, 'execute')
                     and not has_function_privilege('service_role', r.oid, 'execute')
                     and not has_function_privilege('public', r.oid, 'execute') from rpc r), false),
         'buscar_personas_documento: EXECUTE solo para authenticated'
  union all
  select 'C12',
         coalesce((select p.prosecdef and p.provolatile = 's'
                     and p.proconfig @> array['search_path=pg_catalog, pg_temp']
                     from pg_proc p, rpc r where p.oid = r.oid), false),
         'buscar_personas_documento: SECURITY DEFINER, STABLE y search_path = pg_catalog, pg_temp'
  union all
  select 'C13',
         coalesce((select pg_get_userbyid(p.proowner) = (select rol from dueno)
                     and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated', 'service_role', 'authenticator')
                     from pg_proc p, rpc r where p.oid = r.oid), false),
         'Dueño de la consulta = dueño de las tablas, y no es un rol de API'
  union all
  select 'C14',
         coalesce((select (r.rolsuper or r.rolbypassrls)
                     or (pg_get_userbyid((select relowner from pg_class where oid = 'public.usuarios'::regclass)) = r.rolname
                         and pg_get_userbyid((select relowner from pg_class where oid = 'public.ventas'::regclass)) = r.rolname)
                     from pg_roles r where r.rolname = (select rol from dueno)), false),
         'El dueño lee usuarios y ventas sin RLS (si no, la consulta devolvería vacío a todos)'
  union all
  select 'C15',
         to_regnamespace('p214_priv') is not null
         and not exists (select 1 from funcs_priv f, (values ('anon'), ('authenticated'), ('public')) r(rol)
                          where has_function_privilege(r.rol, f.oid, 'execute'))
         and (select count(*) from escritoras e where coalesce(has_function_privilege('service_role', to_regprocedure(e.firma), 'execute'), false)) = 10
         and (select count(*) from internas i where to_regprocedure(i.firma) is not null
                and not has_function_privilege('service_role', to_regprocedure(i.firma), 'execute')) = 5,
         'p214_priv: ninguna función para anon/authenticated/PUBLIC; service_role ejecuta las 10 de gramática y escritura, no las 5 internas'
  union all
  select 'C16',
         to_regnamespace('p214_priv') is not null
         and (select count(*) from funcs_priv) = 15
         and not exists (select 1 from funcs_priv f where not coalesce(f.proconfig @> array['search_path=pg_catalog, pg_temp'], false)),
         'Las 15 funciones de p214_priv fijan search_path = pg_catalog, pg_temp'
  union all
  select 'C17',
         coalesce((select p.prosrc not like '%soy_asesor_del_contrato%' and p.prosrc not like '%mi_rol(%'
                     and p.prosrc not like '%mi_tenant(%' and p.prosrc not like '%puede_ver_tenant%'
                     from pg_proc p, rpc r where p.oid = r.oid), false)
         and exists (select 1 from funcs_priv f where f.proname = 'captura_visible'
                      and f.prosrc like '%soy_ese_asesor(v.asesor)%' and f.prosrc not like '%soy_asesor_del_contrato%'),
         'La consulta no usa mi_rol/mi_tenant/puede_ver_tenant/soy_asesor_del_contrato; el asesor se compara en la misma fila (v.asesor)'
  union all
  select 'C19',
         to_regnamespace('p214_priv') is not null and (select oid from rpc) is not null
         and not exists (select 1 from pg_proc p
                          where (p.pronamespace = to_regnamespace('p214_priv') or p.oid in (select oid from rpc))
                            and (p.prosrc ~* '\m(upper|lower|normalize)\s*\('
                                 or p.prosrc ~* '\m[blr]?trim\s*\([^,()]*\)'
                                 or strpos(p.prosrc, '[[:') > 0)),
         'Gramática solo ASCII: ninguna función de p214_priv ni la consulta usa upper/lower/normalize, trim sin segundo argumento ni clases POSIX'
  union all
  select 'C20',
         (select count(*) from pg_trigger t
           where t.tgrelid in (to_regclass('public.personas'), to_regclass('public.persona_capturas'), to_regclass('public.persona_observaciones'))
             and not t.tgisinternal) = 9
         and not exists (select 1 from pg_trigger t
                          where t.tgrelid in (to_regclass('public.personas'), to_regclass('public.persona_capturas'), to_regclass('public.persona_observaciones'))
                            and t.tgname = 'trg_auditoria'),
         'Solo los nueve disparadores propios en las tres tablas; ninguno ajeno (trg_auditoria de la 087 copiaría PII a auditoria)'
  union all
  select 'C18', true,
         'Filas: personas=' || coalesce((xpath('/row/c/text()', query_to_xml(
             case when to_regclass('public.personas') is null then 'select ''n/a'' as c'
                  else 'select count(*) as c from public.personas' end, false, true, '')))[1]::text, 'n/a')
         || ' · capturas=' || coalesce((xpath('/row/c/text()', query_to_xml(
             case when to_regclass('public.persona_capturas') is null then 'select ''n/a'' as c'
                  else 'select count(*) as c from public.persona_capturas' end, false, true, '')))[1]::text, 'n/a')
         || ' · observaciones=' || coalesce((xpath('/row/c/text()', query_to_xml(
             case when to_regclass('public.persona_observaciones') is null then 'select ''n/a'' as c'
                  else 'select count(*) as c from public.persona_observaciones' end, false, true, '')))[1]::text, 'n/a')
         || ' (recién aplicada: 0/0/0; la 214 no importa históricos)'
),
orden as (
  select c.codigo, coalesce(c.ok, false) as ok, c.detalle, row_number() over (order by length(c.codigo), c.codigo) as n
    from chequeos c
)
select case when count(*) = 20 and count(*) filter (where not o.ok) = 0 then 'OK' else 'FALLA' end as veredicto,
       count(*) filter (where o.ok)::int as ok,
       count(*) filter (where not o.ok)::int as fallos,
       count(*)::int as chequeos,
       coalesce(string_agg(o.codigo, ',' order by o.n) filter (where not o.ok), 'ninguno') as fallidos,
       string_agg(o.codigo || '=' || case when o.ok then 't' else 'f' end, ';' order by o.n) as resumen,
       max(o.detalle) filter (where o.codigo = 'C18') as filas,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'ok', o.ok, 'detalle', o.detalle) order by o.n) as detalle
  from orden o;

rollback;
