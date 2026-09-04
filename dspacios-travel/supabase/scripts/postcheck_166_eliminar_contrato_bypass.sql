-- ───────────────────────────────────────────────────────────────────────────
-- POSTCHECK 166 · bypass controlado de inmutabilidad para eliminar_contrato()
-- (SOLO LECTURA)
--
-- Verifica, DESPUÉS de aplicar la 166, que ambas funciones quedaron con el
-- bypass y que nada más cambió: mismo candado de rol en eliminar_contrato(),
-- mismo trigger BEFORE UPDATE OR DELETE, sin columnas/tablas nuevas (la 166
-- es function-only, igual que la 165).
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.postcheck_166_reporte (
  seccion text,
  nombre  text,
  estado  text,   -- OK | BLOCKED
  detalle text
);
truncate pg_temp.postcheck_166_reporte;

-- 1) Ambas funciones traen la marca del bypass.
insert into pg_temp.postcheck_166_reporte
select 'funciones', f.nombre || ': trae el bypass',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f.nombre
      and pg_get_functiondef(p.oid) like '%app.eliminando_contrato%'
  ) then 'OK' else 'BLOCKED' end,
  'Debe referenciar app.eliminando_contrato tras aplicar la 166'
from (values ('contrato_condiciones_inmutable'), ('eliminar_contrato')) as f(nombre);

-- 2) El bypass del trigger es estrictamente DELETE-only (nunca UPDATE) — la
--    definición debe atar la excepción a TG_OP = 'DELETE', no a cualquier
--    operación.
insert into pg_temp.postcheck_166_reporte
select 'funciones', 'contrato_condiciones_inmutable: bypass restringido a DELETE',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contrato_condiciones_inmutable'
      and pg_get_functiondef(p.oid) like '%TG_OP%=%''DELETE''%'
  ) then 'OK' else 'BLOCKED' end,
  'El bypass debe estar condicionado a TG_OP = ''DELETE'' — nunca a UPDATE.';

-- 3) eliminar_contrato() sigue siendo SECURITY DEFINER con el mismo candado
--    de rol textual (no se relajó ni se quitó).
insert into pg_temp.postcheck_166_reporte
select 'funciones', 'eliminar_contrato: sigue security definer + candado de rol',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'eliminar_contrato'
      and p.prosecdef -- security definer
      and pg_get_functiondef(p.oid) like '%Solo un superadmin puede eliminar contratos%'
  ) then 'OK' else 'BLOCKED' end,
  'security definer + el mismo mensaje de candado de rol de las migraciones 117/159, sin relajar.';

-- 4) El trigger sigue siendo BEFORE UPDATE OR DELETE FOR EACH ROW sobre
--    contrato_condiciones (la 166 no lo recrea, solo reemplaza la función a
--    la que apunta) — sigue existiendo con el mismo nombre.
insert into pg_temp.postcheck_166_reporte
select 'trigger', 'trg_contrato_condiciones_inmutable intacto',
  case when exists (select 1 from pg_trigger tg join pg_class rel on rel.oid = tg.tgrelid
         join pg_namespace n on n.oid = rel.relnamespace
         where n.nspname = 'public' and rel.relname = 'contrato_condiciones'
           and tg.tgname = 'trg_contrato_condiciones_inmutable')
    then 'OK' else 'BLOCKED' end,
  'El trigger debe seguir existiendo con el mismo nombre, apuntando a la función reemplazada.';

-- 5) Espejo negativo: la 166 es function-only — sin columnas/tablas nuevas,
--    contrato_condiciones sigue con exactamente 15 columnas.
insert into pg_temp.postcheck_166_reporte
select 'espejo-negativo', 'contrato_condiciones sigue con las mismas 15 columnas',
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contrato_condiciones'
  ) = 15 then 'OK' else 'BLOCKED' end,
  'La 166 es function-only — no debía agregar columnas.';

-- Veredicto general.
do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.postcheck_166_reporte;
  select count(*) into v_bad from pg_temp.postcheck_166_reporte where estado = 'BLOCKED';
  if v_bad = 0 then
    raise notice 'POSTCHECK 166: %/% chequeos OK (0 BLOCKED) — la 166 quedó aplicada correctamente.', v_total, v_total;
  else
    raise notice 'POSTCHECK 166: % chequeos, % BLOCKED — revisar.', v_total, v_bad;
  end if;
  raise notice 'VEREDICTO POSTCHECK 166: %', (case when v_bad = 0 then 'PASSED' else 'FAILED' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.postcheck_166_reporte order by estado desc, seccion, nombre;
