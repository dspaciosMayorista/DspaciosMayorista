-- ────────────────────────────────────────────────────────────────────────────
-- 291 · Reemisión de tarifas de un contrato NETO PENDIENTE sin pagos (#75)   ⚠️ SIN CORRER
--
-- NUMERACIÓN: primer número libre tras la 290 de #97 (verificado 2026-11-10 en todos los worktrees y ramas locales, incluida
-- `claude/43-60-vigencias-por-dia` de #43/#60: nadie usa 291+). Orden: 288 → 286 → 289 → 290 → **291** → código. Depende de la 205 (guardas de
-- comisión B2B) y de la 284 (identidad del contrato); no exige 286/288/289/290.
--
-- REGLA APROBADA POR EL DUEÑO (2026-11-10). Editar la tarifa de un contrato NETO solo mientras está PENDIENTE y SIN pagos:
--   · se conserva el % pactado (el de la fila descontada; nunca el % vigente del catálogo) y la BNC (`ventas.impuesto`) en importe y moneda;
--   · base = PVP nuevo − BNC − (recobro, solo si el acuerdo lo excluyó de la base: regla de #97 —se deduce del propio acuerdo guardado—);
--   · comisión ordinaria = round(base × %) a la unidad de moneda (igual que 206/222); el recobro conserva importe excluido y participación
--     (que solo existe si se excluyó, regla #97), sin entrar dos veces en la base; total NETO = PVP − (ordinaria + participación);
--   · la fila descontada PERSISTE el importe (comision_valor, criterio #97/286) y liquida exactamente el descuento: se verifica al centavo
--     con la fórmula de comision_b2b_total (sin retención) antes de escribir la venta; la política global de redondeo no cambia;
--   · costos y obligaciones (CxP/previstas) NO se tocan.
-- Ítems, fila descontada (`aliados_b2b`) y `ventas.precio_venta`/`comision_b2b` se escriben en UNA transacción. El mínimo NETO de confirmación
-- (288) sale de esos campos.
-- Se RECHAZA sin cambios: no superadmin / otra agencia; no pendiente; con abonos, soportes de pago vigentes, plan de cuotas o facturación;
-- oferta #63; cobro en otra moneda (la 235 congela precio y total convertido; reabrirlo es decisión de #63); línea de precio total;
-- BNC > PVP nuevo; o si el acuerdo pactado no puede recuperarse de forma inequívoca.
--
-- QUÉ MÁS HACE
--   · Reemplaza `tg_aliados_b2b_proteger_abonos` (205, NO se edita el archivo aplicado) con UNA excepción: el total de la fila descontada puede
--     cambiar solo cuando esta RPC marcó, en su transacción, ESE contrato (`app.p291_reemision` = número|contrato_uid) y la base confirma que
--     sigue pendiente y sin abonos. Todo lo demás de la 205 queda idéntico (estado, marca descontada, asesor `venta`, abonos).
--   · Serialización con pagos y confirmación: la RPC toma `FOR UPDATE` sobre la venta; un abono en curso (FK → FOR KEY SHARE) o una confirmación
--     (UPDATE de la venta) la hacen esperar y luego ve el pago o el nuevo estado y rechaza. No hace falta trigger propio.
-- Rollback: supabase/scripts/rollback_291_reemision_neto.sql · Preflight/Postcheck: preflight_291_*/postcheck_291_* · Prueba: test_291_*.
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ A. 205 + excepción de reemisión aprobada ═══
create or replace function public.tg_aliados_b2b_proteger_abonos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_con_abonos boolean;
  v_reemision  boolean := false;
begin
  -- La fila ya está bloqueada por el UPDATE/DELETE en curso; una inserción
  -- concurrente de abono la bloquea también (tg_comision_b2b_pagos_guardas),
  -- así que esta lectura ve el abono comprometido antes de decidir.
  v_con_abonos := exists (select 1 from public.comision_b2b_pagos p where p.aliado_b2b_id = old.id);

  if tg_op = 'DELETE' then
    if v_con_abonos then
      raise exception 'La comisión B2B % del contrato % tiene abonos registrados: deshaz los abonos antes de eliminarla.',
        old.id, old.numero_contrato
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- UPDATE
  -- Asesor `venta` (#38): la policy "edicion asesor" ya exige que sea SU
  -- contrato y su tenant. Aquí: solo antes de abonos, nunca una NETO
  -- descontada, y solo los campos del cálculo (base, %, valor, recobro).
  if public.mi_rol() = 'venta' then
    if v_con_abonos then
      raise exception 'La comisión B2B % ya tiene abonos: solo administración puede cambiarla.', old.id
        using errcode = '42501';
    end if;
    if public.comision_b2b_descontada(old) then
      raise exception 'La comisión B2B % se descontó del precio de venta: no se edita.', old.id
        using errcode = '42501';
    end if;
    if (new.id, new.numero_contrato, new.tenant, new.aliado, new.nit, new.tipo_aliado, new.aliado_id, new.contacto,
        new.precio_venta, new.aplica_retencion, new.pct_retencion, new.estado, new.fecha_pago, new.created_at,
        new.descontada_en_precio)
       is distinct from
       (old.id, old.numero_contrato, old.tenant, old.aliado, old.nit, old.tipo_aliado, old.aliado_id, old.contacto,
        old.precio_venta, old.aplica_retencion, old.pct_retencion, old.estado, old.fecha_pago, old.created_at,
        old.descontada_en_precio) then
      raise exception 'El asesor solo puede corregir la base, el porcentaje, el valor y el recobro de su comisión.'
        using errcode = '42501';
    end if;
  end if;

  if new.descontada_en_precio is distinct from old.descontada_en_precio then
    raise exception 'No se puede cambiar si la comisión B2B % fue descontada en el precio.', old.id
      using errcode = 'P0001';
  end if;

  -- 291: reemisión APROBADA de un NETO pendiente sin pagos (marca de la RPC reemitir_neto_pendiente para ESTE contrato, verificada contra la base).
  if not v_con_abonos and public.comision_b2b_descontada(old) and new.numero_contrato = old.numero_contrato then
    v_reemision := exists (
      select 1 from public.ventas vt
       where vt.numero_contrato = old.numero_contrato and vt.estado = 'pendiente'
         and coalesce(current_setting('app.p291_reemision', true), '') = vt.numero_contrato || '|' || coalesce(vt.contrato_uid::text, '')
         and not exists (select 1 from public.abonos ab where ab.numero_contrato = vt.numero_contrato));
  end if;

  if v_con_abonos or public.comision_b2b_descontada(old) then
    if new.estado is distinct from old.estado then
      raise exception 'La comisión B2B % ya está abonada o descontada: su estado no se edita.', old.id
        using errcode = 'P0001';
    end if;
    if not v_reemision and round(public.comision_b2b_total(new), 2) <> round(public.comision_b2b_total(old), 2) then
      raise exception 'La comisión B2B % ya tiene abonos o se descontó del precio: el cambio alteraría su total (% → %).',
        old.id, round(public.comision_b2b_total(old), 2), round(public.comision_b2b_total(new), 2)
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_aliados_b2b_proteger_abonos() from public, anon, authenticated;
comment on function public.tg_aliados_b2b_proteger_abonos() is
  'V291: 205 + excepción de reemisión aprobada de un NETO pendiente sin pagos (app.p291_reemision = número|contrato_uid, verificado contra la base).';

-- ═══ B. La reemisión ═══
-- Un abono y una reemisión del mismo contrato NO se cruzan sin código extra: insertar en abonos verifica la FK abonos_numero_contrato_fkey,
-- que toma FOR KEY SHARE sobre la venta, y eso choca con el FOR UPDATE de abajo (en los dos órdenes; test_291_carrera.sh R1/R2).
-- No bajar ese candado a FOR NO KEY UPDATE: dejaría pasar un abono en curso (el postcheck lo vigila).
create or replace function public.reemitir_neto_pendiente(p_numero text, p_items jsonb, p_forzar_margen boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol   text := public.mi_rol()::text;
  v       public.ventas;
  b       public.aliados_b2b;
  n_desc  integer;
  e       jsonb;
  i       integer := 0;
  v_pvp_old numeric; v_items_old numeric; v_pvp numeric := 0;
  v_bnc numeric; v_part numeric; v_pct numeric; v_excl numeric; v_prow numeric; v_trow numeric; v_fold numeric; v_cval numeric; v_chk numeric;
  v_base_old numeric; v_ord_old numeric; v_base numeric; v_ord numeric; v_desc numeric; v_neto numeric; v_total_cobro numeric;
  v_ad integer; v_ni integer; v_ta numeric; v_tn numeric; v_des text;
  v_costos numeric; nh public.cotizacion_neto; ev jsonb;
begin
  -- Permisos: el editor de ítems es solo de superadmin (soloSuperadmin); la RPC lo exige de nuevo y la agencia del contrato.
  if v_rol is null or v_rol <> 'superadmin' then
    raise exception 'NETO_291: no autorizado para editar las tarifas del contrato.' using errcode = '42501';
  end if;
  -- Bloqueo del contrato: serializa con confirmar_venta, con un abono (FK → FOR KEY SHARE) y con otra reemisión.
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then raise exception 'NETO_291: el contrato % no existe.', p_numero using errcode = 'P0001'; end if;
  if not public.puede_ver_tenant(v.tenant) then raise exception 'NETO_291: no autorizado para el contrato %.', p_numero using errcode = '42501'; end if;

  if v.comision_estado is distinct from 'descontada' or v.modo_compra is distinct from 'neta' then
    raise exception 'NETO_291: el contrato % no es NETO.', p_numero using errcode = 'P0001';
  end if;
  if v.estado is distinct from 'pendiente' then
    raise exception 'NETO_291: el contrato % no está pendiente (%): sus tarifas NETO ya no se editan.', p_numero, coalesce(v.estado, 'sin estado') using errcode = 'P0001';
  end if;
  if v.financiero_estado is distinct from 'completo' then
    raise exception 'NETO_291: el contrato % tiene su registro financiero incompleto.', p_numero using errcode = 'P0001';
  end if;
  if v.aceptacion_63_id is not null then
    raise exception 'NETO_291: el contrato % nació de una oferta #63 (cobro congelado): no se reemite.', p_numero using errcode = 'P0001';
  end if;
  -- 235: un cobro en otra moneda congela precio_venta y total_cobro (trg_ventas_cobro_congelado); la 291 no reabre esa regla.
  if v.moneda_cobro is not null and v.moneda_cobro is distinct from coalesce(v.moneda, 'COP') then
    raise exception 'NETO_291: el contrato % se cobra en % con una conversión congelada (TRM %): su precio no se reemite.', p_numero, v.moneda_cobro, v.trm_cobro
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.abonos ab where ab.numero_contrato = p_numero) then
    raise exception 'NETO_291: el contrato % ya tiene pagos: sus tarifas NETO no se editan.', p_numero using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contrato_soportes_pago s where s.numero_contrato = p_numero and coalesce(s.vigente, true) and s.retirado_en is null) then
    raise exception 'NETO_291: el contrato % tiene un soporte de pago vigente: revísalo antes de editar las tarifas.', p_numero using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cuotas q where q.numero_contrato = p_numero) then
    raise exception 'NETO_291: el contrato % tiene un plan de cuotas: elimínalo antes de editar las tarifas (se calculó sobre el total anterior).', p_numero using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contrato_facturacion f where f.numero_contrato = p_numero) then
    raise exception 'NETO_291: el contrato % ya tiene facturación registrada.', p_numero using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contrato_items it where it.numero_contrato = p_numero and it.modo_precio = 'total') then
    raise exception 'NETO_291: el contrato % tiene una línea de precio total que este editor no conserva.', p_numero using errcode = 'P0001';
  end if;

  -- Acuerdo pactado: UNA fila descontada, sin abonos, con % y una base que corresponda EXACTAMENTE a la fórmula con la que se pactó.
  select count(*) into n_desc from public.aliados_b2b x where x.numero_contrato = p_numero and coalesce(x.descontada_en_precio, false);
  if n_desc <> 1 then raise exception 'NETO_291: no se puede recuperar el acuerdo pactado del contrato % (% filas descontadas).', p_numero, n_desc using errcode = 'P0001'; end if;
  select * into b from public.aliados_b2b x where x.numero_contrato = p_numero and coalesce(x.descontada_en_precio, false) for update;
  if exists (select 1 from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id) then
    raise exception 'NETO_291: la comisión del contrato % tiene pagos.', p_numero using errcode = 'P0001';
  end if;
  v_pct := b.pct_comision;
  v_pvp_old := b.precio_venta;
  v_bnc := coalesce(v.impuesto, 0);
  v_base_old := b.base_comision;
  select coalesce(sum(coalesce(it.adultos, 0) * coalesce(it.tarifa_adulto, 0) + coalesce(it.ninos, 0) * coalesce(it.tarifa_nino, 0)), 0)
    into v_items_old from public.contrato_items it where it.numero_contrato = p_numero;
  if v_pct is null or v_pct <= 0 or v_pct > 1 or v_pvp_old is null or v_base_old is null or v.comision_b2b is null
     or coalesce(b.recobro_total, 0) < 0 then
    raise exception 'NETO_291: no se puede recuperar el acuerdo pactado del contrato % (faltan %%, PVP o base).', p_numero using errcode = 'P0001';
  end if;
  -- Acuerdo pactado, deducido SOLO de la fila descontada y de la venta (sirve para las tres formas de fila: 206 con comision_valor NULL,
  -- 222 con el descuento completo en comision_valor, o participación como recobro_total × %):
  --   ordinaria pactada = round(base × %) (206/222/#97) · participación del recobro = descuento − ordinaria ·
  --   recobro excluido de la base (importe) = PVP − BNC − base. Regla #97: hay participación SI Y SOLO SI el recobro se excluyó de la base.
  v_ord_old := round(v_base_old * v_pct);
  v_part := v.comision_b2b - v_ord_old;
  v_excl := v_pvp_old - v_bnc - v_base_old;
  if v_part < 0 or v_excl < -0.005 or (v_part > 0) <> (v_excl > 0.005) then
    raise exception 'NETO_291: no se puede recuperar el acuerdo pactado del contrato % (la base % y el descuento % no corresponden a su PVP, BNC y %%).',
      p_numero, v_base_old, v.comision_b2b using errcode = 'P0001';
  end if;
  v_excl := greatest(v_excl, 0);
  -- La fila debe representar el descuento (fórmula de comision_b2b_total sin retención). Con comision_valor NULL (206) solo se admite la diferencia
  -- del redondeo de la ordinaria (medio peso/dólar); con importe persistido, al centavo.
  v_prow := coalesce(b.recobro_total, 0) * coalesce(b.pct_recobro_aliado, 0.5);
  v_trow := coalesce(b.comision_valor, v_base_old * v_pct) + v_prow;
  v_fold := v_part - v_prow;   -- participación que la fila lleva DENTRO de comision_valor (forma 222)
  v_chk := case when b.comision_valor is null then 0.5 else 0.005 end;   -- tolerancia (variable: un CASE dentro del IF lo cortaría en su THEN)
  if abs(v_trow - v.comision_b2b) > v_chk or v_fold < -0.005
     or abs(coalesce(v.precio_venta, 0) + v.comision_b2b - v_pvp_old) > 0.005
     or abs(v_items_old - v_pvp_old) > 0.5 then
    raise exception 'NETO_291: no se puede recuperar el acuerdo pactado del contrato % (comisión, total o ítems no cuadran con lo pactado).', p_numero using errcode = 'P0001';
  end if;

  -- Ítems nuevos: validados en el servidor (nunca del navegador sin revisar).
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NETO_291: los ítems son obligatorios.' using errcode = '22023';
  end if;
  delete from public.contrato_items where numero_contrato = p_numero;
  for e in select * from jsonb_array_elements(p_items) loop
    v_des := nullif(btrim(coalesce(e->>'descripcion', '')), '');
    continue when v_des is null;
    v_ad := trunc(coalesce((e->>'adultos')::numeric, 0))::integer; v_ni := trunc(coalesce((e->>'ninos')::numeric, 0))::integer;   -- igual que guardarItemsContrato
    v_ta := coalesce((e->>'tarifaAdulto')::numeric, 0); v_tn := coalesce((e->>'tarifaNino')::numeric, 0);
    if v_ad < 0 or v_ni < 0 or v_ta < 0 or v_tn < 0 then raise exception 'NETO_291: valores de ítem inválidos.' using errcode = '22023'; end if;
    insert into public.contrato_items (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden)
      values (p_numero, v_des, v_ad, v_ni, v_ta, v_tn, i);
    v_pvp := v_pvp + v_ad * v_ta + v_ni * v_tn;
    i := i + 1;
  end loop;
  if i = 0 then raise exception 'NETO_291: los ítems son obligatorios.' using errcode = '22023'; end if;

  -- Recálculo aprobado.
  if v_bnc > v_pvp then
    raise exception 'NETO_291: la BNC (%) supera el nuevo PVP (%): no se edita.', v_bnc, v_pvp using errcode = 'P0001';
  end if;
  v_base := greatest(v_pvp - v_bnc - v_excl, 0);
  v_ord := round(v_base * v_pct);
  v_desc := v_ord + v_part;
  v_neto := v_pvp - v_desc;
  if v_neto <= 0 then raise exception 'NETO_291: el total NETO resultante (%) no es válido.', v_neto using errcode = 'P0001'; end if;
  v_total_cobro := v.total_cobro;  -- sin conversión de cobro (rechazada arriba) es NULL por el check de la 235

  -- Margen: la MISMA regla con la que se creó este contrato NETO, sobre el NETO nuevo y los costos ya registrados (ventas.costo_*, misma
  -- moneda del contrato). Rechazar aquí revierte también los ítems ya reemplazados arriba (una sola transacción).
  v_costos := coalesce(v.costo_hotel, 0) + coalesce(v.costo_aereo, 0) + coalesce(v.costo_asistencia, 0) + coalesce(v.costo_receptivo, 0) + coalesce(v.otros_costos, 0);
  select * into nh from public.cotizacion_neto x where x.cotizacion_id = v.cotizacion_id and x.modalidad = 'neto';
  if found then
    -- Hija NETO (222, conversión): p50_priv.evaluar_margen (6 %, o 2 % exacto si es solo tiquetes); costo 0 o NETO bajo el costo, sin excepción;
    -- por debajo del mínimo solo con aprobación explícita del rol que autoriza la 222 (p50_priv.rol_autoriza_margen).
    ev := p50_priv.evaluar_margen(round(v_neto * 100)::bigint, round(v_costos * 100)::bigint, coalesce(nh.solo_tiquetes, false));
    if (ev->>'costo_cero')::boolean or (ev->>'bajo_costo')::boolean then
      raise exception 'NETO_291_MARGEN_COSTO: el total NETO (%) no cubre el costo total (%) del contrato %; no se autoriza para ningún rol.', v_neto, v_costos, p_numero
        using errcode = 'P0001';
    end if;
    if not (ev->>'cumple')::boolean and not (coalesce(p_forzar_margen, false) and p50_priv.rol_autoriza_margen(v_rol, coalesce(nh.solo_tiquetes, false))) then
      raise exception 'NETO_291_MARGEN: el total NETO (%) no cubre el margen mínimo del % %% con costos de % (margen actual: % %%). Requiere aprobación de %.',
        v_neto, (ev->>'piso_bps')::int / 100, v_costos, round((ev->>'margen')::numeric * 100, 2),
        case when coalesce(nh.solo_tiquetes, false) then 'superadmin' else 'superadmin o administración' end using errcode = 'P0001';
    end if;
  elsif coalesce(v.tipo_paquete, '') not in ('bloqueo', 'porcion_terrestre') and v_costos > 0 then
    -- Contrato manual (206): espejo de evaluarMargenContrato modo «neto» + puedeAprobarMargenBajo (lib/contrato/margenContrato.ts):
    -- NETO + 0,5 ≥ costos ÷ (1 − 6 %); por debajo, solo con aprobación explícita de superadmin o administración. Sin costos o negociado, no aplica (igual que al crear).
    if not (v_neto + 0.5 >= v_costos / (1 - 0.06)) and not (coalesce(p_forzar_margen, false) and v_rol in ('superadmin', 'administracion')) then
      raise exception 'NETO_291_MARGEN: el total NETO (%) no cubre el margen mínimo del 6 %% con costos de %; el total NETO mínimo es % (margen actual: % %%).',
        v_neto, v_costos, ceil(v_costos / (1 - 0.06)), round((1 - v_costos / v_neto) * 100, 1) using errcode = 'P0001';
    end if;
  end if;
  -- Criterio #97 (286): se PERSISTE el importe calculado en comision_valor (la ordinaria ya redondeada + la participación que la fila
  -- lleva dentro), así la fila liquida exactamente el descuento; recobro_total/pct_recobro_aliado y el % pactado no se tocan.
  v_cval := v_ord + v_fold;

  perform set_config('app.p291_reemision', v.numero_contrato || '|' || coalesce(v.contrato_uid::text, ''), true);
  update public.aliados_b2b
     set precio_venta = v_pvp, base_comision = v_base, comision_valor = v_cval
   where id = b.id;
  -- Conciliación al centavo con la fórmula real (comision_b2b_total sin retención, igual que p97_priv.materializar).
  select coalesce(x.comision_valor, x.base_comision * x.pct_comision) + coalesce(x.recobro_total, 0) * coalesce(x.pct_recobro_aliado, 0.5)
    into v_chk from public.aliados_b2b x where x.id = b.id;
  if abs(v_chk - v_desc) > 0.005 then
    raise exception 'NETO_291: la fila de comisión (%) no liquida el descuento (%) del contrato %; no se reemite.', v_chk, v_desc, p_numero using errcode = 'P0001';
  end if;
  update public.ventas
     set precio_venta = v_neto, comision_b2b = v_desc, total_cobro = v_total_cobro, updated_at = now()
   where numero_contrato = p_numero;
  perform set_config('app.p291_reemision', '', true);

  return jsonb_build_object('pvp', v_pvp, 'bnc', v_bnc, 'base', v_base, 'pct', v_pct, 'comision', v_ord, 'participacion', v_part, 'recobro_excluido', v_excl, 'comision_valor', v_cval,
                            'descuento', v_desc, 'neto', v_neto, 'total_cobro', v_total_cobro, 'pvp_anterior', v_pvp_old, 'neto_anterior', v.precio_venta);
end;
$$;
revoke all on function public.reemitir_neto_pendiente(text, jsonb, boolean) from public, anon;
grant execute on function public.reemitir_neto_pendiente(text, jsonb, boolean) to authenticated;
comment on function public.reemitir_neto_pendiente(text, jsonb, boolean) is
  'V291: reemisión aprobada de tarifas NETO (pendiente sin pagos): % y BNC pactados, base/comisión/NETO recalculados, una transacción.';
