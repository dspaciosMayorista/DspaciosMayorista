-- 347 · Conversión de una cotización dinámica (manual / hija de comparativa) a contrato — los HOTELES elegidos viajan al contrato (B95-15 / B95-18, revisión del dueño 2026-11-26). Aditiva: reemplaza UNA función auxiliar.
--
-- QUÉ ARREGLA. La 333 dejó en el contrato la categoría / régimen / acomodación del hotel solo como TEXTO del campo «Servicio / Plan» y ninguna fila en `contrato_hoteles`: el documento del cliente salía con la fila
--   genérica «PAQUETE TURÍSTICO A …» y SIN la sección «Hoteles y Servicios» (hotel, categoría, plan de alimentación, acomodación, fechas) que tiene todo contrato manual, y las funciones que leen `contrato_hoteles`
--   (solicitud al proveedor, vouchers, estancia) no veían el hotel. Aquí la conversión escribe una fila por hotel de la COPIA guardada de la cotización (la opción elegida en una hija de comparativa), con el origen de la
--   compra (346) cuando existe. No toca la fila de paquete ni el ajuste de redondeo de la 333 (siguen guardados: Σ líneas = precio), ni contratos ya convertidos (no hay backfill: nada inventado).
--
-- Exige la 333 y la 346. Mismo cuerpo que la 333 + el paso (c). Rollback: supabase/scripts/rollback_347_conversion_hoteles_contrato.sql (restaura el cuerpo de la 333). Preflight / postcheck: supabase/scripts/{preflight,postcheck}_347_….sql
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('p75_priv.completar_conversion_manual(bigint,text)') is null then raise exception '347: falta la 333 (completar_conversion_manual).'; end if;
  if not exists (select 1 from pg_proc where oid = 'p75_priv.completar_conversion_manual(bigint,text)'::regprocedure and prosrc like '%Ajuste de redondeo del reparto del hotel%' and prosrc like '%plan_nombre%') then
    raise exception '347: completar_conversion_manual no tiene la forma de la 333; no se reemplaza a ciegas.';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contrato_hoteles' and column_name in ('categoria', 'proveedor', 'compra_origen', 'plataforma')) <> 4 then
    raise exception '347: falta la 346 (contrato_hoteles.compra_origen / plataforma) o las columnas categoria / proveedor.';
  end if;
end $$;

create or replace function p75_priv.completar_conversion_manual(p_cotizacion_id bigint, p_numero text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.ventas; it public.contrato_items; v_dec integer; v_adult numeric; v_tar numeric; v_resid numeric; v_tope numeric;
  v_payload jsonb; v_plan text; v_ajuste numeric := 0; v_plan_cambiado boolean := false; v_hoteles integer := 0; r_h record; v_nh integer; v_origen text; v_plat text;
  c_desc constant text := 'Ajuste de redondeo del reparto del hotel';   -- = DESCRIPCION_AJUSTE_REDONDEO (lib/reservar/solicitudHotel.ts): los documentos lo reconocen por este texto exacto
begin
  select * into v from public.ventas where numero_contrato = p_numero;
  if not found then return null; end if;

  -- (a) R3-1: las líneas del contrato suman EXACTAMENTE el precio. No aplica a NETO (su documento se calcula desde el snapshot).
  if v.comision_estado is distinct from 'descontada'
     and not exists (select 1 from public.cotizacion_neto n where n.cotizacion_id = p_cotizacion_id and n.modalidad = 'neto')
     and not exists (select 1 from public.contrato_items x where x.numero_contrato = p_numero and x.descripcion = c_desc) then
    select * into it from public.contrato_items
     where numero_contrato = p_numero and orden = 0 and coalesce(modo_precio, 'por_persona') = 'por_persona' and descripcion like 'PAQUETE TURÍSTICO A %'
     order by id limit 1;
    if found and it.adultos > 0 and coalesce(v.precio_venta, 0) > 0 then
      v_dec := case when upper(coalesce(v.moneda, 'COP')) = 'USD' then 2 else 0 end;      -- unidad mínima de cobro: peso en COP, centavo en USD
      v_adult := v.precio_venta - it.ninos * it.tarifa_nino;
      if v_adult < 0 then raise exception 'CONVERSION_REDONDEO_INCOHERENTE: el contrato % tiene niños por más que su precio.', p_numero using errcode = 'P0001'; end if;
      v_tar := round(v_adult / it.adultos, v_dec);
      if v_tar is distinct from it.tarifa_adulto then
        update public.contrato_items set tarifa_adulto = v_tar where id = it.id;           -- USD: la base redondeaba a dólares enteros; aquí queda en centavos
      end if;
      v_resid := v_adult - v_tar * it.adultos;
      if v_resid <> 0 then
        v_tope := it.adultos * power(10::numeric, -v_dec);                                  -- una unidad por adulto es el máximo redondeo posible
        if abs(v_resid) > v_tope then
          raise exception 'CONVERSION_REDONDEO_INCOHERENTE: el residuo % del contrato % supera el redondeo posible (%).', v_resid, p_numero, v_tope using errcode = 'P0001';
        end if;
        insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden)
        values (p_numero, c_desc, 1, 0, v_resid, 0, 1);
        v_ajuste := v_resid;
      end if;
    end if;
  end if;

  -- (b) R3-2: la copia EDITADA del hotel elegido (categoría / régimen / acomodación) pasa al campo «Servicio / Plan» del contrato.
  select payload into v_payload from public.cotizaciones where id = p_cotizacion_id;
  if jsonb_typeof(v_payload->'servicios') = 'array' then
    select string_agg(h.txt, ', ' order by h.ord) into v_plan
      from (select e.ord,
                   concat_ws(' · ', btrim(e.s->>'nombre'), nullif(btrim(coalesce(e.s->>'categoria', '')), ''), nullif(btrim(coalesce(e.s->>'regimen', '')), ''), nullif(btrim(coalesce(e.s->>'acomodacion', '')), '')) as txt
              from jsonb_array_elements(v_payload->'servicios') with ordinality as e(s, ord)
             where e.s->>'tipo' = 'hotel' and btrim(coalesce(e.s->>'nombre', '')) <> '') h;
    if v_plan is not null and exists (select 1 from jsonb_array_elements(v_payload->'servicios') s
                                       where s->>'tipo' = 'hotel' and (nullif(btrim(coalesce(s->>'categoria', '')), '') is not null or nullif(btrim(coalesce(s->>'regimen', '')), '') is not null or nullif(btrim(coalesce(s->>'acomodacion', '')), '') is not null)) then
      update public.ventas set plan_nombre = v_plan where numero_contrato = p_numero and plan_nombre is distinct from v_plan;
      v_plan_cambiado := true;
    end if;
  end if;
  -- (c) 347 (B95-15/18): los HOTELES de la cotización elegida pasan a «Hoteles y Servicios» del contrato (nombre, categoría, plan de alimentación, acomodación, fechas), como en todo contrato manual.
  --     Sale de la COPIA guardada en la cotización (payload.servicios), nunca del catálogo vigente. Solo si el contrato aún no tiene hoteles (idempotente; nunca pisa lo capturado a mano).
  --     Nada inventado: ciudad y fechas solo se conocen con UN hotel (viaje completo); con varios hoteles quedan en blanco (la cotización no guarda a qué noches corresponde cada uno).
  --     El proveedor a pagar sigue la regla de la conversión (proveedor, o la plataforma si no hay proveedor); el origen de la compra (directa / plataforma, 346) viaja tal cual y solo si es coherente.
  if jsonb_typeof(v_payload->'servicios') = 'array' and not exists (select 1 from public.contrato_hoteles where numero_contrato = p_numero) then
    select count(*) into v_nh from jsonb_array_elements(v_payload->'servicios') e(s) where e.s->>'tipo' = 'hotel' and btrim(coalesce(e.s->>'nombre', '')) <> '';
    for r_h in
      select e.ord, e.s from jsonb_array_elements(v_payload->'servicios') with ordinality as e(s, ord)
       where e.s->>'tipo' = 'hotel' and btrim(coalesce(e.s->>'nombre', '')) <> '' order by e.ord
    loop
      v_origen := case when r_h.s->>'compra' in ('directa', 'plataforma') then r_h.s->>'compra' end;
      v_plat := nullif(btrim(coalesce(r_h.s->>'plataforma', '')), '');
      if v_origen = 'plataforma' and v_plat is null then v_origen := null; end if;       -- «plataforma» sin nombre no es un dato coherente: no se inventa
      if v_origen is distinct from 'plataforma' then v_plat := null; end if;
      insert into public.contrato_hoteles
        (numero_contrato, nombre, ciudad, alimentacion, acomodacion, detalle_acomodacion, fecha_ingreso, fecha_salida, orden, categoria, proveedor, compra_origen, plataforma)
      values
        (p_numero, btrim(r_h.s->>'nombre'),
         case when v_nh = 1 then nullif(btrim(coalesce(v.destino, '')), '') end,
         nullif(btrim(coalesce(r_h.s->>'regimen', '')), ''), nullif(btrim(coalesce(r_h.s->>'acomodacion', '')), ''), nullif(btrim(coalesce(r_h.s->>'detalleAcomodacion', '')), ''),
         case when v_nh = 1 then v.fecha_salida end, case when v_nh = 1 then v.fecha_regreso end,
         (r_h.ord - 1)::integer, nullif(btrim(coalesce(r_h.s->>'categoria', '')), ''),
         coalesce(nullif(btrim(coalesce(r_h.s->>'proveedor', '')), ''), v_plat, nullif(btrim(coalesce(r_h.s->>'plataforma', '')), '')),
         v_origen, v_plat);
      v_hoteles := v_hoteles + 1;
    end loop;
  end if;
  return jsonb_build_object('ajuste', v_ajuste, 'plan_nombre', v_plan_cambiado, 'hoteles', v_hoteles);
end $$;

revoke all on function p75_priv.completar_conversion_manual(bigint, text) from public, anon, authenticated;
grant execute on function p75_priv.completar_conversion_manual(bigint, text) to service_role;
comment on function p75_priv.completar_conversion_manual(bigint, text) is '347 (B95-15/18): tras convertir una cotización dinámica, cuadra las líneas del contrato con su precio (línea de ajuste guardada, 333), deja la copia editada del hotel en «Servicio / Plan» y escribe los hoteles elegidos en contrato_hoteles.';

notify pgrst, 'reload schema';
commit;
