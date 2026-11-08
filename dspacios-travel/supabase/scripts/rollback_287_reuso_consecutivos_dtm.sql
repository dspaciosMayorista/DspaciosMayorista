-- ROLLBACK de la migración 287 (reutilización de consecutivos DTM, #75).
-- Restaura eliminar_contrato a la versión de la 196 (texto exacto) y elimina los objetos de la 287.
-- SE NIEGA si: el pool numeros_dtm_liberados tiene números (se perderían consecutivos liberados; vacíalo a propósito
-- antes, p. ej. con un respaldo), la función eliminar_contrato ya no es la de la 287 (alguien la cambió después), o la
-- migración 287 no está aplicada. NO toca auditoria ni ninguna otra evidencia.
begin;

do $$
declare v_md5 text;
begin
  if to_regclass('public.numeros_dtm_liberados') is null then
    raise exception 'rollback 287: la 287 no está aplicada (no existe numeros_dtm_liberados).';
  end if;
  if exists (select 1 from public.numeros_dtm_liberados) then
    raise exception 'rollback 287: el pool tiene % número(s) (%); se perderían consecutivos liberados. Respáldalos y vacía el pool a propósito antes de revertir.',
      (select count(*) from public.numeros_dtm_liberados),
      (select string_agg(numero || '/' || estado, ', ' order by numero) from public.numeros_dtm_liberados);
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = 'public.eliminar_contrato(text,boolean)'::regprocedure;
  if v_md5 is distinct from 'c7a510c064a67fd40e5cb84ea6a3d8d1' then
    raise exception 'rollback 287: eliminar_contrato ya no es la definición de la 287 (md5 %). Revisa qué cambió después antes de revertir.', v_md5;
  end if;
end $$;

drop trigger if exists trg_ventas_reserva_dtm on public.ventas;
drop function if exists public.trg_ventas_reserva_dtm();
drop function if exists public.reservar_numero_contrato(text);
drop function if exists public.contrato_reuso_preview(text);
drop function if exists public.dtm_reuso_bloqueos(text, boolean);
drop function if exists public.dtm_valor_vacio(text);

-- eliminar_contrato tal como la dejó la migración 196
create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.mi_rol() <> 'superadmin' then
    raise exception 'Solo un superadmin puede eliminar contratos.';
  end if;

  if p_reusar and p_numero ~ '^DTM-' then
    raise exception
      'No se puede reutilizar el consecutivo de un contrato DTM- (mayorista): '
      'esa numeración usa una secuencia dedicada que nunca lee de '
      'numeros_contrato_liberados. Vuelve a eliminar el contrato con '
      'p_reusar=false si no necesitas reciclar el número.';
  end if;

  -- Migración 196 (R1 + R2): libera las sillas del contrato con la regla
  -- única `_vaciar_sillas`: quita contrato y TODOS los datos del grupo D;
  -- devuelta y no vendida conservan su estado (nota en bloqueo_cambios).
  perform public._vaciar_sillas(
    array(select id from public.sillas where numero_contrato = p_numero),
    format('Contrato %s eliminado', p_numero));

  -- Desvincula la cotización de origen (vuelve a 'abierta' para reconvertir).
  update public.cotizaciones set numero_contrato = null, estado = 'abierta'
   where numero_contrato = p_numero;

  -- Hijas SIN cascade (factura_items cae por cascade de facturacion).
  delete from public.facturacion          where numero_contrato = p_numero;
  delete from public.rentabilidad         where numero_contrato = p_numero;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero;
  delete from public.aliados_b2b          where numero_contrato = p_numero;
  delete from public.cuentas_por_pagar    where numero_contrato = p_numero;
  delete from public.abonos               where numero_contrato = p_numero;

  -- Ventana ESTRECHA del bypass (migración 166): encendida justo antes del
  -- ÚNICO delete que puede cascadear a contrato_condiciones, apagada
  -- inmediatamente después. `set local` ya está acotado a esta transacción
  -- (esta llamada RPC); apagarlo explícitamente además acota la ventana al
  -- tiempo de esta única sentencia, no al resto de la transacción.
  set local app.eliminando_contrato = 'true';

  -- La venta (contrato_pasajeros/hoteles/vuelos/items/condiciones, vouchers,
  -- adjuntos: cascade).
  delete from public.ventas where numero_contrato = p_numero;

  set local app.eliminando_contrato = 'false';

  if p_reusar then
    insert into public.numeros_contrato_liberados(numero) values (p_numero)
      on conflict do nothing;
  end if;
end;
$function$
;

alter table public.ventas drop column reserva_token;
drop table public.numeros_dtm_liberados;
drop table public.dtm_reuso_config;

notify pgrst, 'reload schema';
commit;
