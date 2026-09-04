-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 166 · bypass controlado de inmutabilidad para eliminar_contrato()
-- (SOLO LECTURA)
--
-- A diferencia de la 164/165 (que crean piezas nuevas), la 166 REEMPLAZA dos
-- funciones YA EXISTENTES (`contrato_condiciones_inmutable`, de la 164;
-- `eliminar_contrato`, de la 159) — no hay una tabla/columna nueva cuya
-- ausencia confirme "no aplicada todavía". En su lugar, esta preflight
-- inspecciona el CUERPO fuente de ambas funciones (`pg_get_functiondef`) en
-- busca de la marca textual del bypass (`app.eliminando_contrato`): si YA
-- aparece, la 166 (o una equivalente) ya está aplicada.
--
-- Verifica también que las piezas de las que depende existen: las dos
-- funciones a reemplazar, el trigger de la 164 que las usa, y
-- `contrato_condiciones` con su FK `on delete cascade` hacia `ventas`.
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_166_reporte (
  seccion text,
  nombre  text,
  estado  text,   -- OK | BLOCKED | INFO
  detalle text
);
truncate pg_temp.preflight_166_reporte;

-- 1) La 166 NO debe estar aplicada todavía: ninguna de las 2 funciones trae
--    ya la marca del bypass en su definición.
insert into pg_temp.preflight_166_reporte
select '166-no-aplicada', 'contrato_condiciones_inmutable() sin bypass todavía',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contrato_condiciones_inmutable'
      and pg_get_functiondef(p.oid) like '%app.eliminando_contrato%'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'contrato_condiciones_inmutable'
      and pg_get_functiondef(p.oid) like '%app.eliminando_contrato%'
  ) then 'YA tiene la marca del bypass — la 166 parece aplicada; revisar antes de reintentar.'
    else 'Sin la marca del bypass — no aplicada todavía' end;

insert into pg_temp.preflight_166_reporte
select '166-no-aplicada', 'eliminar_contrato() sin bypass todavía',
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'eliminar_contrato'
      and pg_get_functiondef(p.oid) like '%app.eliminando_contrato%'
  ) then 'BLOCKED' else 'OK' end,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'eliminar_contrato'
      and pg_get_functiondef(p.oid) like '%app.eliminando_contrato%'
  ) then 'YA tiene la marca del bypass — la 166 parece aplicada; revisar antes de reintentar.'
    else 'Sin la marca del bypass — no aplicada todavía' end;

-- 2) Dependencias que la 166 necesita YA existentes (164/159/165).
insert into pg_temp.preflight_166_reporte
select '164-159-dependencias', f.nombre,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f.nombre) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = f.nombre) then 'Presente' else 'FALTA — la 166 la reemplaza, debe existir antes' end
from (values ('contrato_condiciones_inmutable'), ('eliminar_contrato'), ('mi_rol'), ('congelar_condiciones_contrato')) as f(nombre);

insert into pg_temp.preflight_166_reporte
select '164-dependencias', 'trigger trg_contrato_condiciones_inmutable',
  case when exists (select 1 from pg_trigger tg join pg_class rel on rel.oid = tg.tgrelid
         join pg_namespace n on n.oid = rel.relnamespace
         where n.nspname = 'public' and rel.relname = 'contrato_condiciones' and tg.tgname = 'trg_contrato_condiciones_inmutable')
    then 'OK' else 'BLOCKED' end,
  'El trigger debe existir y seguir apuntando a contrato_condiciones_inmutable() por nombre (la 166 no lo recrea, solo reemplaza la función).';

insert into pg_temp.preflight_166_reporte
select '164-dependencias', 'FK contrato_condiciones.numero_contrato ON DELETE CASCADE',
  case when exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and rel.relname = 'contrato_condiciones'
      and c.contype = 'f' and c.confdeltype = 'c'
  ) then 'OK' else 'BLOCKED' end,
  'Confirma la premisa del hallazgo: el cascade es lo que dispara el trigger de inmutabilidad al eliminar la venta.';

-- Reporte + veredicto general.
do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.preflight_166_reporte;
  select count(*) into v_bad from pg_temp.preflight_166_reporte where estado = 'BLOCKED';
  if v_bad = 0 then
    raise notice 'PREFLIGHT 166: %/% chequeos OK (0 BLOCKED) — la migración 166 se puede aplicar.', v_total, v_total;
  else
    raise notice 'PREFLIGHT 166: % chequeos, % BLOCKED — revisar antes de aplicar.', v_total, v_bad;
  end if;
  raise notice 'VEREDICTO PREFLIGHT 166: %', (case when v_bad = 0 then 'OK' else 'BLOQUEADO' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.preflight_166_reporte order by estado desc, seccion, nombre;
