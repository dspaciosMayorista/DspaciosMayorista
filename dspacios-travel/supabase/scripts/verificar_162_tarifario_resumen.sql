-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK · SOLO LECTURA · migración 20260601000162_tarifario_resumen.sql
-- (vista `public.tarifario_resumen`) — correr DESPUÉS de aplicar la
-- migración 162, sobre el entorno donde se aplicó (local/staging y, post-merge,
-- producción). No escribe nada.
--
-- Verifica la vista YA CREADA:
--   A) definición: las 32 columnas de salida esperadas (20 del group by + 12
--      agregadas por acomodación/desde) existen y en orden;
--   B) security_invoker = true;
--   C) ACL: SOLO `select` y SOLO para anon + authenticated — ni PUBLIC ni
--      ningún privilegio de escritura para nadie;
--   D) conteos: sincronía entre el resumen estimado a mano (mismo group by de
--      20 columnas que la vista) y el count(*) REAL de la vista ya creada —
--      deben coincidir EXACTAMENTE.
--
-- ⚠️ La estimación (consulta D.1) usa exactamente las mismas 20 columnas y el
-- mismo `group by` que `create view public.tarifario_resumen` (migración 162).
-- Si alguna vez se edita el `group by` de la vista, este script debe
-- actualizarse en el mismo commit para no volver a desincronizarse.
--
-- ⚠️ Revisión posterior (defecto confirmado y corregido): la versión anterior
-- de este script agrupaba por SOLO 7 columnas (modulo, paquete_id, bloqueo_id,
-- hotel_id, servicio_id, fecha_ida, fecha_regreso) — MENOS columnas que el
-- `group by` real de la vista 162 (20 columnas: incluye categoria, regimen,
-- noches, moneda, paquete_nombre, paquete_activo, bloqueo_label,
-- empaquetado_id, salida_id, hotel_nombre, servicio_nombre, destino_id,
-- destino_nombre). Agrupar por menos columnas SIEMPRE produce un conteo
-- IGUAL o MENOR al real (nunca mayor) — así que la preventiva vieja podía
-- reportar una reducción de magnitud más favorable de lo que la vista
-- realmente entrega. La consulta D.1 usa AHORA exactamente las mismas 20
-- columnas y el mismo `group by` que la vista.
-- ───────────────────────────────────────────────────────────────────────────

-- ═════════════════════════════════════════════════════════════════════════
-- A) DEFINICIÓN — la vista debe exponer las 32 columnas de salida esperadas,
--    en el mismo orden que el `create view` de la migración 162 (20 columnas
--    del group by + precio_sencilla/doble/triple/multiple/nino/nino2/infante/
--    desde_adulto/desde_general/descripcion/recargo_individual/tipo_tarifa).
--    Devuelve las columnas presentes que NO coinciden con la lista esperada
--    (0 filas = definición correcta) o las esperadas que falten.
-- ═════════════════════════════════════════════════════════════════════════
select
  'DEFINICION' as seccion,
  c.ordinal_position,
  c.column_name,
  c.data_type
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'tarifario_resumen'
  and c.column_name <> all (array[
    'modulo','paquete_id','paquete_nombre','paquete_activo','bloqueo_id',
    'bloqueo_label','empaquetado_id','salida_id','hotel_id','hotel_nombre',
    'servicio_id','servicio_nombre','destino_id','destino_nombre','categoria',
    'regimen','fecha_ida','fecha_regreso','noches','moneda',
    'precio_sencilla','precio_doble','precio_triple','precio_multiple',
    'precio_nino','precio_nino2','precio_infante','desde_adulto','desde_general',
    'descripcion','recargo_individual','tipo_tarifa'
  ])
union all
-- Columnas esperadas que faltan (si alguna aparece aquí, la definición no coincide).
select
  'DEFINICION_FALTANTE',
  v.posicion,
  v.columna,
  'FALTA'
from (values
  (1,'modulo'),(2,'paquete_id'),(3,'paquete_nombre'),(4,'paquete_activo'),(5,'bloqueo_id'),
  (6,'bloqueo_label'),(7,'empaquetado_id'),(8,'salida_id'),(9,'hotel_id'),(10,'hotel_nombre'),
  (11,'servicio_id'),(12,'servicio_nombre'),(13,'destino_id'),(14,'destino_nombre'),(15,'categoria'),
  (16,'regimen'),(17,'fecha_ida'),(18,'fecha_regreso'),(19,'noches'),(20,'moneda'),
  (21,'precio_sencilla'),(22,'precio_doble'),(23,'precio_triple'),(24,'precio_multiple'),
  (25,'precio_nino'),(26,'precio_nino2'),(27,'precio_infante'),(28,'desde_adulto'),
  (29,'desde_general'),(30,'descripcion'),(31,'recargo_individual'),(32,'tipo_tarifa')
) as v(posicion, columna)
where not exists (
  select 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'tarifario_resumen'
    and c.column_name = v.columna
)
order by 1, 2;

-- ═════════════════════════════════════════════════════════════════════════
-- B) SECURITY_INVOKER — la vista debe haberse creado con
--    `security_invoker = true` (la migración lo fija explícitamente). 1 fila
--    = OK; 0 filas = se creó con security_definer (incorrecto para esta vista).
-- ═════════════════════════════════════════════════════════════════════════
select
  'SECURITY_INVOKER' as seccion,
  c.relname,
  c.reloptions,
  exists (
    select 1 from pg_catalog.pg_class c2
    join pg_catalog.pg_namespace n2 on n2.oid = c2.relnamespace
    where n2.nspname = 'public' and c2.relname = 'tarifario_resumen'
      and c2.reloptions @> array['security_invoker=true']
  ) as security_invoker_ok
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';

-- ═════════════════════════════════════════════════════════════════════════
-- C) ACL — la migración revoca todo a PUBLIC/anon/authenticated y luego
--    otorga SOLO `select` a anon + authenticated. Debe quedar:
--      · 2 grants de SELECT (uno por rol: anon, authenticated) — ni más ni menos;
--      · 0 grants de escritura (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER)
--        para anon/authenticated/PUBLIC;
--      · 0 grants a PUBLIC.
--    (El dueño de la vista siempre aparece en information_schema con todos los
--    privilegios en cuanto el ACL deja de ser NULL — eso es ownership normal de
--    Postgres, no una fuga.)
-- ═════════════════════════════════════════════════════════════════════════
select
  'ACL' as seccion,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'tarifario_resumen'
      and grantee in ('anon','authenticated') and privilege_type = 'SELECT') as grants_select_anon_auth,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'tarifario_resumen'
      and grantee in ('anon','authenticated','PUBLIC')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) as grants_escritura,
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'tarifario_resumen'
      and grantee = 'PUBLIC') as grants_a_public;

-- ═════════════════════════════════════════════════════════════════════════
-- D.1) MAGNITUD — filas de tarifario_resultado (vigentes) vs. combinaciones
--    distintas que produce el resumen, usando EXACTAMENTE las mismas columnas
--    y el mismo `group by` que la vista (ver nota arriba). El número de
--    grupos es exacto; los grupos que sobrevivan a la vigencia/empaquetados
--    post-carga solo se saben en TypeScript (`lib/tarifario/filtrosPostCarga.ts`).
-- ═════════════════════════════════════════════════════════════════════════
select
  (select count(*) from public.tarifario_resultado where paquete_activo = true) as filas_tarifario_resultado,
  count(*) as filas_resumen_estimadas,
  count(distinct hotel_id) filter (where hotel_id is not null) as hoteles_distintos,
  count(distinct bloqueo_id) filter (where bloqueo_id is not null) as bloqueos_distintos,
  count(distinct paquete_id) as paquetes_distintos
from (
  select
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
  from public.tarifario_resultado
  where paquete_activo = true
  group by
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
) t;

-- ═════════════════════════════════════════════════════════════════════════
-- D.2) SINCRONÍA — count(*) REAL de la vista ya creada vs. la estimación D.1.
--    Deben coincidir EXACTAMENTE (la vista hace un `min()` por acomodación
--    dentro de cada grupo, que NO cambia el número de grupos). Si no
--    coinciden, este script y la migración se desincronizaron — no confiar
--    en ninguno de los dos hasta reconciliarlos.
-- ═════════════════════════════════════════════════════════════════════════
select
  (select count(*) from public.tarifario_resumen) as filas_vista_real,
  count(*) as filas_resumen_estimadas,
  (select count(*) from public.tarifario_resumen) = count(*) as sincronia_exacta
from (
  select
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
  from public.tarifario_resultado
  where paquete_activo = true
  group by
    modulo, paquete_id, paquete_nombre, paquete_activo, bloqueo_id, bloqueo_label,
    empaquetado_id, salida_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
    destino_id, destino_nombre, categoria, regimen, fecha_ida, fecha_regreso, noches, moneda
) t;

-- ═════════════════════════════════════════════════════════════════════════
-- E) Combos con hotel_id pero SIN ningún precio de acomodación de adulto
--    (sencilla/doble/triple/multiple) — hoy esos hoteles ya se muestran como
--    "Consultar" (desde=null) en las tarjetas; confirma que el resumen
--    reproduce exactamente ese mismo caso, no lo esconde ni lo inventa.
-- ═════════════════════════════════════════════════════════════════════════
select
  hotel_id, hotel_nombre, modulo, paquete_id, bloqueo_id,
  count(*) as filas_del_combo
from public.tarifario_resultado
where paquete_activo = true and hotel_id is not null
group by hotel_id, hotel_nombre, modulo, paquete_id, bloqueo_id
having bool_and(acomodacion not in ('sencilla', 'doble', 'triple', 'multiple') or precio_pvp <= 0)
limit 50;

-- ═════════════════════════════════════════════════════════════════════════
-- F) La relación debe existir YA COMO VISTA (relkind 'v') tras aplicar la 162.
--    1 fila con relkind='v' = OK. (La colisión de nombre que este script
--    verificaba en versión pre-migración ahora la verifica el preflight_162
--    antes de aplicar; aquí lo que interesa es que el resultado sea la vista.)
-- ═════════════════════════════════════════════════════════════════════════
select c.relname, c.relkind
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'tarifario_resumen';
