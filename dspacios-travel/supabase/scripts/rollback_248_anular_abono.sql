-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 248 (anular_abono / abonos_anulados / registrar_abono / abono_operaciones).
--   · Retira las RPC `anular_abono` y `registrar_abono`.
--   · Devuelve `f208_abonos_marca` a su definición exacta de la 208 y retira su helper.
--   · `abonos_anulados` y `abono_operaciones` son EVIDENCIA (abonos ya borrados / claves de idempotencia): solo se
--     eliminan si están vacías. Con filas se conservan (con su inmutabilidad) y se avisa.
--   · No toca ninguna otra guarda de la 208 ni datos de abonos/asientos.
--   · ORDEN: revertir PRIMERO el código (despliegue anterior) y luego este script; con el código nuevo y las RPC
--     ausentes, registrar/anular responden error (no escriben nada).
-- Uso: psql -1 -v ON_ERROR_STOP=1 -f rollback_248_anular_abono.sql
-- ───────────────────────────────────────────────────────────────────────────
drop function if exists public.registrar_abono(text, text, uuid, numeric, numeric, text, text, date, boolean, uuid);
drop function if exists public.anular_abono(bigint, text, text, uuid, text);

-- Definición original de la 208 (sin la excepción de registrar_abono).
create or replace function public.f208_abonos_marca() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.contabilizable := (current_user <> 'service_role');
    new.rev := 0;
  else
    if new.contabilizable is distinct from old.contabilizable then
      raise exception 'FIN_ABONO_NO_CONTABILIZABLE: la procedencia del abono % no se cambia.', old.id using errcode = 'F4426';
    end if;
    new.rev := old.rev + 1;
  end if;
  return new;
end $$;
drop function if exists f208_priv.es_rpc_registro_abono(text);

do $$
begin
  if to_regclass('public.abonos_anulados') is not null then
    if (select count(*) from public.abonos_anulados) = 0 then
      drop table public.abonos_anulados;
      drop function if exists public.f248_anulado_inmutable();
    else
      raise notice '248 rollback: abonos_anulados conserva % fila(s) de evidencia; no se elimina.', (select count(*) from public.abonos_anulados);
    end if;
  end if;
  if to_regclass('public.abono_operaciones') is not null then
    if (select count(*) from public.abono_operaciones) = 0 then
      drop table public.abono_operaciones;
    else
      raise notice '248 rollback: abono_operaciones conserva % fila(s); no se elimina.', (select count(*) from public.abono_operaciones);
    end if;
  end if;
end $$;
