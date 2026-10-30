-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 222 · hija manual con precio NETO (#50). SOLO LECTURA (read only + ROLLBACK).
-- Correr ANTES de aplicar la 222 y con el MISMO rol que la aplicará (en Supabase, el del SQL
-- editor): las funciones de la 222 son SECURITY DEFINER y dependen de los atributos de ese rol.
-- Devuelve UNA sola fila consolidada (mismo formato que los preflight de la 214 y la 219):
--   veredicto   BLOQUEANTE si alguna verificación lo es; si no, INFO.
--   bloqueantes / revisar   cuántas verificaciones tienen ese nivel; chequeos = 12 (P1-P12).
--   resumen     P1=NIVEL/cantidad;P2=...;P12=...  (todas, en orden).
--   mensaje     qué hacer con este resultado.
--   detalle     jsonb con cada verificación: codigo, nivel, cantidad y su explicación.
-- Niveles: BLOQUEANTE (no aplicar hasta resolver) · REVISAR · INFO. Sin datos personales.
--
-- CADENA REAL: exige 211, 216, 217, 219 y 221 aplicadas. La 220 (#67) puede faltar y no se asume
-- ningún hueco: P1 reporta qué números de la cadena están presentes, sin exigir los ausentes por diseño.
-- Límite: la configuración "Exposed schemas" de la Data API no se ve desde SQL; la 222 crea el esquema
-- p50_priv, que NO debe aparecer en Settings → API → Exposed schemas.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
cols(tabla, columna) as (
  values ('cotizaciones', 'id'), ('cotizaciones', 'tenant'), ('cotizaciones', 'tipo'), ('cotizaciones', 'modo'),
         ('cotizaciones', 'payload'), ('cotizaciones', 'precio_venta'), ('cotizaciones', 'moneda'),
         ('cotizaciones', 'precio_total_congelado'), ('cotizaciones', 'aliado_id'), ('cotizaciones', 'cotizacion_origen_id'),
         ('cotizaciones', 'economico_rev'),
         ('cotizacion_servicios', 'tipo_servicio'), ('cotizacion_servicios', 'valor'), ('cotizacion_servicios', 'costo_neto'),
         ('cotizacion_comparativa_validaciones', 'canal'), ('cotizacion_comparativa_validaciones', 'huella'),
         ('ventas', 'aliado_id'), ('ventas', 'tipo_asesor'), ('ventas', 'agencia_nombre'), ('ventas', 'freelance_nombre'),
         ('ventas', 'modo_compra'), ('ventas', 'comision_b2b'), ('ventas', 'comision_estado'), ('ventas', 'precio_venta'), ('ventas', 'updated_at'),
         ('aliados', 'nombre'), ('aliados', 'nit'), ('aliados', 'tipo'), ('aliados', 'pct_comision'),
         ('aliados_b2b', 'aliado_id'), ('aliados_b2b', 'comision_valor'), ('aliados_b2b', 'base_explicita'),
         ('aliados_b2b', 'descontada_en_precio'), ('aliados_b2b', 'tenant'),
         ('usuarios', 'id'), ('usuarios', 'rol'), ('usuarios', 'activo'), ('usuarios', 'tenant')
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
    from (values ('usuarios'), ('cotizaciones'), ('ventas'), ('aliados_b2b'), ('aliados')) t(tabla)
),
cadena(n, presente) as (
  values (211, to_regclass('public.cotizacion_opciones') is not null),
         (216, to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)') is not null),
         (217, (select count(*) from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D' and t.tgname = 'trg_cot_frontera_39') = 1),
         (219, to_regclass('public.cotizacion_participantes') is not null),
         (221, exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'crm_contrato_cliente_ficha')),
         (220, exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ilike '%destino%aereo%'))
),
propias(nombre, firma) as (
  values ('registrar_validacion_comparativa_n50', 'p_madre_id bigint, p_opcion_ref text, p_acomodacion_ref text, p_version integer, p_canal text, p_actor_id uuid, p_precio_reliquidado numeric, p_moneda text, p_disponibilidad_ok boolean, p_datos_cliente jsonb, p_modalidad text, p_reconoce boolean, p_autorizar boolean'),
         ('resolver_solicitud_comparativa_n50', 'p_solicitud bigint, p_decision text, p_motivo text, p_clave text, p_modalidad text, p_reconoce boolean, p_autorizar boolean')
),
colisiones as (
  select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join propias a on a.nombre = p.proname
   where n.nspname = 'public' and pg_get_function_identity_arguments(p.oid) <> a.firma
),
objetos_50 as (
  select (to_regnamespace('p50_priv') is not null)::int + (to_regclass('public.cotizacion_neto') is not null)::int
         + (to_regclass('public.cotizacion_neto_componentes') is not null)::int
         + (exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.cotizacion_comparativa_validaciones')
                     and a.attname = 'modalidad' and a.attnum > 0 and not a.attisdropped))::int as n
),
chequeos as (
  select 'P1' as codigo,
         case when exists (select 1 from cadena c where c.n in (211, 216, 217, 219, 221) and not c.presente) then 'BLOQUEANTE' else 'INFO' end as nivel,
         (select count(*)::int from cadena c where c.n in (211, 216, 217, 219, 221) and c.presente) as cantidad,
         'Cadena real (esperado 5: 211, 216, 217, 219, 221). Ausentes exigidos: '
           || coalesce((select string_agg(c.n::text, ', ' order by c.n) from cadena c where c.n in (211, 216, 217, 219, 221) and not c.presente), 'ninguno')
           || '. La 220 (#67) y la 218 (#56) NO se exigen: 220 '
           || case when (select presente from cadena where n = 220) then 'presente' else 'ausente' end as detalle
  union all
  select 'P2',
         case when md5(replace(coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), ''), chr(13), ''))
                   = 'edc9975010746e53e4af6a75ad9763dc' then 'INFO' else 'BLOQUEANTE' end,
         (to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is not null)::int,
         'La RPC 198 de conversión conserva el cuerpo de main (md5); la 222 no la toca y lo vuelve a comprobar'
  union all
  select 'P3',
         case when exists (select 1 from faltan_cols) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from faltan_cols),
         'Columnas que la 222 lee o escribe: ' || coalesce((select string_agg(col, ', ') from faltan_cols), 'todas presentes')
  union all
  select 'P4',
         case when to_regclass('public.uq_cotizaciones_id_tenant') is null
                or to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)') is null
                or to_regprocedure('p39_priv.componentes_manual(bigint)') is null
                or to_regprocedure('p39_priv.composicion_coincide(bigint,jsonb)') is null
                or to_regprocedure('public._autorizado_pago_previo(uuid)') is null
              then 'BLOQUEANTE' else 'INFO' end,
         (to_regclass('public.uq_cotizaciones_id_tenant') is not null)::int
           + (to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)') is not null)::int
           + (to_regprocedure('p39_priv.componentes_manual(bigint)') is not null)::int
           + (to_regprocedure('p39_priv.composicion_coincide(bigint,jsonb)') is not null)::int
           + (to_regprocedure('public._autorizado_pago_previo(uuid)') is not null)::int,
         'Piezas que la 222 reutiliza: índice (id, tenant), crear_hija, componentes_manual, composicion_coincide y el autorizador de pagos (esperado: 5)'
  union all
  select 'P5',
         case when exists (select 1 from lee_sin_rls where not ok) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from lee_sin_rls where ok),
         'El rol actual (' || current_user || ') escribe usuarios, cotizaciones, ventas, aliados_b2b y aliados sin RLS (superusuario, BYPASSRLS o dueño); esperado: 5'
  union all
  select 'P6',
         case when (select n from objetos_50) = 0 then 'INFO'
              when (select n from objetos_50) = 4 then 'REVISAR'
              else 'BLOQUEANTE' end,
         (select n from objetos_50),
         'Estado: 0 = la 222 no está aplicada (INFO); 4 = ya aplicada (REVISAR: la 222 NO es idempotente y se niega a repetirse); intermedio = BLOQUEANTE (aplicación a medias)'
  union all
  select 'P7',
         case when exists (select 1 from colisiones) then 'BLOQUEANTE' else 'INFO' end,
         (select count(*)::int from colisiones),
         'Funciones public con el nombre de una RPC nueva de la 222 y OTRA firma (bloquean): '
           || coalesce((select string_agg(proname, ', ') from colisiones), 'ninguna')
  union all
  select 'P8', 'INFO',
         (select count(*)::int from public.parametros_tributarios p where p.parametro in ('COMISION_AGENCIA', 'COMISION_FREELANCE')),
         'Parámetros de comisión por tipo (agencia/freelance) presentes (0-2). Sin ellos rige el 12 % / 11 % de siempre'
  union all
  select 'P9',
         'INFO',
         (select count(*)::int from public.cotizaciones h where h.cotizacion_origen_id is not null and h.tipo = 'manual' and h.estado = 'abierta'
             and coalesce(h.payload->>'tipoAsesor', 'interno') <> 'interno'),
         'Hijas manuales B2B abiertas hoy (legadas, sin sello): seguirán en PVP; al convertirlas se propaga su aliado si existe (sin backfill)'
  union all
  select 'P10',
         case when exists (select 1 from public.cotizaciones c where c.modo = 'comparativa' and c.tipo = 'comparativa_manual' and c.estado = 'abierta'
                             and coalesce(c.payload->>'tipoAsesor', 'interno') <> 'interno' and c.aliado_id is null) then 'REVISAR' else 'INFO' end,
         (select count(*)::int from public.cotizaciones c where c.modo = 'comparativa' and c.tipo = 'comparativa_manual' and c.estado = 'abierta'
             and coalesce(c.payload->>'tipoAsesor', 'interno') <> 'interno' and c.aliado_id is null),
         'Comparativas manuales B2B abiertas SIN aliado del catálogo: tras la 223 no podrán generar una hija (hay que elegir el aliado al crear otra comparativa)'
  union all
  select 'P11', 'INFO',
         (select count(*)::int from public.cotizaciones q where q.estado = 'abierta' and q.tipo = 'manual' and q.cotizacion_origen_id is null),
         'Cotizaciones manuales directas abiertas (informativo: #50 v1 no las toca; su NETO es otra reserva)'
  union all
  select 'P12',
         'INFO',
         (to_regnamespace('p50_priv') is not null)::int,
         'p50_priv es un esquema NUEVO: confirmar en Settings → API → Exposed schemas que no se agrega (no se puede ver desde SQL)'
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
            then 'PREFLIGHT: hay BLOQUEANTES; no aplicar la 222.'
            else 'PREFLIGHT: sin bloqueantes; revisa los REVISAR y aplica la 222 con este mismo rol.' end as mensaje,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'nivel', o.nivel, 'cantidad', o.cantidad, 'detalle', o.detalle)
                 order by o.n) as detalle
  from orden o;

rollback;
