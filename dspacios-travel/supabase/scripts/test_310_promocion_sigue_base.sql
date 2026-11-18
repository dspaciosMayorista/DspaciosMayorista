-- Pruebas de la 310 (#125) contra una base DESECHABLE con la 300/301 aplicadas y la 310 ya corrida. Termina en ROLLBACK: no deja nada.
-- Uso: ver test_310_promocion_sigue_base.sh (clona la plantilla, corre preflight → 310 → postcheck → estas pruebas → rollback_310 → postcheck de reversa).
begin;
create temp table _res (n int, nombre text, ok boolean, detalle text) on commit drop;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return 'OK';
exception when others then return sqlstate || '|' || sqlerrm; end $f$;
create or replace function pg_temp.reg(p_n int, p_nombre text, p_ok boolean, p_det text default null) returns void language sql as $f$
  insert into _res values (p_n, p_nombre, coalesce(p_ok, false), p_det) $f$;

-- Usuario interno de prueba (superadmin) para el candado de rol de la RPC (`mi_rol()` lee `auth.uid()` de los claims).
insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000031001', 't310@test.local') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo) values ('00000000-0000-4000-8000-000000031001', 't310@test.local', 'T310', 'superadmin', true) on conflict do nothing;
update public.usuarios set rol = 'superadmin', activo = true where id = '00000000-0000-4000-8000-000000031001'; -- un trigger de auth.users ya pudo crearlo con otro rol
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000031001","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000031001', true);

do $$
declare
  v_dest bigint; v_h bigint; v_a bigint; v_b bigint; v_b2 bigint; v_p bigint; v_q bigint; v_pm bigint; v_o bigint;
  r text; j jsonb;
begin
  insert into destinos (nombre) values ('T310') returning id into v_dest;
  insert into hoteles (destino_id, nombre) values (v_dest, 'Hotel 310') returning id into v_h;
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad) values (v_h, 'BASE A', '2026-12-01', '2026-12-05', 1) returning id into v_a;
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad) values (v_h, 'BASE B', '2026-12-06', '2026-12-12', 1) returning id into v_b;
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
    values (v_h, 'PRE BF', '2026-12-04', '2026-12-08', 5, 'descuento_pct', 10) returning id into v_p;
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, descuento_unidad)
    values (v_h, 'MONTO', '2026-12-04', '2026-12-08', 6, 'descuento_monto', 5000, 'persona_noche') returning id into v_pm;

  perform pg_temp.reg(1, 'columnas nuevas con default false/NULL en filas existentes',
    (select not promo_sigue_base and not nino_gratis and nino_gratis_edad_min is null and nino_gratis_edad_max is null from hotel_temporadas where id = v_p));

  -- 2 modo nuevo cruzando A→B: se guarda, una regla sin grupo, vínculo nulo
  j := promocion_guardar_reglas(v_p, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
         '{"base":null,"reglas":[]}'::jsonb, true, false, null, null);
  perform pg_temp.reg(2, 'seguir-base cruzando dos bases: guarda',
    (select promo_sigue_base and promo_base_id is null from hotel_temporadas where id = v_p)
    and (select count(*) = 1 and bool_and(grupo_id is null) from hotel_promocion_reglas where promocion_id = v_p), j::text);

  -- 3 modo nuevo + base explícita → 22023
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, %s, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true)$q$, v_p, v_a));
  perform pg_temp.reg(3, 'seguir-base con base explícita se rechaza', r like '22023|%', r);

  -- 4 más de una regla o con grupo → 22023
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null},{"grupo_id":null,"valor":5,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true)$q$, v_p));
  perform pg_temp.reg(4, 'seguir-base exige UNA sola regla', r like '22023|%', r);

  -- 5 foto vieja (sin los campos nuevos mientras la promo ya está en modo nuevo) → PT409
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true)$q$, v_p));
  perform pg_temp.reg(5, 'foto vieja (llamador de 4 parámetros) → PT409, no escribe', r like 'PT409|%', r);

  -- 6 niño gratis con edades válidas
  j := promocion_guardar_reglas(v_p, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
         '{"base":null,"sigue_base":true,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true, true, 3::smallint, 12::smallint);
  perform pg_temp.reg(6, 'niño gratis con edad propia 3–12 guarda',
    (select nino_gratis and nino_gratis_edad_min = 3 and nino_gratis_edad_max = 12 from hotel_temporadas where id = v_p), j::text);

  -- 7 solo una edad / min>max / fuera de rango / sin activar
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"nino_gratis":true,"nino_edad_min":3,"nino_edad_max":12,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true, true, 3::smallint, null)$q$, v_p));
  perform pg_temp.reg(7, 'una sola edad se rechaza', r like '22023|%', r);
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"nino_gratis":true,"nino_edad_min":3,"nino_edad_max":12,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true, true, 12::smallint, 3::smallint)$q$, v_p));
  perform pg_temp.reg(8, 'mínimo mayor que máximo lo rechaza la restricción', r like '23514|%', r);
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"nino_gratis":true,"nino_edad_min":3,"nino_edad_max":12,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true, true, 3::smallint, 18::smallint)$q$, v_p));
  perform pg_temp.reg(9, 'edad fuera de 0–17 se rechaza', r like '23514|%', r);
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"nino_gratis":true,"nino_edad_min":3,"nino_edad_max":12,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true, false, 3::smallint, 12::smallint)$q$, v_p));
  perform pg_temp.reg(10, 'edad sin niño gratis activo se rechaza', r like '22023|%', r);

  -- 11 niño gratis en una promoción de monto → 23514
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, %s, '[{"grupo_id":null,"valor":1000,"dias":null}]'::jsonb, '{"base":null,"reglas":[]}'::jsonb, false, true)$q$, v_pm, v_a));
  perform pg_temp.reg(11, 'niño gratis solo con porcentaje', r like '23514|%', r);

  -- 12 empate de bases (B2 prioridad 1 cubre 4–5 como A) → no guarda el modo
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad) values (v_h, 'BASE B2', '2026-12-04', '2026-12-05', 1) returning id into v_b2;
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"nino_gratis":true,"nino_edad_min":3,"nino_edad_max":12,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true, true, 3::smallint, 12::smallint)$q$, v_p));
  perform pg_temp.reg(12, 'empate genuino de bases la misma noche se rechaza (empatan)', r like '23514|%empatan%', r);
  delete from hotel_temporadas where id = v_b2;

  -- 13 promoción con prioridad ≤ base → se rechaza (estaba en 5; se prueba con otra de prioridad 1)
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
    values (v_h, 'BAJA PRIO', '2026-12-01', '2026-12-12', 1, 'descuento_pct', 10) returning id into v_q;
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb, '{"base":null,"reglas":[]}'::jsonb, true)$q$, v_q));
  perform pg_temp.reg(13, 'prioridad no mayor que la base se rechaza', r like '23514|%prioridad%', r);

  -- 14 noche sin ninguna base → se rechaza
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
    values (v_h, 'SIN BASE', '2026-12-20', '2026-12-22', 7, 'descuento_pct', 10) returning id into v_o;
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb, '{"base":null,"reglas":[]}'::jsonb, true)$q$, v_o));
  perform pg_temp.reg(14, 'noche sin base se rechaza', r like '23514|%ninguna temporada base%', r);
  delete from hotel_temporadas where id in (v_q, v_o);

  -- 15 fila guardada con el nombre de la promoción → se rechaza al pasar al modo nuevo
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
    values (v_h, 'CON FILA', '2026-12-04', '2026-12-05', 8, 'descuento_pct', 10) returning id into v_o;
  insert into tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_doble) values (v_h, 'Estandar', 'PAM', 'CON FILA', 90000);
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb, '{"base":null,"reglas":[]}'::jsonb, true)$q$, v_o));
  perform pg_temp.reg(15, 'promoción con filas guardadas no pasa al modo nuevo', r like '23514|%tarifas guardadas%', r);
  delete from tarifa_hotel where temporada = 'CON FILA';
  delete from hotel_temporadas where id = v_o;

  -- 16 otra promoción de la misma prioridad que se cruza → se rechaza
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
    values (v_h, 'GEMELA', '2026-12-05', '2026-12-06', 5, 'descuento_pct', 8) returning id into v_o;
  r := pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
      '{"base":null,"sigue_base":true,"nino_gratis":true,"nino_edad_min":3,"nino_edad_max":12,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, true, true, 3::smallint, 12::smallint)$q$, v_p));
  perform pg_temp.reg(16, 'promoción de igual prioridad que se cruza se rechaza', r like '23514|%misma prioridad%', r);
  delete from hotel_temporadas where id = v_o;

  -- 17 compatibilidad: una promoción VINCULADA con la firma de 4 parámetros (llamada por nombre) sigue funcionando y no activa el modo nuevo
  insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
    values (v_h, 'VINC', '2026-12-01', '2026-12-03', 9, 'descuento_pct', 10) returning id into v_o;
  j := promocion_guardar_reglas(p_promocion_id => v_o, p_base_id => v_a, p_reglas => '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb, p_previas => '{"base":null,"reglas":[]}'::jsonb);
  perform pg_temp.reg(17, 'vinculada con llamada de 4 parámetros: igual que antes (modo nuevo apagado)',
    (select promo_base_id = v_a and not promo_sigue_base and not nino_gratis from hotel_temporadas where id = v_o), j::text);

  -- 18 niño gratis también en una vinculada (edición explícita) y el desvinculado lo apaga
  j := promocion_guardar_reglas(v_o, v_a, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb,
         jsonb_build_object('base', v_a, 'reglas', jsonb_build_array(jsonb_build_object('grupo_id', null, 'valor', 10, 'dias', null))), false, true, null, null);
  perform pg_temp.reg(18, 'niño gratis en promoción vinculada sin edad propia (regla del hotel)',
    (select nino_gratis and nino_gratis_edad_min is null and promo_base_id = v_a from hotel_temporadas where id = v_o), j::text);
  j := promocion_guardar_reglas(v_o, null, '[]'::jsonb,
         jsonb_build_object('base', v_a, 'nino_gratis', true, 'reglas', jsonb_build_array(jsonb_build_object('grupo_id', null, 'valor', 10, 'dias', null))), false, false, null, null);
  perform pg_temp.reg(19, 'quitar reglas y desvincular apaga el niño gratis',
    (select promo_base_id is null and not nino_gratis and not promo_sigue_base from hotel_temporadas where id = v_o) and not exists (select 1 from hotel_promocion_reglas where promocion_id = v_o));

  -- 20 CHECK directo: seguir-base con vínculo, o niño gratis sin reglas
  r := pg_temp.err(format('update hotel_temporadas set promo_sigue_base = true, promo_base_id = %s where id = %s', v_a, v_p));
  perform pg_temp.reg(20, 'restricción: seguir-base excluye el vínculo', r like '23514|%', r);
  r := pg_temp.err(format('update hotel_temporadas set nino_gratis = true where id = %s', v_o));
  perform pg_temp.reg(21, 'restricción: niño gratis exige reglas', r like '23514|%', r);

  -- 22 la regla de una promoción en modo nuevo no admite grupo
  r := pg_temp.err(format($q$insert into hotel_promocion_reglas (promocion_id, grupo_id, valor) values (%s, gen_random_uuid(), 5)$q$, v_p));
  perform pg_temp.reg(22, 'regla con grupo en modo seguir-base se rechaza', r like '%|%', r);

  -- 23 desvincular una promoción en modo nuevo la deja como antes (sin reglas ni modo)
  j := promocion_guardar_reglas(v_p, null, '[]'::jsonb,
         '{"base":null,"sigue_base":true,"nino_gratis":true,"nino_edad_min":3,"nino_edad_max":12,"reglas":[{"grupo_id":null,"valor":10,"dias":null}]}'::jsonb, false, false, null, null);
  perform pg_temp.reg(23, 'desvincular una promoción seguir-base',
    (select not promo_sigue_base and not nino_gratis and nino_gratis_edad_min is null from hotel_temporadas where id = v_p)
    and not exists (select 1 from hotel_promocion_reglas where promocion_id = v_p));
end $$;

-- ── F5 (auditoría Codex): validación POR RÉGIMEN ─────────────────────────────────────────────────────────────
do $$
declare
  v_h bigint; r text; v_p bigint;
  -- crea una vigencia y devuelve su id
  nueva_base text := $f$insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, regimen_restringido) values (%s, %L, %L, %L, %s, %L) returning id$f$;
  nueva_promo text := $f$insert into hotel_temporadas (hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, regimen_restringido) values (%s, %L, %L, %L, %s, 'descuento_pct', 10, %L) returning id$f$;
  v_id bigint;
begin
  insert into hoteles (destino_id, nombre) select id, 'Hotel F5' from destinos where nombre = 'T310' limit 1 returning id into v_h;
  -- sigue(id): intenta pasar la promoción al modo seguir-base con la RPC real (foto de una promoción nueva)
  create or replace function pg_temp.sigue(p_id bigint) returns text language plpgsql as $f$
  begin return pg_temp.err(format($q$select promocion_guardar_reglas(%s, null, '[{"grupo_id":null,"valor":10,"dias":null}]'::jsonb, '{"base":null,"reglas":[]}'::jsonb, true)$q$, p_id)); end $f$;

  -- 24 bases PAM y FULL de igual prioridad y mismas fechas NO compiten; promoción sin restricción → guarda (antes: falso empate)
  execute format(nueva_base, v_h, 'F5 BASE PAM', '2026-12-01', '2026-12-05', 1, 'PAM') into v_id;
  execute format(nueva_base, v_h, 'F5 BASE FULL', '2026-12-01', '2026-12-05', 1, 'FULL') into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO TODOS', '2026-12-02', '2026-12-04', 5, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(24, 'F5: bases PAM y FULL de igual prioridad no se empatan entre sí', r = 'OK', r);

  -- 25 base SIN restricción: aplica a todos los regímenes (promoción sin restricción y con restricción a PAM guardan)
  execute format(nueva_base, v_h, 'F5 BASE UNR', '2027-02-01', '2027-02-05', 1, null) into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO UNR', '2027-02-02', '2027-02-04', 5, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(25, 'F5: una base sin restricción cubre la promoción en todos los regímenes', r = 'OK', r);

  -- 26 empate GENUINO dentro de un régimen: dos bases PAM de igual prioridad que se cruzan → se rechaza y nombra el régimen
  execute format(nueva_base, v_h, 'F5 PAM-A', '2027-03-01', '2027-03-05', 1, 'PAM') into v_id;
  execute format(nueva_base, v_h, 'F5 PAM-B', '2027-03-03', '2027-03-08', 1, 'PAM') into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO PAMPAM', '2027-03-04', '2027-03-04', 5, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(26, 'F5: empate genuino dentro de PAM se rechaza y dice el régimen', r like '23514|%empatan%PAM-A, F5 PAM-B% en el régimen PAM%', r);

  -- 27 empate de una base SIN restricción con una base PAM (misma prioridad): empatan en PAM (no en FULL) → se rechaza, régimen PAM
  execute format(nueva_base, v_h, 'F5 U2', '2027-05-01', '2027-05-05', 1, null) into v_id;
  execute format(nueva_base, v_h, 'F5 P2', '2027-05-01', '2027-05-05', 1, 'PAM') into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO UP', '2027-05-02', '2027-05-03', 5, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(27, 'F5: base sin restricción vs base PAM de igual prioridad: empate solo en PAM', r like '23514|%empatan%en el régimen PAM%', r);
  -- …y la misma promoción restringida a FULL (sin base FULL: solo la sin restricción) NO tiene ese empate
  execute format(nueva_promo, v_h, 'F5 PROMO UP FULL', '2027-05-02', '2027-05-03', 6, 'FULL') into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(28, 'F5: restringida a FULL no hereda el empate que solo existe en PAM', r = 'OK', r);

  -- 29 prioridades distintas por régimen: PAM p1, FULL p2, promoción sin restricción p3 → guarda
  execute format(nueva_base, v_h, 'F5 PAM p1', '2027-06-01', '2027-06-05', 1, 'PAM') into v_id;
  execute format(nueva_base, v_h, 'F5 FULL p2', '2027-06-01', '2027-06-05', 2, 'FULL') into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO P3', '2027-06-02', '2027-06-04', 3, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(29, 'F5: prioridades distintas por régimen (1 y 2) con promoción de prioridad 3: guarda', r = 'OK', r);

  -- 30 promoción p3 sin restricción con PAM p1 y FULL p4 → rechaza por FULL (régimen nombrado); 31 restringida a PAM → guarda
  execute format(nueva_base, v_h, 'F5 PAM q1', '2027-07-01', '2027-07-05', 1, 'PAM') into v_id;
  execute format(nueva_base, v_h, 'F5 FULL q4', '2027-07-01', '2027-07-05', 4, 'FULL') into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO TODOS3', '2027-07-02', '2027-07-04', 3, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(30, 'F5: p3 sin restricción: la base FULL de prioridad 4 la bloquea (régimen FULL)', r like '23514|%mayor prioridad%F5 FULL q4%en el régimen FULL%', r);
  delete from hotel_temporadas where id = v_p; -- la promoción rechazada sigue existiendo y chocaría por igual prioridad: se retira para probar la restringida
  execute format(nueva_promo, v_h, 'F5 PROMO SOLO PAM', '2027-07-02', '2027-07-04', 3, 'PAM') into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(31, 'F5: p3 restringida a PAM ignora la base FULL de prioridad 4 y guarda', r = 'OK', r);

  -- 32 promoción restringida a PAM ignora un empate que solo existe en FULL
  execute format(nueva_base, v_h, 'F5 FULL-A', '2027-08-01', '2027-08-05', 1, 'FULL') into v_id;
  execute format(nueva_base, v_h, 'F5 FULL-B', '2027-08-01', '2027-08-05', 1, 'FULL') into v_id;
  execute format(nueva_base, v_h, 'F5 PAM solo', '2027-08-01', '2027-08-05', 1, 'PAM') into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO PAM8', '2027-08-02', '2027-08-04', 5, 'PAM') into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(32, 'F5: restringida a PAM ignora un empate que solo existe en FULL', r = 'OK', r);
  -- …y sin restricción ese mismo empate FULL sí cuenta
  execute format(nueva_promo, v_h, 'F5 PROMO TODOS8', '2027-08-02', '2027-08-04', 6, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(33, 'F5: sin restricción el empate genuino de FULL sí se rechaza y nombra FULL', r like '23514|%empatan%en el régimen FULL%', r);

  -- 34 noche solo cubierta por una base FULL: promoción sin restricción guarda; restringida a PAM se rechaza por «ninguna temporada base»
  execute format(nueva_base, v_h, 'F5 SOLO FULL', '2027-09-01', '2027-09-05', 1, 'FULL') into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO F9', '2027-09-02', '2027-09-04', 5, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(34, 'F5: noche cubierta solo por una base FULL: promoción sin restricción guarda', r = 'OK', r);
  execute format(nueva_promo, v_h, 'F5 PROMO P9', '2027-09-02', '2027-09-04', 6, 'PAM') into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(35, 'F5: restringida a PAM sobre una noche sin base PAM ni sin restricción: sin base', r like '23514|%ninguna temporada base%', r);

  -- 36 promociones restringidas a regímenes distintos con igual prioridad y fechas que se cruzan NO chocan; una sin restricción sí
  execute format(nueva_base, v_h, 'F5 BASE 10', '2027-10-01', '2027-10-10', 1, null) into v_id;
  execute format(nueva_promo, v_h, 'F5 PROMO PAM10', '2027-10-02', '2027-10-05', 5, 'PAM') into v_p;
  r := pg_temp.sigue(v_p);
  execute format(nueva_promo, v_h, 'F5 PROMO FULL10', '2027-10-03', '2027-10-06', 5, 'FULL') into v_p;
  r := r || ' / ' || pg_temp.sigue(v_p);
  perform pg_temp.reg(36, 'F5: promociones PAM y FULL de igual prioridad que se cruzan no chocan entre sí', r = 'OK / OK', r);
  execute format(nueva_promo, v_h, 'F5 PROMO ALL10', '2027-10-04', '2027-10-05', 5, null) into v_p;
  r := pg_temp.sigue(v_p);
  perform pg_temp.reg(37, 'F5: una promoción sin restricción de igual prioridad sí choca con la PAM (misma prioridad)', r like '23514|%misma prioridad%', r);
end $$;

select n, case when ok then 'OK' else 'FALLA' end as estado, nombre, left(coalesce(detalle, ''), 140) as detalle from _res order by n;
select case when count(*) filter (where not ok) = 0 then 'TODAS OK (' || count(*) || ')' else count(*) filter (where not ok) || ' FALLAS' end as veredicto from _res;
rollback;
