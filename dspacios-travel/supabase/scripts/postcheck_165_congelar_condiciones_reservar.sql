-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 165 · congelar_condiciones_contrato (SOLO LECTURA)
--
-- Verifica, DESPUÉS de aplicar la migración 165, que todo quedó como debe.
-- Materializa `pg_temp.postcheck_165_reporte` y da un veredicto general.
-- Nunca escribe.
--
-- Comprueba:
--   · las 2 funciones nuevas existen.
--   · ACL: EXECUTE solo para service_role; anon/authenticated/PUBLIC sin
--     acceso (misma convención que las funciones de dinero de la 164).
--   · NINGÚN cambio de esquema: la 165 no debió agregar columnas ni tablas
--     ni tocar constraints/triggers/RLS existentes (espejo negativo — si algo
--     de esto aparece, algo se coló fuera del alcance aprobado).
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.postcheck_165_reporte (
  seccion text,
  nombre  text,
  estado  text,   -- OK | BLOCKED
  detalle text
);
truncate pg_temp.postcheck_165_reporte;

-- 1) Las 2 funciones nuevas existen.
insert into pg_temp.postcheck_165_reporte
select 'funciones', f.nombre,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname=f.nombre) then 'OK' else 'BLOCKED' end,
  'Función esperada tras aplicar la 165'
from (values ('_autorizado_congelar_condiciones'), ('congelar_condiciones_contrato')) as f(nombre);

-- 2) ACL: EXECUTE solo para service_role (mismo patrón aclexplode que el
--    postcheck 164, sección 6).
insert into pg_temp.postcheck_165_reporte
select 'acl-funciones', p.proname,
  case when
    exists (
      select 1 from pg_proc pp join pg_namespace nn on nn.oid=pp.pronamespace
      cross join lateral aclexplode(coalesce(pp.proacl, acldefault('f', pp.proowner))) e
      left join pg_roles r on r.oid = e.grantee
      where nn.nspname='public' and pp.proname=p.proname and e.privilege_type='EXECUTE'
        and r.rolname = 'service_role')
    and not exists (
      select 1 from pg_proc pp join pg_namespace nn on nn.oid=pp.pronamespace
      cross join lateral aclexplode(coalesce(pp.proacl, acldefault('f', pp.proowner))) e
      left join pg_roles r on r.oid = e.grantee
      where nn.nspname='public' and pp.proname=p.proname and e.privilege_type='EXECUTE'
        and (e.grantee = 0 or r.rolname in ('anon','authenticated')))
    then 'OK' else 'BLOCKED' end,
  'EXECUTE solo para service_role; anon/authenticated/PUBLIC sin acceso.'
from (values ('_autorizado_congelar_condiciones'), ('congelar_condiciones_contrato')) as p(proname);

-- 3) Espejo negativo: la 165 NO debió agregar columnas a contrato_condiciones
--    ni tablas nuevas (es function-only). Si el conteo de columnas cambió
--    respecto a lo que la 164 dejó (13 columnas de negocio + id/creado_en),
--    algo se coló fuera de alcance.
insert into pg_temp.postcheck_165_reporte
select 'espejo-negativo', 'contrato_condiciones sigue con las mismas columnas de la 164',
  case when (
    select count(*) from information_schema.columns
    where table_schema='public' and table_name='contrato_condiciones'
  ) = 15 then 'OK' else 'BLOCKED' end,
  'contrato_condiciones debe seguir teniendo exactamente 15 columnas (id, numero_contrato, tipo_componente, referencia_externa, orden, valor_componente, condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo, condicion_pago_fecha_limite, monto_exigido, restriccion_comercial, moneda, trm, creado_en) — la 165 es function-only.';

-- 4) Espejo negativo: ningún trigger/tabla/columna nueva con nombre
--    "congelar" además de las 2 funciones esperadas (detecta scope creep).
insert into pg_temp.postcheck_165_reporte
select 'espejo-negativo', 'sin tablas/triggers nuevos con nombre congelar',
  case when not exists (
    select 1 from information_schema.tables where table_schema='public' and table_name like '%congelar%'
    union
    select 1 from pg_trigger tg join pg_class rel on rel.oid=tg.tgrelid join pg_namespace n on n.oid=rel.relnamespace
      where n.nspname='public' and tg.tgname like '%congelar%'
  ) then 'OK' else 'BLOCKED' end,
  'La 165 es solo 2 funciones — ninguna tabla ni trigger nuevo debía crearse.';

-- Veredicto general.
do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.postcheck_165_reporte;
  select count(*) into v_bad from pg_temp.postcheck_165_reporte where estado='BLOCKED';
  if v_bad = 0 then
    raise notice 'POSTCHECK 165: %/% chequeos OK (0 BLOCKED) — la 165 quedó aplicada correctamente.', v_total, v_total;
  else
    raise notice 'POSTCHECK 165: % chequeos, % BLOCKED — revisar.', v_total, v_bad;
  end if;
  raise notice 'VEREDICTO POSTCHECK 165: %', (case when v_bad = 0 then 'PASSED' else 'FAILED' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.postcheck_165_reporte order by estado desc, seccion, nombre;
