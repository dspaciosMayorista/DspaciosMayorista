-- FASE 3 de la 286 · ACTIVAR la exigencia del acuerdo de comisión (#97). Se ejecuta SOLO tras preflight_286_activacion.sql con veredicto «LISTO PARA ACTIVAR».
-- Una transacción: bloquea brevemente las escrituras en cotizaciones (para que el corte sea definitivo), vuelve a comprobar y activa.
--   · PRIMERA activación: fija cotizacion_id_max = mayor id de cotización en este instante. Lo creado antes queda HISTÓRICO y convertible (aunque lo haya creado el código viejo);
--     solo lo posterior exige acuerdo y usa la regla NETO nueva (el corte NO se mueve nunca más).
--   · REACTIVACIÓN (tras desactivar_286): solo vuelve a encender la exigencia; conserva el corte original.
-- Reversible sin perder evidencia: desactivar_286_exigir_acuerdo.sql.
begin;
lock table public.cotizaciones in share mode;
do $$
declare k p97_priv.corte; v_bloq bigint; v_corte bigint;
begin
  select * into k from p97_priv.corte limit 1;
  if not found then raise exception 'ACTIVAR_286: la 286 no está aplicada.' using errcode = 'P0001'; end if;
  if k.exigir then raise exception 'ACTIVAR_286: la exigencia ya está activa (corte %, desde %).', k.cotizacion_id_max, k.activado_en using errcode = 'P0001'; end if;
  if not exists (select 1 from public.comision_plan where cotizacion_id is not null) then
    raise exception 'ACTIVAR_286: todavía no hay ningún acuerdo sellado; el código nuevo no está en uso. No se activa.' using errcode = 'P0001';
  end if;
  -- Misma guarda que el preflight (fila 4): si el código VIEJO sigue creando B2B dinámicas sin acuerdo, activar ahora dejaría bloqueadas las siguientes.
  select count(*) into v_bloq from public.cotizaciones c
   where c.tipo = 'manual' and c.modo = 'simple' and c.cotizacion_origen_id is null and c.paquete_din_id is null and c.aliado_id is null
     and coalesce(c.payload ->> 'tipoAsesor', 'interno') in ('agencia', 'freelance') and c.created_at > now() - interval '30 minutes'
     and not exists (select 1 from public.comision_plan a where a.cotizacion_id = c.id);
  if v_bloq > 0 then
    raise exception 'ACTIVAR_286: % B2B dinámica(s) sin acuerdo creada(s) en los últimos 30 min: el código viejo sigue sirviendo. Espera a que deje de servir y repite el preflight.', v_bloq using errcode = 'P0001';
  end if;
  v_corte := coalesce(k.cotizacion_id_max, (select coalesce(max(id), 0) from public.cotizaciones));
  -- Reactivación: nada abierto posterior al corte sin acuerdo; primera activación: el corte es el máximo actual, no hay posteriores.
  select count(*) into v_bloq from public.cotizaciones c
   where c.id > v_corte and c.tipo = 'manual' and c.modo = 'simple' and c.cotizacion_origen_id is null and c.paquete_din_id is null and c.aliado_id is null
     and c.estado = 'abierta' and coalesce(c.payload ->> 'tipoAsesor', 'interno') in ('agencia', 'freelance')
     and not exists (select 1 from public.comision_plan a where a.cotizacion_id = c.id);
  if v_bloq > 0 then
    raise exception 'ACTIVAR_286: % cotización(es) B2B dinámica(s) abierta(s) posterior(es) al corte % no tienen acuerdo y quedarían bloqueadas. No se activa.', v_bloq, v_corte using errcode = 'P0001';
  end if;
  update p97_priv.corte set exigir = true, cotizacion_id_max = v_corte, activado_en = now();
  raise notice 'ACTIVAR_286: exigencia ACTIVA. Corte definitivo = %.', v_corte;
end $$;
select exigir, cotizacion_id_max as corte_definitivo, activado_en from p97_priv.corte;
commit;
