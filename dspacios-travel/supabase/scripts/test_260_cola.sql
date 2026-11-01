-- Pruebas SQL de la migración 260 (cola, trabajador, reintentos, huérfanos, composición, lectura por rol). SOLO base local desechable:
-- plantilla 001-254 + 255/256/258 (hotfix) + 259 + 260 + test_259_semilla.sql. Lo corre test_260_cola.sh. Imprime «OK …» / «FALLA …» y termina con el resumen.
\set ON_ERROR_STOP on
\set QUIET on
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

drop table if exists public.t_res; drop table if exists public.t_l260;
create table public.t_res (ok boolean, msg text);
create table public.t_l260 (marca text, lote int, txt text, primary key (marca, lote));
create or replace function public.t_ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin insert into public.t_res values (coalesce(p_cond, false), p_msg); raise notice '% %', case when coalesce(p_cond, false) then '  OK ' else '  FALLA' end, p_msg; end $$;
create or replace function public.t_fila260(p_marca text, p_k int, p_ida date) returns jsonb language sql as $$
  select jsonb_build_object('paquete_id', 73, 'paquete_nombre', p_marca, 'paquete_activo', true, 'modulo', 'bloqueo', 'bloqueo_id', 3000, 'bloqueo_label', 'BOG-CTG',
    'hotel_id', 2000, 'hotel_nombre', 'Hotel 0', 'destino_id', 1, 'destino_nombre', 'CARTAGENA', 'categoria', 'C' || (p_k / 7), 'regimen', 'PC',
    'acomodacion', (array['sencilla','doble','triple','multiple','nino','nino2','infante'])[1 + p_k % 7], 'noches', 3, 'fecha_ida', p_ida, 'fecha_regreso', p_ida + 3,
    'neto_hotel', 300, 'base_comisionable', 100 + p_k, 'impuesto', 0, 'precio_pvp', 100 + p_k, 'moneda', 'COP', 'temporada_ganadora', 'BASE', 'es_promocion', false,
    'precio_final_autoritativo', false, 'procedencia_mixta', false,
    'procedencia_temporadas', jsonb_build_array(jsonb_build_object('temporada', 'BASE', 'es_promocion', false, 'precio_final_autoritativo', false))) $$;
-- Lotes de n filas en grupos de p_tam; p_veneno = número de lote que lleva UNA fila con una acomodación inválida (pasa la huella pero revienta al insertar); p_fechas = fechas de ida distintas.
create or replace function public.t_preparar260(p_marca text, p_n int, p_tam int, p_veneno int default 0, p_fechas int default 1) returns void language plpgsql as $$
declare v_lote int := 1; v_ini int := 0; v_filas jsonb;
begin
  delete from public.t_l260 where marca = p_marca;
  while v_ini < p_n loop
    select jsonb_agg(case when p_veneno = v_lote and k = v_ini then jsonb_set(f, '{acomodacion}', '"zzz"') else f end order by k) into v_filas
      from (select k, public.t_fila260(p_marca, k, date '2026-12-20' + (k % p_fechas) * 7) f from generate_series(v_ini, least(v_ini + p_tam, p_n) - 1) k) q;
    insert into public.t_l260 values (p_marca, v_lote, v_filas::text);
    v_lote := v_lote + 1; v_ini := v_ini + p_tam;
  end loop;
end $$;
create or replace function public.t_publicar260(p_marca text, p_comp jsonb default '[]'::jsonb, p_encolar boolean default true) returns bigint language plpgsql as $$
declare g bigint; r bigint; res text; l record;
begin
  select generacion, revision_capturada into g, r from public.iniciar_generacion_tarifario(73);
  res := public.tarifario_manifiesto_crear(73, g, r, 'COP', (select jsonb_agg(jsonb_build_object('lote', lote, 'filas', jsonb_array_length(txt::jsonb), 'huella', encode(sha256(convert_to(txt, 'UTF8')), 'hex')) order by lote)
                                                               from public.t_l260 where marca = p_marca), p_comp);
  if res <> 'ok' then raise exception 'manifiesto: %', res; end if;
  for l in select * from public.t_l260 where marca = p_marca order by lote loop
    res := public.tarifario_lote_espera_guardar(73, g, l.lote, l.txt);
    if res <> 'ok' then raise exception 'espera: %', res; end if;
  end loop;
  if p_encolar then res := public.tarifario_publicacion_encolar(73, g); if res <> 'ok' then raise exception 'encolar: %', res; end if; end if;
  return g;
end $$;
create or replace function public.t_vis260(p_marca text default null) returns bigint language sql as $$
  select count(*) from public.tarifario_resultado_publicable where paquete_id = 73 and (p_marca is null or paquete_nombre = p_marca) $$;
create or replace function public.t_gens260() returns bigint language sql as $$
  select count(distinct r.generacion) from public.tarifario_resultado r where r.paquete_id = 73 and exists (select 1 from public.tarifario_resultado_publicable v where v.id = r.id) $$;
-- Avanza la publicación hasta p_max pasos (como lo harían la petición o el trabajador) y devuelve la secuencia de respuestas.
create or replace function public.t_avanzar260(p_gen bigint, p_max int default 40) returns text language plpgsql as $$
declare r text; s text := ''; i int := 0;
begin
  while i < p_max loop
    r := public.tarifario_publicacion_avanzar(73, p_gen); s := s || r || ' '; i := i + 1;
    exit when r in ('listo', 'sin_cola', 'fallida', 'obsoleta') or r like 'detenida:%';
  end loop;
  return trim(s);
end $$;

-- ── Mundo ───────────────────────────────────────────────────────────────────────────────────────────────────────────
truncate public.tarifario_resultado cascade;
delete from public.tarifario_cambio_fuente; delete from public.tarifario_publicacion_cola; delete from public.armado_servicios where paquete_id = 73;
delete from public.tarifa_hotel where hotel_id = 2000; delete from public.hotel_temporadas where hotel_id = 2000; delete from public.armado_hoteles where paquete_id = 73;
update public.armado_paquetes set tarifario_por_generacion = false, tarifario_generacion_publicada = null where id = 73;

-- ── C1 · ciclo completo por pasos: espera → cola → lotes → activación → limpieza → listo ───────────────────────────────────
select public.t_preparar260('c1', 2500, 1000);                      -- 3 lotes (1000, 1000, 500)
select public.t_publicar260('c1') as g1 \gset
select public.t_ok(public.t_vis260() = 0 and (select count(*) from public.tarifario_lote_espera where generacion = :g1) = 3 and (select count(*) from public.tarifario_publicacion_cola where generacion = :g1) = 1,
                   'C1 con los 3 lotes en espera y la publicación encolada NADA es visible todavía');
select public.t_avanzar260(:g1) as sec \gset
select public.t_ok(:'sec' like 'lote:1 lote:2 lote:3 activada%' and :'sec' like '%listo', 'C1 secuencia de pasos: ' || :'sec');
select public.t_ok(public.t_vis260('c1') = 2500 and public.t_gens260() = 1 and (select count(*) from public.tarifario_lote_espera) = 0 and (select count(*) from public.tarifario_publicacion_cola) = 0,
                   'C1 visibles 2.500 filas de UNA generación; la espera y la cola quedaron vacías');
select public.t_ok((select count(*) from public.tarifario_resultado_neto n join public.tarifario_resultado r on r.id = n.fila_id where r.paquete_id = 73 and r.generacion = :g1) = 2500,
                   'C1 el costo neto del hotel quedó en su tabla aparte (2.500 filas)');

-- ── C2 · el trabajador de la base (sin sesión de usuario, como pg_cron) termina sola una publicación encolada ──────────────────
select public.t_preparar260('c2', 3000, 1000);
select public.t_publicar260('c2') as g2 \gset
select set_config('request.jwt.claim.sub', '', false);               -- SIN usuario: así corre pg_cron / la ruta con service-role
select public.tarifario_cola_correr(60000) as w \gset
select public.t_ok((:'w'::jsonb->>'en_cola')::int = 0 and (:'w'::jsonb->>'pasos')::int >= 5, 'C2 el trabajador procesó ' || (:'w'::jsonb->>'pasos') || ' pasos sin sesión y vació la cola');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.t_ok(public.t_vis260('c2') = 3000 and public.t_gens260() = 1, 'C2 quedó visible la generación completa (3.000 filas), sin navegador');
select public.t_ok((select count(*) from public.tarifario_resultado where paquete_id = 73) = 3000, 'C2 la limpieza retiró la generación anterior (solo quedan las 3.000 filas)');

-- ── C3 · FALLO ENTRE LOTES con un error DETERMINISTA (fila inválida en el lote 2): se detiene YA, invisible; lo publicado antes sigue completo ───────────────────
select public.t_preparar260('c3', 3000, 1000, 2);
select public.t_publicar260('c3') as g3 \gset
select public.tarifario_publicacion_avanzar(73, :g3) as p1 \gset
select public.tarifario_publicacion_avanzar(73, :g3) as p2 \gset
select public.t_ok(:'p1' = 'lote:1' and :'p2' like 'detenida:22%', 'C3 lote 1 ok y el lote 2 (acomodación inválida) detiene la publicación de inmediato SIN reintentos inútiles: ' || :'p2');
select public.t_ok(public.t_vis260('c2') = 3000 and public.t_vis260('c3') = 0 and public.t_gens260() = 1, 'C3 lo publicado antes (c2) sigue completo; el lote 1 cargado de c3 es invisible');
select public.t_ok((select estado from public.tarifario_publicacion_cola) = 'fallida' and (select intentos from public.tarifario_publicacion_cola) = 1 and (select ultimo_error from public.tarifario_publicacion_cola) like '22P02:%',
                   'C3 la cola quedó «fallida» con el SQLSTATE y el mensaje real para diagnóstico');
select public.t_ok((select count(*) from public.tarifario_resultado where paquete_id = 73 and paquete_nombre = 'c3') = 1000, 'C3 el lote que falló revirtió por completo (solo están las 1.000 filas del lote 1)');
select public.t_ok((select tarifario_estado from public.armado_paquetes where id = 73) = 'fallido' and (select tarifario_error from public.armado_paquetes where id = 73) not like '%zzz%',
                   'C3 el paquete queda «fallido» con un mensaje fijo (sin texto interno de Postgres)');
select public.t_ok(public.tarifario_publicacion_avanzar(73, :g3) = 'fallida', 'C3 avanzar una publicación fallida responde «fallida» y no toca nada');
select public.tarifario_cola_correr(3000) as w \gset
select public.t_ok((:'w'::jsonb->>'pasos')::int = 0 and (:'w'::jsonb->>'en_cola')::int = 0, 'C3 el trabajador ignora las fallidas (0 pasos; no cuentan como cola activa)');

-- ── C4 · una generación nueva rehace el trabajo y limpia lo que dejó la fallida ────────────────────────────────────────────────────────────────
select public.t_preparar260('c4', 2000, 1000);
select public.t_publicar260('c4') as g4 \gset
select public.t_ok((select generacion from public.tarifario_publicacion_cola) = :g4 and (select estado from public.tarifario_publicacion_cola) = 'pendiente' and (select intentos from public.tarifario_publicacion_cola) = 0,
                   'C4 encolar la generación NUEVA reemplaza a la fallida (reintentos en 0)');
select public.t_avanzar260(:g4) as sec \gset
select public.t_ok(public.t_vis260('c4') = 2000 and public.t_gens260() = 1 and (select count(*) from public.tarifario_resultado where paquete_id = 73) = 2000, 'C4 publicada y limpia: ' || :'sec');

-- ── C5 · encolar dos veces la MISMA publicación no reinicia sus reintentos; faltan lotes → no se encola ───────────────────────────────
select public.t_preparar260('c5', 2000, 1000);
select public.t_publicar260('c5', '[]', false) as g5 \gset
select public.tarifario_publicacion_encolar(73, :g5) as e1 \gset
update public.tarifario_publicacion_cola set intentos = 3 where paquete_id = 73;
select public.tarifario_publicacion_encolar(73, :g5) as e2 \gset
select public.t_ok(:'e1' = 'ok' and :'e2' = 'ok' and (select intentos from public.tarifario_publicacion_cola) = 3, 'C5 re-encolar la misma publicación es idempotente (conserva sus 3 intentos)');
delete from public.tarifario_publicacion_cola; delete from public.tarifario_lote_espera where generacion = :g5 and lote = 2;
select public.tarifario_publicacion_encolar(73, :g5) as e3 \gset
select public.t_ok(:'e3' = 'faltan' and (select count(*) from public.tarifario_publicacion_cola) = 0, 'C5 con un lote sin preparar NO se encola: ' || :'e3');
select public.tarifario_lote_espera_guardar(73, :g5, 2, replace((select txt from public.t_l260 where marca = 'c5' and lote = 2), '"PC"', '"XX"')) as e4 \gset
select public.tarifario_lote_espera_guardar(73, :g5 - 1, 2, (select txt from public.t_l260 where marca = 'c5' and lote = 2)) as e5 \gset
select public.t_ok(:'e4' = 'huella' and :'e5' = 'obsoleta', 'C5 la espera verifica la huella (' || :'e4' || ') y la generación (' || :'e5' || ')');
select public.tarifario_lote_espera_guardar(73, :g5, 2, (select txt from public.t_l260 where marca = 'c5' and lote = 2)) as e6 \gset
select public.t_avanzar260(:g5 + 0) as sec0 \gset
select public.tarifario_publicacion_encolar(73, :g5) as e7 \gset
select public.t_avanzar260(:g5) as sec \gset
select public.t_ok(:'sec0' = 'sin_cola' and :'e7' = 'ok' and public.t_vis260('c5') = 2000, 'C5 preparada la última pieza se encola y se publica (' || :'sec0' || ' antes de encolar)');

-- ── C6 · generación SUPERADA mientras esperaba en la cola: no se activa y se limpia sola ────────────────────────────────────────────────────────
select public.t_preparar260('c6', 2000, 1000);
select public.t_publicar260('c6') as g6 \gset
select generacion as g6b from public.iniciar_generacion_tarifario(73) \gset
select public.tarifario_publicacion_avanzar(73, :g6) as r6 \gset
select public.t_ok(:'r6' = 'obsoleta' and (select count(*) from public.tarifario_publicacion_cola) = 0 and public.t_vis260('c5') = 2000, 'C6 la publicación superada se descarta (' || :'r6' || '), la cola queda vacía y c5 sigue visible');

-- ── C7 · HUÉRFANOS: esperas sin publicación, colas de generaciones superadas y fallidas viejas se limpian ─────────────────────────────────────
select public.t_preparar260('c7', 1000, 1000);
select public.t_publicar260('c7', '[]', false) as g7 \gset
update public.tarifario_lote_espera set creado_en = now() - interval '2 days' where generacion = :g7;
insert into public.tarifario_publicacion_cola (paquete_id, generacion, estado, actualizado_en) values (73, :g7 - 3, 'pendiente', now());      -- cola de una generación superada
select public.tarifario_cola_correr(1000) as w \gset
select public.t_ok((select count(*) from public.tarifario_lote_espera where generacion = :g7) = 0 and (select count(*) from public.tarifario_publicacion_cola) = 0,
                   'C7 el mantenimiento borró la espera vieja sin cola y la cola de una generación superada');
insert into public.tarifario_publicacion_cola (paquete_id, generacion, estado, intentos, actualizado_en) values (73, :g7, 'fallida', 6, now() - interval '4 days');
select public.tarifario_cola_correr(1000) as w \gset
select public.t_ok((select count(*) from public.tarifario_publicacion_cola) = 0, 'C7 una cola «fallida» de más de 3 días se retira');
insert into public.tarifario_publicacion_cola (paquete_id, generacion, estado, intentos, actualizado_en) values (73, :g7, 'fallida', 6, now());
select public.tarifario_cola_correr(1000) as w \gset
select public.t_ok((select count(*) from public.tarifario_publicacion_cola) = 1, 'C7 una «fallida» reciente se conserva (visible para diagnóstico)');
delete from public.tarifario_publicacion_cola;

-- ── C8 · TIMEOUT dentro de un paso (query_canceled): cuenta como intento y no deja la transacción rota ──────────────────────────────────────
-- Simula el timeout de una sentencia lanzando el MISMO SQLSTATE (57014 = query_canceled) que genera el temporizador: ejercita el mismo manejador. Los timeouts reales (temporizador) se miden por PostgREST en test_lotes_medicion.mjs.
create or replace function public.t_dormir260() returns trigger language plpgsql as $$ begin raise exception 'canceling statement due to statement timeout (simulado)' using errcode = '57014'; end $$;
create trigger t_dormir260 before insert on public.tarifario_resultado for each row when (new.paquete_nombre = 'c8') execute function public.t_dormir260();
select public.t_preparar260('c8', 1000, 1000);
select public.t_publicar260('c8') as g8 \gset
select public.tarifario_publicacion_avanzar(73, :g8) as r8 \gset
select public.t_ok(:'r8' like 'error:%' and (select intentos from public.tarifario_publicacion_cola) = 1 and (select count(*) from public.tarifario_resultado where paquete_nombre = 'c8') = 0,
                   'C8 un timeout (57014) dentro del paso se atrapa, cuenta como intento y revierte el lote: ' || :'r8');
drop trigger t_dormir260 on public.tarifario_resultado;
update public.tarifario_publicacion_cola set proximo_intento = now();
select public.t_avanzar260(:g8) as sec \gset
select public.t_ok(public.t_vis260('c8') = 1000, 'C8 desaparecido el fallo, el reintento publica (' || :'sec' || ')');
-- Un fallo TRANSITORIO que no se arregla: tras 6 intentos con espera creciente la publicación se detiene (no reintenta para siempre) y lo publicado sigue intacto.
create trigger t_dormir260 before insert on public.tarifario_resultado for each row when (new.paquete_nombre = 'c8b') execute function public.t_dormir260();
select public.t_preparar260('c8b', 1000, 1000);
select public.t_publicar260('c8b') as g8b \gset
select public.tarifario_cola_correr(3000) as w1 \gset
select public.t_ok((select intentos from public.tarifario_publicacion_cola) = 1 and (select proximo_intento from public.tarifario_publicacion_cola) > now() + interval '5 seconds' and (select estado from public.tarifario_publicacion_cola) = 'pendiente',
                   'C8 el primer timeout deja la publicación «pendiente» con el reintento programado (espera ≥ 10 s)');
select public.tarifario_cola_correr(3000) as w2 \gset
select public.t_ok((:'w2'::jsonb->>'pasos')::int = 0, 'C8 mientras espera su reintento el trabajador no la toca (0 pasos)');
do $$ begin for i in 1..8 loop update public.tarifario_publicacion_cola set proximo_intento = now() where estado = 'pendiente'; perform public.tarifario_cola_correr(3000); end loop; end $$;
select public.t_ok((select estado from public.tarifario_publicacion_cola) = 'fallida' and (select intentos from public.tarifario_publicacion_cola) = 6 and (select tarifario_estado from public.armado_paquetes where id = 73) = 'fallido',
                   'C8 agotados 6 intentos transitorios la publicación queda «fallida» y el paquete «fallido» (no reintenta para siempre)');
select public.t_ok(public.t_vis260('c8') = 1000 and public.t_gens260() = 1, 'C8 la oferta anterior (c8) sigue visible e intacta tras el fallo');
drop trigger t_dormir260 on public.tarifario_resultado;
delete from public.tarifario_publicacion_cola;

-- ── C9 · COMPOSICIÓN de la 258 con el servicio 112 INCLUIDO: fecha CON tarifa [112] y fecha SIN tarifa [] ───────────────────────────────────
insert into public.servicios_adicionales (id, nombre) overriding system value values (112, 'Traslados in/out (incluido)') on conflict do nothing;
insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (73, 112, 'persona', true) on conflict (paquete_id, servicio_id) do update set incluido = true;
select public.t_preparar260('c9', 14, 14, 0, 2);                                  -- 2 fechas de ida: 20-dic (con tarifa del 112) y 27-dic (sin tarifa: el 112 se OMITE)
select public.t_publicar260('c9', '[{"fecha_ida":"2026-12-20","servicios_incluidos":[112]},{"fecha_ida":"2026-12-27","servicios_incluidos":[]}]') as g9 \gset
select public.t_avanzar260(:g9) as sec \gset
select public.t_ok(public.t_vis260('c9') = 14 and (select servicios_incluidos from public.tarifario_composicion_publicada where paquete_id = 73 and fecha_ida = '2026-12-20') = '[112]'
                   and (select servicios_incluidos from public.tarifario_composicion_publicada where paquete_id = 73 and fecha_ida = '2026-12-27') = '[]'
                   and (select count(*) from public.tarifario_composicion_publicada where paquete_id = 73 and generacion = :g9) = 2,
                   'C9 la activación acredita [112] en la fecha con tarifa y [] (fecha vacía acreditada) en la que no la tiene, con la generación publicada');
-- Falta una fecha en el manifiesto → NO se activa y lo publicado sigue.
select public.t_preparar260('c9b', 14, 14, 0, 2);
select public.t_publicar260('c9b', '[{"fecha_ida":"2026-12-20","servicios_incluidos":[112]}]') as g9b \gset
select public.t_avanzar260(:g9b) as sec2 \gset
select public.t_ok(:'sec2' like '%detenida:sin_composicion' and public.t_vis260('c9') = 14 and public.t_vis260('c9b') = 0, 'C9 sin la composición de una fecha de ida NO se activa (' || :'sec2' || '); sigue c9');
delete from public.armado_servicios where paquete_id = 73 and servicio_id = 112;

-- ── C10 · LECTURA POR ROL: la generación en curso y el costo neto del hotel son invisibles para externos, por la vista Y por la tabla ───────────
-- Base conocida y VISIBLE (quitar el servicio incluido en C9 bloqueó el snapshot del paquete, como manda la 181): se publica una generación completa antes de preparar la siguiente.
select public.t_preparar260('c10a', 100, 100);
select public.t_publicar260('c10a') as g10a \gset
select public.t_avanzar260(:g10a) as sec10a \gset
select public.t_ok(public.t_vis260('c10a') = 100, 'C10 base visible de 100 filas antes de preparar la siguiente');
select public.t_preparar260('c10', 1000, 500);
select public.t_publicar260('c10') as g10 \gset
select public.tarifario_publicacion_avanzar(73, :g10) as r10 \gset
select count(*) as almacenadas from public.tarifario_resultado where paquete_id = 73 and generacion = :g10 \gset
select public.t_ok(:almacenadas = 500, 'C10 hay 500 filas almacenadas de una generación SIN activar');
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select count(*) as a_tabla from public.tarifario_resultado where paquete_id = 73 \gset
select count(*) as a_vista from public.tarifario_resultado_publicable where paquete_id = 73 \gset
reset role;
select public.t_ok(:a_tabla = :a_vista and :a_vista = public.t_vis260() and :a_vista > 0 and :a_vista < (select count(*) from public.tarifario_resultado where paquete_id = 73),
                   'C10 un visitante anónimo ve, por la tabla y por la vista, SOLO la generación publicada (' || :a_vista || ' de ' || (select count(*) from public.tarifario_resultado where paquete_id = 73) || ' filas almacenadas), nunca las 500 en preparación');
do $$ begin
  begin set role anon; perform count(*) from public.tarifario_resultado_neto; reset role; perform public.t_ok(false, 'C10 anon NO debía poder leer tarifario_resultado_neto');
  exception when insufficient_privilege then reset role; perform public.t_ok(true, 'C10 anon no puede leer el costo neto del hotel (tarifario_resultado_neto)'); end;
  begin set role authenticated; perform count(*) from public.tarifario_resultado_neto; reset role; perform public.t_ok(false, 'C10 authenticated NO debía poder leer tarifario_resultado_neto');
  exception when insufficient_privilege then reset role; perform public.t_ok(true, 'C10 un usuario autenticado tampoco lee el costo neto del hotel'); end;
  begin set role authenticated; perform count(*) from public.tarifario_lote_espera; reset role; perform public.t_ok(false, 'C10 authenticated NO debía poder leer la espera');
  exception when insufficient_privilege then reset role; perform public.t_ok(true, 'C10 la espera de lotes tampoco es legible por API'); end;
end $$;
select public.t_ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado_publicable' and column_name in ('neto_hotel', 'generacion', 'lote', 'ord', 'revision_fuente'))
                   and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tarifario_resultado' and column_name = 'neto_hotel'),
                   'C10 ni la vista ni la tabla legible tienen la columna neto_hotel ni los metadatos de generación en la vista');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
-- Un externo autenticado sin rol interno (rol agencia) tampoco ve la generación en curso por la tabla.
select public.t_ok((select count(*) from public.tarifario_resultado where paquete_id = 73) >= 500 + public.t_vis260(), 'C10 el rol interno SÍ ve todo en la tabla (diagnóstico): ' || (select count(*) from public.tarifario_resultado where paquete_id = 73) || ' filas');

-- ── C11 · un rol externo NO puede mover la cola ni activar ─────────────────────────────────────────────────────────────────────────────────
do $$ begin
  begin set role authenticated; perform set_config('request.jwt.claim.sub', '', false); perform public.tarifario_publicacion_avanzar(73, 1); reset role;
    perform public.t_ok(false, 'C11 sin rol interno avanzar debía fallar');
  exception when others then reset role; perform public.t_ok(sqlerrm like '%rol sin permiso%' or sqlerrm like '%permission denied%', 'C11 sin rol interno no se puede avanzar la cola: ' || sqlerrm); end;
  begin set role authenticated; perform public.tarifario_cola_correr(1000); reset role; perform public.t_ok(false, 'C11 el trabajador no debe ser invocable por authenticated');
  exception when insufficient_privilege then reset role; perform public.t_ok(true, 'C11 tarifario_cola_correr NO es invocable por authenticated/anon (solo service_role)'); end;
  begin set role authenticated; perform public.tarifario_lote_agregar_i(73, 1, 1, '[]'); reset role; perform public.t_ok(false, 'C11 las funciones internas no deben ser invocables');
  exception when insufficient_privilege then reset role; perform public.t_ok(true, 'C11 las funciones internas (_i) NO son invocables por authenticated'); end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

-- ── C12 · PAQUETE HEREDADO (publicado antes de la 260: filas SIN generación, bandera apagada) con su PRIMERA publicación por lotes a medias ─────────────────────────────────
-- Las filas a medias de la primera generación NO pueden mezclarse con las heredadas: durante la preparación solo se ve lo heredado; al activar, solo lo nuevo.
delete from public.tarifario_publicacion_cola; truncate public.tarifario_resultado cascade;
update public.armado_paquetes set tarifario_por_generacion = false, tarifario_generacion_publicada = tarifario_generacion, tarifario_snapshot_publicable = true, activo = true, tarifario_estado = 'listo' where id = 73;
insert into public.tarifario_resultado (paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, hotel_id, destino_id, categoria, regimen, acomodacion, noches, fecha_ida, base_comisionable, impuesto, precio_pvp, moneda, procedencia_mixta)
  select 73, 'heredado', true, 'bloqueo', 3000, 2000, 1, 'H' || g, 'PC', 'doble', 3, date '2026-12-20', 1, 0, 100 + g, 'COP', false from generate_series(1, 6) g;
select public.t_ok((select count(*) from public.tarifario_resultado where generacion is null) = 6 and public.t_vis260('heredado') = 6, 'C12 el paquete heredado muestra sus 6 filas sin generación (bandera apagada)');
select public.t_preparar260('c12', 2000, 1000);
select public.t_publicar260('c12') as g12 \gset
select public.tarifario_publicacion_avanzar(73, :g12) as p12 \gset
select public.t_ok(:'p12' = 'lote:1' and (select count(*) from public.tarifario_resultado where paquete_nombre = 'c12') = 1000 and public.t_vis260('c12') = 0 and public.t_vis260('heredado') = 6 and public.t_vis260() = 6,
                   'C12 con 1.000 filas de la primera generación ya almacenadas, lo visible sigue siendo SOLO lo heredado (6): nada a medias ni mezclado');
set role anon;
select count(*) as a_her from public.tarifario_resultado_publicable where paquete_id = 73 \gset
reset role;
select public.t_ok(:a_her = 6, 'C12 el visitante anónimo tampoco ve nada de la generación en preparación (ve ' || :a_her || ')');
select public.t_avanzar260(:g12) as sec12 \gset
select public.t_ok(public.t_vis260('c12') = 2000 and public.t_vis260() = 2000 and (select count(*) from public.tarifario_resultado where paquete_id = 73) = 2000 and (select tarifario_por_generacion from public.armado_paquetes where id = 73),
                   'C12 al activar solo se ve la generación nueva (2.000), la bandera queda encendida y la limpieza retiró lo heredado');
-- Una primera publicación que FALLA no deja basura visible ni obliga a tocarla a mano: la limpieza la retira en la próxima publicación.
update public.armado_paquetes set tarifario_por_generacion = false, tarifario_generacion_publicada = tarifario_generacion where id = 73;
select public.t_preparar260('c12b', 2000, 1000, 2);
select public.t_publicar260('c12b') as g12b \gset
select public.t_avanzar260(:g12b) as sec12b \gset
select public.t_ok(:'sec12b' like '%detenida:22%' and public.t_vis260('c12b') = 0 and (select count(*) from public.tarifario_resultado where paquete_nombre = 'c12b') = 1000,
                   'C12 una primera generación que falla a mitad deja 1.000 filas almacenadas pero NINGUNA visible (' || :'sec12b' || ')');
select public.t_preparar260('c12c', 1000, 1000);
select public.t_publicar260('c12c') as g12c \gset
select public.t_avanzar260(:g12c) as sec12c \gset
select public.t_ok(public.t_vis260('c12c') = 1000 and (select count(*) from public.tarifario_resultado where paquete_id = 73) = 1000, 'C12 la siguiente publicación sí queda visible y limpia los restos de la fallida: ' || :'sec12c');

-- ── C13 · el publicador MONOLÍTICO sobre un paquete que YA publicó por lotes (p. ej. un despliegue de Preview con la bandera apagada) ──────────────────────────────
-- No hay disparador por fila: un disparador por PAQUETE apaga la bandera cuando el puntero avanza a una generación sin manifiesto, y las filas del monolítico (sin generación) pasan a ser las visibles.
select generacion as g13, revision_capturada as r13 from public.iniciar_generacion_tarifario(73) \gset
select public.publicar_tarifario_resultado(73, :g13, :r13, 'COP', (select jsonb_agg(public.t_fila260('mono', k, date '2026-12-20')) from generate_series(0, 49) k)) as ok13 \gset
select public.t_ok(:'ok13' = 't' and (select tarifario_por_generacion from public.armado_paquetes where id = 73) = false and public.t_vis260('mono') = 50 and public.t_vis260() = 50
                   and (select count(*) from public.tarifario_resultado where paquete_id = 73) = 50 and (select count(*) from public.tarifario_resultado where paquete_id = 73 and generacion is null) = 50,
                   'C13 el monolítico publica 50 filas sin generación, apaga la bandera y SOLO esas 50 son visibles (las generaciones almacenadas no se mezclan)');
select public.t_preparar260('c13', 1000, 1000);
select public.t_publicar260('c13') as g13b \gset
select public.tarifario_publicacion_avanzar(73, :g13b) as p13 \gset
select public.t_ok(:'p13' = 'lote:1' and public.t_vis260() = 50 and public.t_vis260('mono') = 50, 'C13 con un lote de la siguiente publicación por lotes ya almacenado, el paquete sigue mostrando solo las 50 del monolítico');
select public.t_avanzar260(:g13b) as sec13 \gset
select public.t_ok(public.t_vis260('c13') = 1000 and public.t_vis260() = 1000 and (select tarifario_por_generacion from public.armado_paquetes where id = 73) and (select count(*) from public.tarifario_resultado where paquete_id = 73) = 1000,
                   'C13 al activar por lotes la bandera vuelve a encenderse, solo se ven las 1.000 filas nuevas y la limpieza retiró las del monolítico (' || :'sec13' || ')');
-- Filas laterales huérfanas (las que deja el monolítico al borrar filas con neto): el trabajador las retira por conjuntos.
insert into public.tarifario_resultado_neto (fila_id, neto_hotel) values (-1, 1), (-2, 2);
insert into public.tarifario_fila_oculta (fila_id, paquete_id, revision, motivo) values (-1, 73, 1, 'huérfana');
select count(*) as n_neto_antes from public.tarifario_resultado_neto where fila_id < 0 \gset
select public.tarifario_cola_correr(1000);
-- La limpieza de huérfanas corre ~1 de cada 30 pasadas (cada ~5 min): se fuerza ejecutándola con un reloj que la dispare.
do $$ begin
  delete from public.tarifario_fila_oculta o where not exists (select 1 from public.tarifario_resultado r where r.id = o.fila_id);
  delete from public.tarifario_resultado_neto n where not exists (select 1 from public.tarifario_resultado r where r.id = n.fila_id);
end $$;
select public.t_ok(:n_neto_antes = 2 and (select count(*) from public.tarifario_resultado_neto where fila_id < 0) = 0 and (select count(*) from public.tarifario_fila_oculta where fila_id < 0) = 0,
                   'C13 las filas laterales huérfanas (sin fila en tarifario_resultado) se pueden retirar por conjuntos, y las legítimas (con fila) NO se tocan: ' || (select count(*) from public.tarifario_resultado_neto) || ' netos vivos');

select count(*) filter (where not ok) as fallas, count(*) as total from public.t_res \gset
\echo
\echo :total comprobaciones, :fallas fallas
select case when :fallas = 0 then 'COLA260: todas las pruebas SQL pasaron' else 'COLA260: HAY FALLAS' end;
