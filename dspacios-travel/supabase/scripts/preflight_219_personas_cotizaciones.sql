-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 219 · personas de cotizaciones en el CRM (#42). SOLO LECTURA (read only + ROLLBACK).
-- Correr ANTES de aplicar la 219 y con el MISMO rol que la aplicará (en Supabase, el del SQL
-- editor): las fachadas de la 219 son SECURITY DEFINER y dependen de los atributos de ese rol.
-- Devuelve UNA sola fila consolidada (mismo formato que el preflight de la 214):
--   veredicto   BLOQUEANTE si alguna verificación lo es; si no, INFO.
--   bloqueantes / revisar   cuántas verificaciones tienen ese nivel; chequeos = 10 (P1-P10).
--   resumen     P1=NIVEL/cantidad;P2=...;P10=...  (todas, en orden).
--   mensaje     qué hacer con este resultado.
--   detalle     jsonb con cada verificación: codigo, nivel, cantidad y su explicación.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR · INFO. Sin datos personales.
-- Límite: la configuración "Exposed schemas" de la Data API no se ve desde SQL; la 219 no crea
-- esquemas (reutiliza p214_priv), pero confirmar en el panel que p214_priv sigue sin exponerse.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
cols(tabla, columna) as (
  values ('cotizaciones', 'id'), ('cotizaciones', 'tenant'), ('cotizaciones', 'estado'), ('cotizaciones', 'tipo'),
         ('cotizaciones', 'modo'), ('cotizaciones', 'payload'), ('cotizaciones', 'detalle'), ('cotizaciones', 'codigo'),
         ('cotizaciones', 'created_at'), ('cotizaciones', 'creado_por'), ('cotizaciones', 'creado_por_id'),
         ('cotizaciones', 'propietario_id'), ('cotizaciones', 'aliado_id'), ('cotizaciones', 'cotizacion_origen_id'),
         ('cotizaciones', 'cliente'), ('cotizaciones', 'cliente_documento'),
         ('usuarios', 'id'), ('usuarios', 'rol'), ('usuarios', 'activo'), ('usuarios', 'tenant'), ('usuarios', 'email')
),
faltan_cols as (
  select c.tabla || '.' || c.columna as col
    from cols c
   where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.' || c.tabla) and a.attname = c.columna
                        and a.attnum > 0 and not a.attisdropped)
),
yo as (
  select r.rolname, r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user
),
lee_sin_rls as (
  select t.tabla,
         coalesce((select y.rolsuper or y.rolbypassrls from yo y), false)
           or coalesce((select pg_get_userbyid(c.relowner) = current_user from pg_class c where c.oid = to_regclass('public.' || t.tabla)), false) as ok
    from (values ('usuarios'), ('cotizaciones'), ('ventas')) t(tabla)
),
estado as (
  select
    (to_regprocedure('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text)') is not null
     and to_regprocedure('p214_priv.captura_visible(text,text,text,text,text)') is not null
     and not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.persona_capturas') and a.attname = 'cotizacion_id'
                        and a.attnum > 0 and not a.attisdropped)) as v1,
    (to_regprocedure('p214_priv.upsert_persona(uuid,text,text,text,text,text,jsonb,text,bigint,uuid,text,bigint,uuid,text)') is not null
     and to_regclass('public.cotizacion_participantes') is not null
     and to_regclass('p214_priv.r219_foto_214') is not null) as v219
),
ajenas(nombre, firma) as (
  values ('registrar_personas_cotizacion', 'p_cotizacion_id bigint, p_usuario_id uuid, p_participantes jsonb'),
         ('actualizar_titular_cotizacion', 'p_cotizacion_id bigint, p_usuario_id uuid, p_titular jsonb, p_version_esperada integer, p_clave uuid'),
         ('sellar_creador_cotizacion', 'p_cotizacion_id bigint, p_usuario_id uuid'),
         ('crm_personas_cotizacion_buscar', 'p_tenant text, p_texto text, p_limite integer, p_offset integer')
),
colisiones as (
  select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join ajenas a on a.nombre = p.proname
   where n.nspname = 'public' and pg_get_function_identity_arguments(p.oid) <> a.firma
),
chequeos as (
  select 'P1' as codigo,
         case when to_regclass('public.personas') is null or to_regclass('public.persona_capturas') is null
                or to_regclass('public.persona_observaciones') is null or to_regnamespace('p214_priv') is null
                or to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') is null
              then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regclass('public.personas') is not null)::int + (to_regclass('public.persona_capturas') is not null)::int
           + (to_regclass('public.persona_observaciones') is not null)::int + (to_regnamespace('p214_priv') is not null)::int
           + (to_regprocedure('public.buscar_personas_documento(text,text,text,integer,integer)') is not null)::int as cantidad,
         'Registro central de la 214 presente: 3 tablas, esquema p214_priv y la consulta (esperado: 5)' as detalle
  union all
  select 'P2',
         case when exists (select 1 from faltan_cols) or to_regclass('public.uq_cotizaciones_id_tenant') is null
              then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from faltan_cols) + (to_regclass('public.uq_cotizaciones_id_tenant') is null)::int,
         'Columnas de cotizaciones/usuarios que la 219 lee y el índice (id, tenant) de la 211: '
           || coalesce((select string_agg(col, ', ') from faltan_cols), 'todas presentes')
           || case when to_regclass('public.uq_cotizaciones_id_tenant') is null then '; FALTA uq_cotizaciones_id_tenant' else '' end
  union all
  select 'P3',
         case when to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)') is null then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from pg_trigger t
           where not t.tgisinternal and t.tgenabled <> 'D' and t.tgname = 'trg_cot_frontera_39'),
         '216 presente (crear_cotizacion_manual, dueña del sello manual que la 219 consume); cantidad = frontera 217 activa (1) o no (0)'
  union all
  select 'P4',
         case when exists (select 1 from lee_sin_rls where not ok) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from lee_sin_rls where ok),
         'El rol actual (' || current_user || ') lee usuarios, cotizaciones y ventas sin RLS (superusuario, BYPASSRLS o dueño); esperado: 3'
  union all
  select 'P5',
         case when (select v1 from estado) and to_regclass('public.cotizacion_participantes') is null
                   and to_regclass('p214_priv.r219_foto_214') is null then 'INFO'
              when (select v219 from estado) then 'REVISAR'
              else 'BLOQUEANTE' end,
         (to_regclass('public.cotizacion_participantes') is not null)::int + (to_regclass('p214_priv.r219_foto_214') is not null)::int
           + (exists (select 1 from pg_catalog.pg_attribute a
                       where a.attrelid = to_regclass('public.persona_capturas') and a.attname = 'cotizacion_id'
                         and a.attnum > 0 and not a.attisdropped))::int,
         'Estado: 0 = forma 214, 219 no aplicada (INFO); 3 con la forma de la 219 = ya aplicada (REVISAR, es idempotente); intermedio o ajeno = BLOQUEANTE'
  union all
  select 'P6',
         case when exists (select 1 from colisiones) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from colisiones),
         'Funciones public con el nombre de una RPC de la 219 y OTRA firma (bloquean): '
           || coalesce((select string_agg(proname, ', ') from colisiones), 'ninguna')
  union all
  select 'P7',
         case when (select v1 from estado)
                   and (select count(*) from pg_constraint
                         where conrelid = to_regclass('public.persona_capturas')
                           and conname in ('persona_capturas_fuente_check', 'persona_capturas_nivel_check',
                                           'persona_capturas_fuente_ck', 'persona_capturas_nivel_ck')) <> 4
              then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from pg_constraint
           where conrelid = to_regclass('public.persona_capturas')
             and conname in ('persona_capturas_fuente_check', 'persona_capturas_nivel_check',
                             'persona_capturas_fuente_ck', 'persona_capturas_nivel_ck')),
         'Restricciones de fuente/nivel de persona_capturas con los nombres que la 219 fotografía y reemplaza (esperado: 4)'
  union all
  select 'P8',
         case when exists (select 1 from public.cotizaciones q where q.tenant is null or q.tenant not in ('mayorista', 'minorista'))
              then 'REVISAR' else 'INFO' end,
         (select count(*)::int from public.cotizaciones q where q.tenant is null or q.tenant not in ('mayorista', 'minorista')),
         'Cotizaciones con tenant nulo o fuera de mayorista/minorista (sus personas no se pueden registrar: la fachada responde tenant_invalido)'
  union all
  select 'P9', 'INFO',
         (select count(*)::int from public.cotizaciones q where q.estado = 'abierta'),
         'Cotizaciones abiertas hoy (informativo: la 219 NO les crea puestos; no hay backfill)'
  union all
  select 'P10',
         case when to_regprocedure('gen_random_uuid()') is null then 'BLOQUEANTE' else 'INFO' end,
         (to_regprocedure('gen_random_uuid()') is not null)::int,
         'gen_random_uuid() disponible (ref de puestos titulares nuevos)'
),
orden as (
  select c.codigo, c.nivel, c.cantidad, c.detalle, row_number() over (order by length(c.codigo), c.codigo) as n
    from chequeos c
)
select case when count(*) filter (where o.nivel = 'BLOQUEANTE') > 0 then 'BLOQUEANTE' else 'INFO' end as veredicto,
       count(*) filter (where o.nivel = 'BLOQUEANTE')::int as bloqueantes,
       count(*) filter (where o.nivel = 'REVISAR')::int as revisar,
       count(*)::int as chequeos,
       string_agg(o.codigo || '=' || o.nivel || '/' || o.cantidad, ';' order by o.n) as resumen,
       case when count(*) filter (where o.nivel = 'BLOQUEANTE') > 0
            then 'PREFLIGHT: hay BLOQUEANTES; no aplicar la 219.'
            else 'PREFLIGHT: sin bloqueantes; revisa los REVISAR y aplica la 219 con este mismo rol.' end as mensaje,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'nivel', o.nivel, 'cantidad', o.cantidad, 'detalle', o.detalle)
                 order by o.n) as detalle
  from orden o;

rollback;
