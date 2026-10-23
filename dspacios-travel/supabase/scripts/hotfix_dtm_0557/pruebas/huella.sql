-- Huella de TODO lo que el hotfix puede tocar (sin auditoria): sirve para
-- probar "no cambió nada" y "el rollback dejó todo exactamente igual".
select md5(string_agg(t, E'\n' order by t)) from (
  select 'ventas '||row(x.*)::text t from public.ventas x
  union all select 'pas '||row(x.*)::text from public.contrato_pasajeros x
  union all select 'vue '||row(x.*)::text from public.contrato_vuelos x
  union all select 'hot '||row(x.*)::text from public.contrato_hoteles x
  union all select 'ite '||row(x.*)::text from public.contrato_items x
  union all select 'cxp '||row(x.*)::text from public.cuentas_por_pagar x
  union all select 'abo '||row(x.*)::text from public.abonos x
  union all select 'ali '||row(x.*)::text from public.aliados_b2b x
  union all select 'liq '||row(x.*)::text from public.liquidacion_comisiones x
  union all select 'fac '||row(x.*)::text from public.facturacion x
  union all select 'ren '||row(x.*)::text from public.rentabilidad x
  union all select 'sil '||row(x.*)::text from public.sillas x
  union all select 'adj '||row(x.*)::text from public.contrato_adjuntos x
  union all select 'cot '||row(x.*)::text from public.cotizaciones x
  union all select 'vou '||row(x.*)::text from public.vouchers x
  union all select 'cuo '||row(x.*)::text from public.cuotas x
  union all select 'cfa '||row(x.*)::text from public.contrato_facturacion x
  union all select 'ser '||row(x.*)::text from public.contrato_servicios x
  union all select 'cvc '||row(x.*)::text from public.contrato_vuelo_control x
  union all select 'cvx '||row(x.*)::text from public.contrato_vuelo_control_cambios x
  union all select 'con '||row(x.*)::text from public.contrato_condiciones x
  union all select 'ovr '||row(x.*)::text from public.restriccion_overrides x
  union all select 'cfp '||row(x.*)::text from public.contrato_financiero_pendiente x
  union all select 'ber '||row(x.*)::text from public.contrato_alojamiento_bernalo x
  union all select 'csi '||row(x.*)::text from public.conciliacion_sistema x
  union all select 'lde '||row(x.*)::text from public.liquidacion_descuentos x
  union all select 'asi '||row(x.*)::text from public.asientos_contables x
  union all select 'lin '||row(x.*)::text from public.asiento_lineas x
  union all select 'obj '||row(x.*)::text from storage.objects x
  union all select 'pool '||numero from public.numeros_contrato_liberados
  union all select 'seq '||last_value||' '||is_called from public.contrato_seq_mayorista
  union all select 'fk '||conname||' '||condeferrable||' '||condeferred from pg_constraint where contype = 'f'
) s;
