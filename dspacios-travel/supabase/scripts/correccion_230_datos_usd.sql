-- ───────────────────────────────────────────────────────────────────────────
-- 230 · CORRECCIÓN DE DATOS (script APARTE de la migración; lo corre el dueño DESPUÉS de aplicar la 230 y de desplegar el código).
--
-- DECISIÓN DEL DUEÑO (2026-10-23), medida en Producción:
--   · 17 empaquetados MDE-SDQ-MDE (ids 3-9 y 11-20; ene-may 2027) con tarifa_para_empaquetar 415-445 y fee_infante 45 se guardaron con
--     moneda = 'COP' pero son USD. Regla del dueño: "todo tiquete que diga COP con valor por debajo de mil es USD sí o sí".
--   · 16 de ellos están vinculados (salidas_dinamicas.empaquetado_id) al paquete 70 "JUAN DOLIO (R.D.)" (Dinámico, modo cop_trm_63,
--     INACTIVO, sin snapshot publicable, nunca vendido): sus salidas vinculadas pasan a USD con su fuente.
--   · Las salidas MANUALES 1 y 2 del paquete 71 (WINGO 370 / 45 / 45) también están marcadas COP y son USD.
--
-- QUÉ HACE: pasa esas filas a USD y deja CONSTANCIA de la decisión en el campo notas de cada fila. Es idempotente (una segunda
-- corrida no cambia nada). Todo ocurre en UNA transacción: si cualquier comprobación falla, no se cambia nada.
-- QUÉ NO HACE: no activa ni regenera ningún paquete (el 70 queda inactivo; no debe activarse ni regenerarse hasta cerrar la tarea #90);
-- no toca ventas, cotizaciones, CxP ni bloqueos.
-- Antes y después: supabase/scripts/preflight_postcheck_230_empaquetados_usd.sql (una sola consulta). Reversa:
-- supabase/scripts/rollback_230_correccion_datos.sql.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_ids   bigint[] := array[3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  v_marca constant text := '[230] Moneda corregida de COP a USD por decisión del dueño (2026-10-23): regla "tiquete en COP con valor menor a 1.000 es USD".';
  v_n     integer;
  v_mal   integer;
  v_nv    integer;
begin
  -- 0. La estructura de la 230 debe estar aplicada (si no, el CHECK de la 227 rechazaría el USD).
  if not exists (select 1 from pg_constraint where conrelid = 'public.empaquetados'::regclass and conname = 'empaquetados_moneda_chk') then
    raise exception 'CORRECCIÓN 230 ABORTADA: aplica antes la migración 230.';
  end if;

  -- 1. Los 17 empaquetados existen.
  select count(*) into v_n from public.empaquetados where id = any (v_ids);
  if v_n <> 17 then
    raise exception 'CORRECCIÓN 230 ABORTADA: se esperaban 17 empaquetados (ids 3-9 y 11-20) y hay %.', v_n;
  end if;

  -- 2. La regla del dueño aplica a todos: o ya son USD (idempotencia) o son COP con algún valor positivo menor a 1.000 y NINGUNO >= 1.000.
  select count(*) into v_mal from public.empaquetados e
   where e.id = any (v_ids) and e.moneda = 'COP'
     and (e.tarifa_para_empaquetar >= 1000 or e.tarifa_proveedor >= 1000 or e.fee_infante >= 1000
          or not (coalesce(e.tarifa_para_empaquetar, 0) > 0 and e.tarifa_para_empaquetar < 1000));
  if v_mal > 0 then
    raise exception 'CORRECCIÓN 230 ABORTADA: % empaquetado(s) objetivo no cumplen la regla (COP con tarifa para empaquetar < 1.000); revisar a mano.', v_mal;
  end if;

  -- 3. Nunca se vendieron: ninguna venta/oferta de los paquetes 70 y 71 ni contrato con estos vuelos como origen.
  select (select count(*) from public.ventas where paquete_armado_id in (70, 71) or empaquetado_ref_id = any (v_ids))
       + (select count(*) from public.p63_oferta where paquete_id in (70, 71)) into v_nv;
  if v_nv > 0 then
    raise exception 'CORRECCIÓN 230 ABORTADA: hay % venta(s)/oferta(s) ligadas a los paquetes 70/71 o a estos empaquetados; no se corrige en silencio.', v_nv;
  end if;
  -- 4. El paquete 70 sigue inactivo y sin snapshot publicable (no debe haberse activado).
  if exists (select 1 from public.armado_paquetes where id = 70 and (activo or coalesce(tarifario_snapshot_publicable, false))) then
    raise exception 'CORRECCIÓN 230 ABORTADA: el paquete 70 está activo o publicable; no debe corregirse mientras esté visible.';
  end if;
  -- 5. Las salidas manuales 1 y 2 del paquete 71 existen, son manuales y con valores < 1.000.
  select count(*) into v_n from public.salidas_dinamicas where id in (1, 2) and paquete_id = 71 and empaquetado_id is null;
  if v_n <> 2 then
    raise exception 'CORRECCIÓN 230 ABORTADA: se esperaban las 2 salidas manuales (ids 1 y 2) del paquete 71 y hay %.', v_n;
  end if;
  select count(*) into v_mal from public.salidas_dinamicas
   where id in (1, 2) and paquete_id = 71 and moneda = 'COP' and (valor_tiquete >= 1000 or ta >= 1000 or fee_infante >= 1000);
  if v_mal > 0 then
    raise exception 'CORRECCIÓN 230 ABORTADA: % salida(s) manual(es) del paquete 71 tienen un valor >= 1.000; revisar a mano.', v_mal;
  end if;

  -- 6. Corrección. Orden: primero los empaquetados (fuente), luego sus salidas vinculadas (la base exige la misma moneda).
  update public.empaquetados
     set moneda = 'USD',
         notas = case when coalesce(notas, '') like '%[230] Moneda corregida%' then notas
                      else case when nullif(btrim(coalesce(notas, '')), '') is null then v_marca else notas || E'\n' || v_marca end end,
         updated_at = now()
   where id = any (v_ids) and moneda = 'COP';

  update public.salidas_dinamicas s
     set moneda = 'USD'
    from public.empaquetados e
   where s.empaquetado_id = e.id and e.id = any (v_ids) and s.moneda = 'COP';

  update public.salidas_dinamicas
     set moneda = 'USD',
         notas = case when coalesce(notas, '') like '%[230] Moneda corregida%' then notas
                      else case when nullif(btrim(coalesce(notas, '')), '') is null then v_marca else notas || E'\n' || v_marca end end
   where id in (1, 2) and paquete_id = 71 and empaquetado_id is null and moneda = 'COP';

  -- 7. Postcondiciones (si alguna falla, la transacción se revierte completa).
  select count(*) into v_n from public.empaquetados where id = any (v_ids) and moneda = 'USD' and notas like '%[230] Moneda corregida%';
  if v_n <> 17 then raise exception 'CORRECCIÓN 230 REVERTIDA: quedaron % de 17 empaquetados en USD con constancia.', v_n; end if;
  select count(*) into v_n from public.salidas_dinamicas s join public.empaquetados e on e.id = s.empaquetado_id
   where e.id = any (v_ids) and s.moneda is distinct from e.moneda;
  if v_n <> 0 then raise exception 'CORRECCIÓN 230 REVERTIDA: % salida(s) vinculada(s) no coinciden con su fuente.', v_n; end if;
  select count(*) into v_n from public.salidas_dinamicas where id in (1, 2) and paquete_id = 71 and moneda = 'USD';
  if v_n <> 2 then raise exception 'CORRECCIÓN 230 REVERTIDA: las salidas manuales 1 y 2 del paquete 71 no quedaron en USD.'; end if;
  select count(*) into v_n from public.empaquetados e
   where e.moneda = 'COP' and ((e.tarifa_proveedor > 0 and e.tarifa_proveedor < 1000) or (e.tarifa_para_empaquetar > 0 and e.tarifa_para_empaquetar < 1000) or (e.fee_infante > 0 and e.fee_infante < 1000));
  if v_n <> 0 then raise exception 'CORRECCIÓN 230 REVERTIDA: aún hay % empaquetado(s) en COP con valor < 1.000.', v_n; end if;
end $$;

commit;
