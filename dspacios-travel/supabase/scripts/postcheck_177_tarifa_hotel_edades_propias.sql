-- Postcheck 177. Corre DESPUÉS de aplicar la migración 177.
--
-- ⚠️ Paso 3 de 4 del orden OBLIGATORIO de despliegue — ver la cabecera de
-- 20260601000177_tarifa_hotel_edades_propias.sql: preflight (REMOTO) →
-- migración 177 (REMOTO) → postcheck (este script, REMOTO) → recién ahí
-- desplegar el código. `computarReserva` (computo.ts) y el buscador público
-- (cotizar.ts) consultan estas columnas para CUALQUIER hotel "persona" —
-- desplegar el código antes de correr la migración rompe TODAS las reservas/
-- búsquedas de hotel de ese entorno, no solo las que usan edades propias.
--
-- Las secciones 1-3 son de solo lectura. La sección 4 (pruebas MUTANTES de
-- los CHECK) usa una fila REAL Y EXISTENTE de `tarifa_hotel` — nunca inserta
-- una fila ficticia con un `hotel_id` inventado (ej. -1), que no respeta
-- ninguna FK real y podría enmascarar un CHECK mal escrito si algún día se
-- agrega una FK a `hoteles`. Toda la sección 4 corre dentro de UNA
-- transacción que termina en `rollback` — ningún dato queda modificado.

-- 1) Las 4 columnas deben existir, todas nullable, tipo integer.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'tarifa_hotel'
  and column_name in ('edad_infante_min', 'edad_infante_max', 'edad_nino_min', 'edad_nino_max')
order by column_name;
-- Esperado: 4 filas, data_type = integer, is_nullable = YES en las 4.

-- 2) Ninguna fila existente quedó con valor (todas NULL = fallback
--    histórico intacto, la migración nunca escribe datos).
select count(*) as filas_con_algun_override
from public.tarifa_hotel
where edad_infante_min is not null or edad_infante_max is not null
   or edad_nino_min is not null or edad_nino_max is not null;
-- Esperado: 0.

-- 3) Los 2 CHECK existen, AMBOS ligados a `tarifa_hotel` (`conrelid`) — sin
--    este filtro, una restricción con el MISMO nombre en OTRA tabla daría un
--    falso positivo (el nombre de un constraint es único por tabla en
--    Postgres, no global).
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.tarifa_hotel'::regclass
  and conname in ('tarifa_hotel_edades_todas_o_ninguna_check', 'tarifa_hotel_edades_rangos_check')
order by conname;
-- Esperado: 2 filas.

-- 4) Pruebas MUTANTES de los CHECK sobre una fila REAL de `tarifa_hotel`,
--    dentro de una transacción que termina en ROLLBACK. Si la tabla está
--    vacía, se avisa explícitamente y las pruebas mutantes NO se ejecutan —
--    nunca se reporta éxito sin haber probado nada de verdad contra el CHECK
--    real.
begin;

do $$
declare
  v_id bigint;
begin
  select id into v_id from public.tarifa_hotel limit 1;

  if v_id is null then
    raise notice 'AVISO: tarifa_hotel no tiene NINGUNA fila — las pruebas mutantes de los CHECK (override parcial / infante_min<>0 / nino_max>17 / regla válida) NO se pudieron ejecutar. Esto NO confirma que el CHECK funciona: vuelve a correr este postcheck cuando exista al menos una fila real de tarifa_hotel.';
    return;
  end if;

  raise notice 'Usando tarifa_hotel.id = % para las pruebas mutantes (se revierte con ROLLBACK al final del script — no queda ningún dato modificado).', v_id;

  -- 4a) Override PARCIAL (solo edad_infante_min) — el CHECK "todas o
  --     ninguna" debe rechazarlo.
  begin
    update public.tarifa_hotel set edad_infante_min = 0 where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un override PARCIAL sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK "todas o ninguna" rechazó correctamente un override parcial.';
  end;

  -- 4b) edad_infante_min distinto de 0 — el CHECK de rangos debe rechazarlo.
  begin
    update public.tarifa_hotel
      set edad_infante_min = 1, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 10
      where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó edad_infante_min=1 sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK de rangos rechazó correctamente edad_infante_min distinto de 0.';
  end;

  -- 4c) edad_nino_max > 17 — el CHECK de rangos debe rechazarlo.
  begin
    update public.tarifa_hotel
      set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 18
      where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó edad_nino_max=18 sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK de rangos rechazó correctamente edad_nino_max > 17.';
  end;

  -- 4d) Regla completa y válida (0,2,3,10) SÍ debe aceptarse.
  update public.tarifa_hotel
    set edad_infante_min = 0, edad_infante_max = 2, edad_nino_min = 3, edad_nino_max = 10
    where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE con la regla válida (0,2,3,10) no afectó ninguna fila (tarifa_hotel.id = % ya no existe).', v_id;
  end if;
  raise notice 'OK: el UPDATE con una regla completa y válida (0,2,3,10) se aceptó sobre tarifa_hotel.id = %.', v_id;
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguno de los UPDATE de la sección 4 queda persistido — la
-- fila usada vuelve exactamente a su estado anterior a este postcheck.
