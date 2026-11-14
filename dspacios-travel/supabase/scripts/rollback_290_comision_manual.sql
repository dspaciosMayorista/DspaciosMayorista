-- ROLLBACK de la migración 290 (#97): vuelve EXACTAMENTE a la 205 (cuerpo copiado literal del archivo de la 205 por genRollback) y quita el trigger.
-- No toca filas: lo registrado mientras la 290 estuvo activa se conserva. Una transacción.
begin;
drop trigger if exists trg_aliados_b2b_sin_duplicado_aliado on public.aliados_b2b;
drop function if exists public.tg_aliados_b2b_sin_duplicado_aliado();
create or replace function public.registrar_comision_b2b_manual(
  p_numero             text,
  p_aliado             text,
  p_nit                text,
  p_tipo_aliado        text,
  p_aliado_id          bigint,
  p_pct                numeric,
  p_recobro            numeric,
  p_pct_recobro        numeric,
  p_aplica_retencion   boolean,
  p_pct_retencion      numeric
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol      text := public.mi_rol()::text;
  v          public.ventas;
  a          public.aliados;
  v_nombre   text;
  v_nit      text;
  v_tipo     text;
  v_ret      boolean;
  v_pct_ret  numeric;
  v_id       bigint;
begin
  -- Usuario y rol (mi_rol() es NULL sin sesión o con el usuario inactivo).
  -- control_vuelo y los externos no registran comisiones.
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta') then
    raise exception 'No autorizado para registrar comisiones B2B.' using errcode = '42501';
  end if;

  -- Contrato y tenant (bloqueado: serializa altas concurrentes del mismo contrato).
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  if not public.puede_ver_tenant(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  -- NETO: la comisión ya se descontó del precio; registrarla la pagaría dos veces.
  if v.comision_estado = 'descontada' then
    raise exception 'El contrato % se vendió en modo neta: la comisión ya se descontó del precio.', p_numero using errcode = 'P0001';
  end if;

  -- Importes (el % 0 es legítimo; NULL no).
  if p_pct is null or p_pct < 0 or p_pct > 1
     or coalesce(p_recobro, 0) < 0
     or coalesce(p_pct_recobro, 0) < 0 or coalesce(p_pct_recobro, 0) > 1
     or (p_aplica_retencion and (p_pct_retencion is null or p_pct_retencion < 0 or p_pct_retencion > 1)) then
    raise exception 'Valores de comisión inválidos.' using errcode = '22023';
  end if;

  v_nombre := nullif(btrim(coalesce(p_aliado, '')), '');
  v_nit := nullif(btrim(coalesce(p_nit, '')), '');
  v_tipo := nullif(btrim(coalesce(p_tipo_aliado, '')), '');
  v_ret := coalesce(p_aplica_retencion, false);
  v_pct_ret := case when v_ret then p_pct_retencion else 0 end;

  if v_rol = 'venta' then
    -- Solo SU contrato (misma regla que usan las policies del contrato).
    if not public.soy_asesor_del_contrato(p_numero) then
      raise exception 'Solo puedes registrar la comisión de tus propios contratos.' using errcode = '42501';
    end if;
    if v.tipo_asesor not in ('agencia','freelance') or v.aliado_id is null then
      raise exception 'El contrato % no es una venta B2B con aliado del catálogo.', p_numero using errcode = 'P0001';
    end if;
    if p_aliado_id is distinct from v.aliado_id then
      raise exception 'La comisión debe ser del aliado del contrato.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero) then
      raise exception 'El contrato % ya tiene comisión registrada; cualquier cambio lo hace administración.', p_numero using errcode = '23505';
    end if;
    -- Identidad y retención del aliado salen del catálogo, no del formulario.
    select * into a from public.aliados where id = v.aliado_id;
    if not found then
      raise exception 'El aliado del contrato no existe en el catálogo.' using errcode = 'P0001';
    end if;
    v_nombre := a.nombre;
    v_nit := a.nit;
    v_tipo := v.tipo_asesor;
    v_ret := coalesce(a.aplica_retencion, false);
    v_pct_ret := case when v_ret then coalesce(a.pct_retencion, 0) else 0 end;
  elsif p_aliado_id is not null then
    select * into a from public.aliados where id = p_aliado_id;
    if not found then
      raise exception 'El aliado % no existe.', p_aliado_id using errcode = 'P0001';
    end if;
    -- Enlazada al catálogo, el tipo es el del catálogo, no el del formulario:
    -- decide si hay cuenta de cobro (solo freelance; la agencia factura).
    v_tipo := coalesce(a.tipo, v_tipo);
  end if;

  if v_nombre is null then
    raise exception 'Indica el aliado de la comisión.' using errcode = '22023';
  end if;

  insert into public.aliados_b2b (
    numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
    precio_venta, base_comision, base_explicita, pct_comision,
    recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado
  ) values (
    v.numero_contrato, v.tenant, v_nombre, v_nit, v_tipo, p_aliado_id,
    coalesce(v.precio_venta, 0), greatest(0, coalesce(v.precio_venta, 0) - coalesce(v.impuesto, 0)), true, p_pct,
    coalesce(p_recobro, 0), coalesce(p_pct_recobro, 0), v_ret, v_pct_ret, 'pendiente'
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) from public, anon;
grant execute on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) to authenticated;
comment on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) is null;
do $$ begin
  -- Huella de la 205: 871d2946… si se aplicó desde un checkout CRLF (Windows, la de producción) o dc89361b… con LF. Mismo texto.
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric)'::regprocedure) <> 'dc89361bdfd6fb12a822b2e093174d28' then
    raise exception 'ROLLBACK_290: el cuerpo restaurado no coincide con la 205 (md5 normalizado); se revierte.';
  end if;
end $$;
commit;
