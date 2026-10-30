-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 219 · personas de cotizaciones en el CRM (#42). SOLO LECTURA (read only + ROLLBACK).
-- Correr DESPUÉS de aplicar la 219. Devuelve UNA sola fila consolidada (formato de la 214):
--   veredicto   OK solo si las 20 verificaciones (C1-C20) dan true; si no, FALLA.
--   ok / fallos / chequeos   conteos (esperado: 20 / 0 / 20). Un resultado nulo cuenta como falla.
--   fallidos    códigos que fallaron, o 'ninguno'.
--   resumen     C1=t;C2=t;...;C20=t  (todas, en orden; t = pasa, f = falla).
--   filas       C18 (informativa, siempre true): capturas de cotización, puestos y el MONITOR de C7:
--               cotizaciones abiertas creadas desde la 219 con titular identificado y SIN puesto
--               (debe ser 0, o tener un "Reintentar" pendiente en su ficha).
--   detalle     jsonb con cada verificación: codigo, ok y su explicación.
-- No lee datos personales: solo catálogo y conteos.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
pc as (select to_regclass('public.persona_capturas') as oid),
cp as (select to_regclass('public.cotizacion_participantes') as oid),
nuevas(firma) as (
  values ('p214_priv.validar_entrada_captura(uuid,text,text,text,text,text,bigint,bigint,uuid,text)'),
         ('p214_priv.captura_coincide(uuid,uuid,text,text,text,text,text,text,bigint,jsonb,bigint,uuid,text)'),
         ('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text,bigint,uuid,text)'),
         ('p214_priv.captura_visible(uuid,text,text,text,text,bigint,text,text,uuid)')
),
viejas(firma) as (
  values ('p214_priv.validar_entrada_captura(uuid,text,text,text,text,text,bigint)'),
         ('p214_priv.captura_coincide(uuid,uuid,text,text,text,text,text,text,bigint,jsonb)'),
         ('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text)'),
         ('p214_priv.captura_visible(text,text,text,text,text)')
),
escritoras(firma) as (
  values ('p214_priv.norm_documento(text,text,boolean,text)'),
         ('p214_priv.dv_nit_valido(text)'),
         ('p214_priv.exigir_read_committed()'),
         ('p214_priv.validar_entrada_captura(uuid,text,text,text,text,text,bigint,bigint,uuid,text)'),
         ('p214_priv.observaciones_de_entrada(jsonb)'),
         ('p214_priv.carga_esperada(jsonb,text)'),
         ('p214_priv.marca_nit(text,text,text)'),
         ('p214_priv.captura_coincide(uuid,uuid,text,text,text,text,text,text,bigint,jsonb,bigint,uuid,text)'),
         ('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text,bigint,uuid,text)'),
         ('p214_priv.promover_persona(uuid,uuid,text,text,text,jsonb,text,text,bigint,uuid,text)')
),
fachadas(firma) as (
  values ('public.registrar_personas_cotizacion(bigint,uuid,jsonb)'),
         ('public.actualizar_titular_cotizacion(bigint,uuid,jsonb,integer,uuid)'),
         ('public.sellar_creador_cotizacion(bigint,uuid)')
),
lista as (select to_regprocedure('public.crm_personas_cotizacion_buscar(text,text,integer,integer)') as oid),
consulta as (select to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') as oid),
dueno as (select pg_get_userbyid(c.relowner) as rol from pg_class c where c.oid = to_regclass('public.personas')),
funcs_priv as (
  select p.oid, p.proname, p.proconfig, p.prosrc from pg_proc p where p.pronamespace = to_regnamespace('p214_priv')
),
publicas_219 as (
  select p.oid, p.prosrc, p.proconfig, p.prosecdef, p.provolatile, p.proowner
    from pg_proc p
   where p.oid in (select to_regprocedure(f.firma) from fachadas f) or p.oid = (select oid from lista)
),
chequeos as (
  select 'C1' as codigo,
         (select count(*) from (values ('cotizacion_id', 'bigint'), ('participante_ref', 'uuid'), ('rol', 'text')) e(col, tipo)
            join pg_attribute a on a.attrelid = (select oid from pc) and a.attname = e.col
             and a.attnum > 0 and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = e.tipo) = 3 as ok,
         'persona_capturas: columnas de origen cotizacion_id (bigint), participante_ref (uuid) y rol (text)' as detalle
  union all
  select 'C2',
         coalesce((select pg_get_constraintdef(c.oid) like '%cotizacion%' and pg_get_constraintdef(c.oid) like '%participante_ref IS NOT NULL%'
                     from pg_constraint c where c.conrelid = (select oid from pc) and c.conname = 'persona_capturas_fuente_ck'), false)
         and coalesce((select pg_get_constraintdef(c.oid) like '%pasajero_cotizacion%'
                          from pg_constraint c where c.conrelid = (select oid from pc) and c.conname = 'persona_capturas_nivel_ck'), false)
         and coalesce((select pg_get_constraintdef(c.oid) like '%cotizacion%'
                          from pg_constraint c where c.conrelid = (select oid from pc) and c.conname = 'persona_capturas_fuente_check'), false)
         and coalesce((select pg_get_constraintdef(c.oid) like '%pasajero_cotizacion%'
                          from pg_constraint c where c.conrelid = (select oid from pc) and c.conname = 'persona_capturas_nivel_check'), false),
         'CHECK de fuente de tres disyuntos y de nivel con pasajero_cotizacion (N2), con los nombres de la 214'
  union all
  select 'C3',
         exists (select 1 from pg_constraint c where c.conrelid = (select oid from pc) and c.conname = 'persona_capturas_puesto_uk' and c.contype = 'u'),
         'persona_capturas_puesto_uk: destino único de la FK compuesta del vínculo'
  union all
  select 'C4',
         coalesce((select c.relrowsecurity from pg_class c where c.oid = (select oid from cp)), false)
         and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cotizacion_participantes'),
         'cotizacion_participantes existe con RLS activa y SIN policies'
  union all
  select 'C5',
         exists (select 1 from pg_constraint c where c.conrelid = (select oid from cp) and c.conname = 'cotizacion_participantes_cotizacion_fk'
                  and c.contype = 'f' and c.confrelid = 'public.cotizaciones'::regclass and c.confdeltype = 'r')
         and exists (select 1 from pg_constraint c where c.conrelid = (select oid from cp) and c.conname = 'cotizacion_participantes_captura_fk'
                      and c.contype = 'f' and c.confrelid = (select oid from pc) and array_length(c.conkey, 1) = 6),
         'FK (cotizacion_id, tenant) -> cotizaciones ON DELETE RESTRICT y FK compuesta de 6 columnas -> persona_capturas'
  union all
  select 'C6',
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_cotizacion_participantes_titular_activo'
                  and indexdef ilike '%unique%(cotizacion_id)%where%titular%activo%'),
         'Un solo titular activo por cotización (índice único parcial)'
  union all
  select 'C7',
         (select count(*) from pg_trigger t where t.tgrelid = (select oid from cp) and not t.tgisinternal
            and t.tgname in ('trg_cotizacion_participantes_guardas', 'trg_cotizacion_participantes_sin_borrado',
                             'trg_cotizacion_participantes_sin_truncate')) = 3
         and not exists (select 1 from pg_trigger t where t.tgrelid = (select oid from cp) and t.tgname = 'trg_auditoria'),
         'cotizacion_participantes: disparadores de inmutabilidad/versión, sin borrado ni truncate; SIN trg_auditoria (regla 214)'
  union all
  select 'C8',
         (select oid from cp) is not null
         and not exists (select 1 from (values ('anon'), ('authenticated'), ('public')) r(rol),
                           (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger')) p(priv)
                          where coalesce(has_table_privilege(r.rol, (select oid from cp), p.priv), true))
         and coalesce(has_table_privilege('service_role', (select oid from cp), 'select,insert,update')
                      and not has_table_privilege('service_role', (select oid from cp), 'delete')
                      and not has_table_privilege('service_role', (select oid from cp), 'truncate'), false),
         'cotizacion_participantes: nada para anon/authenticated/PUBLIC; service_role select/insert/update, sin delete ni truncate'
  union all
  select 'C9',
         (select count(*) from nuevas n where to_regprocedure(n.firma) is not null) = 4
         and (select count(*) from viejas v where to_regprocedure(v.firma) is not null) = 0,
         'Escritores generalizados y captura_visible con firma nueva; las firmas de la 214 ya no existen (sin ambigüedad)'
  union all
  select 'C10',
         (select count(*) from fachadas f join pg_proc p on p.oid = to_regprocedure(f.firma)
           where p.prosecdef and p.proconfig @> array['search_path=pg_catalog, pg_temp']
             and pg_get_userbyid(p.proowner) = (select rol from dueno)
             and has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('public', p.oid, 'execute')) = 3,
         'Las tres fachadas de escritura: SECURITY DEFINER, search_path fijo, dueño = dueño de personas, EXECUTE solo service_role'
  union all
  select 'C11',
         coalesce((select p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=pg_catalog, pg_temp']
                     and has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute')
                     and not has_function_privilege('service_role', p.oid, 'execute')
                     and not has_function_privilege('public', p.oid, 'execute')
                     from pg_proc p where p.oid = (select oid from lista)), false),
         'crm_personas_cotizacion_buscar: SECURITY DEFINER, STABLE, search_path fijo, EXECUTE solo authenticated'
  union all
  select 'C12',
         coalesce((select p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute')
                     and not has_function_privilege('service_role', p.oid, 'execute')
                     and p.prosrc like '%p214_priv.captura_visible(c.id, c.tenant, c.fuente, c.nivel%'
                     and p.prosrc like '%''superadmin'', ''gerencia'', ''administracion'', ''operaciones'', ''venta''%'
                     and p.prosrc not like '%agencia%'
                     from pg_proc p where p.oid = (select oid from consulta)), false),
         'buscar_personas_documento: misma firma y ACL, usa el filtro único nuevo y sigue cerrada a B2B'
  union all
  select 'C13',
         to_regnamespace('p214_priv') is not null
         and not exists (select 1 from funcs_priv f, (values ('anon'), ('authenticated'), ('public')) r(rol)
                          where has_function_privilege(r.rol, f.oid, 'execute'))
         and (select count(*) from escritoras e where coalesce(has_function_privilege('service_role', to_regprocedure(e.firma), 'execute'), false)) = 10
         and not exists (select 1 from funcs_priv f
                          where has_function_privilege('service_role', f.oid, 'execute')
                            and f.oid not in (select to_regprocedure(e.firma) from escritoras e)),
         'p214_priv: nada para anon/authenticated/PUBLIC; service_role ejecuta SOLO las 10 de gramática y escritura (con las firmas nuevas)'
  union all
  select 'C14',
         not exists (select 1 from funcs_priv f where not coalesce(f.proconfig @> array['search_path=pg_catalog, pg_temp'], false))
         and not exists (select 1 from publicas_219 p where not coalesce(p.proconfig @> array['search_path=pg_catalog, pg_temp'], false)),
         'Toda función de p214_priv y las cuatro RPC públicas de la 219 fijan search_path = pg_catalog, pg_temp'
  union all
  select 'C15',
         has_schema_privilege('service_role', to_regnamespace('p214_priv'), 'usage')
         and not has_schema_privilege('anon', to_regnamespace('p214_priv'), 'usage')
         and not has_schema_privilege('authenticated', to_regnamespace('p214_priv'), 'usage')
         and not exists (select 1 from pg_namespace where nspname like 'p219%'),
         'Sin esquema nuevo: p214_priv con USAGE solo para service_role (nada nuevo que vigilar en Exposed schemas)'
  union all
  select 'C16',
         to_regclass('p214_priv.r219_foto_214') is not null
         and coalesce((xpath('/row/c/text()', query_to_xml(
               case when to_regclass('p214_priv.r219_foto_214') is null then 'select 0 as c'
                    else 'select count(*) as c from p214_priv.r219_foto_214' end, false, true, '')))[1]::text = '9', false)
         and coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('p214_priv.r219_foto_214')), false)
         and not coalesce(has_table_privilege('service_role', to_regclass('p214_priv.r219_foto_214'), 'select'), true),
         'Foto de las 9 definiciones de la 214 que cambió (5 funciones, 4 restricciones), cerrada a todos los roles de API: la usa el rollback'
  union all
  select 'C17',
         not exists (select 1 from pg_proc p
                      where (p.pronamespace = to_regnamespace('p214_priv') or p.oid = (select oid from consulta) or p.oid = (select oid from lista))
                        and (p.prosrc ~* '\m(upper|lower|normalize)\s*\('
                             or p.prosrc ~* '\m[blr]?trim\s*\([^,()]*\)'
                             or strpos(p.prosrc, '[[:') > 0)),
         'Gramática solo ASCII también en lo nuevo: ni upper/lower/normalize, ni trim sin segundo argumento, ni clases POSIX'
  union all
  select 'C19',
         coalesce((select (r.rolsuper or r.rolbypassrls)
                     or (pg_get_userbyid((select relowner from pg_class where oid = 'public.usuarios'::regclass)) = r.rolname
                         and pg_get_userbyid((select relowner from pg_class where oid = 'public.cotizaciones'::regclass)) = r.rolname
                         and pg_get_userbyid((select relowner from pg_class where oid = 'public.ventas'::regclass)) = r.rolname)
                     from pg_roles r where r.rolname = (select rol from dueno)), false),
         'El dueño de las fachadas lee usuarios, cotizaciones y ventas sin RLS (si no, devolverían vacío o rechazarían a todos)'
  union all
  select 'C20',
         (select count(*) from pg_trigger t
           where t.tgrelid in (to_regclass('public.personas'), to_regclass('public.persona_capturas'), to_regclass('public.persona_observaciones'))
             and not t.tgisinternal) = 9
         and not exists (select 1 from pg_trigger t
                          where t.tgrelid in (to_regclass('public.personas'), to_regclass('public.persona_capturas'),
                                              to_regclass('public.persona_observaciones'), (select oid from cp))
                            and t.tgname = 'trg_auditoria'),
         'Las tablas de la 214 conservan solo sus nueve disparadores; ninguna tabla de personas lleva trg_auditoria'
  union all
  select 'C18', true,
         'Filas: capturas_cotizacion=' || coalesce((xpath('/row/c/text()', query_to_xml(
             case when (select oid from cp) is null then 'select ''n/a'' as c'
                  else 'select count(*) as c from public.persona_capturas where fuente = ''cotizacion''' end, false, true, '')))[1]::text, 'n/a')
         || ' · puestos=' || coalesce((xpath('/row/c/text()', query_to_xml(
             case when (select oid from cp) is null then 'select ''n/a'' as c'
                  else 'select count(*) as c from public.cotizacion_participantes' end, false, true, '')))[1]::text, 'n/a')
         || ' · monitor_sin_puesto=' || coalesce((xpath('/row/c/text()', query_to_xml(
             case when (select oid from cp) is null or to_regclass('p214_priv.r219_foto_214') is null then 'select ''n/a'' as c'
                  else 'select count(*) as c from public.cotizaciones q
                         where q.estado = ''abierta''
                           and q.created_at >= (select min(f.tomada_en) from p214_priv.r219_foto_214 f)
                           and jsonb_typeof(q.payload -> ''cliente'') = ''object''
                           and (coalesce(btrim(q.payload #>> ''{cliente,numeroDoc}'', '' ''), '''') <> ''''
                                or coalesce(btrim(q.payload #>> ''{cliente,nombres}'', '' ''), '''') <> ''''
                                or coalesce(btrim(q.payload #>> ''{cliente,apellidos}'', '' ''), '''') <> '''')
                           and not exists (select 1 from public.cotizacion_participantes x
                                            where x.cotizacion_id = q.id and x.rol = ''titular'' and x.activo)' end,
             false, true, '')))[1]::text, 'n/a')
         || ' (recién aplicada: 0 · 0 · 0; la 219 no hace backfill)'
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
