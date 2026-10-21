-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 221 · Clientes de contratos en el CRM (#68). SOLO LECTURA (read only + ROLLBACK).
-- Correr ANTES de aplicar la 221 y con el MISMO rol que la aplicará (en Supabase, el del SQL editor): las
-- dos funciones de la 221 son SECURITY DEFINER y se ejecutan con los permisos de ese rol.
-- Devuelve UNA sola fila consolidada (mismo formato que el preflight de la 219):
--   veredicto   BLOQUEANTE si alguna verificación lo es; si no, INFO.
--   bloqueantes / revisar   cuántas verificaciones tienen ese nivel; chequeos = 10 (P1-P10).
--   resumen     P1=NIVEL/cantidad;P2=...;P10=...  (todas, en orden).
--   mensaje     qué hacer con este resultado.
--   detalle     jsonb con cada verificación: codigo, nivel, cantidad y su explicación.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR · INFO. Solo catálogo y conteos: ningún dato personal.
-- Orden en Producción: la 220 (#67) se aplica ANTES que la 221. No es una dependencia de objetos; P10 solo la
-- detecta por un objeto del borrador de la 220 (si ese nombre cambiara, P10 avisaría de más: es REVISAR, no bloquea).
-- Límite: la configuración "Exposed schemas" de la Data API no se ve desde SQL; la 221 no crea esquemas ni tablas.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
cols(tabla, columna) as (
  values ('ventas_basica', 'numero_contrato'), ('ventas_basica', 'fecha_venta'), ('ventas_basica', 'asesor'),
         ('ventas_basica', 'cliente'), ('ventas_basica', 'cliente_documento'), ('ventas_basica', 'cliente_email'),
         ('ventas_basica', 'cliente_telefono'), ('ventas_basica', 'destino'), ('ventas_basica', 'fecha_salida'),
         ('ventas_basica', 'fecha_regreso'), ('ventas_basica', 'estado'), ('ventas_basica', 'tipo_asesor'),
         ('ventas_basica', 'agencia_nombre'), ('ventas_basica', 'freelance_nombre'), ('ventas_basica', 'tenant'),
         ('usuarios', 'id'), ('usuarios', 'rol'), ('usuarios', 'activo'), ('usuarios', 'tenant'),
         ('usuarios', 'nombre'), ('usuarios', 'email')
),
faltan_cols as (
  select c.tabla || '.' || c.columna as col
    from cols c
   where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = to_regclass('public.' || c.tabla) and a.attname = c.columna
                        and a.attnum > 0 and not a.attisdropped)
),
requeridas(firma) as (
  values ('auth.uid()'), ('public.mi_rol()'), ('public.soy_asesor_del_contrato(text)'), ('public.soy_ese_asesor(text)')
),
faltan_fun as (
  select r.firma from requeridas r where to_regprocedure(r.firma) is null
),
propias(firma) as (
  values ('public.crm_contratos_clientes_buscar(text,text,text,integer)'), ('public.crm_contrato_cliente_ficha(text)')
),
colisiones as (
  select p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('crm_contratos_clientes_buscar', 'crm_contrato_cliente_ficha')
     and p.oid not in (select coalesce(to_regprocedure(firma)::oid, 0::oid) from propias)
),
yo as (
  select r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user
),
rol_lee as (
  select coalesce((select y.rolsuper or y.rolbypassrls from yo y), false)
         or coalesce((select pg_get_userbyid(c.relowner) = current_user from pg_class c where c.oid = to_regclass('public.usuarios')), false) as usuarios_sin_rls,
         case when to_regclass('public.ventas_basica') is null then false
              else has_table_privilege(current_user, to_regclass('public.ventas_basica'), 'select') end as vista_legible
),
chequeos(codigo, nivel, cantidad, detalle) as (
  select 'P1',
         case when exists (select 1 from faltan_cols) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from faltan_cols),
         'Columnas que la 221 lee y no existen en ventas_basica/usuarios (bloquean): '
           || coalesce((select string_agg(col, ', ') from faltan_cols), 'ninguna')
  union all
  select 'P2',
         case when exists (select 1 from faltan_fun) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from faltan_fun),
         'Funciones que la 221 usa y no existen (bloquean): '
           || coalesce((select string_agg(firma, ', ') from faltan_fun), 'ninguna')
  union all
  select 'P3',
         case when to_regclass('public.ventas_basica') is not null
                   and pg_get_viewdef(to_regclass('public.ventas_basica'), true) like '%soy_asesor_del_contrato%'
              then 'INFO' else 'REVISAR' end,
         (to_regclass('public.ventas_basica') is not null
          and pg_get_viewdef(to_regclass('public.ventas_basica'), true) like '%soy_asesor_del_contrato%')::int,
         'ventas_basica conserva el enmascarado por contrato propio de la 148/156 (defensa en profundidad bajo la 221; esperado 1)'
  union all
  select 'P4',
         case when exists (select 1 from colisiones) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from colisiones),
         'Funciones public con el nombre de una RPC de la 221 y OTRA firma (bloquean): '
           || coalesce((select string_agg(proname, ', ') from colisiones), 'ninguna')
  union all
  select 'P5',
         case when (select count(*) from propias where to_regprocedure(firma) is not null) = 1 then 'BLOQUEANTE'
              when (select count(*) from propias where to_regprocedure(firma) is not null) = 2 then 'REVISAR'
              else 'INFO' end,
         (select count(*)::int from propias where to_regprocedure(firma) is not null),
         'Estado: 0 = 221 no aplicada (INFO); 2 = ya aplicada (REVISAR, es idempotente); 1 = intermedio (BLOQUEANTE)'
  union all
  select 'P6',
         case when (select usuarios_sin_rls and vista_legible from rol_lee) then 'INFO' else 'BLOQUEANTE' end,
         (select usuarios_sin_rls::int + vista_legible::int from rol_lee),
         'El rol que aplica (' || current_user || ') lee public.usuarios sin RLS (superusuario, BYPASSRLS o dueño) y puede leer ventas_basica; las funciones SECURITY DEFINER dependen de ello (esperado 2)'
  union all
  select 'P7',
         case when exists (select 1 from public.usuarios u where u.activo is true and (u.tenant is null or u.tenant not in ('mayorista', 'minorista')))
              then 'REVISAR' else 'INFO' end,
         (select count(*)::int from public.usuarios u where u.activo is true and (u.tenant is null or u.tenant not in ('mayorista', 'minorista'))),
         'Usuarios activos con tenant fuera de mayorista/minorista (la 221 les devuelve vacío)'
  union all
  select 'P8',
         case when exists (select 1 from public.ventas v where v.tenant is null or v.tenant not in ('mayorista', 'minorista'))
              then 'REVISAR' else 'INFO' end,
         (select count(*)::int from public.ventas v where v.tenant is null or v.tenant not in ('mayorista', 'minorista')),
         'Contratos con tenant fuera de mayorista/minorista (no aparecen en la sección)'
  union all
  select 'P9',
         case when exists (select 1 from public.usuarios u
                            where u.activo is true and u.rol::text = 'venta'
                              and exists (select 1 from public.usuarios u2
                                           where u2.activo is true and u2.id <> u.id and u2.tenant = u.tenant
                                             and (lower(btrim(u2.nombre)) in (lower(btrim(u.nombre)), lower(btrim(u.email)))
                                                  or lower(btrim(u2.email)) in (lower(btrim(u.nombre)), lower(btrim(u.email))))))
              then 'REVISAR' else 'INFO' end,
         (select count(*)::int from public.usuarios u
           where u.activo is true and u.rol::text = 'venta'
             and exists (select 1 from public.usuarios u2
                          where u2.activo is true and u2.id <> u.id and u2.tenant = u.tenant
                            and (lower(btrim(u2.nombre)) in (lower(btrim(u.nombre)), lower(btrim(u.email)))
                                 or lower(btrim(u2.email)) in (lower(btrim(u.nombre)), lower(btrim(u.email)))))),
         'Asesores venta activos cuyo nombre o correo equivale al de otro usuario activo del mismo tenant (homónimos: la 221 no les muestra esos contratos)'
  union all
  select 'P10',
         case when to_regclass('public.armado_paquete_destinos_aereos') is null then 'REVISAR' else 'INFO' end,
         (to_regclass('public.armado_paquete_destinos_aereos') is not null)::int,
         'Orden operativo: la 220 (#67) debe estar aplicada antes que la 221; se detecta por public.armado_paquete_destinos_aereos (esperado 1; en un ambiente sin la 220 es REVISAR, no bloquea)'
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
            then 'PREFLIGHT: hay BLOQUEANTES; no aplicar la 221.'
            else 'PREFLIGHT: sin bloqueantes; revisa los REVISAR y aplica la 221 con este mismo rol.' end as mensaje,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'nivel', o.nivel, 'cantidad', o.cantidad, 'detalle', o.detalle)
                 order by o.n) as detalle
  from orden o;

rollback;
