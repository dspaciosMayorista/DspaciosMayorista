-- ───────────────────────────────────────────────────────────────────────────
-- 159 · consecutivo_dtm_mayorista (ADITIVA)
--
-- DECISIÓN COMERCIAL (confirmada por el dueño con el diagnóstico v3 corrido
-- en producción: 133 contratos, todos minorista, formato MIN-00-NNNN válido,
-- 0 contratos mayorista, 0 colisiones/huérfanas/referencias de mayorista):
--   · Mayorista arranca en DTM-0001, DTM-0002, DTM-0003... — consecutivo
--     PROPIO, no comparte secuencia con minorista.
--   · Minorista sigue exactamente como está (MIN-00-NNNN + su mecanismo de
--     reciclaje de números liberados, sin tocar).
--   · Un DTM eliminado NUNCA se recicla (no hay pool de reciclaje para
--     mayorista — decisión explícita, ver el candado en eliminar_contrato()
--     más abajo).
--   · No hay históricos de mayorista que reenumerar — por eso ninguna fila
--     de datos se toca aquí. Solo se agrega infraestructura NUEVA.
--
-- QUÉ HACE (todo aditivo, nada se reemplaza ni se borra):
--   1) Aborta la migración completa si YA existe algún contrato con
--      tenant='mayorista' — si el diagnóstico dejó de estar vigente entre que
--      se corrió y que se aplica esta migración (alguien creó un contrato
--      mayorista mientras tanto), hay que volver a diagnosticar antes de
--      seguir, no numerar por encima de algo que ya existe.
--   2) `contrato_seq_mayorista` — secuencia NUEVA, arranca en 1, exclusiva de
--      mayorista. La secuencia vieja (`contrato_seq`) sigue siendo la única
--      fuente para minorista (`siguiente_numero_contrato()`, sin tocar).
--   3) `siguiente_numero_contrato_para_tenant(p_tenant text)` — función NUEVA
--      que centraliza la generación por tenant y devuelve el número
--      COMPLETO (ya con su prefijo): mayorista → 'DTM-0001' (de la secuencia
--      nueva, nunca de `numeros_contrato_liberados`); minorista → 'MIN-' +
--      lo que devuelva `siguiente_numero_contrato()` (se reutiliza tal cual,
--      INCLUYE su reciclaje de números liberados — sin cambios de
--      comportamiento para minorista). Falla cerrado (RAISE EXCEPTION) para
--      tenant NULL, vacío, o distinto de 'mayorista'/'minorista'. Ningún
--      SELECT max()+1: mayorista usa nextval() (atómico por diseño de
--      Postgres); minorista delega en la función vieja, que ya es atómica
--      (ver migración 060 — DELETE...WHERE numero=(SELECT MIN...)RETURNING,
--      o nextval() si no hay nada que reciclar).
--   4) `eliminar_contrato()` — REEMPLAZADA (mismo nombre y firma, `create or
--      replace`, no rompe nada que ya la llame) para agregar UN candado: si
--      piden reciclar (`p_reusar=true`) un contrato cuyo numero_contrato
--      empieza por 'DTM-', la función RECHAZA la operación completa (ni
--      borra) — mayorista nunca debe insertar nada en
--      `numeros_contrato_liberados`. Minorista sigue exactamente igual.
--
-- LA FUNCIÓN NUEVA NO ES SECURITY DEFINER (a propósito, "no usar SECURITY
-- DEFINER salvo que sea necesario"): no necesita permisos elevados — solo
-- hace nextval() sobre una secuencia (a la que se le da USAGE directo) y
-- llama a `siguiente_numero_contrato()`, que YA es SECURITY DEFINER por su
-- cuenta y se eleva sola sin importar quién la invoque. `search_path` fijo
-- de todas formas, y todo objeto referenciado va calificado con `public.`,
-- por higiene aunque no haya necesidad estricta de seguridad aquí.
--
-- PERMISOS — AUDITADO CONTRA EL CÓDIGO REAL, NO SUPUESTO:
--   Los 5 caminos de creación de contrato (reservar bloqueo, checkout del
--   tarifario, reservarPrograma, crearContrato manual, convertir cotización
--   dinámica) llaman todos con `sb = await createClient()` — el cliente de
--   SESIÓN (rol `authenticated`), NINGUNO usa `createAdminClient()`/
--   service_role para este RPC puntual. Por eso `authenticated` SÍ necesita
--   EXECUTE (la premisa de "si todos usan admin, solo service_role" no se
--   cumple — se deja documentado en vez de asumirlo). `anon` y `PUBLIC` se
--   revocan explícitamente: nadie sin sesión debe poder generar/gastar un
--   número de contrato. La función vieja (`siguiente_numero_contrato`) NO se
--   toca — sigue con los permisos que ya tenía, esta migración no la
--   reemplaza todavía (así lo pidió el dueño).
--
-- `eliminar_contrato()` sigue exactamente sus permisos previos (RLS/rol
-- interno via `mi_rol()`, migración 117) — el `create or replace` conserva
-- la firma y el candado de rol existente, solo se le agrega el candado de
-- DTM antes de tocar `numeros_contrato_liberados`.
--
-- Todo en una transacción explícita: si el abort del punto 1 dispara, NADA
-- de lo demás se aplica.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Candado de seguridad: 0 contratos mayorista en este momento ────────
do $$
declare
  v_existentes bigint;
begin
  select count(*) into v_existentes from public.ventas where tenant = 'mayorista';
  if v_existentes > 0 then
    raise exception
      'ABORTADO: ya existen % contrato(s) con tenant=mayorista. El diagnóstico que autorizó esta migración asumía 0. '
      'Vuelve a correr supabase/scripts/diagnostico_numeracion_dtm.sql y decide de nuevo antes de aplicar la 159.',
      v_existentes;
  end if;
end $$;

-- ── 2) Secuencia exclusiva de mayorista ─────────────────────────────────────
create sequence public.contrato_seq_mayorista start 1;

comment on sequence public.contrato_seq_mayorista is
  'Consecutivo EXCLUSIVO de mayorista para numero_contrato (formato DTM-####). '
  'No la comparte minorista (que sigue usando contrato_seq, sin tocar). '
  'Nunca se combina con numeros_contrato_liberados — mayorista no recicla '
  'números de contratos eliminados (decisión explícita, migración 159).';

-- ── 3) Generador único por tenant — devuelve el número COMPLETO ────────────
create or replace function public.siguiente_numero_contrato_para_tenant(p_tenant text)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant text := btrim(coalesce(p_tenant, ''));
begin
  if v_tenant = '' then
    raise exception 'tenant requerido para generar el número de contrato.';
  end if;

  if v_tenant = 'mayorista' then
    return 'DTM-' || lpad(nextval('public.contrato_seq_mayorista')::text, 4, '0');
  end if;

  if v_tenant = 'minorista' then
    -- Reutiliza el generador actual TAL CUAL, incluido su reciclaje de
    -- numeros_contrato_liberados — cero cambio de comportamiento.
    return 'MIN-' || public.siguiente_numero_contrato();
  end if;

  raise exception 'tenant inválido: % (debe ser "mayorista" o "minorista")', v_tenant;
end;
$$;

comment on function public.siguiente_numero_contrato_para_tenant(text) is
  'Generador ÚNICO y centralizado de numero_contrato, por tenant, devuelve el '
  'número COMPLETO ya prefijado (DTM-#### / MIN-00-####). El caller NUNCA debe '
  'volver a anteponerle un prefijo. mayorista usa contrato_seq_mayorista '
  '(nextval, nunca numeros_contrato_liberados); minorista delega en '
  'siguiente_numero_contrato() sin cambios. Falla cerrado para tenant NULL/'
  'vacío/inválido — nunca infiere ni asume un tenant por defecto. Migración 159.';

-- Nadie sin sesión debe poder generar/gastar un número de contrato.
revoke all on function public.siguiente_numero_contrato_para_tenant(text) from public;
revoke all on function public.siguiente_numero_contrato_para_tenant(text) from anon;
grant execute on function public.siguiente_numero_contrato_para_tenant(text) to authenticated;

-- La función es INVOKER: quien la ejecuta necesita USAGE directo sobre la
-- secuencia nueva (nextval + currval). Mismo criterio de acceso que la
-- función: authenticated sí, anon/PUBLIC no.
revoke all on sequence public.contrato_seq_mayorista from public;
revoke all on sequence public.contrato_seq_mayorista from anon;
grant usage on sequence public.contrato_seq_mayorista to authenticated;

-- ── 4) eliminar_contrato(): DTM- nunca entra al pool de reciclaje ──────────
-- Mismo cuerpo que la migración 117 (candado de rol incluido), con UN
-- candado nuevo antes de tocar numeros_contrato_liberados.
create or replace function public.eliminar_contrato(p_numero text, p_reusar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
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

commit;
