-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la 242 (guarda de cotización vencida). No toca datos.
--   · Devuelve `aceptar_oferta_63` a su cuerpo de la 235 (renombra la base de vuelta y borra la envoltura).
--   · Devuelve `convertir_cotizacion_manual_controlada` al de la 241 (sin la guarda) y borra `p40_exigir_cotizacion_vigente`.
-- Si el código nuevo sigue desplegado, una vencida volvería a convertirse en la base; la Server Action la sigue cortando antes.
-- ───────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regprocedure('public.p40_aceptar_oferta_63_base(bigint,text,uuid,text,text,numeric,text,numeric)') is null then
    raise exception 'ROLLBACK 242 ABORTADO: la 242 no está aplicada (no existe p40_aceptar_oferta_63_base).';
  end if;
end;
$$;

drop function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric);
alter function public.p40_aceptar_oferta_63_base(bigint, text, uuid, text, text, numeric, text, numeric) rename to aceptar_oferta_63;
revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) to service_role;

create or replace function public.convertir_cotizacion_manual_controlada(
  p_cotizacion_id bigint, p_usuario_id uuid
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tipo text;
  v_modo text;
  v_aut bigint;
  v_res text;
begin
  select c.tipo, c.modo into v_tipo, v_modo from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no se convierte en contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  if v_tipo is distinct from 'manual' then
    raise exception 'Solo las cotizaciones dinámicas se convierten por esta vía.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  end if;
  perform p50_priv.validar_conversion(p_cotizacion_id, p_usuario_id);
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p50_priv.completar_conversion(p_cotizacion_id, v_res);
  update public.ventas v
     set cliente_tipo_documento = t.tipo
    from (
      select case
               when nullif(btrim(c.payload#>>'{cliente,numeroDoc}'), '') is null then null
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) = 'PASAPORTE' then 'PAS'
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT') then upper(btrim(c.payload#>>'{cliente,tipoDoc}'))
               else null
             end as tipo
        from public.cotizaciones c where c.id = p_cotizacion_id
    ) t
   where v.numero_contrato = v_res and v.cotizacion_id = p_cotizacion_id;
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;

drop function public.p40_exigir_cotizacion_vigente(bigint);

commit;
