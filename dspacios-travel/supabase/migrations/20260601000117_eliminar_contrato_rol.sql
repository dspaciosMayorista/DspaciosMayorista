-- ───────────────────────────────────────────────────────────────────────────
-- 117 · eliminar_contrato(): candado de rol DENTRO de la función
--
--  eliminar_contrato() (migración 060) es SECURITY DEFINER (corre con permisos
--  de owner, bypassa RLS en todas las tablas que toca) pero no validaba el rol
--  de quien la invoca. La Server Action `admin-actions.ts::eliminarContrato`
--  sí exige superadmin ANTES de llamar al RPC, pero eso no protege la función:
--  cualquier usuario autenticado puede llamar `supabase.rpc('eliminar_contrato',
--  ...)` directo desde el navegador (con su propio JWT), saltándose la Server
--  Action, y borrar cualquier contrato. Mismo patrón de candado que ya usan
--  fn_renumerar_contrato / fn_fusionar_destino (exigir mi_rol() adentro).
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() <> 'superadmin' then
    raise exception 'Solo un superadmin puede eliminar contratos.';
  end if;

  -- Libera las sillas asociadas (vuelven a 'disponible').
  update public.sillas
     set estado = 'disponible', numero_contrato = null,
         pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null,
         numero_doc = null, nacimiento = null, asesor = null, hotel = null,
         acomodacion = null, plazo = null
   where numero_contrato = p_numero;

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

  -- La venta (contrato_pasajeros/hoteles/vuelos/items, vouchers, adjuntos: cascade).
  delete from public.ventas where numero_contrato = p_numero;

  if p_reusar then
    insert into public.numeros_contrato_liberados(numero) values (p_numero)
      on conflict do nothing;
  end if;
end;
$$;
