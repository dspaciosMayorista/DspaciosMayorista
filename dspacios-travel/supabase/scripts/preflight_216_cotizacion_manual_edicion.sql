-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 216 · #39 edición de cotizaciones dinámicas (A). SOLO LECTURA (read only + ROLLBACK).
-- Correr ANTES de aplicar la 216 y con el MISMO rol que la aplicará (en Supabase, el del editor
-- SQL). Devuelve UNA sola fila consolidada:
--   veredicto   BLOQUEANTE si alguna verificación lo es; si no, INFO.
--   bloqueantes / revisar   cuántas verificaciones tienen ese nivel; chequeos = 10 (P1-P10).
--   resumen     P1=NIVEL/cantidad;P2=...;P10=...  (todas, en orden).
--   mensaje     qué hacer con este resultado.
--   detalle     jsonb con cada verificación: codigo, nivel, cantidad y su explicación.
-- Sin datos personales: solo conteos.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
yo as (
  select r.rolname, r.rolsuper from pg_roles r where r.rolname = current_user
),
tablas(t) as (
  values ('public.cotizaciones'), ('public.cotizacion_servicios'), ('public.cotizacion_pagos_previos'), ('public.cotizacion_condiciones')
),
puede_alterar as (
  select t.t,
         coalesce((select y.rolsuper from yo y), false)
           or coalesce((select pg_has_role(current_user, c.relowner, 'MEMBER') from pg_class c where c.oid = to_regclass(t.t)), false) as ok
    from tablas t
),
md5_198 as (
  select string_agg(coalesce(md5(replace(p.prosrc, chr(13), '')), 'falta'), ',' order by f.n) as h,
         count(p.oid)::int as n
    from (values (1, 'public.anular_pago_previo(bigint,uuid,text)'), (2, 'public.convertir_cotizacion_a_contrato(bigint,uuid)'),
                 (3, 'public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)'),
                 (4, 'public.transferir_pagos_previos_a_abonos(bigint,text,uuid)')) f(n, sig)
    left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
objetos_216 as (
  select (to_regnamespace('p39_priv') is not null)::int
       + (to_regclass('public.cotizacion_ediciones') is not null)::int
       + (exists (select 1 from pg_attribute a where a.attrelid = 'public.cotizaciones'::regclass and a.attname = 'economico_rev'
                   and a.attnum > 0 and not a.attisdropped))::int
       + (to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is not null)::int as n,
         exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D'
                  and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39')) as frontera_activa
),
chequeos as (
  select 'P1' as codigo,
         case when to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is null
                or to_regprocedure('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)') is null
                or to_regprocedure('public.anular_pago_previo(bigint,uuid,text)') is null
                or to_regprocedure('public._autorizado_pago_previo(uuid)') is null
                or to_regprocedure('public.fecha_negocio(timestamptz)') is null
                or to_regprocedure('public.puede_ver_tenant_cotizacion(text)') is null
                or to_regnamespace('f211_priv') is null
              then 'BLOQUEANTE' else 'INFO' end as nivel,
         (to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is not null)::int
           + (to_regprocedure('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)') is not null)::int
           + (to_regprocedure('public.anular_pago_previo(bigint,uuid,text)') is not null)::int
           + (to_regprocedure('public._autorizado_pago_previo(uuid)') is not null)::int
           + (to_regprocedure('public.fecha_negocio(timestamptz)') is not null)::int
           + (to_regprocedure('public.puede_ver_tenant_cotizacion(text)') is not null)::int
           + (to_regnamespace('f211_priv') is not null)::int as cantidad,
         'Piezas de 154/164/198/211 que la 216 usa (esperado: 7)' as detalle
  union all
  select 'P2',
         case when (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) = 3 then 'INFO' else 'BLOQUEANTE' end,
         (select count(*)::int from pg_roles where rolname in ('anon', 'authenticated', 'service_role')),
         'Roles anon, authenticated y service_role presentes (esperado: 3)'
  union all
  select 'P3',
         case when exists (select 1 from puede_alterar where not ok) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from puede_alterar where ok),
         'El rol actual (' || current_user || ') puede alterar cotizaciones, servicios, pagos previos y condiciones '
           || '(dueño, miembro del dueño o superusuario); esperado: 4'
  union all
  select 'P4',
         case when (select h from md5_198) = '49bb1f21f071141d30926ad426f87369,edc9975010746e53e4af6a75ad9763dc,146d0275f5a97b9ecd6a52e11161b248,4814691695eb7587c18628ede17f266f'
              then 'INFO' else 'BLOQUEANTE' end,
         (select n from md5_198),
         'Las 4 RPC de dinero de la 198 tienen el cuerpo de main (md5); los wrappers las llaman sin cambios (esperado: 4, INFO)'
  union all
  select 'P5',
         case when (select n from objetos_216) = 0 then 'INFO'
              when (select frontera_activa from objetos_216) then 'BLOQUEANTE'
              when (select n from objetos_216) = 4 then 'REVISAR'
              else 'BLOQUEANTE' end,
         (select n from objetos_216),
         'Objetos de la 216: 0 = no aplicada (INFO); 4 = ya aplicada (REVISAR, es idempotente); con la frontera ya activa '
           || '(217 aplicada) o a medias = BLOQUEANTE'
  union all
  select 'P6', 'INFO',
         (select count(*)::int from public.cotizaciones where tipo = 'manual' and estado = 'abierta' and creado_por_id is null),
         'Manuales abiertas sin autor estable (creado_por_id nulo): venta no podrá editarlas; las editan los roles de contrato completo'
  union all
  select 'P7', 'INFO',
         (select count(*)::int from public.cotizaciones c where c.tipo = 'manual' and c.estado = 'abierta'
             and (c.condicion_pago_congelada_en is not null or exists (select 1 from public.cotizacion_pagos_previos p where p.cotizacion_id = c.id))),
         'Manuales abiertas con congelado o con algún pago previo: quedan fuera de la edición de fase 1 (#39-1)'
  union all
  select 'P8', 'INFO',
         (select count(*)::int from public.cotizaciones where modo = 'comparativa' or cotizacion_origen_id is not null),
         'Madres e hijas de la 211: fuera de la edición de fase 1'
  union all
  select 'P9',
         case when exists (select 1 from public.cotizacion_pagos_previos p join public.cotizaciones c on c.id = p.cotizacion_id
                            where p.estado in ('activo', 'aplicado') and c.condicion_pago_congelada_en is null) then 'REVISAR' else 'INFO' end,
         (select count(*)::int from public.cotizacion_pagos_previos p join public.cotizaciones c on c.id = p.cotizacion_id
           where p.estado in ('activo', 'aplicado') and c.condicion_pago_congelada_en is null),
         'Pagos previos activos/aplicados en cotizaciones SIN congelar (no debería existir; esperado: 0)'
  union all
  select 'P10', 'INFO',
         (select count(*)::int from (values ('anon'), ('authenticated'), ('service_role')) r(rol),
                 (values ('public.cotizacion_servicios'), ('public.cotizacion_pagos_previos'), ('public.cotizacion_condiciones')) t(n),
                 (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
           where has_table_privilege(r.rol, t.n, p.priv)),
         'Privilegios de escritura de la API sobre servicios/pagos/condiciones hoy (la 217 retirará la lista fija; su rollback la restaura)'
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
            then 'PREFLIGHT: hay BLOQUEANTES; no aplicar la 216.'
            else 'PREFLIGHT: sin bloqueantes; revisa los REVISAR y aplica la 216 con este mismo rol.' end as mensaje,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'nivel', o.nivel, 'cantidad', o.cantidad, 'detalle', o.detalle)
                 order by o.n) as detalle
  from orden o;

rollback;
