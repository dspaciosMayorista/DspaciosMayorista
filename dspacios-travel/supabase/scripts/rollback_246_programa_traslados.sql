-- Ejecutar solo después de revertir código y la 247. No descarta traslados nuevos.
begin;
do $$
declare
  v record;
begin
  if to_regprocedure('public.itinerario_programa_problema(bigint,integer)') is not null then
    raise exception 'Revertir la 247 antes de la 246';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='programa_dias' and column_name='tipo_tramo') then
    raise exception 'La 246 no está aplicada';
  end if;
  if exists (select 1 from public.programa_dias where tipo_tramo <> 'dia' and programa_id not in (7,8,9,11,13)) then
    raise exception 'Existen traslados nuevos; no se pueden descartar';
  end if;
  for v in select * from (values (7::bigint,5),(8::bigint,5),(9::bigint,5),(11::bigint,6),(13::bigint,3)) x(id,dias) loop
    if not exists (select 1 from public.programas where id=v.id) then continue; end if;
    if (select count(*) from public.programa_dias where programa_id=v.id and tipo_tramo='traslado_previo' and dia=0) <> 1
       or (select count(*) from public.programa_dias where programa_id=v.id and tipo_tramo='dia' and dia between 1 and v.dias) <> v.dias
       or (select count(*) from public.programa_dias where programa_id=v.id) <> v.dias+1 then
      raise exception 'El programa % cambió; no se puede revertir automáticamente', v.id;
    end if;
    update public.programa_dias set dia=dia+1 where programa_id=v.id and tipo_tramo='dia';
    update public.programa_dias set dia=1, tipo_tramo='dia' where programa_id=v.id and tipo_tramo='traslado_previo';
  end loop;
end $$;
alter table public.programa_dias drop constraint programa_dias_tipo_tramo_chk;
alter table public.programa_dias drop column tipo_tramo;
notify pgrst, 'reload schema';
commit;
