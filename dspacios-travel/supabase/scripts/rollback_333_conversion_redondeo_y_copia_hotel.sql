-- ROLLBACK 333. Solo la corre el dueño. Restaura la conversión pública con el cuerpo de la 288 y borra la función auxiliar. Los contratos ya convertidos NO se tocan:
-- conservan su línea «Ajuste de redondeo del reparto del hotel» (es una línea válida del contrato) y su «Servicio / Plan» con la copia del hotel.
begin;
create or replace function public.convertir_cotizacion_a_contrato(p_cotizacion_id bigint, p_usuario_id uuid)
 returns text
 language plpgsql
as $function$
declare v_n text; v_rol text; v_t_cot text; v_t_vta text; v_t_act text;
begin
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
  perform set_config('app.p75_conv', v_n, true);
  perform p75_priv.trasladar_cxp_a_previstas(v_n);
  perform set_config('app.p75_conv', '', true);
  perform p75_priv.normalizar_abonos_previos(v_n);
  return v_n;
end $function$;
drop function if exists p75_priv.completar_conversion_manual(bigint, text);
notify pgrst, 'reload schema';
commit;
