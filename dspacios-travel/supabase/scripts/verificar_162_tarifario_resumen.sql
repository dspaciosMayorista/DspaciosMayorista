-- ═══════════════════════════════════════════════════════════════════════════
-- POSTCHECK · SOLO LECTURA · migración 20260601000162_tarifario_resumen.sql
-- (vista `public.tarifario_resumen`) — correr DESPUÉS de aplicar la 162, sobre
-- el entorno donde se aplicó (local/staging y, post-merge, producción).
-- No escribe nada salvo una tabla temporal de sesión (pg_temp). El reporte se
-- materializa en pg_temp.postcheck_162_reporte y la ÚLTIMA sentencia es
-- `select ... from pg_temp.postcheck_162_reporte order by orden;`.
--
-- Verifica la vista YA CREADA:
--   A) definición: las 32 columnas de salida esperadas existen, con el NOMBRE
--      y la POSICIÓN ORDINAL EXACTA del `create view` de la migración 162;
--   B) security_invoker = true (reloptions);
--   C) ACL vía pg_catalog.pg_class.relacl + aclexplode(): anon SELECT
--      exactamente 1, authenticated SELECT exactamente 1, PUBLIC sin
--      privilegios, y CERO privilegios de ESCRITURA únicamente para PUBLIC/
--      anon/authenticated (NO se cuentan el owner ni postgres — sus privilegios
--      son implícitos y legítimos);
--   D) conteos: sincronía entre el resumen estimado a mano (mismo group by de
--      20 columnas que la vista) y el count(*) REAL de la vista ya creada —
--      deben coincidir EXACTAMENTE;
--   E) la vista debe existir YA COMO VISTA (relkind 'v').
--
-- ⚠️ NUNCA aborta: si la vista no existe o no es relkind 'v', el reporte
-- devuelve FAILED (cada check cae a false) — todas las lecturas usan
-- información de catálogos o subconsultas que devuelven NULL/0 cuando el
-- objeto falta, jamás `::regclass` directo (que lanzaría "relation does not
-- exist"). Los conteos se ejecutan con `execute` DINÁMICO SOLO cuando la
-- estructura requerida existe (vista presente Y tabla base con las columnas
-- del group by); si no, quedan NULL y la sincronía sale FAILED / NO CALCULADA.
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
-- Bloque de CONTEO condicional (sincronía). Calcula filas de la vista y filas
-- estimadas por el group by SOLO cuando la estructura requerida existe; si no,
-- deja ambas en NULL (el reporte mostrará sincronía FAILED / NO CALCULADA).
-- De paso elimina/recrea limpiamente las dos tablas temporales del script.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  _existe_vista boolean;
  _estructura_base_ok boolean;
begin
  execute 'drop table if exists pg_temp.postcheck_162_conteos';
  execute 'drop table if exists pg_temp.postcheck_162_reporte';

  -- La vista debe existir YA COMO VISTA (relkind 'v').
  select exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resumen'
      and c.relkind = 'v'
  ) into _existe_vista;

  -- La tabla base debe existir (relkind r/p) con las columnas del group by
  -- (20) + paquete_activo (filtro) para poder estimar la sincronía.
  select
      to_regclass('public.tarifario_resultado') is not null
  and exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tarifario_resultado'
      and c.relkind in ('r', 'p')
  )
  and not exists (
    select 1 from (values
      ('paquete_activo'),('modulo'),('paquete_id'),('paquete_nombre'),('bloqueo_id'),
      ('bloqueo_label'),('empaquetado_id'),('salida_id'),('hotel_id'),('hotel_nombre'),
      ('servicio_id'),('servicio_nombre'),('destino_id'),('destino_nombre'),('categoria'),
      ('regimen'),('fecha_ida'),('fecha_regreso'),('noches'),('moneda')
    ) r(columna)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'tarifario_resultado'
        and c.column_name = r.columna
    )
  )
  into _estructura_base_ok;

  if _existe_vista and _estructura_base_ok then
    -- SOLO aquí se leen la vista y la tabla reales (count). El `group by` es
    -- EXACTAMENTE el de la vista 162.
    execute $cnt$
      create temp table pg_temp.postcheck_162_conteos as
      select
        (select count(*) from public.tarifario_resumen) as filas_vista_real,
        (select count(*) from (
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
        ) s) as filas_estimadas
    $cnt$;
  else
    -- Estructura ausente: no ejecutar la lectura; dejar conteos en NULL.
    create temp table pg_temp.postcheck_162_conteos as
      select null::bigint as filas_vista_real, null::bigint as filas_estimadas;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- REPORTE CONSOLIDADO, materializado en pg_temp.postcheck_162_reporte.
-- El veredicto_final se deriva de ESTAS MISMAS filas (bool_and(pass)).
-- ───────────────────────────────────────────────────────────────────────────
create table pg_temp.postcheck_162_reporte as
with

-- A) Columnas por NOMBRE Y POSICIÓN ORDINAL EXACTA. Si la vista no existe,
--    information_schema no devuelve filas → cada columna esperada "falta" →
--    count > 0 → ok = false (FAILED). Nunca aborta.
definicion as (
  select
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

-- B) security_invoker = true (si la vista no existe → false → FAILED).
seguridad as (
  select coalesce((
    select exists (
      select 1 from pg_catalog.pg_class c2
      join pg_catalog.pg_namespace n2 on n2.oid = c2.relnamespace
      where n2.nspname = 'public' and c2.relname = 'tarifario_resumen'
        and c2.reloptions @> array['security_invoker=true']
    )
  ), false) as ok
),

-- C) ACL. Sin casts `::regclass`: se resuelve el oid de la vista por catálogo
--    (NULL si no existe → 0 grants → FAILED, sin abortar). El owner/postgres
--    NO se cuentan (sus privilegios son implícitos, fuera de relacl).
oid_vista as (
  select c.oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'tarifario_resumen'
),

acl as (
  select
    -- SELECT a anon: exactamente 1.
    coalesce((
      select count(*) = 1
      from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      join pg_catalog.pg_roles r on r.oid = acl.grantee
      where c.oid = (select oid from oid_vista)
        and r.rolname = 'anon' and acl.privilege_type = 'SELECT'
    ), false) as anon_select_ok,
    -- SELECT a authenticated: exactamente 1.
    coalesce((
      select count(*) = 1
      from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      join pg_catalog.pg_roles r on r.oid = acl.grantee
      where c.oid = (select oid from oid_vista)
        and r.rolname = 'authenticated' and acl.privilege_type = 'SELECT'
    ), false) as auth_select_ok,
    -- PUBLIC (grantee oid 0) sin privilegios de ningún tipo.
    coalesce((
      select count(*) = 0
      from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      where c.oid = (select oid from oid_vista)
        and acl.grantee = 0
    ), true) as public_sin_privilegios_ok,
    -- CERO privilegios de ESCRITURA únicamente para PUBLIC/anon/authenticated.
    -- (Si la vista no existe, el where sobre oid NULL no devuelve filas → true.)
    coalesce((
      select count(*) = 0
      from pg_catalog.pg_class c
      cross join lateral aclexplode(c.relacl) acl
      left join pg_catalog.pg_roles r on r.oid = acl.grantee
      where c.oid = (select oid from oid_vista)
        and acl.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
        and (acl.grantee = 0 or r.rolname in ('anon','authenticated'))
    ), true) as escritura_cero_ok
),

-- D) Sincronía de conteos (NULL cuando la estructura requerida no existe →
--    ok = false → FAILED / NO CALCULADA).
sincronia as (
  select
    (select filas_vista_real from pg_temp.postcheck_162_conteos) as filas_vista_real,
    (select filas_estimadas from pg_temp.postcheck_162_conteos) as filas_estimadas,
    coalesce((
      select filas_vista_real = filas_estimadas
      from pg_temp.postcheck_162_conteos
      where filas_vista_real is not null and filas_estimadas is not null
    ), false) as ok
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
      'FAILED — columnas fuera de nombre u orden, el total no es 32, o la vista no existe' end as resultado

  union all

  select
    2 as orden,
    'B · security_invoker = true' as chequeo,
    (select ok from seguridad) as pass,
    case when (select ok from seguridad) then 'PASSED — reloptions contiene security_invoker=true' else
      'FAILED — la vista no se creó con security_invoker=true (¿security_definer?) o no existe' end as resultado

  union all

  select
    3 as orden,
    'C · ACL: anon SELECT=1 · authenticated SELECT=1 · PUBLIC sin privilegios · cero escritura (solo PUBLIC/anon/auth)' as chequeo,
    ((select anon_select_ok from acl) and (select auth_select_ok from acl)
      and (select public_sin_privilegios_ok from acl) and (select escritura_cero_ok from acl)) as pass,
    case
      when (select anon_select_ok from acl) and (select auth_select_ok from acl)
        and (select public_sin_privilegios_ok from acl) and (select escritura_cero_ok from acl)
        then 'PASSED — anon SELECT=1 ✓ · authenticated SELECT=1 ✓ · PUBLIC sin privilegios ✓ · escritura 0 (PUBLIC/anon/auth) ✓'
      else 'FAILED — revisar ACL:' ||
        case when not (select anon_select_ok from acl) then ' anon SELECT ≠ exactamente 1' else '' end ||
        case when not (select auth_select_ok from acl) then ' authenticated SELECT ≠ exactamente 1' else '' end ||
        case when not (select public_sin_privilegios_ok from acl) then ' PUBLIC tiene privilegios' else '' end ||
        case when not (select escritura_cero_ok from acl) then ' hay escritura para PUBLIC/anon/auth' else '' end ||
        case when not (exists (select 1 from oid_vista)) then ' (la vista no existe)' else '' end
    end as resultado

  union all

  select
    4 as orden,
    'D · sincronía: count(*) de la vista == estimación (mismo GROUP BY de 20 columnas)' as chequeo,
    (select ok from sincronia) as pass,
    case
      when (select filas_estimadas from sincronia) is null
        then 'FAILED — NO CALCULADA: estructura requerida ausente (vista o base/columnas)'
      when (select ok from sincronia)
        then 'PASSED — vista=' || (select filas_vista_real from sincronia)::text ||
             ' · estimada=' || (select filas_estimadas from sincronia)::text ||
             ' (coinciden exactamente)'
      else 'FAILED — vista=' || coalesce((select filas_vista_real from sincronia)::text,'NULL') ||
           ' ≠ estimada=' || coalesce((select filas_estimadas from sincronia)::text,'NULL') ||
           ' — script y migración desincronizados; reconciliar antes de confiar'
    end as resultado

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

-- ÚLTIMA sentencia: lectura del reporte ya materializado (nada después).
select orden, chequeo, pass, resultado, veredicto_final
from pg_temp.postcheck_162_reporte
order by orden;
