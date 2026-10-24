-- ───────────────────────────────────────────────────────────────────────────
-- 230 · ROLLBACK de la CORRECCIÓN DE DATOS (correccion_230_datos_usd.sql): devuelve a COP SOLO las filas que la corrección marcó
-- (las que llevan la constancia "[230] Moneda corregida" en notas) y quita esa constancia. Una transacción; si hay ventas, ofertas aceptadas o aceptaciones vigentes
-- ligadas a los paquetes 70/71 o a esos empaquetados, se NIEGA (con USD vendido, volver a COP descuadraría costos y cuentas por pagar).
-- No toca la estructura de la 230 (para eso: rollback_230_empaquetados_usd.sql, que se corre DESPUÉS de este).
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
declare
  v_ids   bigint[] := array[3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  v_marca constant text := '[230] Moneda corregida de COP a USD por decisión del dueño (2026-10-23): regla "tiquete en COP con valor menor a 1.000 es USD".';
  v_nv integer;
  v_n  integer;
begin
  select (select count(*) from public.ventas where paquete_armado_id in (70, 71) or empaquetado_ref_id = any (v_ids))
       + (select count(*) from public.p63_oferta where paquete_id in (70, 71) and estado = 'aceptada')
       + (select count(*) from public.p63_aceptacion a join public.p63_oferta o on o.id = a.oferta_id
           where o.paquete_id in (70, 71) and a.estado <> 'descartada') into v_nv;
  if v_nv > 0 then
    raise exception 'ROLLBACK DE DATOS 230 ABORTADO: hay % venta(s), oferta(s) aceptada(s) o aceptación(es) vigente(s) ligadas; no se devuelve a COP lo que ya se usó en USD.', v_nv;
  end if;

  -- Primero los empaquetados (fuente), luego las salidas (la base exige la misma moneda).
  update public.empaquetados
     set moneda = 'COP',
         notas = nullif(btrim(replace(replace(notas, E'\n' || v_marca, ''), v_marca, '')), ''),
         updated_at = now()
   where id = any (v_ids) and moneda = 'USD' and notas like '%[230] Moneda corregida%';

  update public.salidas_dinamicas s
     set moneda = 'COP'
    from public.empaquetados e
   where s.empaquetado_id = e.id and e.id = any (v_ids) and e.moneda = 'COP' and s.moneda = 'USD';

  update public.salidas_dinamicas
     set moneda = 'COP',
         notas = nullif(btrim(replace(replace(notas, E'\n' || v_marca, ''), v_marca, '')), '')
   where id in (1, 2) and paquete_id = 71 and empaquetado_id is null and moneda = 'USD' and notas like '%[230] Moneda corregida%';

  select count(*) into v_n from public.salidas_dinamicas s join public.empaquetados e on e.id = s.empaquetado_id where s.moneda is distinct from e.moneda;
  if v_n <> 0 then raise exception 'ROLLBACK DE DATOS 230 REVERTIDO: % salida(s) vinculada(s) quedaron con otra moneda que su fuente.', v_n; end if;
end $$;

commit;
