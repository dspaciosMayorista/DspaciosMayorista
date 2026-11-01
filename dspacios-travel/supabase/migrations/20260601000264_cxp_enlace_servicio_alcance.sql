-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 264 (PROVISIONAL, NO APLICADA) — vínculo ESTRUCTURADO y auditable entre la CxP, la línea de servicio del contrato y el alcance vendido de un traslado.
-- Depende de la 262 (contrato_servicios.alcance_traslado). Número provisional: 257/260/261 existen en otras ramas; nadie usa la 263 (esta rama) ni la 264 (revisado en local).
--
-- Medición previa (por qué NO se reemplaza la RPC financiera): `registrar_financiero_contrato` está redefinida en 10 migraciones (171, 172, 179, 210, 227, 230, 233, 234,
-- 236, 245), inserta las CxP con una lista FIJA de columnas, delega en `p63_registrar_financiero` cuando hay oferta #63, la reentrada/reconciliador (cron) puede BORRAR y
-- RECREAR las CxP automáticas, y es SECURITY DEFINER con EXECUTE solo para service_role. Cambiarla arriesga todas esas rutas. En cambio, un TRIGGER BEFORE INSERT sobre
-- `cuentas_por_pagar` enlaza la CxP con su línea en cualquier camino (primera escritura o reentrada) sin tocar la función ni su contrato.
--
-- Qué hace (aditiva; no modifica filas existentes):
--  1) contrato_servicios.servicio_id  -> servicio del catálogo vendido en esa línea (FK, on delete set null).
--  2) cuentas_por_pagar.alcance_traslado + contrato_servicio_id (FK a la línea del contrato, on delete set null) + índice ÚNICO parcial: una línea del contrato tiene A LO SUMO
--     una CxP enlazada.
--  3) Trigger tg_cxp_enlazar_servicio_alcance: al insertar una CxP con servicio_id, busca la línea de contrato_servicios del MISMO contrato y servicio con alcance vendido
--     cuya descripción es EXACTAMENTE el `servicio` de la CxP y que aún no tiene CxP; si la hay, copia alcance_traslado y contrato_servicio_id. Nunca bloquea el insert.
-- La conversión escribe la línea (descripcion = texto del servicio de la CxP, servicio_id, alcance_traslado) ANTES de registrar el financiero.
-- Rollback: supabase/scripts/rollback_264_cxp_enlace_servicio_alcance.sql
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contrato_servicios' and column_name = 'alcance_traslado') then
    raise exception '264 ABORTADA SIN MODIFICAR NADA: falta contrato_servicios.alcance_traslado (aplica antes la 262).';
  end if;
  if to_regclass('public.cuentas_por_pagar') is null then
    raise exception '264 ABORTADA SIN MODIFICAR NADA: falta public.cuentas_por_pagar.';
  end if;
end $$;

alter table public.contrato_servicios
  add column if not exists servicio_id bigint references public.servicios_adicionales(id) on delete set null;
comment on column public.contrato_servicios.servicio_id is 'Servicio del catálogo vendido en esta línea (264). NULL = línea manual sin catálogo.';

alter table public.cuentas_por_pagar
  add column if not exists alcance_traslado text,
  add column if not exists contrato_servicio_id bigint references public.contrato_servicios(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.cuentas_por_pagar'::regclass and conname = 'cuentas_por_pagar_alcance_traslado_chk') then
    alter table public.cuentas_por_pagar add constraint cuentas_por_pagar_alcance_traslado_chk
      check (alcance_traslado is null or alcance_traslado in ('llegada', 'salida', 'ida_regreso'));
  end if;
end $$;
comment on column public.cuentas_por_pagar.alcance_traslado is 'Alcance vendido del traslado al que corresponde esta CxP (264): llegada | salida | ida_regreso. NULL = no aplica.';
comment on column public.cuentas_por_pagar.contrato_servicio_id is 'Línea de contrato_servicios que originó esta CxP (264). NULL = CxP sin línea de servicio por alcance.';

create unique index if not exists uq_cxp_contrato_servicio on public.cuentas_por_pagar(contrato_servicio_id) where contrato_servicio_id is not null;
create index if not exists idx_contrato_servicios_servicio on public.contrato_servicios(numero_contrato, servicio_id) where alcance_traslado is not null;

create or replace function public.tg_cxp_enlazar_servicio_alcance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      bigint;
  v_alcance text;
begin
  if new.servicio_id is null or new.contrato_servicio_id is not null or new.servicio is null then
    return new;
  end if;
  select cs.id, cs.alcance_traslado into v_id, v_alcance
    from public.contrato_servicios cs
   where cs.numero_contrato = new.numero_contrato
     and cs.servicio_id = new.servicio_id
     and cs.alcance_traslado is not null
     and cs.descripcion = new.servicio
     and not exists (select 1 from public.cuentas_por_pagar c where c.contrato_servicio_id = cs.id)
   order by cs.id
   limit 1;
  if v_id is not null then
    new.contrato_servicio_id := v_id;
    new.alcance_traslado := v_alcance;
  end if;
  return new;
end;
$$;
revoke all on function public.tg_cxp_enlazar_servicio_alcance() from public, anon, authenticated;

drop trigger if exists cxp_enlazar_servicio_alcance on public.cuentas_por_pagar;
create trigger cxp_enlazar_servicio_alcance
  before insert on public.cuentas_por_pagar
  for each row execute function public.tg_cxp_enlazar_servicio_alcance();

commit;
