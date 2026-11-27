-- 333 · Conversión de una cotización dinámica (manual / hija de comparativa) a contrato — auditoría Codex R3-1 y R3-2 (#95/#33). Aditiva: reemplaza UNA función pública y crea UNA auxiliar. NO reescribe contratos existentes.
--
-- R3-1 · Redondeo. `p75_priv.convertir_cotizacion_base` (288) reparte el subtotal de adultos con `round(subtotal / adultos)` (a pesos enteros, también en USD) y guarda UNA línea «PAQUETE TURÍSTICO …». Con un total que no
--   se divide exacto (1.330.455 entre 2) las líneas suman 1.330.456 mientras `ventas.precio_venta` y los abonos valen 1.330.455: el documento imprime un total distinto y, pagado el contrato por completo, un SALDO inventado.
--   Corrección con el enfoque ya establecido (#120): la línea de paquete conserva su fila agrupada y su tarifa por adulto (redondeada a la unidad de la moneda: peso en COP, centavo en USD) y el residuo exacto se
--   acredita en UNA línea «Ajuste de redondeo del reparto del hotel» (adultos 1, tarifa = residuo, que puede ser negativo), que los documentos ya rotulan «Ajuste por redondeo» con el importe solo en «Valor total».
--   La tarifa del niño NO se toca (es la real). Se calcula desde lo PERSISTIDO (`ventas.precio_venta` y la línea de paquete) para que lo guardado cuadre por construcción. No aplica a un contrato NETO (su documento calcula
--   desde el snapshot NETO). Un residuo mayor que el redondeo posible (una unidad por adulto) NO es redondeo: aborta la conversión entera en vez de absorberse.
--
-- R3-2 · Copia editada del hotel. La categoría, el régimen y la acomodación que el asesor editó viven solo en `cotizaciones.payload.servicios[]` (la copia guardada; `cotizacion_servicios` no tiene esas columnas). La conversión
--   los dejaba fuera del contrato. Representación elegida (existente, sin tablas nuevas): el campo «Servicio / Plan» del contrato (`ventas.plan_nombre`), donde el documento ya presenta la categoría y el régimen de las
--   cotizaciones normales: «{hotel} · {categoría} · {régimen} · {acomodación}» por cada hotel de la cotización (en una hija de comparativa solo viaja el hotel elegido). Sale de la COPIA guardada, nunca del catálogo vigente;
--   si el payload no trae ninguno de los tres datos, `plan_nombre` queda exactamente como lo dejó la base. `ventas.hotel` y `contrato_hoteles` no se tocan.
--
-- Orden: preflight (supabase/scripts/preflight_333_conversion_redondeo_y_copia_hotel.sql) → 333 → postcheck. Rollback: supabase/scripts/rollback_333_conversion_redondeo_y_copia_hotel.sql (restaura el cuerpo de la 288).
do $$ begin
  if to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is null
     or to_regprocedure('p75_priv.convertir_cotizacion_base(bigint,uuid)') is null
     or to_regprocedure('p75_priv.trasladar_cxp_a_previstas(text)') is null
     or to_regprocedure('p75_priv.normalizar_abonos_previos(text)') is null then
    raise exception '333: falta la 288 (convertir_cotizacion_a_contrato y sus funciones de apoyo).';
  end if;
  if to_regclass('public.contrato_items') is null or to_regclass('public.cotizacion_neto') is null or to_regclass('public.cotizaciones') is null then
    raise exception '333: faltan contrato_items, cotizacion_neto o cotizaciones.';
  end if;
  -- No se reemplaza una definición que no sea la de la 288 (o la propia 333): se compara por las llamadas que la caracterizan.
  if not exists (select 1 from pg_proc where oid = 'public.convertir_cotizacion_a_contrato(bigint,uuid)'::regprocedure
                  and prosrc like '%p75_priv.convertir_cotizacion_base%' and prosrc like '%p75_priv.trasladar_cxp_a_previstas%' and prosrc like '%p75_priv.normalizar_abonos_previos%') then
    raise exception '333: convertir_cotizacion_a_contrato no tiene la forma de la 288; no se reemplaza a ciegas.';
  end if;
end $$;

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
comment on function p75_priv.completar_conversion_manual(bigint, text) is '333 (R3-1/R3-2): tras convertir una cotización dinámica, cuadra las líneas del contrato con su precio (línea «Ajuste de redondeo…») y deja la copia editada del hotel en «Servicio / Plan».';

-- Mismo cuerpo que la 288 + UN paso (completar_conversion_manual) justo tras la base y antes de trasladar las CxP.
create or replace function public.convertir_cotizacion_a_contrato(p_cotizacion_id bigint, p_usuario_id uuid)
 returns text
 language plpgsql
as $function$
declare v_n text; v_rol text; v_t_cot text; v_t_vta text; v_t_act text;
begin
  -- REINTENTO (respuesta perdida, llamada repetida o concurrente): una conversión ya terminada nunca es un error ni se repite. Se serializa con el FOR UPDATE de la cotización y, ANTES de devolver
  -- el contrato existente, se comprueba la autorización VIGENTE del actor: usuario existente, activo y de rol de conversión (_autorizado_pago_previo) y acceso a la agencia de la cotización y del contrato
  -- (superadmin = excepción global). Nada de lo económico ni lo escrito se repite: ni CxP a previstas, ni materialización, ni normalización, ni validaciones de importes.
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select tenant into v_t_cot from public.cotizaciones where id = p_cotizacion_id for update;
  if found then
    select tenant into v_t_act from public.usuarios where id = p_usuario_id;
    if v_rol <> 'superadmin' and v_t_act is distinct from v_t_cot then
      raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_t_cot using errcode = '42501';
    end if;
    select numero_contrato, tenant into v_n, v_t_vta from public.ventas where cotizacion_id = p_cotizacion_id;
    if found then
      if v_rol <> 'superadmin' and v_t_act is distinct from v_t_vta then
        raise exception 'No tienes acceso a la agencia (tenant %) de este contrato.', v_t_vta using errcode = '42501';
      end if;
      return v_n;
    end if;
  end if;
  v_n := p75_priv.convertir_cotizacion_base(p_cotizacion_id, p_usuario_id);
  perform p75_priv.completar_conversion_manual(p_cotizacion_id, v_n);   -- 333: líneas exactas + copia editada del hotel (misma transacción)
  perform set_config('app.p75_conv', v_n, true);
  perform p75_priv.trasladar_cxp_a_previstas(v_n);
  perform set_config('app.p75_conv', '', true);
  perform p75_priv.normalizar_abonos_previos(v_n);   -- valor_abono en la moneda de COBRO (ver la función)
  -- La CONFIRMACIÓN por pagos previos NO va aquí: la conversión controlada (#97) completa después el recobro y el plan de comisión, y confirmar antes dejaría
  -- la comisión sin materializar. Se evalúa al FINAL con confirmar_tras_conversion (paso posterior, mismo gancho confirmar_venta).
  return v_n;
end $function$;

notify pgrst, 'reload schema';
