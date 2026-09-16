-- Postcheck 178. Corre DESPUÉS de aplicar la migración 178.
--
-- ⚠️ Paso 3 de 4 del orden OBLIGATORIO de despliegue — ver la cabecera de
-- 20260601000178_contrato_hoteles_condiciones_tarifa.sql: preflight (REMOTO)
-- → migración 178 (REMOTO) → postcheck (este script, REMOTO) → recién ahí
-- desplegar el código.
--
-- Las secciones 1-3 son de solo lectura. La sección 4 (pruebas MUTANTES del
-- CHECK) usa una fila REAL Y EXISTENTE de `contrato_hoteles` — nunca inserta
-- una fila ficticia con un `numero_contrato` inventado (no respeta ninguna
-- referencia real). Toda la sección 4 corre dentro de UNA transacción que
-- termina en `rollback` — ningún dato queda modificado.

-- 1) La columna debe existir, nullable, tipo jsonb.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'contrato_hoteles'
  and column_name = 'condiciones_tarifa';
-- Esperado: 1 fila, data_type = jsonb, is_nullable = YES.

-- 2) Ninguna fila existente quedó con valor (sin backfill — la migración
--    nunca escribe datos; solo código nuevo, desplegado DESPUÉS, puede
--    poblar esta columna en conversiones futuras).
select count(*) as filas_con_algun_valor
from public.contrato_hoteles
where condiciones_tarifa is not null;
-- Esperado: 0 (inmediatamente después de correr la migración).

-- 3) El CHECK existe, ligado a `contrato_hoteles` (`conrelid`) — sin este
--    filtro, una restricción con el MISMO nombre en OTRA tabla daría un
--    falso positivo (el nombre de un constraint es único por tabla en
--    Postgres, no global).
select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.contrato_hoteles'::regclass
  and conname = 'contrato_hoteles_condiciones_tarifa_array_check';
-- Esperado: 1 fila.

-- 4) Pruebas MUTANTES del CHECK sobre una fila REAL de `contrato_hoteles`,
--    dentro de una transacción que termina en ROLLBACK. Si la tabla está
--    vacía, se avisa explícitamente y las pruebas mutantes NO se ejecutan —
--    nunca se reporta éxito sin haber probado nada de verdad contra el CHECK
--    real.
begin;

do $$
declare
  v_id bigint;
begin
  select id into v_id from public.contrato_hoteles limit 1;

  if v_id is null then
    raise notice 'AVISO: contrato_hoteles no tiene NINGUNA fila — las pruebas mutantes del CHECK (forma no-arreglo rechazada / NULL y arreglo aceptados) NO se pudieron ejecutar. Esto NO confirma que el CHECK funciona: vuelve a correr este postcheck cuando exista al menos una fila real de contrato_hoteles.';
    return;
  end if;

  raise notice 'Usando contrato_hoteles.id = % para las pruebas mutantes (se revierte con ROLLBACK al final del script — no queda ningún dato modificado).', v_id;

  -- 4a) Un OBJETO jsonb (no arreglo) debe rechazarse.
  begin
    update public.contrato_hoteles set condiciones_tarifa = '{"temporada":"ALTA","texto":"x"}'::jsonb where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un objeto jsonb (no arreglo) sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK rechazó correctamente un objeto jsonb (jsonb_typeof <> array).';
  end;

  -- 4b) Un STRING jsonb (no arreglo) debe rechazarse.
  begin
    update public.contrato_hoteles set condiciones_tarifa = '"No reembolsable"'::jsonb where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un string jsonb (no arreglo) sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK rechazó correctamente un string jsonb (jsonb_typeof <> array).';
  end;

  -- 4c) Un NÚMERO jsonb (no arreglo) debe rechazarse.
  begin
    update public.contrato_hoteles set condiciones_tarifa = '42'::jsonb where id = v_id;
    raise exception 'FALLO POSTCHECK: se aceptó un número jsonb (no arreglo) sin que el CHECK lo rechazara.';
  exception when check_violation then
    raise notice 'OK: el CHECK rechazó correctamente un número jsonb (jsonb_typeof <> array).';
  end;

  -- 4d) Un arreglo VACÍO SÍ debe aceptarse ("hay snapshot, cero condiciones").
  update public.contrato_hoteles set condiciones_tarifa = '[]'::jsonb where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE con arreglo vacío no afectó ninguna fila (contrato_hoteles.id = % ya no existe).', v_id;
  end if;
  raise notice 'OK: el UPDATE con un arreglo vacío ([]) se aceptó sobre contrato_hoteles.id = %.', v_id;

  -- 4e) Un arreglo con una condición completa SÍ debe aceptarse.
  update public.contrato_hoteles
    set condiciones_tarifa = '[{"temporada":"ALTA","texto":"No reembolsable."}]'::jsonb
    where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE con una condición completa no afectó ninguna fila (contrato_hoteles.id = % ya no existe).', v_id;
  end if;
  raise notice 'OK: el UPDATE con una condición completa se aceptó sobre contrato_hoteles.id = %.', v_id;

  -- 4f) NULL explícito SÍ debe aceptarse (vuelve al estado "sin snapshot").
  update public.contrato_hoteles set condiciones_tarifa = null where id = v_id;
  if not found then
    raise exception 'FALLO POSTCHECK: el UPDATE con NULL no afectó ninguna fila (contrato_hoteles.id = % ya no existe).', v_id;
  end if;
  raise notice 'OK: el UPDATE con NULL se aceptó sobre contrato_hoteles.id = %.', v_id;
end $$;

rollback;
-- ⚠️ ROLLBACK: ninguno de los UPDATE de la sección 4 queda persistido — la
-- fila usada vuelve exactamente a su estado anterior a este postcheck.
