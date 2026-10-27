-- 246 · Tramos de traslado fuera de los días turísticos de un programa.
-- Aplicar después de la 245 y antes de la 247 (blackouts e itinerario publicado).
-- Los cinco programas auditados tienen una salida por carretera en la primera
-- fila; las filas siguientes son los días turísticos, incluido el regreso.
begin;

alter table public.programa_dias
  add column if not exists tipo_tramo text not null default 'dia';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.programa_dias'::regclass
      and conname = 'programa_dias_tipo_tramo_chk'
  ) then
    alter table public.programa_dias
      add constraint programa_dias_tipo_tramo_chk
      check (tipo_tramo in ('dia', 'traslado_previo', 'traslado_posterior'));
  end if;
end $$;

do $$
declare
  v record;
  v_filas integer;
  v_distintos integer;
  v_min integer;
  v_max integer;
  v_traslados integer;
  v_titulo text;
begin
  for v in
    select * from (values
      (7::bigint, 5, 'Medellín - Villavicencio'::text),
      (8::bigint, 5, 'MEDELLIN - BUCARAMANGA'::text),
      (9::bigint, 5, 'MEDELLIN - BOYACA'::text),
      (11::bigint, 6, 'MEDELLIN - CALI'::text),
      (13::bigint, 3, 'MEDELLIN - NEIVA'::text)
    ) as x(programa_id, dias, titulo_traslado)
  loop
    if not exists (select 1 from public.programas p where p.id = v.programa_id) then
      continue; -- instalaciones nuevas sin estos cinco programas históricos
    end if;
    if not exists (select 1 from public.programas p where p.id = v.programa_id and p.dias = v.dias) then
      raise exception '246: programa % cambió de duración; revisar antes de reclasificar', v.programa_id;
    end if;
    select count(*), count(distinct dia), min(dia), max(dia),
           count(*) filter (where tipo_tramo <> 'dia')
      into v_filas, v_distintos, v_min, v_max, v_traslados
      from public.programa_dias where programa_id = v.programa_id;
    if v_traslados = 1 and v_filas = v.dias + 1
       and exists (select 1 from public.programa_dias
                    where programa_id = v.programa_id and dia = 0
                      and tipo_tramo = 'traslado_previo' and titulo = v.titulo_traslado)
       and (select count(*) from public.programa_dias
             where programa_id = v.programa_id and tipo_tramo = 'dia'
               and dia between 1 and v.dias) = v.dias
       and v_distintos = v_filas then
      continue; -- reejecución exacta
    end if;
    select titulo into v_titulo from public.programa_dias
      where programa_id = v.programa_id and dia = 1 and tipo_tramo = 'dia';
    if v_filas <> v.dias + 1 or v_distintos <> v_filas or v_min <> 1
       or v_max <> v.dias + 1 or v_traslados <> 0
       or v_titulo is distinct from v.titulo_traslado then
      raise exception '246: itinerario del programa % difiere del inventario auditado; no se cambió nada', v.programa_id;
    end if;
    update public.programa_dias
       set dia = 0, tipo_tramo = 'traslado_previo'
     where programa_id = v.programa_id and dia = 1;
    update public.programa_dias
       set dia = dia - 1
     where programa_id = v.programa_id and tipo_tramo = 'dia';
  end loop;
end $$;

comment on column public.programa_dias.tipo_tramo is
  'dia cuenta en programas.dias; traslado_previo (dia=0) y traslado_posterior (dia=N+1) se muestran en el itinerario sin sumar días turísticos ni noches de hotel.';

notify pgrst, 'reload schema';
commit;
