-- ═══════════════════════════════════════════════════════════════════════════
-- POSTCHECK · SOLO LECTURA · migración 20260601000162_tarifario_resumen.sql
-- (vista `public.tarifario_resumen`) — correr DESPUÉS de aplicar la 162, sobre
-- el entorno donde se aplicó (local/staging y, post-merge, producción).
-- No escribe nada. Devuelve UN ÚNICO reporte consolidado con veredicto
-- PASSED/FAILED como ÚLTIMA sentencia (nada después).
--
-- Verifica la vista YA CREADA:
--   A) definición: las 32 columnas de salida esperadas existen, con el NOMBRE
--      y la POSICIÓN ORDINAL EXACTA del `create view` de la migración 162;
--   B) security_invoker = true (reloptions);
--   C) ACL vía pg_catalog.pg_class.relacl + aclexplode(): anon SELECT=true,
--      authenticated SELECT=true, PUBLIC sin privilegios, y CERO privilegios de
--      escritura para nadie;
--   D) conteos: sincronía entre el resumen estimado a mano (mismo group by de
--      20 columnas que la vista) y el count(*) REAL de la vista ya creada —
--      deben coincidir EXACTAMENTE;
--   E) control funcional: la vista debe existir YA COMO VISTA (relkind 'v').
--
-- ⚠️ La estimación (consulta D.1) usa exactamente las mismas 20 columnas y el
-- mismo `group by` que `create view public.tarifario_resumen` (migración 162).
-- Si alguna vez se edita el `group by` de la vista, este script debe
-- actualizarse en el mismo commit para no volver a desincronizarse.
--
-- ⚠️ Revisión posterior (defecto confirmado y corregido): la versión anterior
-- de este script agrupaba por SOLO 7 columnas (modulo, paquete_id, bloqueo_id,
-- hotel_id, servicio_id, fecha_ida, fecha_regreso) — MENOS columnas que el
-- `group by` real de la vista 162 (20 columnas). Agrupar por menos columnas
-- SIEMPRE produce un conteo IGUAL o MENOR al real — la preventiva vieja podía
-- reportar una reducción más favorable de lo que la vista entrega. La consulta
-- D.1 usa AHORA exactamente las mismas 20 columnas y el mismo `group by`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Datos crudos (un solo bloque `with`; la ÚLTIMA sentencia es el reporte).
-- Ninguna de estas lecturas aborta en el contexto POST-migración: si la vista
-- ya se creó, la tabla base existe por construcción.
-- ───────────────────────────────────────────────────────────────────────────
with

-- A) Columnas por NOMBRE Y POSICIÓN ORDINAL EXACTA. Compara la posición real
--    (information_schema.columns.ordinal_position) contra la posición esperada
--    de la lista de 32 de la migración 162, columna a columna.
definicion as (
  select
    -- 0 desajustes (cada columna esperada existe Y en su posición exacta)
    -- Y el total de columnas es exactamente 32 (no hay columnas extra).
    (
      select count(*) from (values
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
          and c.column_name = v.columna and c.ordinal_position = v.posicion
      )
    ) = 0
    -- Y no hay columnas extra (el total debe ser exactamente 32).
    and (
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tarifario_resumen'
    ) = 32 as ok
),

-- B) security_invoker = true.
seguridad as (
  select
    coalesce((
      select exists (
        select 1 from pg_catalog.pg_class c2
        join pg_catalog.pg_namespace n2 on n2.oid = c2.relnamespace
        where n2.nspname = 'public' and c2.relname = 'tarifario_resumen'
          and c2.reloptions @> array['security_invoker=true']
      )
    ), false) as ok
),

-- C) ACL vía pg_class.relacl + aclexplode(). Contamos, de los GRANTS EXPLÍCITOS
--    del ACL de la vista (el owner tiene privilegios implícitos y NO aparece en
--    relacl), cuántos son SELECT para anon, SELECT para authenticated, cuántos
--    pertenecen a PUBLIC, y cuántos son de ESCRITURA para cualquiera.
acl as (
  select
    -- SELECT a anon (grante rolname 'anon').
    coalesce((
      select count(*) = 1 from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      join pg_catalog.pg_roles r on r.oid = acl.grantee
      where c.oid = 'public.tarifario_resumen'::regclass
        and r.rolname = 'anon' and acl.privilege_type = 'SELECT'
    ), false) as anon_select_ok,
    -- SELECT a authenticated.
    coalesce((
      select count(*) = 1 from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      join pg_catalog.pg_roles r on r.oid = acl.grantee
      where c.oid = 'public.tarifario_resumen'::regclass
        and r.rolname = 'authenticated' and acl.privilege_type = 'SELECT'
    ), false) as auth_select_ok,
    -- PUBLIC (grantee oid 0) sin privilegios.
    coalesce((
      select count(*) = 0 from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      where c.oid = 'public.tarifario_resumen'::regclass
        and acl.grantee = 0
    ), true) as public_sin_privilegios_ok,
    -- CERO privilegios de ESCRITURA para nadie (todos los grantees).
    coalesce((
      select count(*) = 0 from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      where c.oid = 'public.tarifario_resumen'::regclass
        and acl.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
    ), true) as escritura_cero_ok
),

-- D) Conteos: estimación manual (mismo group by de 20 columnas) vs count(*)
--    REAL de la vista. Deben coincidir EXACTAMENTE.
--    D.1) estimación por el mismo group by; D.2) sincronía con la vista.
estimado as (
  select count(*) as filas_estimadas
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
  ) t
),

sincronia as (
  select
    (select count(*) from public.tarifario_resumen) as filas_vista_real,
    (select filas_estimadas from estimado) as filas_estimadas,
    (select count(*) from public.tarifario_resumen) = (select filas_estimadas from estimado) as ok
),

-- E) La relación debe ser YA una VISTA (relkind 'v').
es_vista as (
  select coalesce((
    select c.relkind = 'v' from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resumen'
  ), false) as ok
),

checks as (
  select
    1 as orden,
    'A · definición: 32 columnas con nombre y posición ordinal EXACTA' as chequeo,
    (select ok from definicion) as pass,
    case when (select ok from definicion) then 'PASSED — 32 columnas correctas (nombre y orden)' else
      'FAILED — columnas fuera de nombre u orden, o el total no es 32' end as resultado

  union all

  select
    2 as orden,
    'B · security_invoker = true' as chequeo,
    (select ok from seguridad) as pass,
    case when (select ok from seguridad) then 'PASSED — reloptions contiene security_invoker=true' else
      'FAILED — la vista no se creó con security_invoker=true (¿security_definer?)' end as resultado

  union all

  select
    3 as orden,
    'C · ACL: anon SELECT / authenticated SELECT / PUBLIC sin privilegios / cero escritura' as chequeo,
    ((select anon_select_ok from acl) and (select auth_select_ok from acl)
      and (select public_sin_privilegios_ok from acl) and (select escritura_cero_ok from acl)) as pass,
    case
      when (select anon_select_ok from acl) and (select auth_select_ok from acl)
        and (select public_sin_privilegios_ok from acl) and (select escritura_cero_ok from acl)
        then 'PASSED — anon SELECT ✓ · authenticated SELECT ✓ · PUBLIC sin privilegios ✓ · escritura 0 ✓'
      else 'FAILED — revisar ACL:' ||
        case when not (select anon_select_ok from acl) then ' falta/sobra SELECT a anon' else '' end ||
        case when not (select auth_select_ok from acl) then ' falta/sobra SELECT a authenticated' else '' end ||
        case when not (select public_sin_privilegios_ok from acl) then ' PUBLIC tiene privilegios' else '' end ||
        case when not (select escritura_cero_ok from acl) then ' hay privilegios de escritura' else '' end
    end as resultado

  union all

  select
    4 as orden,
    'D · sincronía: count(*) de la vista == estimación (mismo GROUP BY de 20 columnas)' as chequeo,
    (select ok from sincronia) as pass,
    case when (select ok from sincronia)
      then 'PASSED — vista=' || (select filas_vista_real from sincronia)::text ||
           ' · estimada=' || (select filas_estimadas from sincronia)::text ||
           ' (coinciden exactamente)'
      else 'FAILED — vista=' || (select filas_vista_real from sincronia)::text ||
           ' ≠ estimada=' || (select filas_estimadas from sincronia)::text ||
           ' — script y migración desincronizados; reconciliar antes de confiar' end as resultado

  union all

  select
    5 as orden,
    'E · la relación existe YA COMO VISTA (relkind v)' as chequeo,
    (select ok from es_vista) as pass,
    case when (select ok from es_vista) then 'PASSED — relkind = v (vista)' else
      'FAILED — public.tarifario_resumen no es una vista (¿no aplicó la 162?)' end as resultado
)

select
  orden,
  chequeo,
  pass,
  resultado,
  case
    when bool_and(pass) over () then 'PASSED — la migración 162 quedó aplicada correctamente'
    else 'FAILED — corregir la(s) fila(s) con pass=false antes de desplegar el código de la vista'
  end as veredicto_final
from checks
order by orden;
