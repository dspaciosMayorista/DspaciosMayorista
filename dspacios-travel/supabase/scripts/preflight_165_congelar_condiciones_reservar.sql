-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 165 · congelar_condiciones_contrato (SOLO LECTURA)
--
-- Verifica, ANTES de aplicar la migración 165, que el estado de la BD está
-- listo y que la migración NO ha sido aplicada todavía. Nunca aborta ni
-- escribe: materializa un reporte en `pg_temp.preflight_165_reporte` y deja
-- un veredicto general. El dueño lo corre en producción cuando el code-review
-- lo autorice.
--
-- La 165 es puramente aditiva: SOLO agrega dos funciones nuevas
-- (`_autorizado_congelar_condiciones`, `congelar_condiciones_contrato`). No
-- toca columnas ni tablas — depende por completo de lo que ya dejó la 164
-- (INMUTABLE, ya aplicada en producción, no se toca aquí).
--
-- Verifica:
--   · que las 2 funciones nuevas de la 165 NO existan aún (→ migración no
--     aplicada). Si alguna YA existe, es señal de que ya se aplicó.
--   · que las piezas de la 164 de las que depende existen: tabla
--     `contrato_condiciones` (destino del insert) + su trigger de
--     inmutabilidad `trg_contrato_condiciones_inmutable`, y la tabla `ventas`
--     con columna `tenant` (usada para el lock/tenant-check).
--   · que `usuarios` tiene las columnas que el helper de rol necesita
--     (rol, activo, tenant).
--
-- Veredicto: si todo OK → "PREFLIGHT OK — la 165 se puede aplicar".
-- Si algo falta o choca → "PREFLIGHT BLOQUEADO — revisar filas BLOCKED".
-- ───────────────────────────────────────────────────────────────────────────

create temp table if not exists pg_temp.preflight_165_reporte (
  seccion text,
  nombre  text,
  estado  text,   -- OK | BLOCKED | INFO
  detalle text
);
truncate pg_temp.preflight_165_reporte;

-- 1) La 165 NO debe estar aplicada todavía: ninguna de sus 2 funciones existe.
insert into pg_temp.preflight_165_reporte
select '165-no-aplicada', 'funciones _autorizado_congelar_condiciones / congelar_condiciones_contrato',
  case when choca = 0 then 'OK' else 'BLOCKED' end,
  case when choca = 0 then 'Ninguna función nueva presente' else choca || ' función(es) YA existen — la 165 parece aplicada; revisar antes de reintentar.' end
from (
  select count(*)::int as choca from (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('_autorizado_congelar_condiciones','congelar_condiciones_contrato')
  ) t
) q;

-- 2) Dependencias de la 164 (ya aplicada, INMUTABLE) que la 165 reutiliza.
insert into pg_temp.preflight_165_reporte
select '164-dependencias', 'tabla contrato_condiciones',
  case when exists (select 1 from information_schema.tables where table_schema='public' and table_name='contrato_condiciones') then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from information_schema.tables where table_schema='public' and table_name='contrato_condiciones') then 'Presente' else 'FALTA — la 164 debe estar aplicada antes que la 165' end;

insert into pg_temp.preflight_165_reporte
select '164-dependencias', c.tabla || '.' || c.col,
  case when exists (select 1 from information_schema.columns x
         where x.table_schema='public' and x.table_name=c.tabla and x.column_name=c.col) then 'OK' else 'BLOCKED' end,
  case when exists (select 1 from information_schema.columns x
         where x.table_schema='public' and x.table_name=c.tabla and x.column_name=c.col) then 'Presente' else 'FALTA la columna' end
from (values
  ('contrato_condiciones','numero_contrato'),('contrato_condiciones','tipo_componente'),
  ('contrato_condiciones','referencia_externa'),('contrato_condiciones','orden'),
  ('contrato_condiciones','valor_componente'),('contrato_condiciones','condicion_pago_tipo'),
  ('contrato_condiciones','condicion_pago_pct_aplicable'),('contrato_condiciones','condicion_pago_dias_saldo'),
  ('contrato_condiciones','condicion_pago_fecha_limite'),('contrato_condiciones','monto_exigido'),
  ('contrato_condiciones','restriccion_comercial'),('contrato_condiciones','moneda'),
  ('contrato_condiciones','trm'),
  ('ventas','numero_contrato'),('ventas','tenant'),
  ('usuarios','id'),('usuarios','rol'),('usuarios','activo'),('usuarios','tenant')
) as c(tabla, col);

insert into pg_temp.preflight_165_reporte
select '164-dependencias', 'trigger trg_contrato_condiciones_inmutable',
  case when exists (select 1 from pg_trigger tg join pg_class rel on rel.oid=tg.tgrelid
         join pg_namespace n on n.oid=rel.relnamespace
         where n.nspname='public' and rel.relname='contrato_condiciones' and tg.tgname='trg_contrato_condiciones_inmutable')
    then 'OK' else 'BLOCKED' end,
  'Candado de inmutabilidad de la 164 (la 165 depende de que siga bloqueando UPDATE/DELETE sobre las filas que inserta)';

-- Reporte + veredicto general.
do $$
declare v_bad int; v_total int;
begin
  select count(*) into v_total from pg_temp.preflight_165_reporte;
  select count(*) into v_bad from pg_temp.preflight_165_reporte where estado='BLOCKED';
  if v_bad = 0 then
    raise notice 'PREFLIGHT 165: %/% chequeos OK (0 BLOCKED) — la migración 165 se puede aplicar.', v_total, v_total;
  else
    raise notice 'PREFLIGHT 165: % chequeos, % BLOCKED — revisar antes de aplicar.', v_total, v_bad;
  end if;
  raise notice 'VEREDICTO PREFLIGHT 165: %', (case when v_bad = 0 then 'OK' else 'BLOQUEADO' end);
end $$;

select seccion, nombre, estado, detalle from pg_temp.preflight_165_reporte order by estado desc, seccion, nombre;
