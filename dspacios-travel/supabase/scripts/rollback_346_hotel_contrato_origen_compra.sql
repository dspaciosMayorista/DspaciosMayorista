-- ROLLBACK 346 (B95-15 origen de la compra del hotel). Se NIEGA si ya hay hoteles de contrato con origen registrado: esa constancia (directa/plataforma) se perdería. Una transacción con espera acotada de candados.
-- Antes de revertir, el código que escribe estas columnas debe estar retirado (su INSERT las incluye).
begin;
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contrato_hoteles' and column_name = 'compra_origen')
     and exists (select 1 from public.contrato_hoteles where compra_origen is not null or plataforma is not null) then
    raise exception 'ROLLBACK 346 detenido: hay hoteles de contrato con el origen de la compra registrado. Confirma con el dueño antes de borrar esa constancia.';
  end if;
end $$;
alter table public.contrato_hoteles drop constraint if exists contrato_hoteles_plataforma_coherente_check;
alter table public.contrato_hoteles drop constraint if exists contrato_hoteles_compra_origen_check;
alter table public.contrato_hoteles drop column if exists plataforma;
alter table public.contrato_hoteles drop column if exists compra_origen;
notify pgrst, 'reload schema';
commit;
