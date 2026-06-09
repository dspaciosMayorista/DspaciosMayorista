-- 060 · Eliminar contrato (superadmin) + reusar consecutivo
--
-- El superadmin puede borrar un contrato. Opcionalmente "libera" su consecutivo
-- para reusarlo: el siguiente contrato tomará ese número (el menor liberado) en
-- vez de avanzar la secuencia. Borrar maneja las hijas sin ON DELETE CASCADE
-- (abonos, CxP, etc.), libera las sillas y desvincula la cotización de origen.

create table if not exists public.numeros_contrato_liberados (
  numero text primary key
);
alter table public.numeros_contrato_liberados enable row level security;
drop policy if exists "num_liberados: superadmin" on public.numeros_contrato_liberados;
create policy "num_liberados: superadmin" on public.numeros_contrato_liberados
  for all using (public.mi_rol() = 'superadmin') with check (public.mi_rol() = 'superadmin');

-- Numeración: reusa el menor consecutivo liberado si hay; si no, avanza la secuencia.
create or replace function public.siguiente_numero_contrato()
returns text language plpgsql security definer set search_path = public as $$
declare n text;
begin
  delete from public.numeros_contrato_liberados
   where numero = (select min(numero) from public.numeros_contrato_liberados)
   returning numero into n;
  if n is not null then
    return n;
  end if;
  return '00-' || lpad(nextval('public.contrato_seq')::text, 4, '0');
end;
$$;

-- Borrado completo de un contrato. p_reusar = true libera el consecutivo.
create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
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
