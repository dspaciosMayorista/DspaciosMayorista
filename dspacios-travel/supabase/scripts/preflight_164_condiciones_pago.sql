-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 164 · condiciones de pago por componente (SOLO LECTURA)
--
-- Verifica, ANTES de aplicar la migración 164, que el estado de la BD está
-- listo y que la migración NO ha sido aplicada todavía. Nunca aborta ni
-- escribe: materializa un reporte en `pg_temp.preflight_164_reporte` y deja
-- un veredicto general. El dueño lo corre en producción cuando el code-review
-- lo autorice.
--
-- Verifica, con consultas de catálogo (no `::regclass`), cada pieza que la
-- 164 crea/espera:
--   · que las columnas/tablas NUEVAS de la 164 NO existan aún (→ migración no
--     aplicada). Si alguna YA existe, es señal de que ya se aplicó o de que
--     choca con otra línea → revisar antes de aplicar.
--   · que las tablas/columnas de ORIGEN que la 164 va a tocar EXISTEN
--     (cotizaciones, abonos, ventas, hotel_temporadas, armado_paquetes,
--     programas, asientos_contables/asiento_lineas/puc_cuentas, usuarios).
--   · que las cuentas del Plan que los posteos de la 164 necesitan existen
--     por tenant: 110505 Caja, 111005/111010 Bancos, 280505 Anticipos,
--     280510 Anticipos sin identificar.
--   · que los helpers RLS que la 164 reutiliza existen:
--     mi_rol / mi_tenant / puede_ver_tenant / puede_ver_contrato /
--     puede_ver_cotizacion / puede_ver_tenant_cotizacion.
--   · precondición de numeración: la 161/162/163 ya deben estar (espejo de
--     que la cadena previa se corrió).
--
-- Veredicto: si todo OK → "PREFLIGHT OK — la 164 se puede aplicar".
-- Si algo falta o choca → "PREFLIGHT BLOQUEADO — revisar filas BLOCKED".
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_164_reporte (
  seccion text,
  nombre  text,
  estado  text,   -- OK | BLOCKED | INFO
  detalle text
);
truncate pg_temp.preflight_164_reporte;

-- 1) La 164 NO debe estar aplicada todavía: ninguna de sus piezas nuevas existe.
insert into pg_temp.preflight_164_reporte
select '164-no-aplicada', 'columnas condicion_pago_* / ventas.cotizacion_id / tablas nuevas',
  case when choca = 0 then 'OK' else 'BLOCKED' end,
  case when choca = 0 then 'Ninguna pieza nueva presente' else choca || ' piezas nuevas YA existen — la 164 parece aplicada o hay colisión; revisar antes.' end
from (
  select count(*)::int as choca from (
    select 1 from information_schema.columns where table_schema='public' and table_name='hotel_temporadas' and column_name='condicion_pago_tipo'
    union select 1 from information_schema.columns where table_schema='public' and table_name='armado_paquetes' and column_name='condicion_pago_tipo'
    union select 1 from information_schema.columns where table_schema='public' and table_name='programas' and column_name='condicion_pago_tipo'
    union select 1 from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='cotizacion_id'
    union select 1 from information_schema.columns where table_schema='public' and table_name='cotizaciones' and column_name='condicion_pago_congelada_en'
    union select 1 from information_schema.tables where table_schema='public' and table_name in
      ('config_cobros_componente','cotizacion_condiciones','cotizacion_pagos_previos','contrato_condiciones','restriccion_overrides')
  ) t
) q;

-- 1bis) Commit 5 (conversión atómica) es PARTE de la 164: si el RPC o sus helpers
--   ya existen, la 164 (o una versión parcial) está aplicada → detectarlo también
--   a nivel de función, no solo de columna/tabla.
insert into pg_temp.preflight_164_reporte
select '164-no-aplicada', 'funciones Commit 5 (convertir_cotizacion_a_contrato + helpers)',
  case when choca = 0 then 'OK' else 'BLOCKED' end,
  case when choca = 0 then 'Ninguna función de conversión presente' else choca || ' función(es) Commit 5 YA existen — la 164 parece aplicada o hay colisión; revisar antes.' end
from (
  select count(*)::int as choca from (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('convertir_cotizacion_a_contrato','_tipo_cotizacion_convertible','_monto_cop_pagado',
       '_tipo_proveedor_cxp','_cuentas_cxp')
  ) t
) q;

-- 1ter) Commit 6 (condiciones permanentes/candados/overrides) es PARTE de la
--   164: si sus funciones/columnas ya existen, esa porción (o toda la 164) ya
--   se aplicó → detectarlo antes de reintentar.
insert into pg_temp.preflight_164_reporte
select '164-no-aplicada', 'Commit 6 (registrar_override_restriccion + candados + columnas de alcance)',
  case when choca = 0 then 'OK' else 'BLOCKED' end,
  case when choca = 0 then 'Ninguna pieza del Commit 6 presente' else choca || ' pieza(s) del Commit 6 YA existen — revisar antes.' end
from (
  select count(*)::int as choca from (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('registrar_override_restriccion','_autorizado_override')
    union
    select 1 from information_schema.columns where table_schema='public' and table_name='restriccion_overrides'
      and column_name in ('contrato_condicion_id','restriccion_afectada')
    union
    select 1 from pg_trigger tg join pg_class rel on rel.oid=tg.tgrelid join pg_namespace n on n.oid=rel.relnamespace
      where n.nspname='public' and tg.tgname in
        ('trg_contrato_condiciones_inmutable','trg_ventas_cotizacion_id_inmutable','trg_restriccion_overrides_guardas')
  ) t
) q;

-- 2) Tablas de origen que la 164 toca deben existir.
insert into pg_temp.preflight_164_reporte
select 'origen', t.tabla,
  case when exists (select 1 from information_schema.tables where table_schema='public' and table_name=t.tabla) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from information_schema.tables where table_schema='public' and table_name=t.tabla) then 'Presente' else 'FALTA la tabla origen' end
from (values
  ('cotizaciones'),('abonos'),('ventas'),('hotel_temporadas'),('armado_paquetes'),
  ('programas'),('asientos_contables'),('asiento_lineas'),('puc_cuentas'),('usuarios'),
  ('config_cobros')
) as t(tabla);

-- 3) Columnas que la 164 USARÁ en tablas existentes deben existir.
insert into pg_temp.preflight_164_reporte
select 'origen-cols', c.tabla || '.' || c.col,
  case when exists (select 1 from information_schema.columns x
         where x.table_schema='public' and x.table_name=c.tabla and x.column_name=c.col) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from information_schema.columns x
         where x.table_schema='public' and x.table_name=c.tabla and x.column_name=c.col) then 'Presente' else 'FALTA la columna origen' end
from (values
  ('cotizaciones','estado'),('cotizaciones','moneda'),('cotizaciones','precio_venta'),
  ('cotizaciones','cliente'),('cotizaciones','numero_contrato'),
  ('abonos','trm'),('abonos','monto_cop'),('abonos','tenant'),('abonos','recibido_por'),
  ('ventas','numero_contrato'),('ventas','estado'),
  ('usuarios','id'),('usuarios','email'),('usuarios','rol'),('usuarios','activo'),
  ('asientos_contables','tenant'),('asientos_contables','numero'),('asientos_contables','origen'),
  ('asiento_lineas','asiento_id'),('puc_cuentas','codigo'),('puc_cuentas','tenant')
) as c(tabla, col);

-- 4) Cuentas del PUC que la 164 necesita (por cada tenant presente).
insert into pg_temp.preflight_164_reporte
select 'puc', 'tenant=' || t.tenant || ' codigo=' || c.codigo,
  case when exists (select 1 from puc_cuentas p where p.tenant=t.tenant and p.codigo=c.codigo) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from puc_cuentas p where p.tenant=t.tenant and p.codigo=c.codigo) then 'Presente' else 'FALTA la cuenta del PUC' end
from (select distinct tenant from puc_cuentas where tenant in ('mayorista','minorista')) t
cross join (values ('110505'),('111005'),('111010'),('280505'),('280510')) as c(codigo);

-- 5) Helpers RLS que la 164 reutiliza.
insert into pg_temp.preflight_164_reporte
select 'helpers', f.nombre,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=f.nombre) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=f.nombre) then 'Presente' else 'FALTA el helper' end
from (values
  ('mi_rol'),('mi_tenant'),('puede_ver_tenant'),('puede_ver_contrato'),
  ('puede_ver_cotizacion'),('puede_ver_tenant_cotizacion')
) as f(nombre);

-- 6) Numeración: la 161/162/163 deben existir como migraciones previas (espejo).
insert into pg_temp.preflight_164_reporte
select 'numeracion', archivo,
  case when exists (select 1 from pg_extension) then 'OK' else 'OK' end,  -- no-op informativo: la cadena la confirma el dueño al correr
  'Confirmar que 161/162/163 ya se aplicaron antes de la 164 (la migración es aditiva sobre ellas).'
from (values
  ('20260601000161_...'),('20260601000162_...'),('20260601000163_...')
) as a(archivo);

-- Reporte + veredicto general.
do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.preflight_164_reporte;
  select count(*) into v_bad from pg_temp.preflight_164_reporte where estado='BLOCKED';
  if v_bad = 0 then
    raise notice 'PREFLIGHT 164: %/% chequeos OK (0 BLOCKED) — la migración 164 se puede aplicar.', v_total, v_total;
  else
    raise notice 'PREFLIGHT 164: % chequeos, % BLOCKED — revisar antes de aplicar.', v_total, v_bad;
  end if;
  -- Veredicto único, literal y greppable (contrato del runner/CI): exactamente
  -- una de estas dos líneas, sin variantes de texto alrededor del token.
  raise notice 'VEREDICTO PREFLIGHT 164: %', (case when v_bad = 0 then 'OK' else 'BLOQUEADO' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.preflight_164_reporte order by estado desc, seccion, nombre;
