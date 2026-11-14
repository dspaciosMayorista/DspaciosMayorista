-- ROLLBACK de la migración 291 (#75): quita la RPC de reemisión y vuelve EXACTAMENTE a la función de la 205
-- (copiada literal del archivo de la 205 por genRollback). No toca filas: lo reemitido mientras la 291 estuvo activa se conserva. Una transacción.
begin;
drop function if exists public.reemitir_neto_pendiente(text, jsonb, boolean);
create or replace function public.tg_aliados_b2b_proteger_abonos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_con_abonos boolean;
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

  if v_con_abonos or public.comision_b2b_descontada(old) then
    if new.estado is distinct from old.estado then
      raise exception 'La comisión B2B % ya está abonada o descontada: su estado no se edita.', old.id
        using errcode = 'P0001';
    end if;
    if round(public.comision_b2b_total(new), 2) <> round(public.comision_b2b_total(old), 2) then
      raise exception 'La comisión B2B % ya tiene abonos o se descontó del precio: el cambio alteraría su total (% → %).',
        old.id, round(public.comision_b2b_total(old), 2), round(public.comision_b2b_total(new), 2)
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_aliados_b2b_proteger_abonos() from public, anon, authenticated;
comment on function public.tg_aliados_b2b_proteger_abonos() is null;
do $$ begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.tg_aliados_b2b_proteger_abonos()'::regprocedure) <> '0efb4b1c4d7961d81ea700b05e9e4ba6' then
    raise exception 'ROLLBACK_291: la función restaurada no coincide con la 205 (md5 normalizado); se revierte.';
  end if;
end $$;
commit;
