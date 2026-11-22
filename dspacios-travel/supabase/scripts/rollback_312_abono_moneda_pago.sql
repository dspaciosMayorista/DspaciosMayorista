-- ROLLBACK de la 312 (#126-A). Quita la restricción y la columna `abonos.moneda_pago` SOLO si no se pierde información.
-- Una sola transacción: si cualquier guarda se activa, NO se cambia nada (ni la restricción ni la columna ni ningún abono).
--   · REHÚSA si algún abono ya tiene moneda_pago (USD o COP): borrar la columna convertiría el equivalente contable de un pago recibido en dólares en «pesos recibidos».
--     Retirar el código nuevo NO conserva esas clasificaciones. Camino: corrección hacia adelante (dejar la columna y retirar solo el código que la lee) o un procedimiento de conservación/recuperación
--     revisado aparte (por ejemplo respaldar (id, moneda_pago) antes de decidir). Este script nunca reescribe abonos.
--   · REHÚSA si la 313 sigue aplicada (el disparador trg_f313_abonos_moneda lee la columna: sin ella fallaría todo INSERT en abonos). Revertir antes la 313 (rollback_313_registrar_abono_moneda.sql).
--   · CONCURRENCIA: lo PRIMERO que hace es bloquear `public.abonos` en modo ACCESS EXCLUSIVE (ningún lector ni escritor entra) y conserva ese bloqueo hasta el COMMIT, de modo que NINGÚN pago nuevo
--     —clasificado o no— puede confirmarse entre la revisión de las guardas y el DROP. Un INSERT en curso (aún sin confirmar) hace esperar al script hasta que termine; si termina clasificado,
--     las guardas lo ven y el script rehúsa. La espera está acotada (lock_timeout 5 s): si no se obtiene el bloqueo, el script FALLA y no cambia nada (ni restricción, ni columna, ni filas).
--     Mientras el script espera el bloqueo, las lecturas/escrituras nuevas de abonos hacen cola detrás de él durante, como máximo, esos 5 s: ejecutarlo en una ventana de mantenimiento.
-- Efecto cuando procede (sin clasificaciones): la columna, vacía, desaparece; los abonos históricos y el resto del esquema quedan idénticos.
begin;
set local lock_timeout = '5s';
lock table public.abonos in access exclusive mode;
do $$
declare v_n bigint;
begin
  if exists (select 1 from pg_trigger where tgname = 'trg_f313_abonos_moneda' and not tgisinternal) then
    raise exception 'ROLLBACK 312 RECHAZADO: la 313 sigue aplicada (trg_f313_abonos_moneda lee abonos.moneda_pago). Ejecuta antes rollback_313_registrar_abono_moneda.sql. No se cambió nada.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'abonos' and column_name = 'moneda_pago') then
    execute 'select count(*) from public.abonos where moneda_pago is not null' into v_n;
    if v_n > 0 then
      raise exception 'ROLLBACK 312 RECHAZADO: % abono(s) ya tienen moneda_pago registrada (dólares/pesos recibidos). Borrar la columna los reinterpretaría como pesos recibidos. No se cambió nada: usa una corrección hacia adelante o un procedimiento de conservación/recuperación revisado aparte.', v_n;
    end if;
  end if;
end $$;
alter table public.abonos drop constraint if exists abonos_moneda_pago_check;
alter table public.abonos drop column if exists moneda_pago;
commit;
