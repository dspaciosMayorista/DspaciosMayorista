-- DESACTIVAR la exigencia del acuerdo de comisión (#97) SIN eliminar evidencia. Alternativa NO destructiva al rollback de la 286.
-- Efecto: p97_priv.corte.exigir = false → una cotización B2B dinámica sin acuerdo vuelve a convertirse como siempre.
-- CONSERVA: la tabla comision_plan con todas sus versiones, las filas de aliados_b2b ya completadas, el vínculo ventas.aliado_id y el corte definitivo
--   (la regla NETO nueva sigue rigiendo para lo ya sellado bajo ella: apagarla recalcularía distinto lo sellado). Los acuerdos existentes se siguen validando al convertir.
begin;
do $$
declare k p97_priv.corte;
begin
  select * into k from p97_priv.corte limit 1;
  if not found then raise exception 'DESACTIVAR_286: la 286 no está aplicada.' using errcode = 'P0001'; end if;
  if not k.exigir then raise exception 'DESACTIVAR_286: la exigencia ya está apagada.' using errcode = 'P0001'; end if;
  update p97_priv.corte set exigir = false;
  raise notice 'DESACTIVAR_286: exigencia apagada. Corte conservado = %. Acuerdos conservados = %.', k.cotizacion_id_max, (select count(*) from public.comision_plan);
end $$;
select exigir, cotizacion_id_max as corte_conservado, activado_en, (select count(*) from public.comision_plan) as acuerdos_conservados from p97_priv.corte;
commit;
