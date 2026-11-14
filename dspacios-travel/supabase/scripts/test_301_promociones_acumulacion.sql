-- Pruebas de la 301 (#43/#60 entrega 5; base local desechable: cadena de la 300 + 300 + datos de abajo + 301). Cada aserción
-- imprime «OK …» o aborta con «FALLO …». La corre test_301_promociones_acumulacion.sh, que crea ANTES de aplicar la 301 el hotel
-- 9305 con la promoción HEREDADA 930510 (EBB 30 vigente) para comprobar la línea base.
-- Fechas en junio de 2027 (las coincidencias dependen de hoy = fecha_negocio(); válidas mientras hoy < 2027-05).
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema if not exists t301;
grant usage on schema t301 to public;
create or replace function t301.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FALLO %', m; end if; raise notice 'OK    %', m; end $$;
create or replace function t301.pasa(sql text, m text) returns void language plpgsql as $$
begin execute sql; set constraints all immediate; set constraints all deferred; raise notice 'OK    %', m;
exception when others then raise exception 'FALLO % — [%] %', m, sqlstate, sqlerrm; end $$;
create or replace function t301.estado() returns text language sql security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(to_jsonb(c)::text, E'\n' order by c.promocion_id), '') from public.hotel_promocion_combinacion c),
    (select coalesce(string_agg(to_jsonb(r)::text, E'\n' order by r.id), '') from public.hotel_reglas_descuento r),
    (select coalesce(string_agg(to_jsonb(t)::text, E'\n' order by t.id), '') from public.hotel_temporadas t),
    (select coalesce(string_agg((to_jsonb(p) - 'propuesto_en')::text, E'\n' order by p.promocion_id), '') from public.hotel_promocion_cambio_pendiente p)))
$$;
create or replace function t301.atomico(sql text, patron text, m text) returns void language plpgsql as $$
declare v_antes text := t301.estado();
begin
  begin execute sql; set constraints all immediate; set constraints all deferred;
  exception when others then
    if not (sqlerrm ~* patron or sqlstate ~* patron) then raise exception 'FALLO % — error distinto [%]: %', m, sqlstate, sqlerrm; end if;
    if t301.estado() <> v_antes then raise exception 'FALLO % — rechazado pero cambió algo', m; end if;
    raise notice 'OK    % (rechazado [%]: %; nada cambió)', m, sqlstate, left(sqlerrm, 170); return;
  end;
  raise exception 'FALLO % — no se rechazó', m;
end $$;
create or replace function t301.n(sql text) returns bigint language plpgsql security definer set search_path = public as $$
declare r bigint; begin execute sql into r; return r; end $$;
create or replace function t301.t(sql text) returns text language plpgsql security definer set search_path = public as $$
declare r text; begin execute sql into r; return r; end $$;
grant execute on all functions in schema t301 to public;

-- ── A. Línea base (sin cambiar nada) ───────────────────────────────────────────────────────
select t301.ok(t301.t('select estado || '':'' || array_to_string(alternativas, '','') from public.hotel_promocion_combinacion where promocion_id = 930510') = 'heredada:ebb',
  'A1 la promoción que ya coincidía con EBB queda HEREDADA (acumula como hoy)');
select t301.ok(t301.n('select count(*) from public.hotel_reglas_descuento where not autorizada or propuesta is not null') = 0, 'A2 todas las reglas existentes quedan autorizadas, sin propuestas');
select t301.ok(t301.n('select count(*) from public.hotel_promocion_combinacion where estado <> ''heredada''') = 0, 'A3 nada configurado ni pendiente al aplicar');
select t301.ok(public._e5_max_noches() = 30, 'A4 estadía máxima 30 noches');

-- ── B. Coincidencias (solo se pregunta cuando pueden coincidir) ─────────────────────────────
select t301.ok(public._e5_requeridas(930510, '[{"tipo":"ebb","umbral":30}]') = array['ebb'], 'B1 EBB 30 días: coincide');
select t301.ok(public._e5_requeridas(930510, '[{"tipo":"ebb","umbral":900}]') = '{}', 'B2 EBB 900 días: imposible desde hoy, no coincide');
select t301.ok(public._e5_requeridas(930510, '[{"tipo":"long_stay","umbral":7}]') = array['long_stay'], 'B3 Long Stay 7 noches: coincide');
select t301.ok(public._e5_requeridas(930510, '[{"tipo":"long_stay","umbral":31}]') = '{}', 'B4 Long Stay 31 noches (> 30): no coincide');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, compra_inicio, compra_fin)
  values (930519, 9305, 'VENCIDA', '2027-06-01', '2027-06-30', 2, 'descuento_pct', 5, '2026-01-01', '2026-02-01');
set constraints all immediate; set constraints all deferred;
select t301.ok(public._e5_requeridas(930519, '[{"tipo":"ebb","umbral":30},{"tipo":"long_stay","umbral":7}]') = '{}', 'B5 compra ya cerrada: no puede coincidir con nada');
select t301.ok(t301.n('select count(*) from public.hotel_promocion_combinacion where promocion_id = 930519') = 0, 'B6 sin coincidencias no se crea fila');

-- Operaciones Mayorista (escribe catálogo).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000009302","session_id":"00000000-0000-4000-8000-00000000a302","role":"authenticated"}', false),
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009302', false);
set role authenticated;

-- ── C. Promoción NUEVA que coincide: queda pendiente (no error); la versión vendida no cambia ──────
select t301.pasa($q$insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor)
  values (930511, 9305, 'NUEVA', '2027-06-01', '2027-06-30', 3, 'descuento_pct', 15)$q$, 'C1 crear una promoción que coincide con EBB se guarda');
select t301.ok(t301.t('select estado || '':'' || array_to_string(alternativas, '','') from public.hotel_promocion_combinacion where promocion_id = 930511') = 'pendiente:ebb',
  'C2 queda PENDIENTE con EBB (el motor no la vende hasta configurarla)');
select t301.atomico($q$select public.promocion_guardar_combinacion(930511, '{"acumulable":{}}')$q$, '22023|acumula', 'C3 sin responder: rechazado, sin valor por defecto');
select t301.pasa($q$select public.promocion_guardar_combinacion(930511, '{"acumulable":{"ebb":true}}')$q$, 'C4 acumula con EBB (una sola regla, sin orden)');
select t301.ok(t301.t('select estado || '':'' || coalesce(acumulable_ebb::text, ''?'') || '':'' || coalesce(array_to_string(orden, '',''), ''-'') from public.hotel_promocion_combinacion where promocion_id = 930511') = 'configurada:true:-',
  'C5 configurada: acumula con EBB, sin orden');

-- ── D. Regla nueva que crea combinaciones sin resolver: RETENIDA; la autorizada sigue vendiéndose ─────
select t301.pasa($q$select public.regla_descuento_guardar(9305, null, 'long_stay', 7, 15, true)$q$, 'D1 agregar Long Stay 7 noches → respuesta sin error');
select t301.ok(t301.n('select count(*) from public.hotel_reglas_descuento where hotel_id = 9305 and tipo = ''long_stay'' and not autorizada') = 1, 'D2 quedó RETENIDA (autorizada = false)');
select t301.ok(t301.t('select (public.regla_descuento_guardar(9305, (select id from public.hotel_reglas_descuento where hotel_id = 9305 and tipo = ''long_stay''), ''long_stay'', 7, 15, true))->>''estado''') = 'retenida',
  'D3 volver a guardarla sin configurar: sigue retenida');
select t301.ok(t301.n('select count(*) from jsonb_array_elements(public._e5_reglas(9305, false)) x where x->>''tipo'' = ''long_stay''') = 0, 'D4 el motor (reglas autorizadas) no la ve');
select t301.atomico($q$select public.regla_descuento_aplicar((select id from public.hotel_reglas_descuento where hotel_id = 9305 and tipo = 'long_stay'))$q$,
  'COMBINACION_SIN_CONFIGURAR', 'D5 aplicarla sin configurar las promociones que coinciden: rechazado');
select t301.atomico($q$insert into public.hotel_reglas_descuento (hotel_id, tipo, umbral, pct, activa) values (9305, 'long_stay', 10, 20, true)$q$,
  'COMBINACION_SIN_CONFIGURAR', 'D6 una escritura DIRECTA (sin la RPC) que crea pares sin resolver: rechazada al confirmar');

-- ── E. Configurar con orden y aplicar ───────────────────────────────────────────────────────────
select t301.atomico($q$select public.promocion_guardar_combinacion(930510, '{"acumulable":{"ebb":false,"long_stay":false},"orden":["ebb","promocion"]}')$q$,
  '22023|Ordena', 'E1 orden incompleto (falta Long Stay): rechazado');
select t301.atomico($q$select public.promocion_guardar_combinacion(930510, '{"acumulable":{"ebb":false,"long_stay":false},"orden":["ebb","ebb","long_stay","promocion"]}')$q$,
  '22023|Ordena', 'E2 orden con repetidos: rechazado');
select t301.pasa($q$select public.promocion_guardar_combinacion(930510, '{"acumulable":{"ebb":true,"long_stay":false},"orden":["ebb","long_stay","promocion"]}')$q$,
  'E3 la HEREDADA se configura (EBB acumula, Long Stay no; orden EBB > Long Stay > promoción)');
select t301.atomico($q$select public.promocion_guardar_combinacion(930511, '{"acumulable":{"ebb":true,"long_stay":true},"orden":["long_stay","promocion","ebb"]}')$q$,
  'CONTRADICCION_PROMOCIONES: «HEREDADA» y «NUEVA» pueden aplicar en una misma estadía y deciden distinto frente a EBB / Long Stay: «HEREDADA» no acumula con larga estadía \(Long Stay\) y «NUEVA» sí\. Ejemplo: una estadía del 01/06/2027 al 02/06/2027 \(1 noche\) incluye noches de las dos\.',
  'E4 otra promoción que coincide con acumulación distinta: CONTRADICCIÓN que nombra las dos, la decisión que difiere y una estadía de ejemplo; nada cambia');
select t301.atomico($q$select public.promocion_guardar_combinacion(930511, '{"acumulable":{"ebb":true,"long_stay":false},"orden":["long_stay","ebb","promocion"]}')$q$,
  'deciden distinto frente a EBB / Long Stay: el orden de aplicación: «HEREDADA» compra anticipada \(EBB\) → larga estadía \(Long Stay\) → promoción; «NUEVA» larga estadía \(Long Stay\) → compra anticipada \(EBB\) → promoción\. Ejemplo:',
  'E4b misma acumulación y orden distinto: el aviso dice el orden de cada una');
select t301.pasa($q$select public.promocion_guardar_combinacion(930511, '{"acumulable":{"ebb":true,"long_stay":false},"orden":["ebb","long_stay","promocion"]}')$q$,
  'E5 la misma configuración en las dos: aceptada');
select t301.ok(t301.t('select (public.regla_descuento_aplicar((select id from public.hotel_reglas_descuento where hotel_id = 9305 and tipo = ''long_stay'')))->>''estado''') = 'aplicada',
  'E6 con todo configurado, la regla retenida se APLICA');
select t301.ok(t301.n('select count(*) from jsonb_array_elements(public._e5_reglas(9305, false)) x where x->>''tipo'' = ''long_stay''') = 1, 'E7 ahora el motor la ve');

-- ── F. Promociones que NO pueden coincidir no se contradicen ──────────────────────────────────────
select t301.pasa($q$insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, regimen_restringido)
  values (930512, 9305, 'SOLO PC', '2027-06-01', '2027-06-30', 4, 'descuento_pct', 8, 'PC')$q$, 'F1 promoción restringida a otro régimen');
update public.hotel_temporadas set regimen_restringido = 'PAM' where id in (930510, 930511);
set constraints all immediate; set constraints all deferred;
select t301.pasa($q$select public.promocion_guardar_combinacion(930512, '{"acumulable":{"ebb":false,"long_stay":true},"orden":["long_stay","ebb","promocion"]}')$q$,
  'F3 régimen distinto (PC vs PAM): otra configuración no contradice');

-- ── G. Editar una promoción que se vende para que coincida con algo nuevo ──────────────────────────
select t301.pasa($q$insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, compra_inicio, compra_fin, regimen_restringido)
  values (930513, 9305, 'CORTA', '2027-06-01', '2027-06-30', 5, 'descuento_pct', 7, '2026-01-01', '2026-02-01', 'SAI')$q$, 'G1 promoción sin compra vigente (no coincide con nada)');
select t301.ok(t301.n('select count(*) from public.hotel_promocion_combinacion where promocion_id = 930513') = 0, 'G2 sin fila');
reset role;
select t301.atomico($q$update public.hotel_temporadas set compra_fin = '2027-05-31' where id = 930513$q$, 'COMBINACION_SIN_CONFIGURAR',
  'G3 abrir su compra (ya existía, no es nueva) crea coincidencias sin configurar: rechazado, la versión vendida no cambia');
set role authenticated;
select t301.pasa($q$select public.promocion_guardar_combinacion(930513, '{"acumulable":{"ebb":false,"long_stay":false},"orden":["promocion","ebb","long_stay"]}', '{"compra_fin":"2027-05-31"}')$q$,
  'G4 el MISMO cambio junto con su combinación, en una transacción: aceptado');
select t301.ok(t301.t('select compra_fin::text from public.hotel_temporadas where id = 930513') = '2027-05-31', 'G5 el cambio quedó guardado');
select t301.atomico($q$select public.promocion_guardar_combinacion(930513, '{"acumulable":{"ebb":true}}', '{"hotel_id":1}')$q$, '22023|no válidos', 'G6 los cambios no pueden mover la promoción de hotel');

-- ── H. Retención de un CAMBIO de una regla autorizada (propuesta) y descarte ─────────────────────
select t301.pasa($q$select public.regla_descuento_guardar(9305, null, 'ebb', 900, 30, true)$q$, 'H1 EBB 900 días (no coincide con nada): se aplica de inmediato');
select t301.ok(t301.n('select count(*) from public.hotel_reglas_descuento where hotel_id = 9305 and umbral = 900 and autorizada and propuesta is null') = 1, 'H2 autorizada');
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, regimen_restringido)
  values (930514, 9305, 'OTRA NUEVA', '2027-06-01', '2027-06-30', 6, 'descuento_pct', 9, 'TI');
set constraints all immediate; set constraints all deferred;
select t301.ok(t301.t('select estado from public.hotel_promocion_combinacion where promocion_id = 930514') = 'pendiente', 'H3 una promoción nueva que coincide nace pendiente');
select t301.ok(t301.t('select (public.regla_descuento_guardar(9305, (select id from public.hotel_reglas_descuento where hotel_id = 9305 and umbral = 900), ''ebb'', 900, 25, false))->>''estado''') = 'aplicada',
  'H4 desactivar una regla nunca crea pares: se aplica');
select t301.pasa($q$select public.regla_descuento_descartar((select id from public.hotel_reglas_descuento where hotel_id = 9305 and umbral = 900))$q$, 'H5 descartar sin propuesta: no cambia nada');

-- ── J. Promoción por grupo: sus PRIMERAS reglas (RPC de la 300) la hacen coincidir ⇒ nace pendiente, no se rechaza ────────
select t301.pasa($q$insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, promo_base_id, regimen_restringido)
  values (930515, 9305, 'POR GRUPO', '2027-06-01', '2027-06-30', 7, 'descuento_pct', 930501, 'AI')$q$, 'J1 promoción vinculada a la base, aún sin reglas (no coincide con nada)');
select t301.ok(t301.n('select count(*) from public.hotel_promocion_combinacion where promocion_id = 930515') = 0, 'J2 sin reglas no coincide: sin fila');
select t301.pasa($q$select public.promocion_guardar_reglas(930515, 930501, '[{"grupo_id":null,"valor":10,"dias":null}]', '{"base":930501,"reglas":[]}')$q$,
  'J3 guardar sus primeras reglas por la RPC: aceptado (no se rechaza)');
select t301.ok(t301.t('select estado from public.hotel_promocion_combinacion where promocion_id = 930515') = 'pendiente', 'J4 queda PENDIENTE (no se vende hasta configurarla)');

-- ── K. P3: cambio PENDIENTE persistente de una promoción que se vende (proponer → activar / descartar) ─────────
select t301.pasa($q$insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor, compra_inicio, compra_fin, regimen_restringido)
  values (930516, 9305, 'P3 UNO', '2027-06-01', '2027-06-30', 8, 'descuento_pct', 6, '2026-01-01', '2026-02-01', 'K1'),
         (930517, 9305, 'P3 DOS', '2027-06-01', '2027-06-30', 9, 'descuento_pct', 6, '2026-01-01', '2026-02-01', 'K2')$q$, 'K1 dos promociones que se venden sin coincidencias');
select t301.ok(t301.t($q$select (public.promocion_cambio_proponer(930516, '{"compra_fin":"2027-05-31","descuento_valor":7}'))::text$q$) = '{"estado": "pendiente", "faltan": ["ebb", "long_stay"]}',
  'K2 proponer un cambio que crea coincidencias: queda PENDIENTE y dice qué falta');
select t301.ok(t301.t('select compra_fin::text || ''|'' || descuento_valor::int::text from public.hotel_temporadas where id = 930516') = '2026-02-01|6',
  'K3 la versión autorizada no cambió (se sigue vendiendo)');
select t301.ok(t301.n('select cardinality(public._e5_requeridas(930516, public._e5_reglas(9305, false)))') = 0, 'K4 el motor sigue viendo la promoción sin coincidencias');
select t301.ok(t301.t($q$select (x->'cambio_pendiente'->'cambios'->>'compra_fin') || '|' || (x->'cambio_pendiente'->>'desactualizado')
  from jsonb_array_elements(public.promociones_combinacion_estado(9305)) x where (x->>'promocion_id')::bigint = 930516$q$) = '2027-05-31|false',
  'K5 la ficha ve el cambio pendiente (vigente, no desactualizado)');
select t301.atomico($q$select public.promocion_cambio_activar(930516)$q$, 'COMBINACION_SIN_CONFIGURAR', 'K6 activar sin combinación: rechazado, el pendiente sigue');
select t301.atomico($q$select public.promocion_cambio_activar(930516, '{"acumulable":{"ebb":true,"long_stay":false}}')$q$, '22023|Ordena', 'K7 activar con combinación incompleta: rechazado');
select t301.ok(t301.t($q$select (public.promocion_cambio_activar(930516, '{"acumulable":{"ebb":true,"long_stay":false},"orden":["long_stay","promocion","ebb"]}'))->>'estado'$q$) = 'configurada',
  'K8 activar con la combinación: aceptado en una transacción');
set constraints all immediate; set constraints all deferred;
select t301.ok(t301.t($q$select t.compra_fin::text || '|' || t.descuento_valor::int::text || '|' || c.estado || '|' || (select count(*) from public.hotel_promocion_cambio_pendiente where promocion_id = 930516)
  from public.hotel_temporadas t join public.hotel_promocion_combinacion c on c.promocion_id = t.id where t.id = 930516$q$) = '2027-05-31|7|configurada|0',
  'K9 quedó el cambio completo, configurado y sin pendiente');
select t301.atomico($q$select public.promocion_cambio_activar(930516)$q$, 'CAMBIO_NO_PENDIENTE', 'K10 activarlo otra vez: ya no está pendiente');
select t301.ok(t301.t($q$select (public.promocion_cambio_proponer(930516, '{"descuento_valor":8}'))->>'estado'$q$) = 'aplicada',
  'K11 un cambio que no crea nada sin configurar se aplica directo (no se retiene)');
select t301.ok(t301.t($q$select (public.promocion_cambio_proponer(930517, '{"compra_fin":"2027-05-31"}'))->>'estado'$q$) = 'pendiente', 'K12 segundo cambio pendiente');
reset role;
update public.hotel_temporadas set descuento_valor = 5 where id = 930517;  -- otra sesión edita la versión vendida
set constraints all immediate; set constraints all deferred;
set role authenticated;
select t301.ok(t301.t($q$select x->'cambio_pendiente'->>'desactualizado' from jsonb_array_elements(public.promociones_combinacion_estado(9305)) x where (x->>'promocion_id')::bigint = 930517$q$) = 'true',
  'K13 la ficha marca el pendiente como desactualizado');
select t301.atomico($q$select public.promocion_cambio_activar(930517, '{"acumulable":{"ebb":true,"long_stay":true},"orden":["promocion","ebb","long_stay"]}')$q$, 'CAMBIO_CONCURRENTE|40001',
  'K14 activar sobre una versión que cambió: rechazado, nada cambia');
select t301.pasa($q$select public.promocion_cambio_descartar(930517)$q$, 'K15 descartar');
select t301.ok(t301.t($q$select compra_fin::text || '|' || (select count(*) from public.hotel_promocion_cambio_pendiente where promocion_id = 930517) from public.hotel_temporadas where id = 930517$q$) = '2026-02-01|0',
  'K16 descartado: la versión vendida intacta y sin pendiente');
select t301.atomico($q$select public.promocion_cambio_proponer(930517, '{"hotel_id":1}')$q$, '22023|no válidos', 'K17 un cambio no puede mover la promoción de hotel');

-- ── I. Permisos ──────────────────────────────────────────────────────────────────────────────────
reset role;
set role anon;
select t301.atomico($q$select public.promocion_guardar_combinacion(930511, '{"acumulable":{"ebb":true}}')$q$, '42501|permission|permiso', 'I1 anon no ejecuta la RPC');
select t301.atomico($q$select public.regla_descuento_guardar(9305, null, 'ebb', 10, 5, true)$q$, '42501|permission|permiso', 'I2 anon no guarda reglas');
select t301.atomico($q$select public.promocion_cambio_proponer(930517, '{"descuento_valor":1}')$q$, '42501|permission|permiso', 'I2b anon no propone cambios');
select t301.atomico($q$select public.promocion_cambio_activar(930517)$q$, '42501|permission|permiso', 'I2c anon no activa cambios');
reset role;
select t301.ok(not has_function_privilege('authenticated', 'public._e5_revisar(bigint, bigint)', 'execute'), 'I3 las funciones internas no se exponen');
select t301.ok(not has_table_privilege('authenticated', 'public.hotel_promocion_combinacion', 'insert'), 'I4 la combinación solo se escribe por la RPC');
select t301.ok(not has_table_privilege('authenticated', 'public.hotel_promocion_cambio_pendiente', 'insert')
  and not has_function_privilege('authenticated', 'public._e5_aplicar_cambios(bigint, jsonb)', 'execute'), 'I5 el cambio pendiente solo se escribe por la RPC');
select t301.ok(not has_function_privilege('authenticated', 'public._e5_ejemplo_estadia(bigint, bigint)', 'execute'), 'I6 el ejemplo de estadía del aviso es interno');
-- (E4c) va al final, como superusuario: el ejemplo de estadía es una función interna (I6).
do $$
declare r text;
begin
  -- Fechas separadas (sin noches comunes): el ejemplo va de la última noche de la primera a la primera de la segunda. Se deshace.
  begin
    insert into public.hoteles (id, destino_id, nombre, modelo_tarifario) values (9399, 9301, 'T301 EJEMPLO', 'persona');
    insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor) values
      (939901, 9399, 'ALTA', '2027-06-01', '2027-06-30', 1, 'tarifa', null),
      (939910, 9399, 'P1', '2027-06-01', '2027-06-10', 2, 'descuento_pct', 10),
      (939911, 9399, 'P2', '2027-06-15', '2027-06-20', 2, 'descuento_pct', 10);
    r := public._e5_ejemplo_estadia(939911, 939910);
    raise exception 'E4C_DESHACER:%', r;
  exception when raise_exception then
    if sqlerrm not like 'E4C_DESHACER:%' then raise; end if;
    r := substr(sqlerrm, length('E4C_DESHACER:') + 1);
  end;
  if r is distinct from 'una estadía del 10/06/2027 al 16/06/2027 (6 noches) incluye noches de las dos' then raise exception 'FALLO E4c ejemplo con fechas separadas: %', r; end if;
  raise notice 'OK    E4c fechas separadas: «%»', r;
end $$;
