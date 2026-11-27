-- ROLLBACK 347. Solo la corre el dueño. Restaura el cuerpo de la 333 de la función auxiliar (deja de escribir contrato_hoteles). Los hoteles ya escritos en contratos convertidos son filas válidas del contrato y se CONSERVAN (no se borran).
begin;
create or replace function p75_priv.completar_conversion_manual(p_cotizacion_id bigint, p_numero text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.ventas; it public.contrato_items; v_dec integer; v_adult numeric; v_tar numeric; v_resid numeric; v_tope numeric;
  v_payload jsonb; v_plan text; v_ajuste numeric := 0; v_plan_cambiado boolean := false;
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
  return jsonb_build_object('ajuste', v_ajuste, 'plan_nombre', v_plan_cambiado);
end $$;
revoke all on function p75_priv.completar_conversion_manual(bigint, text) from public, anon, authenticated;
grant execute on function p75_priv.completar_conversion_manual(bigint, text) to service_role;
notify pgrst, 'reload schema';
commit;
