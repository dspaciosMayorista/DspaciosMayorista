-- POSTCHECK integral de la migración 237 (#5 D8/D9). SOLO LECTURA: una consulta, un resultado.
-- Pegar COMPLETO en el editor SQL de Supabase y ejecutar UNA vez DESPUÉS de aplicar la 237.
-- Cada fila: control · observado · esperado · estado. La última fila es el veredicto.
--
-- Corre como postgres (sin JWT): por eso puede comprobar que, SIN sesión, la base niega la
-- escritura de catálogos (falla cerrado). El comportamiento por usuario/agencia (superadmin en
-- Mayorista vs Minorista, logout, usuario desactivado) se valida con el recorrido manual de
-- docs/tecnico/catalogos-globales-permisos.md §6, que no puede hacerse desde el editor SQL.
with
reg(t) as (
  select unnest(array['aliados','asesores','formas_pago','rangos_edad','parametros_tributarios',
    'destinos','hoteles','hotel_acomodaciones','hotel_blackouts','hotel_calculadora','hotel_categorias',
    'hotel_documentos','hotel_fotos','hotel_regimenes','hotel_temporadas','hotel_tarifas_unidad',
    'tarifa_hotel','categorias_habitacion','planes_alimentacion','aerolineas','aerolinea_tarifas',
    'proveedores','proveedores_datos_sensibles','servicios_adicionales','servicio_tarifa_pax',
    'servicio_temporadas'])
),
filas as (
  select 1 as n, 'Catálogos con exactamente 3 policies restrictivas (insert/update/delete)' as control,
         (select count(*)::text from reg r
           where (select count(*) from pg_policy p
                   where p.polrelid = to_regclass('public.' || r.t) and not p.polpermissive
                     and p.polname like 'catalogo global:%') = 3) as observado,
         '26' as esperado
  union all
  select 2, 'Policies restrictivas con la expresión de la guarda (puede_escribir_catalogo_global)',
         (select count(*)::text from pg_policy p join reg r on p.polrelid = to_regclass('public.' || r.t)
           where not p.polpermissive and p.polname like 'catalogo global:%'
             and coalesce(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) like '%puede_escribir_catalogo_global()%'),
         '78'
  union all
  select 3, 'Policies permisivas sobre el registro (sin cambio respecto del preflight)',
         (select count(*)::text from pg_policy p join reg r on p.polrelid = to_regclass('public.' || r.t) where p.polpermissive),
         '47'
  union all
  select 4, 'Policies "catalogo global" FUERA del registro (ventas, sillas, CxP, contratos intactos)',
         (select count(*)::text from pg_policy where polname like 'catalogo global:%'
            and polrelid not in (select to_regclass('public.' || t) from reg)),
         '0'
  union all
  select 5, 'Tablas de contexto con RLS activa y FORZADA',
         (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace
            and relname in ('sesion_agencia','sesion_agencia_inicio') and relrowsecurity and relforcerowsecurity),
         '2'
  union all
  select 6, 'anon/authenticated con CUALQUIER privilegio sobre las tablas de contexto',
         (select count(*)::text from (values ('anon'),('authenticated')) r(rol), (values ('sesion_agencia'),('sesion_agencia_inicio')) t(tb)
           where has_table_privilege(r.rol, 'public.' || t.tb, 'select,insert,update,delete,truncate,references,trigger')),
         '0'
  union all
  select 7, 'RPC de contexto ejecutables por anon/authenticated',
         (select count(*)::text from (values ('anon'),('authenticated')) r(rol),
                 (values ('public.iniciar_contexto_agencia(uuid,text,interval)'),('public.cambiar_contexto_agencia(uuid,text)')) f(fx)
           where has_function_privilege(r.rol, f.fx, 'execute')),
         '0'
  union all
  select 8, 'RPC de contexto ejecutables por service_role',
         (select count(*)::text from (values ('public.iniciar_contexto_agencia(uuid,text,interval)'),('public.cambiar_contexto_agencia(uuid,text)')) f(fx)
           where has_function_privilege('service_role', f.fx, 'execute')),
         '2'
  union all
  select 9, 'Funciones SECURITY DEFINER de catálogo con la guarda dentro',
         (select count(*)::text from pg_proc
           where pronamespace = 'public'::regnamespace
             and proname in ('fn_fusionar_destino','generar_tarifas_hotel_calculadora','reemplazar_tarifas_hotel_calculadora','aprobar_solicitud_b2b')
             and prosecdef and prosrc like '%puede_escribir_catalogo_global()%'),
         '4'
  union all
  select 10, 'Funciones de la guarda legibles por la sesión (authenticated puede ejecutarlas)',
         (select count(*)::text from (values ('public.puede_escribir_catalogo_global()'),('public.agencia_activa_sesion()')) f(fx)
           where has_function_privilege('authenticated', f.fx, 'execute')),
         '2'
  union all
  select 11, 'Sin sesión (editor SQL, sin JWT) puede_escribir_catalogo_global() = false (falla cerrado)',
         (select public.puede_escribir_catalogo_global()::text),
         'false'
  union all
  select 12, 'Sin sesión agencia_activa_sesion() es NULL',
         (select coalesce(public.agencia_activa_sesion(), 'NULL')),
         'NULL'
  union all
  select 13, 'Trigger que invalida el contexto al cambiar rol/estado/agencia del usuario',
         (select count(*)::text from pg_trigger where tgname = 'usuarios_invalidar_contexto_agencia' and not tgisinternal),
         '1'
  union all
  select 14, 'El registro de la base coincide con la lista de 26 catálogos',
         (select cardinality(public.catalogos_globales_registro())::text),
         '26'
  union all
  select 15, 'Filas de contexto/inicio tras aplicar (0 hasta que alguien inicie sesión)',
         ((select count(*) from public.sesion_agencia) || ' / ' || (select count(*) from public.sesion_agencia_inicio)),
         'informativo'
  union all
  select 17, 'Respaldo exacto de las 4 funciones previas (filas) y cerrado a roles de cliente',
         (select count(*)::text from public.catalogos_funciones_previas_237)
           || ' / cliente=' || (has_table_privilege('authenticated', 'public.catalogos_funciones_previas_237', 'select')
                                 or has_table_privilege('anon', 'public.catalogos_funciones_previas_237', 'select'))::text,
         '4 / cliente=false'
  union all
  select 16, 'Sesiones de Auth con created_at/not_after legibles (la función de agencia depende de auth.sessions)',
         (select (count(*) >= 0)::text from auth.sessions limit 1),
         'true'
),
evaluadas as (
  select n, control, observado, esperado,
         case when esperado = 'informativo' then 'INFO'
              when observado = esperado then 'OK' else 'REVISAR' end as estado
  from filas
)
select control, observado, esperado, estado
from (
  select n, control, observado, esperado, estado from evaluadas
  union all
  select 99, 'VEREDICTO',
         case when count(*) filter (where estado = 'REVISAR') = 0 then 'CORRECTO'
              else 'REVISAR: ' || count(*) filter (where estado = 'REVISAR') || ' control(es)' end,
         'CORRECTO',
         case when count(*) filter (where estado = 'REVISAR') = 0 then 'OK' else 'REVISAR' end
  from evaluadas
) x
order by n;
