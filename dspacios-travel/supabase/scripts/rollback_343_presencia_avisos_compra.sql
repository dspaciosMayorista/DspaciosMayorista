-- ROLLBACK 343 (#11 presencia + #13 avisos de compra). Se NIEGA si ya hay avisos de compra SIN archivar (la gente aún los ve: se archivan o se deciden con el dueño) — no se borra información de la campana en silencio.
-- La presencia (un instante por persona) y los avisos ya ARCHIVADOS son telemetría derivada y se eliminan. Una sola transacción, con espera ACOTADA de candados (5 s) y candado exclusivo sobre avisos ANTES de revisar.
-- El CHECK de avisos_tipo_check se restablece SIN compra_por_vencer conservando los demás tipos que tenga en ese momento.
begin;
set local lock_timeout = '5s';
lock table public.avisos in access exclusive mode;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'avisos' and column_name = 'ventana_tipo')
     and exists (select 1 from public.avisos where tipo = 'compra_por_vencer' and archivado_en is null) then
    raise exception 'ROLLBACK 343 detenido: hay avisos de compra por vencer vigentes en la campana. Archívalos (o confirma con el dueño) antes de revertir.';
  end if;
end $$;
drop trigger if exists trg_f343_paquete on public.armado_paquetes;
drop trigger if exists trg_f343_salida on public.salidas_dinamicas;
drop trigger if exists trg_f343_empaquetado on public.empaquetados;
drop trigger if exists trg_f343_total on public.paquete_din;
drop function if exists public.f343_archivar_ventana();
drop function if exists public.generar_avisos_compra(date, integer);
drop function if exists public.f343_ventanas_compra(date, integer);
drop function if exists public.fn_actividad_reciente(integer);
drop function if exists public.registrar_presencia();
drop table if exists public.presencia_usuario;
delete from public.avisos where tipo = 'compra_por_vencer';   -- solo quedan archivados (la guarda de arriba)
drop index if exists public.uq_avisos_compra_vivo;
alter table public.avisos drop constraint if exists avisos_compra_coherente_check;
do $$
declare v_def text; v_lista text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid = 'public.avisos'::regclass and conname = 'avisos_tipo_check';
  if v_def like '%compra_por_vencer%' then
    v_lista := substring(v_def from 'ARRAY\[(.*)\]');
    v_lista := regexp_replace(v_lista, ',\s*''compra_por_vencer''(::text)?', '');
    alter table public.avisos drop constraint avisos_tipo_check;
    execute format('alter table public.avisos add constraint avisos_tipo_check check (tipo = any (array[%s]))', v_lista);
  end if;
end $$;
alter table public.avisos drop column if exists ventana_tipo, drop column if exists ventana_id, drop column if exists ventana_ref, drop column if exists ventana_titulo, drop column if exists compra_fin;
commit;
