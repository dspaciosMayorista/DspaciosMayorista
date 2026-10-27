-- ═════════════════════════════════════════════════════════════════════════
-- Migración 246 (PR #409): blackouts de un programa con ALCANCE y guardado atómico.
--
--   1. programa_blackouts.alcance — «entrada» (solo la fecha de entrada; el comportamiento de siempre) | «viaje» (cualquier día del viaje, noches
--      adicionales incluidas). NOT NULL DEFAULT 'entrada': todo blackout ya cargado conserva el comportamiento de fecha de entrada, sin tocar filas.
--   2. programa_blackouts_extremos_chk — ambos extremos obligatorios e inicio <= fin. NOT VALID a propósito: valida toda fila NUEVA o modificada, pero
--      NO falla por filas viejas con un solo extremo (siguen sin bloquear nada; el inventario las lista para corregirlas a mano).
--   3. guardar_programa_blackouts(programa, blackouts jsonb) — reemplaza los blackouts de un programa EN UNA SOLA TRANSACCIÓN: valida TODO antes de
--      borrar nada, así que un fallo (fecha inválida, extremo ausente, alcance desconocido, permiso) deja los blackouts anteriores intactos. SECURITY INVOKER:
--      la RLS de siempre (superadmin/gerencia/administracion/operaciones) decide quién escribe. También rechaza elementos que no son objeto y
--      fechas que no son AAAA-MM-DD (los espacios de los extremos se recortan).
--   4. Itinerario de un programa PUBLICADO: no puede quedar incompleto (días 1..N exactos). itinerario_programa_problema() describe lo que falta;
--      dos triggers de constraint DIFERIDOS (programa_dias y programas) lo exigen al cerrar la transacción —así cualquier vía de escritura
--      (PostgREST, SQL, importación) queda cubierta y un reemplazo borrar+insertar dentro de una misma transacción sí pasa—; y
--      guardar_programa_dias(programa, días jsonb, total opcional) reemplaza días (y total) atómicamente con mensaje claro. Un programa
--      DESPUBLICADO sí puede guardar un borrador incompleto (no se puede volver a publicar hasta completarlo). No toca programas ya publicados
--      e incompletos; solo impide empeorar/editar sus días sin completarlos o despublicarlos. Si un día CAMBIA de programa se validan origen y
--      destino; y cada comprobación toma un candado consultivo por programa (bloquear_itinerario_programa, en orden ascendente de id) para que una
--      transacción concurrente vea el resultado ya confirmado de la anterior (READ COMMITTED). También se rechaza (al cerrar la transacción)
--      un INSERT de programas con publicado = true sin itinerario 1..N: el trigger de programas cubre INSERT y UPDATE.
-- Aditiva e idempotente. No toca la 244 ni la 245. Rollback: supabase/scripts/rollback_246_programa_blackout_alcance.sql.
-- ═════════════════════════════════════════════════════════════════════════
begin;

alter table public.programa_blackouts
  add column if not exists alcance text not null default 'entrada';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'programa_blackouts_alcance_chk' and conrelid = 'public.programa_blackouts'::regclass) then
    alter table public.programa_blackouts
      add constraint programa_blackouts_alcance_chk check (alcance in ('entrada', 'viaje'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programa_blackouts_extremos_chk' and conrelid = 'public.programa_blackouts'::regclass) then
    alter table public.programa_blackouts
      add constraint programa_blackouts_extremos_chk
      check (fecha_inicio is not null and fecha_fin is not null and fecha_inicio <= fecha_fin) not valid;
  end if;
end $$;

comment on column public.programa_blackouts.alcance is
  '#409: entrada = bloquea si la fecha de ENTRADA cae en el rango (comportamiento de siempre); viaje = bloquea si el rango se traslapa con CUALQUIER día del viaje (entrada → regreso, noches adicionales incluidas).';

create or replace function public.guardar_programa_blackouts(p_programa_id bigint, p_blackouts jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item  jsonb;
  v_n     integer := 0;
  v_ini   date;
  v_fin   date;
  v_alc   text;
  v_filas integer;
begin
  if not exists (select 1 from public.programas where id = p_programa_id) then
    raise exception 'El programa % no existe.', p_programa_id using errcode = 'P0001';
  end if;
  if p_blackouts is null or jsonb_typeof(p_blackouts) <> 'array' then
    raise exception 'La lista de blackouts no es válida.' using errcode = 'P0001';
  end if;

  -- 1) Se valida TODO antes de tocar nada: un fallo aquí deja los blackouts anteriores como estaban.
  for v_item in select * from jsonb_array_elements(p_blackouts) loop
    v_n := v_n + 1;
    -- Cada entrada debe ser un OBJETO (un null, un texto o un arreglo suelto se rechaza: nunca se descarta en silencio).
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'El blackout % no es válido (se esperaba un objeto con sus fechas).', v_n using errcode = 'P0001';
    end if;
    if coalesce(btrim(v_item ->> 'fecha_inicio'), '') = '' or coalesce(btrim(v_item ->> 'fecha_fin'), '') = '' then
      raise exception 'El blackout % necesita fecha de inicio y de fin.', v_n using errcode = 'P0001';
    end if;
    -- Solo AAAA-MM-DD: '20270301' o '2027-3-5' también serían fechas para el cast, pero no es lo que el formulario manda.
    if btrim(v_item ->> 'fecha_inicio') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or btrim(v_item ->> 'fecha_fin') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'El blackout % tiene una fecha con formato inválido (use AAAA-MM-DD).', v_n using errcode = 'P0001';
    end if;
    begin
      v_ini := btrim(v_item ->> 'fecha_inicio')::date;
      v_fin := btrim(v_item ->> 'fecha_fin')::date;
    exception when others then
      raise exception 'El blackout % tiene una fecha que no existe.', v_n using errcode = 'P0001';
    end;
    if v_ini > v_fin then
      raise exception 'El blackout % termina antes de empezar.', v_n using errcode = 'P0001';
    end if;
    v_alc := coalesce(nullif(v_item ->> 'alcance', ''), 'entrada');
    if v_alc not in ('entrada', 'viaje') then
      raise exception 'El blackout % tiene un alcance desconocido (%).', v_n, v_alc using errcode = 'P0001';
    end if;
  end loop;

  -- 2) Reemplazo en la misma transacción.
  delete from public.programa_blackouts where programa_id = p_programa_id;
  insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, motivo, ciudad, alcance)
  select p_programa_id,
         btrim(e ->> 'fecha_inicio')::date,
         btrim(e ->> 'fecha_fin')::date,
         nullif(btrim(e ->> 'motivo'), ''),
         nullif(btrim(e ->> 'ciudad'), ''),
         coalesce(nullif(e ->> 'alcance', ''), 'entrada')
    from jsonb_array_elements(p_blackouts) e;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke all on function public.guardar_programa_blackouts(bigint, jsonb) from public, anon;
grant execute on function public.guardar_programa_blackouts(bigint, jsonb) to authenticated;
comment on function public.guardar_programa_blackouts(bigint, jsonb) is
  '#409: reemplaza los blackouts de un programa de forma atómica; valida todo antes de borrar y respeta la RLS de quien llama (SECURITY INVOKER).';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Un programa PUBLICADO no puede quedar con el itinerario incompleto (días 1..N, sin faltantes, repetidos ni fuera de rango).
--    · itinerario_programa_problema(programa, dias): null si está completo; si no, qué falla.
--    · Triggers de constraint DIFERIDOS (se evalúan al confirmar la transacción) sobre programa_dias y sobre programas (publicar o cambiar N): una
--      transacción que reemplaza los días de forma atómica (guardar_programa_dias) pasa por estados intermedios sin fallar, pero NINGUNA vía —app,
--      API directa o SQL— puede confirmar un publicado incompleto. No actúan sobre programas ya publicados mientras no se toque su itinerario ni su N.
--    · guardar_programa_dias: reemplazo ATÓMICO de los días (valida todo antes de borrar; opcionalmente fija el total de días en la misma transacción).
--      Un borrador incompleto solo se guarda si el programa está despublicado.
-- ═════════════════════════════════════════════════════════════════════════
create or replace function public.itinerario_programa_problema(p_programa_id bigint, p_dias integer)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_falta  text;
  v_rep    text;
  v_fuera  text;
  v_partes text[] := array[]::text[];
begin
  if p_dias is null or p_dias < 1 then
    return 'el programa no tiene configurados sus días';
  end if;
  select string_agg(g::text, ', ' order by g) into v_falta
    from generate_series(1, p_dias) g
   where not exists (select 1 from public.programa_dias d where d.programa_id = p_programa_id and d.dia = g);
  select string_agg(r.dia::text, ', ' order by r.dia) into v_rep
    from (select dia from public.programa_dias where programa_id = p_programa_id group by dia having count(*) > 1) r;
  select string_agg(r.dia::text, ', ' order by r.dia) into v_fuera
    from (select distinct dia from public.programa_dias where programa_id = p_programa_id and (dia < 1 or dia > p_dias)) r;
  if v_falta is not null then v_partes := v_partes || ('faltan los días ' || v_falta); end if;
  if v_rep   is not null then v_partes := v_partes || ('se repiten los días ' || v_rep); end if;
  if v_fuera is not null then v_partes := v_partes || ('hay días fuera de 1–' || p_dias || ' (' || v_fuera || ')'); end if;
  return case when cardinality(v_partes) = 0 then null else array_to_string(v_partes, '; ') end;
end;
$$;

-- Candado consultivo por programa (liberado al cerrar la transacción). Las comprobaciones de itinerario van DIFERIDAS al commit: sin serializarlas,
-- dos transacciones concurrentes sobre filas distintas (p. ej. publicar mientras otra borra un día, o dos borrados de días repetidos) verían cada una
-- el estado SIN los cambios de la otra, pasarían las dos y dejarían el programa publicado incompleto. Con el candado la segunda espera a la primera y,
-- en READ COMMITTED (el nivel de PostgREST), su siguiente consulta ya ve lo confirmado. (En REPEATABLE READ/SERIALIZABLE la instantánea es fija: no aplica.)
create or replace function public.bloquear_itinerario_programa(p_programa_id bigint)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtextextended('programa_itinerario:' || p_programa_id::text, 0));
$$;

create or replace function public.tg_programa_itinerario_publicado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ids       bigint[];
  v_id        bigint;
  v_publicado boolean;
  v_dias      integer;
  v_problema  text;
begin
  -- Programas afectados: en programa_dias, el de origen Y el de destino si un día CAMBIA de programa (UPDATE de programa_id).
  if tg_table_name = 'programas' then
    -- INSERT (un programa que nace publicado sin itinerario) o UPDATE de publicado/dias. Un WHEN de INSERT no puede leer OLD, así que la
    -- condición vive aquí: solo importa si el programa queda publicado y (al insertar, o al publicar o cambiar el total).
    if not new.publicado then
      return null;
    end if;
    if tg_op = 'UPDATE' and not (old.publicado is distinct from new.publicado or old.dias is distinct from new.dias) then
      return null;
    end if;
    v_ids := array[new.id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.programa_id];
  elsif tg_op = 'UPDATE' then
    v_ids := array[old.programa_id, new.programa_id];
  else
    v_ids := array[new.programa_id];
  end if;

  -- Orden ascendente y sin repetidos: dos transacciones que mueven días en sentidos opuestos toman los candados en el mismo orden.
  for v_id in select distinct x from unnest(v_ids) x where x is not null order by x loop
    perform public.bloquear_itinerario_programa(v_id);
    select p.publicado, p.dias into v_publicado, v_dias from public.programas p where p.id = v_id;
    -- Programa borrado (cascada) o sin publicar: un borrador incompleto es válido.
    if not found or not coalesce(v_publicado, false) then
      continue;
    end if;
    v_problema := public.itinerario_programa_problema(v_id, v_dias);
    if v_problema is not null then
      raise exception 'El programa % está publicado y su itinerario quedaría incompleto (%). Despublícalo para guardar un borrador incompleto, o completa los días 1 a N.', v_id, v_problema
        using errcode = 'P0001';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_programa_dias_itinerario_publicado on public.programa_dias;
create constraint trigger trg_programa_dias_itinerario_publicado
  after insert or update or delete on public.programa_dias
  deferrable initially deferred
  for each row execute function public.tg_programa_itinerario_publicado();

drop trigger if exists trg_programas_itinerario_publicado on public.programas;
create constraint trigger trg_programas_itinerario_publicado
  after insert or update of publicado, dias on public.programas
  deferrable initially deferred
  for each row
  execute function public.tg_programa_itinerario_publicado();

create or replace function public.guardar_programa_dias(p_programa_id bigint, p_dias jsonb, p_total_dias integer default null)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_item     jsonb;
  v_n        integer := 0;
  v_filas    integer;
  v_publicado boolean;
  v_total    integer;
  v_problema text;
begin
  -- Serializa con cualquier otra escritura del itinerario de este programa antes de leer su estado.
  perform public.bloquear_itinerario_programa(p_programa_id);
  select p.publicado, p.dias into v_publicado, v_total from public.programas p where p.id = p_programa_id;
  if not found then
    raise exception 'El programa % no existe.', p_programa_id using errcode = 'P0001';
  end if;
  if p_dias is null or jsonb_typeof(p_dias) <> 'array' then
    raise exception 'La lista de días no es válida.' using errcode = 'P0001';
  end if;
  if p_total_dias is not null and p_total_dias < 1 then
    raise exception 'El total de días del programa debe ser 1 o más.' using errcode = 'P0001';
  end if;

  -- 1) Se valida TODO antes de tocar nada: una entrada inválida NO reemplaza los días anteriores.
  for v_item in select * from jsonb_array_elements(p_dias) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'El día % no es válido (se esperaba un objeto).', v_n using errcode = 'P0001';
    end if;
    if coalesce(btrim(v_item ->> 'dia'), '') !~ '^[0-9]{1,4}$' or btrim(v_item ->> 'dia')::integer < 1 then
      raise exception 'El día % necesita un número entero de 1 en adelante.', v_n using errcode = 'P0001';
    end if;
  end loop;

  -- 2) Reemplazo (y, si se pide, el total de días) en la misma transacción.
  if p_total_dias is not null then
    update public.programas set dias = p_total_dias, updated_at = now() where id = p_programa_id;
    v_total := p_total_dias;
  end if;
  delete from public.programa_dias where programa_id = p_programa_id;
  insert into public.programa_dias (programa_id, dia, titulo, desayuno, almuerzo, cena, descripcion)
  select p_programa_id,
         btrim(e ->> 'dia')::integer,
         nullif(btrim(e ->> 'titulo'), ''),
         coalesce((e ->> 'desayuno')::boolean, false),
         coalesce((e ->> 'almuerzo')::boolean, false),
         coalesce((e ->> 'cena')::boolean, false),
         nullif(btrim(e ->> 'descripcion'), '')
    from jsonb_array_elements(p_dias) e;
  get diagnostics v_filas = row_count;

  -- 3) Un publicado no puede quedar incompleto: mensaje claro AQUÍ (el trigger diferido es el respaldo para cualquier otra vía).
  if v_publicado then
    v_problema := public.itinerario_programa_problema(p_programa_id, v_total);
    if v_problema is not null then
      raise exception 'Este programa está publicado y su itinerario quedaría incompleto (%). Despublícalo para guardar un borrador incompleto, o completa los días 1 a N.', v_problema
        using errcode = 'P0001';
    end if;
  end if;
  return v_filas;
end;
$$;

revoke all on function public.guardar_programa_dias(bigint, jsonb, integer) from public, anon;
grant execute on function public.guardar_programa_dias(bigint, jsonb, integer) to authenticated;
revoke all on function public.bloquear_itinerario_programa(bigint) from public, anon;
grant execute on function public.bloquear_itinerario_programa(bigint) to authenticated;
-- Las escrituras con service_role (reservas, importaciones) también disparan el trigger: sin este permiso fallarían al tomar el candado.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bloquear_itinerario_programa(bigint) to service_role;
  end if;
end $$;
revoke all on function public.itinerario_programa_problema(bigint, integer) from public, anon;
grant execute on function public.itinerario_programa_problema(bigint, integer) to authenticated;
comment on function public.guardar_programa_dias(bigint, jsonb, integer) is
  '#409: reemplaza los días del itinerario de un programa (y opcionalmente su total) de forma atómica; un publicado no puede quedar incompleto (SECURITY INVOKER: respeta la RLS).';

notify pgrst, 'reload schema';

commit;
