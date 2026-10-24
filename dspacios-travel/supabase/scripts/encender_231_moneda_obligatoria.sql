-- ───────────────────────────────────────────────────────────────────────────
-- 231 · ENCENDER el interruptor estricto de la moneda de los Bloqueos  (#90 · Entrega B · paso OBLIGATORIO y POSTERIOR a la acreditación)
--
-- Con el interruptor encendido, la base rechaza crear un Bloqueo (crear_bloqueo / insert) o cambiar sus tarifas SIN moneda
-- (trigger trg_bloqueos_moneda_90). Es el cierre definitivo de "un Bloqueo nuevo nunca se supone en COP", incluso para un cliente
-- antiguo o una llamada directa a la API.
--
-- CUÁNDO: DESPUÉS de desplegar el código nuevo (que siempre envía la moneda), de acreditar los 95 (acreditar_231_bloqueos_cop.sql) y de comprobarlos
--   con el postcheck (preflight_postcheck_231_moneda_bloqueos.sql: solo 'interruptor_estricto' en REVISAR). SIN este paso el despliegue NO está completo:
--   el cierre se da por bueno solo cuando el postcheck FINAL (con el interruptor encendido) sale sin ningún REVISAR.
--   Si queda algún Bloqueo sin acreditar, ABORTA (editarlo después exigiría moneda; acredítalo antes).
-- Para APAGARLO: update p90_priv.config set exigir_moneda_bloqueo = false, actualizado_en = now() where id;
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_sin integer;
begin
  if to_regclass('p90_priv.config') is null then
    raise exception 'ENCENDIDO 231 ABORTADO: la migración 231 no está aplicada.';
  end if;
  select count(*) into v_sin from public.bloqueos_vuelo where moneda is null;
  if v_sin > 0 then
    raise exception 'ENCENDIDO 231 ABORTADO: hay % Bloqueo(s) sin acreditar; acredítalos antes (acreditar_231_bloqueos_cop.sql o el formulario).', v_sin;
  end if;
end $$;

update p90_priv.config set exigir_moneda_bloqueo = true, actualizado_en = now() where id;

do $$
begin
  if not (select exigir_moneda_bloqueo from p90_priv.config where id) then
    raise exception 'ENCENDIDO 231: el interruptor no quedó encendido.';
  end if;
end $$;

commit;

select control, valor, esperado, estado
  from (
    select 1 as ord, 'interruptor_estricto' as control, case when (select exigir_moneda_bloqueo from p90_priv.config where id) then 'encendido' else 'apagado' end as valor, 'encendido' as esperado,
           case when (select exigir_moneda_bloqueo from p90_priv.config where id) then 'OK' else 'REVISAR' end as estado
    union all
    select 2, 'bloqueos_sin_acreditar', count(*)::text, '0', case when count(*) = 0 then 'OK' else 'REVISAR' end from public.bloqueos_vuelo where moneda is null
  ) q
 order by ord;
