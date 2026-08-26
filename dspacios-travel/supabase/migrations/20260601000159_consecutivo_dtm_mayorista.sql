-- ───────────────────────────────────────────────────────────────────────────
-- 159 · consecutivo_dtm_mayorista (ADITIVA en cuanto a esquema — crea objetos
--   NUEVOS y no borra/renombra nada existente. NO es "aditiva" en el sentido
--   de que `eliminar_contrato()` técnicamente se REEMPLAZA, no se crea de
--   cero: ver el punto 4 más abajo, que documenta contra qué versión real se
--   comparó y qué es lo único que cambia funcionalmente.)
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
--     de datos se toca aquí. Solo se agrega infraestructura NUEVA (con la
--     única excepción de `eliminar_contrato()`, ver punto 4).
--
-- QUÉ HACE:
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
--      nueva, nunca de `numeros_contrato_liberados`); minorista → delega en
--      `siguiente_numero_contrato()` (sin cambios de comportamiento: mismo
--      reciclaje de números liberados) y SOLO le antepone 'MIN-' cuando el
--      valor devuelto todavía no lo trae (ver "FIX — doble prefijo" más
--      abajo). Falla cerrado (RAISE EXCEPTION) para tenant NULL, vacío, o
--      distinto de 'mayorista'/'minorista'. Ningún SELECT max()+1: mayorista
--      usa nextval() (atómico por diseño de Postgres); minorista delega en
--      la función vieja, que ya es atómica (ver migración 060 —
--      DELETE...WHERE numero=(SELECT MIN...)RETURNING, o nextval() si no hay
--      nada que reciclar).
--   4) `eliminar_contrato()` — REEMPLAZADA (mismo nombre y firma, `create or
--      replace`), para agregar UN candado: si piden reciclar (`p_reusar=true`)
--      un contrato cuyo numero_contrato empieza por 'DTM-', la función
--      RECHAZA la operación completa (ni borra) — mayorista nunca debe
--      insertar nada en `numeros_contrato_liberados`. Minorista sigue
--      exactamente igual.
--
-- FIX — DOBLE PREFIJO al reciclar minorista (revisión posterior al PR #274):
--   `numeros_contrato_liberados` guarda el `numero_contrato` COMPLETO de la
--   venta eliminada (`p_numero` tal cual, en `eliminar_contrato()` — ver
--   migración 060). Para un contrato minorista eso YA es 'MIN-00-XXXX' (el
--   prefijo se aplica al generar el número, migración 159/`numeroConTenant`
--   en el código viejo). El primer borrador de esta migración hacía
--   `return 'MIN-' || public.siguiente_numero_contrato();` sin condición —
--   si `siguiente_numero_contrato()` reciclaba una fila del pool, el
--   resultado ya venía con 'MIN-' puesto, y se le anteponía OTRO 'MIN-':
--   `MIN-MIN-00-8001`. También existen entradas HISTÓRICAS del pool sin
--   prefijo ('00-8002', de antes de que existiera la convención MIN-), que sí
--   necesitan que se les anteponga. La función ahora distingue los dos casos
--   mirando el propio valor devuelto (`like 'MIN-%'`): si YA viene prefijado,
--   se devuelve tal cual; si es crudo, se le antepone 'MIN-'. Nunca hay
--   ambigüedad: un valor fresco de `contrato_seq` siempre es '00-NNNN' (nunca
--   empieza por 'MIN-'), así que el `like` distingue exactamente "reciclado
--   ya prefijado" de "crudo (reciclado viejo o recién generado)".
--
-- PERMISOS — service_role ÚNICAMENTE (revisión posterior al PR #274, corrige
-- el diseño original de esta migración):
--   El primer borrador otorgaba EXECUTE/USAGE a `authenticated` (justificado
--   en que los 5 caminos de creación de contrato llaman con el cliente de
--   SESIÓN). Eso es un hallazgo real sobre CÓMO llama la aplicación, pero es
--   la política de acceso EQUIVOCADA: cualquier sesión autenticada — de
--   cualquier tenant, de cualquier rol, incluso uno sin permiso real para
--   crear contratos — podía invocar el RPC DIRECTO
--   (`supabase.rpc('siguiente_numero_contrato_para_tenant', {p_tenant:
--   'mayorista'})`) sin pasar por ninguna Server Action ni validación de la
--   aplicación, y consumir consecutivos DTM/MIN a voluntad. Que la UI nunca
--   arme esa llamada no es un control de seguridad — cualquiera con su propio
--   JWT puede llamar el RPC directo.
--
--   Ahora el RPC y `contrato_seq_mayorista` son accesibles ÚNICAMENTE por
--   `service_role`: REVOKE ALL explícito de PUBLIC, `anon` Y `authenticated`;
--   GRANT EXECUTE/USAGE únicamente a `service_role`. El código de aplicación
--   (`lib/contrato/numeracion.ts`) se actualizó para llamar este RPC con
--   `createAdminClient()` (service_role), nunca con el cliente de sesión —
--   por eso cada uno de los 5 caminos de creación DEBE validar sesión +
--   `activo=true` + tenant autorizado + rol/propiedad con permiso real ANTES
--   de invocar el helper: al correr con service_role (bypassa RLS), esa
--   validación de aplicación es ahora la ÚNICA barrera antes de gastar un
--   consecutivo, no una capa adicional. El detalle de qué valida cada uno de
--   los 5 caminos vive en el cuerpo del PR y en `lib/contrato/contexto.ts`/
--   `lib/cotizacion/acceso.ts`.
--
--   La función SIGUE SIENDO `SECURITY INVOKER` (no hace falta `SECURITY
--   DEFINER`: el único invocador posible ahora es `service_role`, que ya
--   tiene privilegio directo — no necesita "prestado" de un definer). Se
--   mantiene el GRANT explícito de USAGE sobre la secuencia a `service_role`
--   por higiene/claridad de intención, aunque en Supabase real `service_role`
--   ya recibe privilegios por `ALTER DEFAULT PRIVILEGES` del proyecto — el
--   REVOKE explícito de `anon`/`authenticated`/PUBLIC es lo que de verdad
--   cierra el hueco, no depende de qué privilegios por defecto tenga
--   `service_role`. `search_path` fijo, todo objeto calificado con
--   `public.`, por higiene.
--
-- `eliminar_contrato()` sigue exactamente sus permisos previos (RLS/rol
-- interno vía `mi_rol()`, migración 117) — el `create or replace` conserva
-- la firma y el candado de rol existente, solo se le agrega el candado de
-- DTM antes de tocar `numeros_contrato_liberados`. Verificado contra las 158
-- migraciones reales del repo (`grep -rl eliminar_contrato
-- supabase/migrations/`): la ÚNICA modificación posterior a su creación
-- (migración 060) es la 117 (candado de rol) — no hay ninguna otra migración
-- entre la 117 y esta que la haya vuelto a tocar, así que el cuerpo base de
-- este `create or replace` es, byte a byte, el de la 117 más el candado DTM
-- nuevo (sin el candado de rol duplicado ni ninguna otra diferencia
-- funcional). El PR documenta la huella `pg_get_functiondef` real tomada
-- contra una base con las 158 migraciones aplicadas, antes y después de este
-- archivo, como evidencia — no una copia asumida del archivo de la 117.
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
  'números de contratos eliminados (decisión explícita, migración 159). '
  'USAGE otorgado ÚNICAMENTE a service_role.';

-- ── 3) Generador único por tenant — devuelve el número COMPLETO ────────────
create or replace function public.siguiente_numero_contrato_para_tenant(p_tenant text)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant text := btrim(coalesce(p_tenant, ''));
  v_base   text;
begin
  if v_tenant = '' then
    raise exception 'tenant requerido para generar el número de contrato.';
  end if;

  if v_tenant = 'mayorista' then
    return 'DTM-' || lpad(nextval('public.contrato_seq_mayorista')::text, 4, '0');
  end if;

  if v_tenant = 'minorista' then
    -- Reutiliza el generador actual TAL CUAL, incluido su reciclaje de
    -- numeros_contrato_liberados — cero cambio de comportamiento. El pool
    -- puede devolver un valor YA prefijado ('MIN-00-XXXX', reciclado de un
    -- contrato minorista real) o crudo ('00-XXXX', reciclado histórico
    -- previo a la convención MIN-, o recién generado por contrato_seq) — solo
    -- se antepone 'MIN-' en el segundo caso, nunca en el primero (evita
    -- 'MIN-MIN-00-XXXX').
    v_base := public.siguiente_numero_contrato();
    if v_base like 'MIN-%' then
      return v_base;
    end if;
    return 'MIN-' || v_base;
  end if;

  raise exception 'tenant inválido: % (debe ser "mayorista" o "minorista")', v_tenant;
end;
$$;

comment on function public.siguiente_numero_contrato_para_tenant(text) is
  'Generador ÚNICO y centralizado de numero_contrato, por tenant, devuelve el '
  'número COMPLETO ya prefijado (DTM-#### / MIN-00-####), sin doble prefijo '
  'aunque el reciclaje de minorista ya lo traiga puesto. El caller NUNCA debe '
  'volver a anteponerle un prefijo. mayorista usa contrato_seq_mayorista '
  '(nextval, nunca numeros_contrato_liberados); minorista delega en '
  'siguiente_numero_contrato() sin cambios. Falla cerrado para tenant NULL/'
  'vacío/inválido — nunca infiere ni asume un tenant por defecto. EXECUTE '
  'otorgado ÚNICAMENTE a service_role — ni anon ni authenticated pueden '
  'invocarlo directo. Migración 159.';

-- Acceso ÚNICAMENTE por service_role — ver la nota "PERMISOS" arriba: con el
-- cliente de sesión (authenticated), cualquier usuario autenticado podía
-- gastar consecutivos sin pasar por ninguna validación de la aplicación.
revoke all on function public.siguiente_numero_contrato_para_tenant(text) from public;
revoke all on function public.siguiente_numero_contrato_para_tenant(text) from anon;
revoke all on function public.siguiente_numero_contrato_para_tenant(text) from authenticated;
grant execute on function public.siguiente_numero_contrato_para_tenant(text) to service_role;

-- La función es INVOKER: quien la ejecuta necesita USAGE directo sobre la
-- secuencia nueva (nextval + currval). Mismo criterio de acceso que la
-- función: únicamente service_role.
revoke all on sequence public.contrato_seq_mayorista from public;
revoke all on sequence public.contrato_seq_mayorista from anon;
revoke all on sequence public.contrato_seq_mayorista from authenticated;
grant usage on sequence public.contrato_seq_mayorista to service_role;

-- ── 4) eliminar_contrato(): DTM- nunca entra al pool de reciclaje ──────────
-- Mismo cuerpo que la migración 117 (candado de rol incluido — verificado
-- contra las 158 migraciones reales, ver nota arriba), con UN candado nuevo
-- antes de tocar numeros_contrato_liberados.
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
