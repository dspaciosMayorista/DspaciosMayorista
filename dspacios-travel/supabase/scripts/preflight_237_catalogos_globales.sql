-- PREFLIGHT integral de la migración 237 (#5 D8/D9). SOLO LECTURA: una consulta, un resultado.
-- Pegar COMPLETO en el editor SQL de Supabase y ejecutar UNA vez ANTES de aplicar la 237.
-- Cada fila: control · observado · esperado · estado. La última fila es el veredicto:
-- aplicar la 237 solo si dice "LISTO PARA APLICAR".
--
-- NOTA md5: son los del cuerpo (prosrc) VIGENTE de las 4 funciones que la 237 reemplaza. Si alguno no
-- coincide, la función se editó fuera del repo: NO aplicar la 237 (su CREATE OR REPLACE la pisaría);
-- avisar antes de continuar. reemplazar_tarifas_hotel_calculadora admite DOS md5 porque se comprobó
-- por tokens (supabase/scripts/pruebas_237/comparar_funcion_tokens.mjs) que son el MISMO código:
--   d7e05c96e1260a76fbad22784e881c77  = definición observada en Producción (formato multilínea)
--   632146aba910eb17f2572273567de091  = migración 179 tal cual (entornos creados desde el repo)
-- Las otras tres funciones aún no tienen definición de Producción comparada: si en Producción su md5
-- difiere, hay que compararlas por tokens con la migración que las define antes de aplicar.
with
reg(t) as (
  select unnest(array['aliados','asesores','formas_pago','rangos_edad','parametros_tributarios',
    'destinos','hoteles','hotel_acomodaciones','hotel_blackouts','hotel_calculadora','hotel_categorias',
    'hotel_documentos','hotel_fotos','hotel_regimenes','hotel_temporadas','hotel_tarifas_unidad',
    'tarifa_hotel','categorias_habitacion','planes_alimentacion','aerolineas','aerolinea_tarifas',
    'proveedores','proveedores_datos_sensibles','servicios_adicionales','servicio_tarifa_pax',
    'servicio_temporadas'])
),
fn(nombre, md5_esperado) as (
  values ('aprobar_solicitud_b2b',                   'b25ce02790c3991ff224be6079093fe5'),
         ('fn_fusionar_destino',                     'ccaecffb962705ae088f7ad6127b7a79'),
         ('generar_tarifas_hotel_calculadora',       'a3ecc79779e4d1c7bda05dca1bb3158e'),
         ('reemplazar_tarifas_hotel_calculadora',    'd7e05c96e1260a76fbad22784e881c77 | 632146aba910eb17f2572273567de091')
),
filas as (
  select 1 as n, 'Catálogos del registro que existen en public' as control,
         (select count(*)::text from reg r where to_regclass('public.' || r.t) is not null) as observado,
         '26' as esperado
  union all
  select 2, 'Catálogos del registro con RLS activa',
         (select count(*)::text from reg r join pg_class c on c.oid = to_regclass('public.' || r.t) where c.relrowsecurity),
         '26'
  union all
  select 3, 'Objetos de la 237 ya presentes (si hay alguno, la 237 ya se aplicó o quedó a medias)',
         ((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('sesion_agencia','sesion_agencia_inicio','catalogos_funciones_previas_237'))
        + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
             and proname in ('agencia_activa_sesion','puede_escribir_catalogo_global','iniciar_contexto_agencia',
                             'cambiar_contexto_agencia','catalogos_globales_registro','invalidar_contexto_agencia_usuario'))
        + (select count(*) from pg_trigger where tgname = 'usuarios_invalidar_contexto_agencia'))::text,
         '0'
  union all
  select 4, 'Policies RESTRICTIVAS de catálogo sobre el registro (cualquiera)',
         (select count(*)::text from pg_policy p join reg r on p.polrelid = to_regclass('public.' || r.t) where not p.polpermissive),
         '0'
  union all
  select 5, 'Policies permisivas totales sobre el registro (referencia: no deben cambiar con la 237)',
         (select count(*)::text from pg_policy p join reg r on p.polrelid = to_regclass('public.' || r.t) where p.polpermissive),
         '47'
  union all
  select 6 + row_number() over (order by f.nombre), 'Cuerpo vigente de ' || f.nombre || '() = uno de los md5 conocidos (ver nota)',
         coalesce((select md5(p.prosrc) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.nombre), 'NO EXISTE'),
         f.md5_esperado
  from fn f
  union all
  select 11, 'auth.sessions expone user_id, created_at y not_after',
         (select count(*)::text from information_schema.columns
           where table_schema = 'auth' and table_name = 'sessions' and column_name in ('user_id','created_at','not_after')),
         '3'
  union all
  select 12, 'mi_rol() y mi_tenant_real() existen',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('mi_rol','mi_tenant_real')),
         '2'
  union all
  select 13, 'Usuarios internos activos sin tenant válido (el supuesto de la 116)',
         (select count(*)::text from public.usuarios
           where activo and rol::text in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo')
             and (tenant is null or tenant not in ('mayorista','minorista'))),
         '0'
  union all
  select 14, 'Superadmin activos (deberán volver a iniciar sesión tras la 237 para escribir catálogos)',
         (select count(*)::text from public.usuarios where activo and rol::text = 'superadmin'),
         '>= 1 (informativo)'
  union all
  select 15, 'Usuarios activos con rol de escritura de catálogos en Minorista (perderán esa escritura: D8/D9)',
         (select count(*)::text from public.usuarios
           where activo and tenant = 'minorista' and rol::text in ('gerencia','administracion','operaciones')),
         'informativo'
  union all
  select 16, 'Función guardar_proveedor es SECURITY INVOKER (la frontera la alcanza por RLS)',
         (select (not p.prosecdef)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'guardar_proveedor'),
         'true'
),
evaluadas as (
  select n, control, observado, esperado,
         case
           when esperado like '%informativo%' then 'INFO'
           when observado = any (string_to_array(esperado, ' | ')) then 'OK'
           when esperado like '>= 1%' and observado ~ '^[0-9]+$' and observado::int >= 1 then 'OK'
           else 'REVISAR'
         end as estado
  from filas
)
select control, observado, esperado, estado
from (
  select n, control, observado, esperado, estado from evaluadas
  union all
  select 99, 'VEREDICTO',
         case when count(*) filter (where estado = 'REVISAR') = 0 then 'LISTO PARA APLICAR'
              else 'NO APLICAR: ' || count(*) filter (where estado = 'REVISAR') || ' control(es) en REVISAR' end,
         'LISTO PARA APLICAR',
         case when count(*) filter (where estado = 'REVISAR') = 0 then 'OK' else 'REVISAR' end
  from evaluadas
) x
order by n;
