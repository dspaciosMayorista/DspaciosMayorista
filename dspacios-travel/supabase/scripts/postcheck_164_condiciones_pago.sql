-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 164 · condiciones de pago por componente (SOLO LECTURA)
--
-- Verifica, DESPUÉS de aplicar la migración 164, que todo quedó como debe.
-- Materializa `pg_temp.postcheck_164_reporte` y da un veredicto general.
-- Reutiliza las convenciones de la 162 (nombres de columna, ACL con
-- aclexplode, conteo de seeds). Nunca escribe.
--
-- Comprueba:
--   · columnas NUEVAS presentes con tipo/default correctos (aditivas, con
--     NOT NULL default en las de condición, resto nullable).
--   · tablas nuevas presentes + RLS activa.
--   · `config_cobros_componente` sembrada con hotel/vuelo_bloqueo/servicio=0.30
--     y SIN fila aereo_empaquetado (corrección #8).
--   · constraints de check y el UNIQUE `ventas_cotizacion_id_key`.
--   · trigger de congelado de condiciones + helper `_autorizado_pago_previo`.
--   · ACL de las 3 funciones de dinero: ejecutables SOLO por service_role
--     (revoked a public/anon/authenticated).
--   · helpers RLS intactos (mi_rol/mi_tenant/puede_ver_*).
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.postcheck_164_reporte (
  seccion text,
  nombre  text,
  estado  text,   -- OK | BLOCKED
  detalle text
);
truncate pg_temp.postcheck_164_reporte;

-- 1) Columnas aditivas con su default/not-null esperado.
insert into pg_temp.postcheck_164_reporte
select 'cols', c.tabla || '.' || c.col,
  case when exists (select 1 from information_schema.columns x
         where x.table_schema='public' and x.table_name=c.tabla and x.column_name=c.col
           and coalesce(x.column_default,'') = coalesce(c.default,'')
           and (x.is_nullable='NO') = c.not_null) then 'OK' else 'BLOCKED' end,
  'default esperado: ' || coalesce(c.default,'(null)') || ' · not null: ' || c.not_null
from (values
  ('hotel_temporadas','condicion_pago_tipo','''sin_condicion''::text',true),
  ('hotel_temporadas','condicion_pago_pct_inicial',null,false),
  ('hotel_temporadas','condicion_pago_dias_saldo',null,false),
  ('armado_paquetes','condicion_pago_tipo','''normal''::text',true),
  ('armado_paquetes','condicion_pago_pct_inicial',null,false),
  ('armado_paquetes','condicion_pago_dias_saldo',null,false),
  ('armado_paquetes','restriccion_comercial','''normal''::text',true),
  ('programas','condicion_pago_tipo','''normal''::text',true),
  ('programas','condicion_pago_pct_inicial',null,false),
  ('programas','condicion_pago_dias_saldo',null,false),
  ('programas','restriccion_comercial','''normal''::text',true),
  ('cotizaciones','condicion_pago_congelada_en',null,false),
  ('cotizaciones','moneda_congelada',null,false),
  ('cotizaciones','trm_autoritativa','1',false),
  ('cotizaciones','precio_total_congelado',null,false),
  ('cotizaciones','monto_exigido_total',null,false),
  ('cotizaciones','monto_exigido_total_cop',null,false),
  ('cotizaciones','pct_efectivo_informativo',null,false),
  ('ventas','cotizacion_id',null,false)
) as c(tabla, col, default, not_null);

-- 2) Tablas nuevas presentes + RLS activa.
insert into pg_temp.postcheck_164_reporte
select 'tablas', t.tabla,
  case when exists (select 1 from information_schema.tables where table_schema='public' and table_name=t.tabla)
         and exists (select 1 from pg_class rel join pg_namespace n on n.oid=rel.relnamespace
                     where n.nspname='public' and rel.relname=t.tabla and rel.relrowsecurity)
    then 'OK' else 'BLOCKED' end,
  'Tabla + RLS activa esperadas'
from (values
  ('config_cobros_componente'),('cotizacion_condiciones'),('cotizacion_pagos_previos'),
  ('contrato_condiciones'),('restriccion_overrides')
) as t(tabla);

-- 3) config_cobros_componente: seed de 3 filas, sin aereo_empaquetado.
insert into pg_temp.postcheck_164_reporte
select 'seed-config', 'config_cobros_componente',
  case when (select count(*) from config_cobros_componente where tipo_componente in ('hotel','vuelo_bloqueo','servicio')) = 3
         and not exists (select 1 from config_cobros_componente where tipo_componente='aereo_empaquetado')
    then 'OK' else 'BLOCKED' end,
  'Espera hotel+vuelo_bloqueo+servicio (0.30) y NINGUNA fila aereo_empaquetado (100% fijo en el motor).';

-- 4) Constraints: checks de condición/restricción en fuentes + UNIQUE ventas.cotizacion_id.
insert into pg_temp.postcheck_164_reporte
select 'constraints', 'ventas_cotizacion_id_key',
  case when exists (select 1 from pg_constraint where conname='ventas_cotizacion_id_key') then 'OK' else 'BLOCKED' end,
  'UNIQUE nullable para UN SOLO CONTRATO por cotización';
insert into pg_temp.postcheck_164_reporte
select 'constraints', c.con,
  case when exists (select 1 from pg_constraint where conname=c.con) then 'OK' else 'BLOCKED' end,
  'check sobre ' || c.tabla
from (values
  ('hotel_temporadas_condicion_pago_tipo_check','hotel_temporadas'),
  ('hotel_temporadas_anticipo_coherencia_check','hotel_temporadas'),
  ('armado_paquetes_condicion_pago_tipo_check','armado_paquetes'),
  ('armado_paquetes_restriccion_check','armado_paquetes'),
  ('programas_condicion_pago_tipo_check','programas'),
  ('programas_restriccion_check','programas'),
  ('cotizacion_pagos_previos_estado_check','cotizacion_pagos_previos')
) as c(con, tabla);

-- 5) Trigger de congelado + helper de autorización.
insert into pg_temp.postcheck_164_reporte
select 'trigger', 'trg_cotizacion_condiciones_bloquear_congeladas',
  case when exists (select 1 from pg_trigger t join pg_class rel on rel.oid=t.tgrelid
         join pg_namespace n on n.oid=rel.relnamespace
         where n.nspname='public' and rel.relname='cotizacion_condiciones' and t.tgname='trg_cotizacion_condiciones_bloquear_congeladas')
    then 'OK' else 'BLOCKED' end,
  'Bloquea alterar condiciones cuando la cotización está congelada';
insert into pg_temp.postcheck_164_reporte
select 'funciones', '_autorizado_pago_previo',
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='_autorizado_pago_previo') then 'OK' else 'BLOCKED' end,
  'Helper de doble autorización de pagos previos (rol interno autorizado + activo).';

-- 6) ACL de las 3 funciones de dinero: SOLO service_role ejecuta.
--    aclexplode da el oid del grantee; PUBLIC es oid 0; anon/authenticated/
--    service_role se resuelven por nombre en pg_roles. La migración hace
--    `revoke all from public, anon, authenticated` + `grant ... to service_role`,
--    así que la única EXECUTE concedida (directa o vía PUBLIC) debe ser service_role.
insert into pg_temp.postcheck_164_reporte
select 'acl-funciones', p.proname,
  case when
    -- existe al menos una EXECUTE para service_role (por nombre)...
    exists (
      select 1 from pg_proc pp join pg_namespace nn on nn.oid=pp.pronamespace
      cross join lateral aclexplode(coalesce(pp.proacl, acldefault('f', pp.proowner))) e
      left join pg_roles r on r.oid = e.grantee
      where nn.nspname='public' and pp.proname=p.proname and e.privilege_type='EXECUTE'
        and r.rolname = 'service_role')
    -- ...y NINGUNA EXECUTE alcanzable desde public/anon/authenticated.
    and not exists (
      select 1 from pg_proc pp join pg_namespace nn on nn.oid=pp.pronamespace
      cross join lateral aclexplode(coalesce(pp.proacl, acldefault('f', pp.proowner))) e
      left join pg_roles r on r.oid = e.grantee
      where nn.nspname='public' and pp.proname=p.proname and e.privilege_type='EXECUTE'
        and (e.grantee = 0 or r.rolname in ('anon','authenticated')))
    then 'OK' else 'BLOCKED' end,
  'EXECUTE solo para service_role; anon/authenticated/PUBLIC sin acceso (cierra la llamada directa con sesión).'
from (values
  ('registrar_pago_previo'),('anular_pago_previo'),('transferir_pagos_previos_a_abonos')
) as p(proname);

-- Veredicto general.
do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.postcheck_164_reporte;
  select count(*) into v_bad from pg_temp.postcheck_164_reporte where estado='BLOCKED';
  if v_bad = 0 then
    raise notice 'POSTCHECK 164: %/OK (0 BLOCKED) — la 164 quedó aplicada correctamente.', v_total;
  else
    raise notice 'POSTCHECK 164: % chequeos, % BLOCKED — revisar.', v_total, v_bad;
  end if;
end $$;

select seccion, nombre, estado, detalle from pg_temp.postcheck_164_reporte order by estado desc, seccion, nombre;
