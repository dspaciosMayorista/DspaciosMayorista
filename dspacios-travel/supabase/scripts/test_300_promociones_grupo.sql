-- Pruebas de la 300 (base local desechable: cadena de la 299 + 299 + fixture_299 + 300). Cada aserción imprime
-- «OK …» o aborta con «FALLO …». La corre test_300_promociones_grupo.sh.
-- Datos (fixtures 293/297/299): hotel 9301, ALTA 930101 (prioridad 1) con grupos Semana c0001 [L–J] y Fin de semana
-- c0002 [V–D]; hotel 9304 sin grupos, ALTA 930401. Promociones de esta prueba: 9301xx/9304xx con ids 93011x/93041x.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t300;
grant usage on schema t300 to public;
create or replace function t300.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FALLO %', m; end if; raise notice 'OK    %', m; end $$;
create or replace function t300.pasa(sql text, m text) returns void language plpgsql as $$
begin execute sql; set constraints all immediate; set constraints all deferred; raise notice 'OK    %', m;
exception when others then raise exception 'FALLO % — [%] %', m, sqlstate, sqlerrm; end $$;
create or replace function t300.estado() returns text language sql security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(r)::text, E'\n' order by r.id), '') from public.hotel_promocion_reglas r),
    (select coalesce(string_agg(to_jsonb(g)::text, E'\n' order by g.id), '') from public.hotel_temporada_grupos g),
    (select coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '') from public.hotel_temporadas t)))
$$;
create or replace function t300.atomico(sql text, patron text, m text) returns void language plpgsql as $$
declare v_antes text := t300.estado();
begin
  begin execute sql; set constraints all immediate; set constraints all deferred;
  exception when others then
    if not (sqlerrm ~* patron or sqlstate ~* patron) then raise exception 'FALLO % — error distinto [%]: %', m, sqlstate, sqlerrm; end if;
    if t300.estado() <> v_antes then raise exception 'FALLO % — rechazado pero cambió algo', m; end if;
    raise notice 'OK    % (rechazado [%]: %; nada cambió)', m, sqlstate, left(sqlerrm, 160); return;
  end;
  raise exception 'FALLO % — no se rechazó', m;
end $$;
create or replace function t300.n(sql text) returns bigint language plpgsql security definer set search_path = public as $$
declare r bigint; begin execute sql into r; return r; end $$;
grant execute on all functions in schema t300 to public;

-- Promociones de prueba (como dueño: el alta de vigencias no es lo que se prueba aquí).
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, promo_base_id) values
  (930110, 9301, 'PROMO SEMANA', '2027-01-01', '2027-01-31', 2, 'descuento_pct', 930101);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_unidad, promo_base_id) values
  (930111, 9301, 'PROMO MONTO', '2027-01-01', '2027-01-31', 3, 'descuento_monto', 'habitacion_noche', 930101),
  (930410, 9304, 'PROMO 9304',  '2027-01-01', '2027-01-31', 2, 'descuento_monto', 'persona_noche', 930401);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, noche_gratis_regla, dias_promo, min_noches) values
  (930112, 9301, 'GRATIS', '2027-01-01', '2027-01-31', 4, 'promo_noche_gratis', 'mas_barata', array[1,2,3,4], 3);
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, descuento_unidad, dias_promo) values
  (930113, 9301, 'ESTADIA', '2027-01-01', '2027-01-31', 5, 'descuento_monto', 20000, 'persona_estadia', array[1,2,3]);

-- Operaciones Mayorista (escribe catálogo).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;

-- ── A. Guardar reglas (RPC, una transacción) ───────────────────────────────────────────
select t300.pasa($q$select public.promocion_guardar_reglas(930110, 930101,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":10,"dias":[1,2,3]},{"grupo_id":"00000000-0000-4000-8000-0000000c0002","valor":5,"dias":null}]',
  '{"base":930101,"reglas":[]}')$q$, 'A1 guardar −10 % lun–mié (Semana) y −5 % todo el Fin de semana');
select t300.ok(t300.n('select count(*) from public.hotel_promocion_reglas where promocion_id = 930110') = 2, 'A2 quedaron 2 reglas');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930101, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":20,"dias":null}]',
  '{"base":930101,"reglas":[]}')$q$, 'PT409|recarga', 'A3 foto desactualizada ⇒ PT409, nada cambia');
select t300.pasa($q$select public.promocion_guardar_reglas(930110, 930101, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","valor":5.00,"dias":null},{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":10,"dias":[1,2,3]}]}')$q$,
  'A4 la foto se compara sin importar orden ni forma numérica; reemplaza todo');
select t300.ok(t300.n('select count(*) from public.hotel_promocion_reglas where promocion_id = 930110') = 1, 'A5 reemplazo exacto (1 regla)');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930101, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":10,"dias":[4,5]}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]}')$q$,
  'pertenecer al grupo', 'A6 viernes en la regla de Semana ⇒ rechazado al guardar (Y.4.3)');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930101, '[{"grupo_id":null,"valor":10,"dias":null}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]}')$q$,
  'indicar su grupo', 'A7 regla sin grupo en una base con grupos');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930101, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0003","valor":10,"dias":null}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]}')$q$,
  'no es de su base', 'A8 grupo de otra vigencia');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930101, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":100,"dias":null}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]}')$q$,
  'menor que 100', 'A9 porcentaje de 100');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930101, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":10,"dias":[]}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]}')$q$,
  'hotel_promocion_reglas_dias|check', 'A10 «elegir días» sin días (selección vacía sin significado)');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930101, '[]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]}')$q$,
  'al menos una regla', 'A11 vínculo sin reglas');
select t300.atomico($q$select public.promocion_guardar_reglas(930110, 930102, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":10,"dias":null}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":12,"dias":[1,2,3]}]}')$q$,
  'no es de su base|mayor prioridad', 'A12 cambiar a otra base conservando un grupo de la anterior');
select t300.pasa($q$select public.promocion_guardar_reglas(930111, 930101, '[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","valor":20000,"dias":[6]}]',
  '{"base":930101,"reglas":[]}')$q$, 'A13 monto por habitación/noche solo el sábado');
select t300.pasa($q$select public.promocion_guardar_reglas(930410, 930401, '[{"grupo_id":null,"valor":20000,"dias":[1,2,3]}]',
  '{"base":930401,"reglas":[]}')$q$, 'A14 base sin grupos: una regla sin grupo, días lun–mié');

-- ── B. Vínculo y prioridades (trigger de vigencias) ────────────────────────────────────
select t300.atomico('update public.hotel_temporadas set prioridad = 1 where id = 930110', 'mayor prioridad', 'B1 promoción con prioridad igual a su base');
-- Igual prioridad entre promociones de la misma base: solo es conflicto si PUEDEN coincidir (S.1).
-- PROMO SEMANA (930110, %): Semana L–X; PROMO MONTO (930111, por habitación, prioridad 3): Fin de semana, solo sábado.
select t300.pasa('update public.hotel_temporadas set prioridad = 3 where id = 930110', 'B2 igual prioridad SIN días en común (L–X frente a sábado): se acepta');
select t300.ok(t300.n('select jsonb_array_length(public._promo_300_conflictos(930101))') = 0, 'B2b la revisión no informa conflicto');
select t300.atomico($q$select public.promocion_guardar_reglas(930111, 930101,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":20000,"dias":[3]},{"grupo_id":"00000000-0000-4000-8000-0000000c0002","valor":20000,"dias":[6]}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","valor":20000,"dias":[6]}]}')$q$,
  'CONFLICTO_PROMOCIONES.*misma prioridad.*grupo Semana', 'B2c con el miércoles en común: conflicto real, se bloquea nombrando ambas y la noche (sin elegir ninguna)');
update public.hotel_temporadas set compra_inicio = '2026-12-01', compra_fin = '2026-12-15' where id = 930110;
update public.hotel_temporadas set compra_inicio = '2026-12-16', compra_fin = '2026-12-31' where id = 930111;
select t300.pasa($q$select public.promocion_guardar_reglas(930111, 930101,
  '[{"grupo_id":"00000000-0000-4000-8000-0000000c0001","valor":20000,"dias":[3]},{"grupo_id":"00000000-0000-4000-8000-0000000c0002","valor":20000,"dias":[6]}]',
  '{"base":930101,"reglas":[{"grupo_id":"00000000-0000-4000-8000-0000000c0002","valor":20000,"dias":[6]}]}')$q$,
  'B2d mismos días pero ventanas de COMPRA que no se cruzan (1–15 y 16–31 dic): se acepta');
select t300.atomico('update public.hotel_temporadas set compra_inicio = null, compra_fin = null where id = 930110', 'CONFLICTO_PROMOCIONES',
  'B2e abrir la compra de una vuelve a cruzar las ventanas: conflicto');
update public.hotel_temporadas set regimen_restringido = 'PAM' where id = 930111;
select t300.pasa('update public.hotel_temporadas set compra_inicio = null, compra_fin = null, regimen_restringido = ''PC'' where id = 930110', 'B2f RÉGIMEN distinto (PC frente a PAM): no pueden coincidir, se acepta');
select t300.atomico('update public.hotel_temporadas set regimen_restringido = null where id = 930110', 'CONFLICTO_PROMOCIONES', 'B2g régimen libre frente a PAM: pueden coincidir, conflicto');
update public.hotel_temporadas set fecha_inicio = '2027-01-16', fecha_fin = '2027-01-31' where id = 930111;
select t300.pasa('update public.hotel_temporadas set fecha_inicio = ''2027-01-01'', fecha_fin = ''2027-01-15'', regimen_restringido = null where id = 930110', 'B2h FECHAS de viaje que no se cruzan (1–15 y 16–31 ene): se acepta aunque coincidan régimen, compra y días');
select t300.atomico('update public.hotel_temporadas set fecha_fin = ''2027-01-20'' where id = 930110', 'CONFLICTO_PROMOCIONES.*2027-01-20', 'B2i ampliar las fechas hasta cruzarse en un miércoles (20 ene): conflicto con la noche exacta');
select t300.ok(t300.n($q$select count(*) from public.hotel_temporadas where id in (930110, 930111) and prioridad = 3$q$) = 2, 'B2j las dos siguen con prioridad 3 (nada se eligió en silencio)');
select t300.atomico('update public.hotel_temporadas set fecha_fin = ''2027-01-31'' where id = 930110', 'CONFLICTO_PROMOCIONES',
  'B2k ACOMODACIÓN: un % y un monto por habitación aplican los dos a las habitaciones ⇒ la acomodación no los separa: conflicto');
update public.hotel_temporadas set prioridad = 2 where id = 930110;
update public.hotel_temporadas set fecha_fin = '2031-12-31' where id = 930101;
update public.hotel_temporadas set fecha_inicio = '2027-01-01', fecha_fin = '2031-12-31', compra_inicio = null, compra_fin = null, regimen_restringido = null where id = 930111;
select t300.atomico('update public.hotel_temporadas set prioridad = 3, fecha_fin = ''2031-12-31'' where id = 930110', 'No se puede verificar', 'B2l cruce de más de 1.096 noches: «no verificable» y bloquea');
update public.hotel_temporadas set fecha_fin = '2027-01-31' where id = 930111;
update public.hotel_temporadas set fecha_fin = '2027-01-31' where id = 930101;
select t300.ok(t300.n('select jsonb_array_length(public._promo_300_conflictos(930101))') = 0, 'B2m estado final sin conflictos');
select t300.atomico('update public.hotel_temporadas set prioridad = 2 where id = 930101', 'base de la promoción', 'B3 subir la base al nivel de su promoción');
select t300.atomico('update public.hotel_temporadas set tipo = ''descuento_pct'' where id = 930101', 'base de la promoción|hotel_temporadas_promo_300', 'B4 la base deja de ser de tarifa');
select t300.atomico('update public.hotel_temporadas set promo_base_id = 930301 where id = 930110', 'mismo hotel', 'B5 base de otro hotel');
select t300.atomico('update public.hotel_temporadas set promo_base_id = null where id = 930110', 'quítalas', 'B6 desvincular con reglas fuera del editor');
select t300.atomico('update public.hotel_temporadas set descuento_unidad = ''persona_noche'' where id = 930110', 'hotel_temporadas_promo_300', 'B7 unidad en una promoción de porcentaje');
select t300.atomico('update public.hotel_temporadas set noche_gratis_regla = ''primera'' where id = 930112', 'hotel_temporadas_promo_300', 'B8 «primera noche» no es una regla (P.1.2)');
select t300.atomico('update public.hotel_temporadas set dias_promo = array[1] where id = 930110', 'hotel_temporadas_promo_300', 'B9 días de estadía en una promoción por noche');
select t300.atomico('update public.hotel_temporadas set tipo = ''tarifa'' where id = 930110', 'hotel_temporadas_promo_300', 'B9b una vigencia de tarifa no se vincula a una base');
select t300.atomico('update public.hotel_temporadas set promo_base_id = 930101 where id = 930113', 'hotel_temporadas_promo_300', 'B10 persona/estadía no se vincula a una base');
select t300.atomico('update public.hotel_temporadas set dias_promo = array[]::smallint[] where id = 930112', 'hotel_temporadas_promo_300', 'B11 días vacíos (sin significado implícito)');

-- ── C. Grupos con reglas ──────────────────────────────────────────────────────────────
reset role;
select t300.atomico($q$delete from public.hotel_temporada_grupos where id = '00000000-0000-4000-8000-0000000c0002'$q$,
  'antes de borrarlo', 'C1 borrar un grupo con reglas (las promociones se resuelven primero, V.3)');
select t300.atomico($q$update public.hotel_temporada_grupos set dias = array[1,2] where id = '00000000-0000-4000-8000-0000000c0001'$q$,
  'dejarían de ser del grupo', 'C2 achicar los días del grupo por debajo de una regla');
select t300.pasa($q$update public.hotel_temporada_grupos set dias = array[1,2,3] where id = '00000000-0000-4000-8000-0000000c0001'$q$,
  'C3 achicar sin romper la regla (lun–mié sigue dentro)');
update public.hotel_temporada_grupos set dias = array[1,2,3,4] where id = '00000000-0000-4000-8000-0000000c0001';
select t300.atomico($q$insert into public.hotel_temporada_grupos (temporada_id, nombre, dias) values (930401, 'Semana', array[1,2,3,4])$q$,
  'regla para todos los días', 'C4 dividir en grupos una base con una regla de todos los días');
select t300.atomico('delete from public.hotel_temporadas where id = 930401', 'hotel_temporadas_promo_base_id_fkey', 'C5 borrar la base de una promoción (FK del vínculo)');

-- ── D. Permisos ───────────────────────────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009304","session_id":"00000000-0000-4000-8000-00000000a304","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009304', false);
select t300.ok((select count(*) from public.hotel_promocion_reglas) = 0, 'D1 venta no ve las reglas');
select t300.atomico($q$select public.promocion_guardar_reglas(930410, 930401, '[]', '{"base":930401,"reglas":[]}')$q$,
  '42501|permiso|row-level|PT409', 'D2 venta no guarda reglas');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009303","session_id":"00000000-0000-4000-8000-00000000a303","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009303', false);
select t300.atomico($q$select public.promocion_guardar_reglas(930410, 930401, '[{"grupo_id":null,"valor":1,"dias":null}]',
  '{"base":930401,"reglas":[{"grupo_id":null,"valor":20000,"dias":[1,2,3]}]}')$q$, '42501|row-level|permiso', 'D3 sesión Minorista no escribe el catálogo global');
reset role;
set role anon;
select t300.atomico('select count(*) from public.hotel_promocion_reglas', '42501|permission denied', 'D4 anon no lee las reglas');
reset role;

-- ── E. Desvincular y borrar ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;
select t300.pasa($q$select public.promocion_guardar_reglas(930410, null, '[]', '{"base":930401,"reglas":[{"grupo_id":null,"valor":20000,"dias":[1,2,3]}]}')$q$,
  'E1 desvincular desde el editor (vínculo y reglas en una transacción)');
select t300.ok(t300.n('select count(*) from public.hotel_promocion_reglas where promocion_id = 930410') = 0
               and t300.n('select count(*) from public.hotel_temporadas where id = 930410 and promo_base_id is null') = 1, 'E2 sin reglas ni vínculo');
reset role;
delete from public.hotel_temporadas where id = 930111;
select t300.ok(t300.n('select count(*) from public.hotel_promocion_reglas where promocion_id = 930111') = 0, 'E3 borrar la promoción borra sus reglas');
select t300.ok(t300.n($q$select count(*) from public.auditoria where tabla = 'hotel_promocion_reglas'$q$) > 0, 'E4 las reglas quedan en la auditoría');

-- ── F. «Aplicar a la venta» ve las promociones vinculadas y sus reglas; su huella las cubre ───────────────
select t300.ok((select jsonb_path_exists(public._grupos_43_config(930101), '$.promociones_reglas[*] ? (@.nombre == "PROMO SEMANA")')),
  'F1 la configuración de ALTA lista PROMO SEMANA con sus reglas');
select t300.ok((select jsonb_array_length(public._grupos_43_config(930101)->'promociones_reglas'->0->'reglas')) >= 1, 'F2 con sus reglas (grupo, días, valor)');
select t300.ok((select public._grupos_43_config(930101) ? 'promociones_conflictos'), 'F3 y sus conflictos (lista vacía si no hay)');
create temp table t300_h as select public._grupos_43_config(930101)->>'huella' as h;
update public.hotel_promocion_reglas set valor = 11 where promocion_id = 930110;
select t300.ok((select public._grupos_43_config(930101)->>'huella') <> (select h from t300_h), 'F4 cambiar una regla cambia la huella de la vigencia base');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
select t300.atomico($q$select public.grupos_dias_activar(930101, (select h from t300_h), public._grupos_43_habilitaciones(930101))$q$,
  'PT409|CONFIG_DESACTUALIZADA', 'F5 aplicar a la venta con la revisión anterior al cambio de la regla: rechazado (sin consecuencias ocultas)');
