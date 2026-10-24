-- ───────────────────────────────────────────────────────────────────────────
-- 231 · ACREDITACIÓN EN BLOQUE de la moneda de los Bloqueos existentes  (#90 · Entrega B · decisión D2 del dueño, 2026-10-23)
--
-- Decisión D2: "todos los tiquetes de los 95 Bloqueos se compran en COP". Esta es la acreditación EXPRESA de esa decisión: deja la moneda
-- 'COP' en cada Bloqueo que hoy está sin acreditar, con constancia (en = now(), ref = la decisión). NO convierte ni cambia ningún importe.
--
-- CUÁNDO: DESPUÉS de aplicar la migración 231 y de desplegar el código, y SOLO si el preflight (preflight_postcheck_231_moneda_bloqueos.sql)
--   salió con 'tarifas_cop_menor_1000' = 0 y 'paquetes_activos_en_usd_con_bloqueo_sin_acreditar_o_no_usd' = 0. NO se corre antes de la 231.
-- SIGUIENTE PASO OBLIGATORIO (no opcional): comprobar con el postcheck y ENCENDER el interruptor (encender_231_moneda_obligatoria.sql).
-- CUÁNTO: exactamente los 95 Bloqueos sin acreditar. Si hay más o menos (p. ej. se creó un Bloqueo nuevo sin moneda mientras tanto) ABORTA:
--   un Bloqueo nuevo NUNCA se supone en COP, hay que acreditarlo por el formulario (o decidir aparte).
-- REGLA DEL DUEÑO: ABORTA si alguna tarifa neta, de reventa o fee de infante positiva es menor a 1.000 (casi seguro es USD). Nada se escribe.
-- ESCRITURA-UNA-VEZ: solo toca filas con moneda NULL; nunca cambia una moneda ya acreditada.
-- EFECTO EN EL TARIFARIO: NULL -> COP no invalida ningún tarifario publicado (la 231 lo exceptúa: NULL siempre se leyó como COP).
-- Se ejecuta como UNA transacción (todo o nada). Rollback de datos: rollback_231_acreditacion_datos.sql.
-- Termina con UNA consulta integral (control · valor · esperado · estado).
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_esperados constant integer := 95;
  v_sin       integer;
  v_malos     integer;
  v_ids       text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bloqueos_vuelo' and column_name = 'moneda_acreditada_ref') then
    raise exception 'ACREDITACIÓN 231 ABORTADA: la migración 231 no está aplicada. No se escribió nada.';
  end if;

  select count(*) into v_sin from public.bloqueos_vuelo where moneda is null;
  if v_sin <> v_esperados then
    raise exception 'ACREDITACIÓN 231 ABORTADA: se esperaban % Bloqueos sin acreditar (decisión D2) y hay %. Un Bloqueo nuevo nunca se supone en COP: revisa cuáles son (preflight, control 15). No se escribió nada.', v_esperados, v_sin;
  end if;

  select count(*), string_agg(id::text || ' (' || record || ')', ', ' order by id) into v_malos, v_ids
    from public.bloqueos_vuelo
   where moneda is null
     and ((tarifa_neta > 0 and tarifa_neta < 1000)
          or (tarifa_para_empaquetar > 0 and tarifa_para_empaquetar < 1000)
          or (fee_infante > 0 and fee_infante < 1000));
  if v_malos > 0 then
    raise exception 'ACREDITACIÓN 231 ABORTADA: % Bloqueo(s) con una tarifa neta, de reventa o fee de infante positiva menor a 1.000 (casi seguro en USD, no en COP): %. Corrígelos o decide su moneda antes de acreditar. No se escribió nada.', v_malos, v_ids;
  end if;
end $$;

-- La constancia de la decisión viaja en un parámetro LOCAL de la transacción que lee el trigger de la 231.
select set_config('p90.moneda_ref', 'D2 del dueño 2026-10-23: los 95 Bloqueos vigentes se compran en COP (acreditación en bloque, script acreditar_231)', true);

update public.bloqueos_vuelo set moneda = 'COP' where moneda is null;

do $$
declare
  v_nulos integer;
  v_d2    integer;
begin
  select count(*) filter (where moneda is null), count(*) filter (where moneda_acreditada_ref like 'D2 del dueño 2026-10-23%')
    into v_nulos, v_d2 from public.bloqueos_vuelo;
  if v_nulos <> 0 or v_d2 <> 95 then
    raise exception 'ACREDITACIÓN 231 ABORTADA al verificar: sin acreditar=% (esperado 0), con constancia D2=% (esperado 95). Se revierte todo.', v_nulos, v_d2;
  end if;
end $$;

commit;

select control, valor, esperado, estado
  from (
    select 1 as ord, 'bloqueos_sin_acreditar' as control, count(*) filter (where moneda is null)::text as valor, '0' as esperado,
           case when count(*) filter (where moneda is null) = 0 then 'OK' else 'REVISAR' end as estado
      from public.bloqueos_vuelo
    union all
    select 2, 'acreditados_en_bloque_en_COP_con_constancia_D2', count(*) filter (where moneda = 'COP' and moneda_acreditada_ref like 'D2 del dueño 2026-10-23%')::text, '95',
           case when count(*) filter (where moneda = 'COP' and moneda_acreditada_ref like 'D2 del dueño 2026-10-23%') = 95 then 'OK' else 'REVISAR' end
      from public.bloqueos_vuelo
    union all
    select 3, 'bloqueos_en_usd (creados por formulario tras el despliegue; esta acreditación solo escribe COP)', count(*) filter (where moneda = 'USD')::text, 'dato', 'INFO'
      from public.bloqueos_vuelo
  ) q
 order by ord;
