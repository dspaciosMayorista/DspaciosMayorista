-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK de la migración 159 (consecutivo_dtm_mayorista)
--
-- Revierte: la función nueva (siguiente_numero_contrato_para_tenant), la
-- secuencia nueva (contrato_seq_mayorista) y el candado agregado a
-- eliminar_contrato() (la restaura EXACTA a la versión de la migración 117).
--
-- ⚠️ ABORTA SI YA HAY CONTRATOS DTM (revisión posterior al PR #274): el
-- primer borrador de este rollback solo lo ADVERTÍA en un comentario, sin
-- verificarlo de verdad — dejaba borrar la función/secuencia igual aunque ya
-- hubiera contratos DTM- reales, lo que rompería `crearContrato`/`reservar`/
-- etc. para mayorista en caliente sin ningún aviso en tiempo de ejecución.
-- Ahora, DENTRO de la misma transacción y ANTES de tocar cualquier objeto, se
-- cuenta cuántas filas de `ventas` tienen `tenant='mayorista'` O
-- `numero_contrato LIKE 'DTM-%'` (las dos condiciones por separado: una fila
-- podría, en teoría, tener una sin la otra si algo externo la tocó a mano) —
-- si el conteo es mayor a 0, el rollback ABORTA con RAISE EXCEPTION y no
-- cambia absolutamente nada (ni siquiera el `create or replace` de
-- eliminar_contrato llega a ejecutarse: todo va antes, en el mismo bloque).
--
-- Solo cuando el conteo es 0 continúa con el resto del rollback.
--
-- Todo el archivo corre en una transacción explícita. Es idempotente en el
-- tramo de "drop" (`drop ... if exists`), pero el candado de arriba SÍ puede
-- hacer que la transacción entera aborte — eso es intencional.
-- ───────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  v_contratos_dtm bigint;
begin
  select count(*) into v_contratos_dtm
    from public.ventas
   where tenant = 'mayorista' or numero_contrato like 'DTM-%';
  if v_contratos_dtm > 0 then
    raise exception
      'ABORTADO: existen % contrato(s) con tenant=mayorista o numero_contrato '
      'DTM-%%. Revertir la 159 dejaría esos contratos (y cualquier código que '
      'siga desplegado y dependa de siguiente_numero_contrato_para_tenant()) '
      'sin la función/secuencia que necesitan. Coordina primero el rollback '
      'del código desplegado, o confirma que esos contratos son aceptables '
      'de perder soporte antes de forzar este rollback a mano.',
      v_contratos_dtm;
  end if;
end $$;

-- 1) eliminar_contrato() vuelve a la versión EXACTA de la migración 117
--    (sin el candado de DTM-).
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

-- 2) Función y secuencia nuevas, fuera.
drop function if exists public.siguiente_numero_contrato_para_tenant(text);
drop sequence if exists public.contrato_seq_mayorista;

commit;
