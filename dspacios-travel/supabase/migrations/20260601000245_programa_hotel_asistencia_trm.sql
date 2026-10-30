-- ═════════════════════════════════════════════════════════════════════════
-- Migración 245 (#88, correcciones tras la primera auditoría): asistencia con proveedor, TRM de costos
-- y modo hotel solo terrestre. Va DESPUÉS de la 244 y no la edita.
--
-- ADITIVA e IDEMPOTENTE salvo el retiro de dos columnas de la 244 que nunca se usaron en producción
-- (la 244 tampoco está aplicada todavía).
--
--   1. programas.proveedor_asistencia_id — el proveedor al que se le paga la asistencia médica del programa.
--      La asistencia es un COSTO (entra al PVP antes del markup); cuando su costo es positivo la reserva por
--      hotel y vigencia exige este proveedor y registra UNA CxP de asistencia por la estancia completa
--      (días incluidos + noches adicionales).
--   2. contrato_programa_estancia_costo:
--        · asistencia_total / proveedor_asistencia_id — la asistencia de la estancia completa y su proveedor;
--        · trm_costo — la TRM de costos CONGELADA del contrato (solo programas en USD; el mismo modelo de la 236:
--          cada CxP en USD guarda además valor_cop_costo/trm_costo, y hay UNA sola TRM por contrato);
--        · se retiran cxp_programa_id / cxp_noches_id: las CxP se vinculan por numero_contrato y se escriben
--          DESPUÉS del registro de costo, dentro de la escritura financiera atómica (registrar_financiero_contrato),
--          así que el registro de costo ya no puede apuntar a ellas.
--   3. programas_modo_hotel_terrestre_chk — el modo «hotel» no se combina con transporte aéreo (defensa de la base;
--      la app lo valida además en el formulario y en el servidor).
-- ═════════════════════════════════════════════════════════════════════════
begin;

-- 1) Proveedor de la asistencia médica
alter table public.programas
  add column if not exists proveedor_asistencia_id bigint references public.proveedores(id) on delete set null;
comment on column public.programas.proveedor_asistencia_id is
  '#88: proveedor al que se le paga la asistencia médica del programa (programas por hotel y vigencia: obligatorio si la asistencia diaria es > 0).';

-- 2) Registro de costo de la estancia
alter table public.contrato_programa_estancia_costo
  add column if not exists asistencia_total numeric(15,2) not null default 0,
  add column if not exists proveedor_asistencia_id bigint,
  add column if not exists trm_costo numeric(15,4);

alter table public.contrato_programa_estancia_costo drop column if exists cxp_programa_id;
alter table public.contrato_programa_estancia_costo drop column if exists cxp_noches_id;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contrato_programa_estancia_costo_asistencia_check'
                  and conrelid = 'public.contrato_programa_estancia_costo'::regclass) then
    alter table public.contrato_programa_estancia_costo
      add constraint contrato_programa_estancia_costo_asistencia_check
      check (asistencia_total >= 0 and asistencia_total >= asistencia_noches);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contrato_programa_estancia_costo_trm_check'
                  and conrelid = 'public.contrato_programa_estancia_costo'::regclass) then
    alter table public.contrato_programa_estancia_costo
      add constraint contrato_programa_estancia_costo_trm_check
      check (trm_costo is null or (moneda = 'USD' and trm_costo > 0 and trm_costo < 1e11));
  end if;
  -- 3) El modo «hotel» no se combina con aéreo.
  if not exists (select 1 from pg_constraint where conname = 'programas_modo_hotel_terrestre_chk'
                  and conrelid = 'public.programas'::regclass) then
    alter table public.programas
      add constraint programas_modo_hotel_terrestre_chk
      check (modo_precio is distinct from 'hotel' or (tipo_transporte <> 'aereo' and not incluye_aereo));
  end if;
end $$;

comment on column public.contrato_programa_estancia_costo.trm_costo is
  '#88: TRM de costos congelada del contrato (solo USD). Es la misma que llevan trm_costo/valor_cop_costo de cada CxP en USD (migración 236).';

notify pgrst, 'reload schema';

commit;
