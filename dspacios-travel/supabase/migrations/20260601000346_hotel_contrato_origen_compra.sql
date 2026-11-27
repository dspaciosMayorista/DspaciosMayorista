-- 346 · B95-15 (revisión del dueño, 2026-11-26) · ORIGEN DE LA COMPRA del hotel de un contrato manual: directa al hotel o por plataforma.
--
-- Aditiva: dos columnas NULLABLES en `contrato_hoteles`; no toca ni reescribe ninguna fila existente (las anteriores quedan con origen NULL = «no registrado», nunca se infiere).
--   · compra_origen : 'directa' | 'plataforma'.
--   · plataforma    : nombre de la plataforma cuando compra_origen = 'plataforma' (y solo entonces).
-- La identidad del HOTEL (propiedad) sigue en `nombre`; el PROVEEDOR contractual a pagar sigue en `proveedor` (la cuenta por pagar lo toma de ahí, como siempre):
-- con compra por plataforma `proveedor` = la plataforma (no el proveedor del hotel); con compra directa `proveedor` = el del hotel. Estas dos columnas solo dejan constancia explícita.
-- Las cotizaciones guardan el mismo dato dentro de su payload (servicios[].compra) y en `cotizacion_servicios.plataforma/proveedor`: no necesitan columna nueva.
--
-- Orden: aplicar ANTES de desplegar el código que escribe estas columnas (el INSERT de crearContrato las incluye).
-- Preflight: supabase/scripts/preflight_346_hotel_contrato_origen_compra.sql · Postcheck: postcheck_346_… · Rollback: rollback_346_…
begin;
set local lock_timeout = '5s';

alter table public.contrato_hoteles add column if not exists compra_origen text;
alter table public.contrato_hoteles add column if not exists plataforma text;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.contrato_hoteles'::regclass and conname = 'contrato_hoteles_compra_origen_check') then
    alter table public.contrato_hoteles add constraint contrato_hoteles_compra_origen_check check (compra_origen is null or compra_origen in ('directa', 'plataforma'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.contrato_hoteles'::regclass and conname = 'contrato_hoteles_plataforma_coherente_check') then
    -- La plataforma existe exactamente cuando la compra es por plataforma; nunca una plataforma «huérfana» con compra directa o sin origen.
    alter table public.contrato_hoteles add constraint contrato_hoteles_plataforma_coherente_check
      check ((compra_origen is not distinct from 'plataforma') = (nullif(btrim(coalesce(plataforma, '')), '') is not null));
  end if;
end $$;

comment on column public.contrato_hoteles.compra_origen is '346 (B95-15): cómo se compró el hotel: directa | plataforma. NULL = no registrado (contratos anteriores). El proveedor a pagar sigue en `proveedor`.';
comment on column public.contrato_hoteles.plataforma is '346 (B95-15): plataforma por la que se compró (solo con compra_origen = plataforma); es también el `proveedor` a pagar de ese hotel.';

notify pgrst, 'reload schema';
commit;
