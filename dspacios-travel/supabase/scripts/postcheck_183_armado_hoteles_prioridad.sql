-- Postcheck 183. Corre DESPUÉS de aplicar la migración 183.
-- Secciones 1-3 son de solo lectura. Sección 4 es mutante, dentro de una
-- transacción que termina en ROLLBACK — ningún dato queda modificado.

-- 1) La columna debe existir: smallint, nullable, sin default.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'armado_hoteles'
  and column_name = 'prioridad';
-- Esperado: 1 fila — prioridad (smallint, YES, default null).

-- 2) El CHECK existe, ligado a armado_hoteles.
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.armado_hoteles'::regclass
  and conname = 'armado_hoteles_prioridad_rango_check';
-- Esperado: 1 fila, definición debe contener "prioridad IS NULL" y
-- "prioridad >= 1" / "prioridad <= 6" (o el equivalente BETWEEN).

-- 3) El índice único parcial existe y es realmente único + parcial.
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'armado_hoteles'
  and indexname = 'armado_hoteles_paquete_prioridad_unica';
-- Esperado: 1 fila, indexdef debe contener "UNIQUE" y
-- "WHERE (prioridad IS NOT NULL)".

-- 4) Sin backfill: ninguna fila existente quedó con prioridad poblada.
select count(*) as filas_con_prioridad from public.armado_hoteles where prioridad is not null;
-- Esperado: 0 (inmediatamente después de correr la migración).

-- 5) Pruebas MUTANTES del CHECK y del índice único parcial, sobre datos
--    REALES si existen, dentro de una transacción que termina en ROLLBACK.
begin;

do $$
declare
  v_paquete_id bigint;
  v_hotel_a    bigint;
  v_hotel_b    bigint;
begin
  -- Necesita un paquete con AL MENOS 2 hoteles asociados para probar la
  -- unicidad parcial (paquete_id, prioridad) de verdad.
  select paquete_id into v_paquete_id
  from public.armado_hoteles
  group by paquete_id
  having count(*) >= 2
  limit 1;

  if v_paquete_id is null then
    raise notice 'AVISO: no hay ningún paquete con 2+ hoteles asociados en armado_hoteles — las pruebas mutantes del CHECK/índice NO se pudieron ejecutar de verdad. Vuelve a correr este postcheck sobre un entorno con datos reales.';
    return;
  end if;

  select hotel_id into v_hotel_a from public.armado_hoteles where paquete_id = v_paquete_id order by hotel_id limit 1;
  select hotel_id into v_hotel_b from public.armado_hoteles where paquete_id = v_paquete_id and hotel_id <> v_hotel_a order by hotel_id limit 1;

  raise notice 'Usando paquete_id=%, hotel_a=%, hotel_b=% para las pruebas mutantes (se revierte con ROLLBACK al final del script).', v_paquete_id, v_hotel_a, v_hotel_b;

  -- 5a) prioridad = 0 debe rechazarse (fuera de rango).
  begin
    update public.armado_hoteles set prioridad = 0 where paquete_id = v_paquete_id and hotel_id = v_hotel_a;
    raise exception 'FALLO POSTCHECK: se aceptó prioridad = 0 sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK rechazó correctamente prioridad = 0.';
  end;

  -- 5b) prioridad = 7 debe rechazarse (fuera de rango).
  begin
    update public.armado_hoteles set prioridad = 7 where paquete_id = v_paquete_id and hotel_id = v_hotel_a;
    raise exception 'FALLO POSTCHECK: se aceptó prioridad = 7 sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK rechazó correctamente prioridad = 7.';
  end;

  -- 5c) prioridad = 1 en hotel_a SÍ debe aceptarse.
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_id and hotel_id = v_hotel_a;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE (prioridad=1, hotel_a) no afectó ninguna fila.';
  end if;
  raise notice 'OK: prioridad = 1 aceptada para hotel_a dentro del paquete %.', v_paquete_id;

  -- 5d) La MISMA prioridad (1) en hotel_b, DENTRO DEL MISMO paquete, debe
  --     rechazarse por el índice único parcial.
  begin
    update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_id and hotel_id = v_hotel_b;
    raise exception 'FALLO POSTCHECK: se aceptó la MISMA prioridad (1) para dos hoteles del MISMO paquete — el índice único parcial no lo impidió.';
  exception when unique_violation then
    raise notice 'OK: el índice único parcial rechazó correctamente la prioridad duplicada (1) dentro del mismo paquete (%).', v_paquete_id;
  end;

  -- 5e) Desmarcar hotel_a (prioridad -> NULL) libera el cupo: hotel_b puede
  --     tomar prioridad 1 sin conflicto.
  update public.armado_hoteles set prioridad = null where paquete_id = v_paquete_id and hotel_id = v_hotel_a;
  update public.armado_hoteles set prioridad = 1 where paquete_id = v_paquete_id and hotel_id = v_hotel_b;
  if not found then
    raise exception 'FALLO POSTCHECK: tras liberar la prioridad de hotel_a, hotel_b no pudo tomar prioridad = 1.';
  end if;
  raise notice 'OK: al desmarcar hotel_a (prioridad=null), hotel_b tomó prioridad = 1 sin conflicto — el cupo se liberó correctamente.';
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguno de los UPDATE de la sección 5 queda persistido.
