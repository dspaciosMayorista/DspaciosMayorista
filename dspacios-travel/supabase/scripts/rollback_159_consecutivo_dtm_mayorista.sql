-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 159 (consecutivo_dtm_mayorista)
--
-- Revierte: la función nueva (siguiente_numero_contrato_para_tenant), la
-- secuencia nueva (contrato_seq_mayorista) y el candado agregado a
-- eliminar_contrato() (la restaura EXACTA a la versión de la migración 117).
--
-- ⚠️ ANTES DE CORRER ESTO: si ya se desplegó el código que usa
-- siguiente_numero_contrato_para_tenant() y ya se generaron contratos DTM-
-- reales, este rollback deja ese código SIN la función que necesita — hay
-- que revertir el despliegue de código PRIMERO (o al mismo tiempo). Los
-- contratos DTM- ya creados NO se pierden ni se tocan: solo deja de ser
-- posible generar NUEVOS con esa función. Verifica antes (solo lectura):
--
--   select count(*) from public.ventas where numero_contrato like 'DTM-%';
--
-- Si el conteo es 0 (nunca se llegó a usar en producción), este rollback es
-- 100% seguro. Si es mayor que 0, coordina con el despliegue de código antes
-- de correrlo.
--
-- Todo el archivo corre en una transacción explícita. Es idempotente
-- (`drop ... if exists`).
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) eliminar_contrato() vuelve a la versión EXACTA de la migración 117
--    (sin el candado de DTM-).
create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mi_rol() <> 'superadmin' then
    raise exception 'Solo un superadmin puede eliminar contratos.';
  end if;

  update public.sillas
     set estado = 'disponible', numero_contrato = null,
         pasajero_nombres = null, pasajero_apellidos = null, tipo_doc = null,
         numero_doc = null, nacimiento = null, asesor = null, hotel = null,
         acomodacion = null, plazo = null
   where numero_contrato = p_numero;

  update public.cotizaciones set numero_contrato = null, estado = 'abierta'
   where numero_contrato = p_numero;

  delete from public.facturacion          where numero_contrato = p_numero;
  delete from public.rentabilidad         where numero_contrato = p_numero;
  delete from public.liquidacion_comisiones where numero_contrato = p_numero;
  delete from public.aliados_b2b          where numero_contrato = p_numero;
  delete from public.cuentas_por_pagar    where numero_contrato = p_numero;
  delete from public.abonos               where numero_contrato = p_numero;

  delete from public.ventas where numero_contrato = p_numero;

  if p_reusar then
    insert into public.numeros_contrato_liberados(numero) values (p_numero)
      on conflict do nothing;
  end if;
end;
$$;

-- 2) Función y secuencia nuevas, fuera.
drop function if exists public.siguiente_numero_contrato_para_tenant(text);
drop sequence if exists public.contrato_seq_mayorista;

commit;
