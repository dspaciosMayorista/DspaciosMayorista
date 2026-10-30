-- SOLO base local/desechable con las migraciones hasta 246 (esquema real). Siempre termina en ROLLBACK.
-- PR #409: la 247 agrega programa_blackouts.alcance (entrada | viaje), la CHECK de extremos (NOT VALID: solo filas nuevas) y guardar_programa_blackouts
-- (reemplazo ATÓMICO que valida todo antes de borrar). Comprueba: default y CHECK del alcance, CHECK de extremos, el reemplazo, que CADA entrada inválida
-- deja los blackouts anteriores intactos, y los permisos (RLS de quien llama; anon sin ejecución).
--   psql -h 127.0.0.1 -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -f test_247_programa_blackout_alcance.sql
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK  %', p_msg;
end $$;
create function pg_temp.intenta(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return 'ERROR: ' || sqlerrm;
end $$;
create function pg_temp.como(p_rol text, p_uid text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol)::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('role', p_rol, true);
  begin
    execute p_sql into v;
  exception when others then
    v := 'ERROR: ' || sqlerrm;
  end;
  perform set_config('role', 'supabase_admin', true);
  return v;
end $$;
grant execute on function pg_temp.como(text, text, text) to public;

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d2461', 've-r246@local.test'),
  ('00000000-0000-0000-0000-0000000d2462', 'op-r246@local.test');
update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = true, nombre = 'Ve r246' where id = '00000000-0000-0000-0000-0000000d2461';
update public.usuarios set rol = 'operaciones', tenant = 'mayorista', activo = true, nombre = 'Op r246' where id = '00000000-0000-0000-0000-0000000d2462';
select '00000000-0000-0000-0000-0000000d2461' as ve, '00000000-0000-0000-0000-0000000d2462' as op \gset

insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte) values ('__t246_programa__', 4, 3, 'USD', 'categoria', 'ninguno');
select id as pid from public.programas where nombre = '__t246_programa__' \gset

-- ── Columna y CHECK del alcance ─────────────────────────────────────────────
insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, motivo) values (:pid, '2027-03-10', '2027-03-12', 'sin alcance');
select pg_temp.ok((select alcance from public.programa_blackouts where programa_id = :pid and motivo = 'sin alcance') = 'entrada',
  'un blackout sin alcance explícito queda en «entrada» (el comportamiento de siempre)');
select pg_temp.ok(pg_temp.intenta(format($q$insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, alcance) values (%s, '2027-04-01', '2027-04-02', 'otro')$q$, :pid)) like 'ERROR:%programa_blackouts_alcance_chk%',
  'un alcance desconocido se rechaza');
select pg_temp.ok(pg_temp.intenta(format($q$insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin, alcance) values (%s, '2027-04-01', '2027-04-02', 'viaje')$q$, :pid)) = 'OK',
  'el alcance «viaje» se acepta');

-- ── CHECK de extremos (solo filas nuevas) ──────────────────────────────────────
select pg_temp.ok(pg_temp.intenta(format($q$insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin) values (%s, '2027-05-01', null)$q$, :pid)) like 'ERROR:%programa_blackouts_extremos_chk%',
  'una fila nueva sin fecha de fin se rechaza');
select pg_temp.ok(pg_temp.intenta(format($q$insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin) values (%s, null, '2027-05-01')$q$, :pid)) like 'ERROR:%programa_blackouts_extremos_chk%',
  'una fila nueva sin fecha de inicio se rechaza');
select pg_temp.ok(pg_temp.intenta(format($q$insert into public.programa_blackouts (programa_id, fecha_inicio, fecha_fin) values (%s, '2027-05-09', '2027-05-01')$q$, :pid)) like 'ERROR:%programa_blackouts_extremos_chk%',
  'una fila nueva con el inicio después del fin se rechaza');
select pg_temp.ok((select convalidated from pg_constraint where conname = 'programa_blackouts_extremos_chk') = false,
  'la CHECK de extremos es NOT VALID: no falla por filas viejas con un solo extremo');
delete from public.programa_blackouts where programa_id = :pid;

-- ── guardar_programa_blackouts: reemplazo atómico ─────────────────────────────
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-06-01","fecha_fin":"2027-06-05","motivo":"Feria","alcance":"viaje"},{"fecha_inicio":"2027-07-01","fecha_fin":"2027-07-01","motivo":"  ","ciudad":"Cali"}]'::jsonb)::text$q$, :pid)) = '2',
  'operaciones guarda 2 blackouts (devuelve cuántos)');
select pg_temp.ok((select count(*) from public.programa_blackouts where programa_id = :pid) = 2
                  and (select alcance from public.programa_blackouts where programa_id = :pid and fecha_inicio = '2027-06-01') = 'viaje'
                  and (select alcance from public.programa_blackouts where programa_id = :pid and fecha_inicio = '2027-07-01') = 'entrada'
                  and (select motivo from public.programa_blackouts where programa_id = :pid and fecha_inicio = '2027-07-01') is null,
  'cada blackout queda con su alcance (sin alcance = entrada) y el motivo en blanco queda nulo');

-- Cada entrada inválida: error claro Y los blackouts anteriores intactos.
create function pg_temp.huella() returns text language sql as $$
  select coalesce(string_agg(id::text || ':' || fecha_inicio || ':' || fecha_fin || ':' || alcance, ',' order by id), '') from public.programa_blackouts where programa_id = (select id from public.programas where nombre = '__t246_programa__')
$$;
select pg_temp.huella() as antes \gset
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-08-01","fecha_fin":"2027-08-02"},{"fecha_inicio":"2027-08-10","fecha_fin":null}]'::jsonb)::text$q$, :pid)) like 'ERROR:%necesita fecha de inicio y de fin%'
                  and pg_temp.huella() = :'antes', 'un extremo ausente se rechaza y NO borra los blackouts anteriores');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-08-01","fecha_fin":"2027-08-02"},{"fecha_inicio":"2027-02-30","fecha_fin":"2027-03-01"}]'::jsonb)::text$q$, :pid)) like 'ERROR:%fecha que no existe%'
                  and pg_temp.huella() = :'antes', 'una fecha que no existe se rechaza sin borrar nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-08-05","fecha_fin":"2027-08-02"}]'::jsonb)::text$q$, :pid)) like 'ERROR:%termina antes de empezar%'
                  and pg_temp.huella() = :'antes', 'inicio posterior al fin se rechaza sin borrar nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-08-01","fecha_fin":"2027-08-02","alcance":"siempre"}]'::jsonb)::text$q$, :pid)) like 'ERROR:%alcance desconocido%'
                  and pg_temp.huella() = :'antes', 'un alcance desconocido se rechaza sin borrar nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '{"a":1}'::jsonb)::text$q$, :pid)) like 'ERROR:%no es válida%'
                  and pg_temp.huella() = :'antes', 'una lista que no es arreglo se rechaza sin borrar nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', $q$select public.guardar_programa_blackouts(999999999, '[]'::jsonb)::text$q$) like 'ERROR:%no existe%',
  'un programa inexistente se rechaza');

-- Entradas que NO son un objeto válido o con una fecha en otro formato: se rechazan (nunca se descartan en silencio) y no reemplazan nada.
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-08-01","fecha_fin":"2027-08-02"}, "texto"]'::jsonb)::text$q$, :pid)) like 'ERROR:%no es válido (se esperaba un objeto%'
                  and pg_temp.huella() = :'antes', 'un elemento que no es objeto (texto) se rechaza sin reemplazar nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[null]'::jsonb)::text$q$, :pid)) like 'ERROR:%no es válido (se esperaba un objeto%'
                  and pg_temp.huella() = :'antes', 'un null suelto se rechaza (no se salta) y no reemplaza nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[[]]'::jsonb)::text$q$, :pid)) like 'ERROR:%no es válido (se esperaba un objeto%'
                  and pg_temp.huella() = :'antes', 'un arreglo suelto se rechaza y no reemplaza nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{}]'::jsonb)::text$q$, :pid)) like 'ERROR:%necesita fecha de inicio y de fin%'
                  and pg_temp.huella() = :'antes', 'un objeto vacío se rechaza y no reemplaza nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"   ","fecha_fin":"2027-08-02"}]'::jsonb)::text$q$, :pid)) like 'ERROR:%necesita fecha de inicio y de fin%'
                  and pg_temp.huella() = :'antes', 'una fecha en blanco (solo espacios) se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":20270801,"fecha_fin":"2027-08-02"}]'::jsonb)::text$q$, :pid)) like 'ERROR:%formato inválido%'
                  and pg_temp.huella() = :'antes', 'una fecha numérica (20270801) se rechaza por formato aunque el cast la aceptaría');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-8-1","fecha_fin":"2027-08-02"}]'::jsonb)::text$q$, :pid)) like 'ERROR:%formato inválido%'
                  and pg_temp.huella() = :'antes', 'una fecha sin ceros (2027-8-1) se rechaza por formato');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":" 2027-08-01 ","fecha_fin":"2027-08-02"}]'::jsonb)::text$q$, :pid)) = '1',
  'los espacios alrededor de una fecha válida se toleran (se recortan)');
select pg_temp.huella() as antes \gset

-- ── Permisos ──────────────────────────────────────────────────────────────
select pg_temp.ok(pg_temp.como('authenticated', :'ve', format($q$select public.guardar_programa_blackouts(%s, '[{"fecha_inicio":"2027-09-01","fecha_fin":"2027-09-02"}]'::jsonb)::text$q$, :pid)) like 'ERROR:%'
                  and pg_temp.huella() = :'antes', 'el rol venta no puede guardar (la RLS de quien llama manda) y no cambia nada');
select pg_temp.ok(pg_temp.como('anon', null, format($q$select public.guardar_programa_blackouts(%s, '[]'::jsonb)::text$q$, :pid)) like 'ERROR:%permission denied%',
  'anon no puede ejecutar la función');
-- La llamada y la comprobación van en sentencias distintas: un count(*) en la misma sentencia usaría la instantánea previa al borrado.
select pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_blackouts(%s, '[]'::jsonb)::text$q$, :pid)) as vacia \gset
select pg_temp.ok(:'vacia' = '0' and (select count(*) from public.programa_blackouts where programa_id = :pid) = 0,
  'una lista vacía es válida y deja el programa sin blackouts');

-- ══ Itinerario de un programa PUBLICADO ═══════════════════════════════════════
-- Los triggers son DIFERIDOS (se evalúan al confirmar): como esta prueba termina en ROLLBACK, las sentencias directas se prueban con intenta_i, que fuerza
-- la evaluación (set constraints immediate) y vuelve al modo diferido. Las llamadas a la RPC validan dentro de la propia función.
create function pg_temp.intenta_i(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  set constraints all immediate;
  set constraints all deferred;
  return 'OK';
exception when others then
  return 'ERROR: ' || sqlerrm;
end $$;
create function pg_temp.huella_dias(p_id bigint) returns text language sql as $$
  select coalesce(string_agg(id::text || ':' || dia, ',' order by id), '') || '|' || coalesce((select dias::text from public.programas where id = p_id), '-') from public.programa_dias where programa_id = p_id
$$;

insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte) values ('__t246_it__', 3, 2, 'USD', 'categoria', 'ninguno');
select id as pit from public.programas where nombre = '__t246_it__' \gset
insert into public.programa_dias (programa_id, dia, titulo) values (:pit, 1, 'a'), (:pit, 2, 'b'), (:pit, 3, 'c');

select pg_temp.ok(public.itinerario_programa_problema(:pit, 3) is null
                  and public.itinerario_programa_problema(:pit, 4) = 'faltan los días 4'
                  and public.itinerario_programa_problema(:pit, 2) = 'hay días fuera de 1–2 (3)'
                  and public.itinerario_programa_problema(:pit, null) like '%no tiene configurados sus días%',
  'itinerario_programa_problema: completo = null; faltante, fuera de rango y sin total se nombran');

-- Despublicado: el borrador incompleto es válido.
delete from public.programa_dias where programa_id = :pit and dia = 2;
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programas set nombre = '__t246_it__' where id = %s$q$, :pit)) = 'OK'
                  and public.itinerario_programa_problema(:pit, 3) = 'faltan los días 2',
  'un programa DESPUBLICADO puede quedar con el itinerario incompleto (borrador)');
-- Publicar con el itinerario incompleto: se rechaza.
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programas set publicado = true where id = %s$q$, :pit)) like 'ERROR:%itinerario quedaría incompleto (faltan los días 2)%'
                  and (select publicado from public.programas where id = :pit) = false,
  'publicar con un día faltante se rechaza en la base (y no queda publicado)');
insert into public.programa_dias (programa_id, dia, titulo) values (:pit, 2, 'b');
select pg_temp.intenta_i(format($q$update public.programas set publicado = true where id = %s$q$, :pit)) as r_pub \gset
select pg_temp.ok(:'r_pub' = 'OK' and (select publicado from public.programas where id = :pit) = true,
  'publicar con el itinerario completo se acepta');

-- Publicado: ninguna edición directa puede dejarlo incompleto.
select pg_temp.ok(pg_temp.intenta_i(format($q$delete from public.programa_dias where programa_id = %s and dia = 2$q$, :pit)) like 'ERROR:%itinerario quedaría incompleto (faltan los días 2)%',
  'borrar un día de un publicado se rechaza');
select pg_temp.ok(pg_temp.intenta_i(format($q$insert into public.programa_dias (programa_id, dia) values (%s, 2)$q$, :pit)) like 'ERROR:%se repiten los días 2%',
  'repetir un día de un publicado se rechaza');
select pg_temp.ok(pg_temp.intenta_i(format($q$insert into public.programa_dias (programa_id, dia) values (%s, 9)$q$, :pit)) like 'ERROR:%fuera de 1–3 (9)%',
  'un día fuera de 1..N en un publicado se rechaza');
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programa_dias set dia = 7 where programa_id = %s and dia = 3$q$, :pit)) like 'ERROR:%faltan los días 3%',
  'renumerar un día de un publicado hacia fuera de rango se rechaza');
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programas set dias = 4 where id = %s$q$, :pit)) like 'ERROR:%faltan los días 4%',
  'subir el total de días de un publicado sin completar el itinerario se rechaza');
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programas set dias = 2 where id = %s$q$, :pit)) like 'ERROR:%fuera de 1–2 (3)%',
  'bajar el total de días de un publicado deja un día fuera de rango y se rechaza');
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programas set nombre = 'otro nombre', dias = 3 where id = %s$q$, :pit)) = 'OK',
  'editar otros campos de un publicado (o reenviar el mismo total) sigue permitido');
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programas set publicado = false, dias = 4 where id = %s$q$, :pit)) = 'OK',
  'despublicar y cambiar el total en el mismo cambio sí se permite (queda como borrador)');
-- Un programa publicado con su itinerario completo se puede borrar (la cascada no dispara el control).
update public.programas set dias = 3 where id = :pit;
update public.programas set publicado = true where id = :pit;
select pg_temp.intenta_i(format($q$delete from public.programas where id = %s$q$, :pit)) as r_del \gset
select pg_temp.ok(:'r_del' = 'OK' and (select count(*) from public.programa_dias where programa_id = :pit) = 0,
  'borrar un programa publicado borra sus días sin que el control lo impida');

-- ── guardar_programa_dias (RPC atómica) ─────────────────────────────────────────
insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado) values ('__t246_it2__', 3, 2, 'USD', 'categoria', 'ninguno', false);
select id as pi2 from public.programas where nombre = '__t246_it2__' \gset
insert into public.programa_dias (programa_id, dia, titulo) values (:pi2, 1, 'a'), (:pi2, 2, 'b'), (:pi2, 3, 'c');
update public.programas set publicado = true where id = :pi2;
select pg_temp.huella_dias(:pi2) as d0 \gset

select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1},{"dia":2}]'::jsonb)::text$q$, :pi2)) ilike 'ERROR:%está publicado y su itinerario quedaría incompleto (faltan los días 3)%despublícalo%'
                  and pg_temp.huella_dias(:pi2) = :'d0', 'un publicado: guardar un itinerario incompleto se rechaza con mensaje claro y NO reemplaza los días');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1},{"dia":2},{"dia":2},{"dia":3}]'::jsonb)::text$q$, :pi2)) like 'ERROR:%se repiten los días 2%'
                  and pg_temp.huella_dias(:pi2) = :'d0', 'un publicado: un día repetido se rechaza sin reemplazar nada');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1},{"dia":2},{"dia":3}]'::jsonb, 5)::text$q$, :pi2)) like 'ERROR:%faltan los días 4, 5%'
                  and pg_temp.huella_dias(:pi2) = :'d0', 'un publicado: subir el total a 5 con solo 3 días se rechaza y el total NO cambia');
select pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1,"titulo":"Uno","desayuno":true},{"dia":2},{"dia":3}]'::jsonb)::text$q$, :pi2)) as r_gd \gset
select pg_temp.ok(:'r_gd' = '3'
                  and (select titulo || ':' || desayuno from public.programa_dias where programa_id = :pi2 and dia = 1) = 'Uno:true', 'un publicado: un itinerario COMPLETO se guarda y reemplaza los días');

-- Los traslados se guardan y se muestran, pero no reemplazan ni agregan días turísticos.
select pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":0,"tipo_tramo":"traslado_previo"},{"dia":1},{"dia":2},{"dia":3},{"dia":4,"tipo_tramo":"traslado_posterior"}]'::jsonb)::text$q$, :pi2)) as r_traslados \gset
select pg_temp.ok(:'r_traslados' = '5' and public.itinerario_programa_problema(:pi2, 3) is null
                  and (select count(*) from public.programa_dias where programa_id=:pi2 and tipo_tramo='dia')=3,
                  'un publicado admite traslados antes y después sin cambiar sus tres días turísticos');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":0,"tipo_tramo":"traslado_previo"},{"dia":1},{"dia":2},{"dia":3},{"dia":5,"tipo_tramo":"traslado_posterior"}]'::jsonb)::text$q$, :pi2)) like 'ERROR:%no corresponde a su posición%'
                  and (select count(*) from public.programa_dias where programa_id=:pi2 and tipo_tramo <> 'dia')=2,
                  'un traslado posterior fuera de posición se rechaza sin cambiar el itinerario');
select pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1,"titulo":"Uno","desayuno":true},{"dia":2},{"dia":3}]'::jsonb)::text$q$, :pi2)) as r_gd_restaurado \gset
select pg_temp.ok(:'r_gd_restaurado' = '3', 'el itinerario original se restaura para las demás pruebas');

-- Entradas inválidas: se rechazan (nada se descarta en silencio) y no reemplazan los días.
select pg_temp.huella_dias(:pi2) as d1 \gset
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1},"texto"]'::jsonb)::text$q$, :pi2)) like 'ERROR:%no es válido (se esperaba un objeto)%' and pg_temp.huella_dias(:pi2) = :'d1', 'un día que no es objeto se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":0}]'::jsonb)::text$q$, :pi2)) like 'ERROR:%no corresponde a su posición%' and pg_temp.huella_dias(:pi2) = :'d1', 'el día 0 sin tipo de traslado se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":"x"}]'::jsonb)::text$q$, :pi2)) like 'ERROR:%tipo o número inválido%' and pg_temp.huella_dias(:pi2) = :'d1', 'un día no numérico se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"titulo":"sin número"}]'::jsonb)::text$q$, :pi2)) like 'ERROR:%tipo o número inválido%' and pg_temp.huella_dias(:pi2) = :'d1', 'un día sin número se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '{"dia":1}'::jsonb)::text$q$, :pi2)) like 'ERROR:%lista de días no es válida%' and pg_temp.huella_dias(:pi2) = :'d1', 'una lista que no es arreglo se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1}]'::jsonb, 0)::text$q$, :pi2)) like 'ERROR:%total de días%' and pg_temp.huella_dias(:pi2) = :'d1', 'un total de días menor que 1 se rechaza');
select pg_temp.ok(pg_temp.como('authenticated', :'op', $q$select public.guardar_programa_dias(999999999, '[]'::jsonb)::text$q$) like 'ERROR:%no existe%', 'un programa inexistente se rechaza');

-- Permisos.
select pg_temp.ok(pg_temp.como('authenticated', :'ve', format($q$select public.guardar_programa_dias(%s, '[{"dia":1},{"dia":2},{"dia":3}]'::jsonb)::text$q$, :pi2)) like 'ERROR:%'
                  and pg_temp.huella_dias(:pi2) = :'d1', 'el rol venta no puede guardar días (RLS) y no cambia nada');
select pg_temp.ok(pg_temp.como('anon', null, format($q$select public.guardar_programa_dias(%s, '[]'::jsonb)::text$q$, :pi2)) like 'ERROR:%permission denied%', 'anon no puede ejecutar guardar_programa_dias');

-- Importación del proveedor: días + total en UNA transacción (cambia el total y reemplaza el itinerario a la vez).
select pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1},{"dia":2},{"dia":3},{"dia":4}]'::jsonb, 4)::text$q$, :pi2)) as r_imp \gset
select pg_temp.ok(:'r_imp' = '4'
                  and (select dias from public.programas where id = :pi2) = 4 and (select count(*) from public.programa_dias where programa_id = :pi2) = 4,
  'un publicado: cambiar el total y el itinerario juntos (importación) se acepta si el resultado es 1..N');

-- Despublicado: el borrador incompleto SÍ se guarda por la RPC (y por tanto no se puede volver a publicar hasta completarlo).
update public.programas set publicado = false where id = :pi2;
select pg_temp.como('authenticated', :'op', format($q$select public.guardar_programa_dias(%s, '[{"dia":1},{"dia":1},{"dia":4}]'::jsonb)::text$q$, :pi2)) as r_bor \gset
select pg_temp.ok(:'r_bor' = '3'
                  and public.itinerario_programa_problema(:pi2, 4) like 'faltan los días 2, 3; se repiten los días 1%',
  'un programa despublicado guarda un borrador incompleto (con repetidos) por la RPC');
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programas set publicado = true where id = %s$q$, :pi2)) like 'ERROR:%quedaría incompleto%',
  'y no se puede volver a publicar mientras siga incompleto');

-- ── Mover un día de un programa a otro (UPDATE de programa_id): se validan ORIGEN y DESTINO ────────────────────────────────
-- pubA/pubB: publicados con días 1..3 · borA: borrador con 1..3 · borB: borrador con 1..2 (le falta el 3).
insert into public.programas (nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado) values
  ('__t246_mv_pubA__', 3, 2, 'USD', 'categoria', 'ninguno', false), ('__t246_mv_pubB__', 3, 2, 'USD', 'categoria', 'ninguno', false),
  ('__t246_mv_borA__', 3, 2, 'USD', 'categoria', 'ninguno', false), ('__t246_mv_borB__', 3, 2, 'USD', 'categoria', 'ninguno', false);
select (select id from public.programas where nombre = '__t246_mv_pubA__') as mpa,
       (select id from public.programas where nombre = '__t246_mv_pubB__') as mpb,
       (select id from public.programas where nombre = '__t246_mv_borA__') as mba,
       (select id from public.programas where nombre = '__t246_mv_borB__') as mbb \gset
insert into public.programa_dias (programa_id, dia, titulo)
  select p, d, 'D' || d from unnest(array[:mpa, :mpb, :mba]::bigint[]) p, generate_series(1, 3) d;
insert into public.programa_dias (programa_id, dia, titulo) values (:mbb, 1, 'D1'), (:mbb, 2, 'D2');
update public.programas set publicado = true where id in (:mpa, :mpb);
select pg_temp.intenta_i('select 1') as _calentar \gset
select pg_temp.huella_dias(:mpa) as h_pa, pg_temp.huella_dias(:mpb) as h_pb, pg_temp.huella_dias(:mba) as h_ba, pg_temp.huella_dias(:mbb) as h_bb \gset

-- Publicado → publicado: el ORIGEN pierde un día (el destino además repetiría el 3): se rechaza y nada cambia.
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = %s where programa_id = %s and dia = 3$q$, :mpb, :mpa)) like format('ERROR:%%El programa %s está publicado y su itinerario quedaría incompleto%%', :mpa)
                  and pg_temp.huella_dias(:mpa) = :'h_pa' and pg_temp.huella_dias(:mpb) = :'h_pb',
  'traslado publicado → publicado: se rechaza (el origen pierde un día) y ambos itinerarios quedan intactos');

-- Publicado → borrador (que así quedaría completo): ANTES se escapaba porque solo se miraba el destino; ahora el origen publicado lo impide.
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = %s where programa_id = %s and dia = 3$q$, :mbb, :mpa)) like format('ERROR:%%El programa %s está publicado y su itinerario quedaría incompleto (faltan los días 3)%%', :mpa)
                  and pg_temp.huella_dias(:mpa) = :'h_pa' and pg_temp.huella_dias(:mbb) = :'h_bb',
  'traslado publicado → borrador: se rechaza por el ORIGEN publicado aunque el destino borrador quedara completo');

-- Borrador → publicado: el DESTINO publicado quedaría con el día 3 repetido.
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = %s where programa_id = %s and dia = 3$q$, :mpb, :mba)) like format('ERROR:%%El programa %s está publicado y su itinerario quedaría incompleto (se repiten los días 3)%%', :mpb)
                  and pg_temp.huella_dias(:mba) = :'h_ba' and pg_temp.huella_dias(:mpb) = :'h_pb',
  'traslado borrador → publicado: se rechaza por el DESTINO publicado (día repetido) y el origen borrador no cambia');

-- Borrador → publicado con otro día fuera de rango: también el destino.
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = %s, dia = 9 where programa_id = %s and dia = 3$q$, :mpb, :mba)) like format('ERROR:%%El programa %s está publicado%%fuera de 1–3 (9)%%', :mpb)
                  and pg_temp.huella_dias(:mba) = :'h_ba' and pg_temp.huella_dias(:mpb) = :'h_pb',
  'traslado borrador → publicado con día 9: se rechaza (día fuera de 1–N en el destino)');

-- Borrador → borrador: permitido (ninguno está publicado), aunque deje a ambos incompletos o repetidos.
select pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = %s where programa_id = %s and dia = 3$q$, :mbb, :mba)) as r_bb \gset
select pg_temp.ok(:'r_bb' = 'OK' and (select count(*) from public.programa_dias where programa_id = :mbb and dia = 3) = 1
                  and (select count(*) from public.programa_dias where programa_id = :mba) = 2,
  'traslado borrador → borrador: se permite (el borrador incompleto es válido)');

-- Intercambio publicado ↔ borrador en UNA sola transacción: ambos terminan completos (el día 3 de cada uno cambia de manos), así que pasa.
select pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = case programa_id when %s then %s else %s end
                                      where (programa_id = %s and dia = 3) or (programa_id = %s and dia = 3)$q$, :mpa, :mbb, :mpa, :mpa, :mbb)) as r_sw \gset
select pg_temp.ok(:'r_sw' = 'OK' and (select count(*) from public.programa_dias where programa_id = :mpa and dia = 3) = 1
                  and public.itinerario_programa_problema(:mpa, 3) is null,
  'intercambio del día 3 entre un publicado y un borrador en una misma transacción: el publicado sigue completo y se acepta');

-- Intercambio publicado ↔ publicado (ids en sentidos opuestos, orden de candados estable): ambos siguen completos.
select pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = case programa_id when %s then %s else %s end
                                      where (programa_id = %s and dia = 2) or (programa_id = %s and dia = 2)$q$, :mpa, :mpb, :mpa, :mpa, :mpb)) as r_sw2 \gset
select pg_temp.ok(:'r_sw2' = 'OK' and public.itinerario_programa_problema(:mpa, 3) is null and public.itinerario_programa_problema(:mpb, 3) is null,
  'intercambio del día 2 entre dos publicados (sentidos opuestos): ambos siguen completos y se acepta');

-- Cambiar de programa un día de un publicado reponiendo el hueco en la misma transacción también pasa; sin reponerlo, no.
select pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = %s where programa_id = %s and dia = 1;
                                    insert into public.programa_dias (programa_id, dia, titulo) values (%s, 1, 'repuesto')$q$, :mba, :mpb, :mpb)) as r_rep \gset
select pg_temp.ok(:'r_rep' = 'OK' and public.itinerario_programa_problema(:mpb, 3) is null,
  'mover un día de un publicado y reponer el hueco en la misma transacción: se acepta');
select pg_temp.ok(pg_temp.intenta_i(format($q$update public.programa_dias set programa_id = %s where programa_id = %s and dia = 1$q$, :mba, :mpb)) like format('ERROR:%%El programa %s está publicado%%faltan los días 1%%', :mpb),
  'mover un día de un publicado sin reponerlo: se rechaza');

-- El helper de candado está cerrado a anon (no se ofrece por la API pública).
select pg_temp.ok(not has_function_privilege('anon', 'public.bloquear_itinerario_programa(bigint)', 'execute')
                  and has_function_privilege('authenticated', 'public.bloquear_itinerario_programa(bigint)', 'execute'),
  'bloquear_itinerario_programa: authenticated sí, anon no');

-- ── INSERT de un programa que nace PUBLICADO ─────────────────────────────────────────────────────────────────────────────
-- Todo dentro de esta transacción (termina en ROLLBACK). Ids explícitos de un rango reservado (246801-246806; los días, id = programa × 10 + día) para
-- NO consumir las secuencias de programas ni de programa_dias, y para no tocar ninguna fila ajena.

-- 1) REPRODUCCIÓN con la versión ANTERIOR del trigger (solo UPDATE, con su WHEN): el INSERT publicado sin itinerario se acepta (el hallazgo de auditoría).
drop trigger trg_programas_itinerario_publicado on public.programas;
create constraint trigger trg_programas_itinerario_publicado
  after update of publicado, dias on public.programas
  deferrable initially deferred
  for each row
  when (new.publicado and (old.publicado is distinct from new.publicado or old.dias is distinct from new.dias))
  execute function public.tg_programa_itinerario_publicado();
select pg_temp.intenta_i($q$insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
                            values (246801, '__t246_ins_anterior__', 3, 2, 'USD', 'categoria', 'ninguno', true)$q$) as r_ins_ant \gset
select pg_temp.ok(:'r_ins_ant' = 'OK'
                  and (select publicado from public.programas where id = 246801) = true
                  and public.itinerario_programa_problema(246801, 3) = 'faltan los días 1, 2, 3',
  'REPRODUCCIÓN con el trigger anterior (solo UPDATE): un INSERT publicado sin itinerario se acepta y queda publicado sin días');
delete from public.programas where id = 246801;

-- 2) Se restaura la definición vigente (la de la migración: INSERT y UPDATE) y se comprueba el rechazo.
drop trigger trg_programas_itinerario_publicado on public.programas;
create constraint trigger trg_programas_itinerario_publicado
  after insert or update of publicado, dias on public.programas
  deferrable initially deferred
  for each row
  execute function public.tg_programa_itinerario_publicado();

select pg_temp.ok(pg_temp.intenta_i($q$insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
                                         values (246802, '__t246_ins_nuevo__', 3, 2, 'USD', 'categoria', 'ninguno', true)$q$) like 'ERROR:%El programa 246802 está publicado y su itinerario quedaría incompleto (faltan los días 1, 2, 3)%'
                  and (select count(*) from public.programas where id = 246802) = 0,
  'INSERT publicado sin itinerario: se rechaza al cerrar la transacción (con la guarda ampliada) y no queda la fila');
select pg_temp.ok(pg_temp.intenta_i($q$insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
                                         values (246803, '__t246_ins_sin_total__', null, null, 'USD', 'categoria', 'ninguno', true)$q$) like 'ERROR:%no tiene configurados sus días%',
  'INSERT publicado sin total de días: se rechaza');
select pg_temp.ok(pg_temp.intenta_i($q$with p as (insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
                                                     values (246804, '__t246_ins_parcial__', 3, 2, 'USD', 'categoria', 'ninguno', true) returning id)
                                         insert into public.programa_dias (id, programa_id, dia, titulo) select p.id * 10 + g, p.id, g, 'D' || g from p, generate_series(1, 2) g$q$) like 'ERROR:%faltan los días 3%'
                  and (select count(*) from public.programas where id = 246804) = 0,
  'INSERT publicado con el itinerario parcial (1 y 2 de 3): se rechaza');

-- Lo válido sigue pasando: publicado + itinerario completo en la misma transacción, y un borrador incompleto.
select pg_temp.intenta_i($q$with p as (insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
                                         values (246805, '__t246_ins_completo__', 3, 2, 'USD', 'categoria', 'ninguno', true) returning id)
                             insert into public.programa_dias (id, programa_id, dia, titulo) select p.id * 10 + g, p.id, g, 'D' || g from p, generate_series(1, 3) g$q$) as r_ins_ok \gset
select pg_temp.ok(:'r_ins_ok' = 'OK' and (select publicado from public.programas where id = 246805) = true
                  and public.itinerario_programa_problema(246805, 3) is null,
  'INSERT publicado con el itinerario 1..N completo en la misma transacción: se acepta');
select pg_temp.intenta_i($q$insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
                            values (246806, '__t246_ins_borrador__', 3, 2, 'USD', 'categoria', 'ninguno', false)$q$) as r_ins_bor \gset
select pg_temp.ok(:'r_ins_bor' = 'OK' and (select count(*) from public.programas where id = 246806) = 1,
  'INSERT de un borrador sin itinerario: se acepta (el borrador incompleto sigue siendo válido)');
-- Y el camino UPDATE (publicar/cambiar el total) conserva su comportamiento.
select pg_temp.ok(pg_temp.intenta_i('update public.programas set publicado = true where id = 246806') like 'ERROR:%quedaría incompleto (faltan los días 1, 2, 3)%',
  'publicar por UPDATE un borrador sin itinerario sigue rechazándose');
select pg_temp.ok(pg_temp.intenta_i('update public.programas set nombre = nombre where id = 246805') = 'OK',
  'una edición ajena al itinerario de un publicado completo sigue permitida');

-- Traslado posterior: sigue a programas.dias (recolocación atómica en la misma sentencia) y su posición se valida.
select pg_temp.intenta_i($q$with p as (insert into public.programas (id, nombre, dias, noches, moneda, modo_precio, tipo_transporte, publicado)
                                         values (246810, '__t246_traslado_post__', 3, 2, 'USD', 'categoria', 'ninguno', true) returning id)
                             insert into public.programa_dias (id, programa_id, dia, tipo_tramo, titulo)
                             select p.id * 10 + g, p.id, g, case when g = 4 then 'traslado_posterior' else 'dia' end, 'D' || g from p, generate_series(1, 4) g$q$) as r_post \gset
select pg_temp.ok(:'r_post' = 'OK' and public.itinerario_programa_problema(246810, 3) is null,
  'publicado con días 1..3 + traslado posterior (día 4): se acepta y no cuenta como día turístico');
-- (El resultado se captura con \gset: una subconsulta en la misma sentencia vería la instantánea anterior a la función.)
select pg_temp.intenta_i('delete from public.programa_dias where programa_id = 246810 and dia = 3; update public.programas set dias = 2 where id = 246810') as r_baja \gset
select pg_temp.ok(:'r_baja' = 'OK'
                  and (select dia from public.programa_dias where programa_id = 246810 and tipo_tramo = 'traslado_posterior') = 3,
  'bajar programas.dias de 3 a 2 (y quitar el día 3) recoloca el traslado posterior en el día 3 y el publicado sigue completo');
select pg_temp.intenta_i('update public.programas set dias = 5 where id = 246810') as r_sube \gset
select pg_temp.ok(:'r_sube' like 'ERROR:%faltan los días 3, 4, 5%'
                  and (select dia from public.programa_dias where programa_id = 246810 and tipo_tramo = 'traslado_posterior') = 3
                  and (select dias from public.programas where id = 246810) = 2,
  'subir programas.dias sin completar los días: se rechaza con mensaje de negocio y nada cambia (traslado y total intactos)');
select pg_temp.intenta_i($q$insert into public.programa_dias (id, programa_id, dia, tipo_tramo, titulo) values (2468109, 246810, 9, 'traslado_posterior', 'mal puesto')$q$) as r_dup \gset
select pg_temp.ok(:'r_dup' like 'ERROR:%traslado fuera de posición o repetido%',
  'un segundo traslado posterior o en posición equivocada se rechaza en un publicado');

rollback;
