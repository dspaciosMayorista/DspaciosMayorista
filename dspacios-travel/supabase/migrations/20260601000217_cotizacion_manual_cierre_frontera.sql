-- ═════════════════════════════════════════════════════════════════════════
-- 217 · #39 fase 1 (B, CIERRE) — cotización manual: revocaciones y activación de la frontera.
--
-- Número reservado por el Coordinador (WORKSTREAMS.md, 2026-10-18). Scripts:
-- supabase/scripts/{postcheck,rollback}_217_cotizacion_manual_cierre.sql.
--
-- ⚠️ Va DESPUÉS de la 216 y del código nuevo (desplegado y verificado). Con el
-- código viejo todavía arriba, esta migración rompe la creación y la conversión
-- de cotizaciones dinámicas (falla cerrado: el código viejo escribe directo).
--
-- Qué cierra (Data API: anon, authenticated y REST con service_role):
--   · `cotizacion_servicios`: nadie de la API inserta, cambia, borra ni trunca.
--     El único escritor es la RPC de creación/edición (SECURITY DEFINER).
--   · `cotizacion_pagos_previos` / `cotizacion_condiciones`: anon y authenticated
--     sin escritura; service_role sin DELETE/TRUNCATE (pagos) ni TRUNCATE
--     (condiciones). Lo que service_role conserva solo pasa con la autorización
--     de transacción que emite un wrapper (disparadores de la 216).
--   · Filas manuales de `cotizaciones`: el PATCH directo de precio, congelado
--     (incluido el PRIMER congelado sin pago, del que depende #50), estado o
--     número queda rechazado. Siguen permitidos: vigencia (decisión A del dueño),
--     abierta → descartada, titular e incluye.
-- NO cambia el contexto service_role de la 198 ni ninguna función existente.
--
-- Retirada: solo por incidente comprobado y con decisión humana (decisión 2 del
-- dueño): supabase/scripts/rollback_217_cotizacion_manual_cierre.sql. Mientras
-- la frontera no esté activa, la edición de servicios queda apagada sola.
-- ═════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('p39_priv.frontera_activa()') is null
     or to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)') is null
     or to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is null
     or to_regprocedure('public.crear_cotizacion_manual(uuid,text,jsonb,jsonb)') is null
     or (select count(*) from pg_catalog.pg_trigger t
          where not t.tgisinternal
            and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39')) <> 3 then
    raise exception '217: la 216 no está aplicada. No se aplicó nada.';
  end if;
end $$;

-- 1. Revocaciones (lista fija; el rollback restaura exactamente esta lista).
revoke insert, update, delete, truncate on public.cotizacion_servicios from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.cotizacion_pagos_previos from public, anon, authenticated;
revoke delete, truncate on public.cotizacion_pagos_previos from service_role;
revoke insert, update, delete, truncate on public.cotizacion_condiciones from public, anon, authenticated;
revoke truncate on public.cotizacion_condiciones from service_role;

-- 2. Activar la frontera.
alter table public.cotizaciones enable trigger trg_cot_frontera_39;
alter table public.cotizacion_pagos_previos enable trigger trg_cot_pagos_frontera_39;
alter table public.cotizacion_condiciones enable trigger trg_cot_condiciones_frontera_39;

-- 3. Verificación: todo en su sitio o no se confirma nada.
do $$
begin
  if not p39_priv.frontera_activa() then
    raise exception '217: la frontera no quedó activa (disparadores o permisos). No se aplicó nada.';
  end if;
end $$;

commit;
