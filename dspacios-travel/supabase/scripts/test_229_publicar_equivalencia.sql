-- ─────────────────────────────────────────────────────────────────────────────
-- BATERÍA SQL · 229 (publicar_tarifario_resultado set-based, #100). SOLO bases desechables (CI o local); nunca remota.
-- Corre en UNA transacción que termina en ROLLBACK.
--
-- Requisitos: base con 001-229 Y la función de referencia public._ref226_publicar(bigint, bigint, bigint, text, jsonb)
-- (el cuerpo EXACTO de la 226, renombrado; test_229_fases.sh la crea extrayéndola del rollback 229). Cierre esperado:
-- "TEST 229 EQUIVALENCIA: TODO OK".
--
-- Idea: cada caso se ejecuta DOS veces, con la referencia (226) y con la función vigente (229), cada una dentro de una
-- subtransacción que se revierte (misma base de partida), y se comparan TRES cosas: lo que devuelve (o el error exacto:
-- sqlstate + mensaje), el snapshot resultante (todas las columnas menos id/created_at, en orden de id) y el estado de
-- publicación de armado_paquetes.
--   A  payload rico (todas las columnas, nulos, procedencia uniforme/mixta/ausente/null JSON, números como texto,
--      Unicode, paquete_id número/texto/con espacios/null, moneda y paquete_activo del payload IGNORADOS)
--   B  rechazos con `false` (generación o revisión vencidas) y arreglo vacío
--   C  errores: moneda, p_filas, elemento no objeto, paquete_id ajeno / no numérico, paquete inexistente, nulos, rol
--   D  fallo de CHECK / enum / cast a mitad del lote: el snapshot anterior sobrevive (atomicidad) igual en ambas
--   E  ACL y rol: anon no ejecuta; venta (rol sin permiso) recibe el mismo error
-- ─────────────────────────────────────────────────────────────────────────────
begin;

create schema t229;
create table t229.res (nombre text, ok boolean, detalle text);

create function t229.afirma(p_nombre text, p_ok boolean, p_detalle text default null) returns void
language plpgsql as $$
begin
  insert into t229.res values (p_nombre, coalesce(p_ok, false), p_detalle);
  if coalesce(p_ok, false) then raise notice 'OK    % [%]', p_nombre, left(coalesce(p_detalle, ''), 110);
  else raise notice 'FALLO % -- %', p_nombre, coalesce(p_detalle, ''); end if;
end $$;

create function t229.u(p_k text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000229' || case p_k
    when 'super' then '001' when 'oper' then '004' when 'vent' then '006' else '999' end)::uuid
$$;

-- Ejecuta UNA consulta que devuelve un texto como el usuario `p_k` con el rol de Postgres `p_rol`; devuelve el texto o
-- 'ERR <sqlstate> <mensaje>' (el mensaje entra en la comparación).
create function t229.q(p_sql text, p_k text, p_rol text default 'authenticated') returns text
language plpgsql as $$
declare v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_k is null then '' else json_build_object('sub', t229.u(p_k), 'role', p_rol)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(t229.u(p_k)::text, ''), true);
    execute format('set local role %I', p_rol);
    execute p_sql into v_res;
  exception when others then
    v_res := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_res;
end $$;

-- Corre `p_fn` (_ref226_publicar o publicar_tarifario_resultado) en una subtransacción que SIEMPRE se revierte y devuelve
-- {res, snap, estado}: resultado, snapshot del paquete (sin id/created_at, en orden de id) y estado de publicación.
create function t229.corre(p_fn text, p_k text, p_paq bigint, p_gen bigint, p_rev bigint, p_mon text, p_filas jsonb) returns jsonb
language plpgsql as $$
declare v_res text; v_snap jsonb; v_estado jsonb; v_out jsonb;
begin
  begin
    v_res := t229.q(format('select public.%I(%L::bigint, %L::bigint, %L::bigint, %L::text, %L::jsonb)::text',
                           p_fn, p_paq, p_gen, p_rev, p_mon, p_filas::text), p_k);
    select coalesce(jsonb_agg(to_jsonb(t) - 'id' - 'created_at' order by t.id), '[]'::jsonb)
      into v_snap from public.tarifario_resultado t where t.paquete_id = coalesce(p_paq, 229301);
    select to_jsonb(p) - 'id' - 'nombre' into v_estado
      from (select tarifario_generacion, tarifario_revision_fuente, tarifario_generacion_publicada, tarifario_revision_publicada,
                   tarifario_estado, tarifario_error, tarifario_snapshot_publicable, tarifario_actualizado_en, moneda, activo
              from public.armado_paquetes where id = coalesce(p_paq, 229301)) p;
    v_out := jsonb_build_object('res', v_res, 'snap', v_snap, 'estado', v_estado);
    raise exception 'revertir' using errcode = 'P0229';
  exception when sqlstate 'P0229' then null;
  end;
  return v_out;
end $$;

-- Compara referencia (226) y vigente (229) para el mismo caso.
create function t229.equiv(p_nombre text, p_k text, p_paq bigint, p_gen bigint, p_rev bigint, p_mon text, p_filas jsonb) returns void
language plpgsql as $$
declare a jsonb := t229.corre('_ref226_publicar', p_k, p_paq, p_gen, p_rev, p_mon, p_filas);
        b jsonb := t229.corre('publicar_tarifario_resultado', p_k, p_paq, p_gen, p_rev, p_mon, p_filas);
begin
  perform t229.afirma(p_nombre, a is not null and a = b,
    'ref=' || left(coalesce(a->>'res', '<null>'), 160) || ' | 229=' || left(coalesce(b->>'res', '<null>'), 160)
    || case when a->'snap' is distinct from b->'snap' then ' | SNAPSHOT DISTINTO' else '' end
    || case when a->'estado' is distinct from b->'estado' then ' | ESTADO DISTINTO' else '' end);
end $$;

do $$ begin
  if to_regprocedure('public._ref226_publicar(bigint, bigint, bigint, text, jsonb)') is null then
    raise exception 'FALTA public._ref226_publicar: crearla con test_229_fases.sh (cuerpo de la 226 renombrado).';
  end if;
end $$;

-- ── Usuarios y fixtures ──────────────────────────────────────────────────────
insert into auth.users (id, email) select t229.u(k), 'c229-' || k || '@x.test' from unnest(array['super','oper','vent']) k on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
select t229.u(v.k), 'c229-' || v.k || '@x.test', 'C229 ' || v.k, v.r::rol_usuario, true, 'mayorista'
from (values ('super','superadmin'), ('oper','operaciones'), ('vent','venta')) v(k, r)
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;

insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (229010, 'T229 DESTINO', 'CTG', 'Colombia', true);
insert into public.hoteles (id, destino_id, nombre) values (229020, 229010, 'T229 hotel');
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values
  (229301, 'T229 paquete', 'bloqueo', true, 229010),
  (229302, 'T229 paquete inactivo', 'bloqueo', false, 229010);
insert into public.servicios_adicionales (id, nombre, precio_persona) values (229401, 'T229 tour', 100000);
insert into public.empaquetados (id, record, aerolinea, ruta, fecha_ida, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)
values (229501, 'T229E1', 'AEROTEST', 'BOG - CTG - BOG', current_date + 40, 100000, 120000, 10, true);
do $$
declare v_res text; v_id bigint;
begin
  v_res := t229.q($q$select (public.crear_bloqueo(jsonb_build_object('record', 't229a', 'modalidad_emision', 'serie',
            'tarifa_para_empaquetar', 200000, 'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'ruta', 'BOG - CTG - BOG'), 2))->>'id'$q$, 'super');
  v_id := nullif(v_res, '')::bigint;
  create temp table t229_ids as select v_id as bloqueo_id;
exception when others then
  insert into t229.res values ('setup bloqueo', false, coalesce(v_res, sqlerrm));
  create temp table t229_ids as select null::bigint as bloqueo_id;
end $$;

-- Snapshot de partida (publicado con la REFERENCIA): ambas funciones parten de él en cada caso (borrado + reemplazo).
do $$
declare v_res text;
begin
  v_res := t229.q(format('select public._ref226_publicar(229301, %s, %s, ''COP'', %L::jsonb)::text',
    (select tarifario_generacion from public.armado_paquetes where id = 229301),
    (select tarifario_revision_fuente from public.armado_paquetes where id = 229301),
    jsonb_build_array(
      jsonb_build_object('modulo', 'bloqueo', 'categoria', 'BASE', 'regimen', 'PC', 'acomodacion', 'doble', 'noches', 3, 'precio_pvp', 1000, 'hotel_nombre', 'viejo'),
      jsonb_build_object('modulo', 'servicios', 'servicio_nombre', 'viejo', 'precio_pvp', 5))::text), 'oper');
  perform t229.afirma('S1 snapshot de partida del paquete activo publicado (como operaciones)', v_res = 'true', v_res);
  -- El paquete 229302 (inactivo) también parte con un snapshot.
  v_res := t229.q(format('select public._ref226_publicar(229302, %s, %s, ''USD'', %L::jsonb)::text',
    (select tarifario_generacion from public.armado_paquetes where id = 229302),
    (select tarifario_revision_fuente from public.armado_paquetes where id = 229302),
    jsonb_build_array(jsonb_build_object('modulo', 'bloqueo', 'precio_pvp', 7))::text), 'oper');
  perform t229.afirma('S2 snapshot de partida del paquete inactivo publicado', v_res = 'true', v_res);
end $$;

-- Tokens vigentes (se leen UNA vez; las subtransacciones revierten y no los cambian).
create temp table t229_tok as
  select (select tarifario_generacion from public.armado_paquetes where id = 229301) g1,
         (select tarifario_revision_fuente from public.armado_paquetes where id = 229301) r1,
         (select tarifario_generacion from public.armado_paquetes where id = 229302) g2,
         (select tarifario_revision_fuente from public.armado_paquetes where id = 229302) r2;

-- ═ A · payload rico ═══════════════════════════════════════════════════════════════
do $$
declare
  v_b bigint := (select bloqueo_id from t229_ids);
  g1 bigint := (select g1 from t229_tok); r1 bigint := (select r1 from t229_tok);
  g2 bigint := (select g2 from t229_tok); r2 bigint := (select r2 from t229_tok);
  v_prov_uni jsonb := '[{"temporada":"ALTA","es_promocion":false,"precio_final_autoritativo":false}]';
  v_prov_mix jsonb := '[{"temporada":"ALTA","es_promocion":false,"precio_final_autoritativo":false},{"temporada":"PROMO","es_promocion":true,"precio_final_autoritativo":true}]';
  v_rico jsonb;
begin
  v_rico := jsonb_build_array(
    -- 1 fila completa de hotel (bloqueo), procedencia uniforme coherente con las columnas planas
    jsonb_build_object('paquete_id', 229301, 'paquete_nombre', 'Nombre del payload', 'paquete_activo', false, 'modulo', 'bloqueo',
      'bloqueo_id', v_b, 'bloqueo_label', 'T229A BOG-CTG', 'hotel_id', 229020, 'hotel_nombre', 'Hotel ñandú ✓ "dobles" ''simples''',
      'destino_id', 229010, 'destino_nombre', 'T229 DESTINO', 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'doble',
      'noches', 3, 'fecha_ida', '2030-01-10', 'fecha_regreso', '2030-01-13', 'base_comisionable', 1000.5, 'impuesto', 10.25,
      'precio_pvp', 2000000, 'descripcion', 'desc', 'moneda', 'USD', 'temporada_ganadora', 'ALTA', 'es_promocion', false,
      'precio_final_autoritativo', false, 'procedencia_temporadas', v_prov_uni, 'procedencia_mixta', false),
    -- 2 infante con precio de menor de 2 años
    jsonb_build_object('modulo', 'bloqueo', 'bloqueo_id', v_b, 'hotel_id', 229020, 'categoria', 'ESTANDAR', 'regimen', 'PC', 'acomodacion', 'infante',
      'noches', 3, 'precio_pvp', 1305000, 'precio_pvp_menor2', 155000, 'temporada_ganadora', 'ALTA', 'es_promocion', false,
      'precio_final_autoritativo', false, 'procedencia_temporadas', v_prov_uni),
    -- 3 procedencia MIXTA (2 objetos, planas NULL, mixta true)
    jsonb_build_object('modulo', 'porcion_terrestre', 'hotel_id', 229020, 'acomodacion', 'triple', 'precio_pvp', 5,
      'procedencia_temporadas', v_prov_mix, 'procedencia_mixta', true),
    -- 4 procedencia = null JSON explícito (debe quedar SQL NULL)
    jsonb_build_object('modulo', 'dinamico', 'acomodacion', 'multiple', 'precio_pvp', 6, 'procedencia_temporadas', 'null'::jsonb),
    -- 5 clave de procedencia ausente
    jsonb_build_object('modulo', 'bloqueo', 'acomodacion', 'nino', 'precio_pvp', 7),
    -- 6 servicio por grupo con rangos y recargo
    jsonb_build_object('modulo', 'servicios', 'servicio_id', 229401, 'servicio_nombre', 'T229 tour', 'tipo_tarifa', 'grupo',
      'pax_desde', 2, 'pax_hasta', 5, 'base_comisionable', 100000, 'impuesto', 0, 'precio_pvp', 100000, 'recargo_individual', 5000),
    -- 7 origen Sistema (empaquetado, sin bloqueo)
    jsonb_build_object('modulo', 'bloqueo', 'empaquetado_id', 229501, 'hotel_id', 229020, 'acomodacion', 'sencilla', 'precio_pvp', 8),
    -- 8 números y paquete_id como TEXTO (con espacios), enteros como texto
    jsonb_build_object('paquete_id', ' 229301 ', 'modulo', 'bloqueo', 'acomodacion', 'nino2', 'noches', '4', 'precio_pvp', '123.45',
      'base_comisionable', '10', 'impuesto', '0.5', 'pax_desde', '1'),
    -- 9 casi todo nulo (solo el modulo, que es NOT NULL)
    jsonb_build_object('modulo', 'servicios'),
    -- 10 paquete_id nulo explícito
    jsonb_build_object('paquete_id', null, 'modulo', 'bloqueo', 'precio_pvp', 9, 'moneda', 'EUR', 'salida_id', 4242),
    -- 11 claves desconocidas y espacios en texto
    jsonb_build_object('modulo', 'bloqueo', 'hotel_nombre', '  espacios  ', 'columna_inventada', 'x', 'precio_pvp', 10, 'paquete_activo', true)
  );
  perform t229.equiv('A1 payload rico (11 filas heterogéneas) · operaciones · paquete activo', 'oper', 229301, g1, r1, 'COP', v_rico);
  perform t229.equiv('A2 el mismo payload en un paquete INACTIVO: paquete_activo y snapshot_publicable salen de armado_paquetes',
                     'oper', 229302, g2, r2, 'USD', replace(v_rico::text, '229301', '229302')::jsonb);
  perform t229.equiv('A3 superadmin con p_moneda USD', 'super', 229301, g1, r1, 'USD', v_rico);
  -- efecto concreto verificado sobre la vigente (no solo contra la referencia)
  declare b jsonb := t229.corre('publicar_tarifario_resultado', 'oper', 229301, g1, r1, 'COP', v_rico);
  begin
    perform t229.afirma('A4 229: 11 filas, todas COP, activas y del paquete pedido (ignora moneda/paquete_activo del payload)',
      b->>'res' = 'true' and jsonb_array_length(b->'snap') = 11
      and not exists (select 1 from jsonb_array_elements(b->'snap') e where e->>'moneda' <> 'COP' or (e->>'paquete_activo')::boolean is not true or (e->>'paquete_id')::bigint <> 229301),
      left(b::text, 200));
    perform t229.afirma('A5 229: JSON null y clave ausente de procedencia quedan SQL NULL; la mixta y la uniforme se conservan',
      (b->'snap'->3->'procedencia_temporadas') = 'null'::jsonb and (b->'snap'->3) ? 'procedencia_temporadas'
      and jsonb_typeof(b->'snap'->3->'procedencia_temporadas') = 'null'
      and (b->'snap'->2->>'procedencia_mixta')::boolean and jsonb_array_length(b->'snap'->2->'procedencia_temporadas') = 2
      and (b->'snap'->0->>'temporada_ganadora') = 'ALTA',
      'fila4=' || coalesce((b->'snap'->3)::text, '<null>'));
  end;
end $$;

-- ═ B · rechazos con false y arreglo vacío ═════════════════════════════════════════
do $$
declare g1 bigint := (select g1 from t229_tok); r1 bigint := (select r1 from t229_tok);
        ok jsonb := jsonb_build_array(jsonb_build_object('modulo', 'bloqueo', 'precio_pvp', 1));
begin
  perform t229.equiv('B1 generación vencida: false y el snapshot no se toca', 'oper', 229301, g1 + 1, r1, 'COP', ok);
  perform t229.equiv('B2 revisión de fuente vencida: false y el paquete queda pendiente', 'oper', 229301, g1, r1 + 1, 'COP', ok);
  perform t229.equiv('B3 arreglo vacío: true y el snapshot queda vacío', 'oper', 229301, g1, r1, 'COP', '[]'::jsonb);
  perform t229.equiv('B4 un solo objeto mínimo', 'oper', 229301, g1, r1, 'COP', ok);
end $$;

-- ═ C · errores de entrada (mismo sqlstate y mismo mensaje) ═══════════════════════════
do $$
declare g1 bigint := (select g1 from t229_tok); r1 bigint := (select r1 from t229_tok);
        ok jsonb := jsonb_build_array(jsonb_build_object('modulo', 'bloqueo', 'precio_pvp', 1));
begin
  perform t229.equiv('C1 moneda NULL', 'oper', 229301, g1, r1, null, ok);
  perform t229.equiv('C2 moneda EUR', 'oper', 229301, g1, r1, 'EUR', ok);
  perform t229.equiv('C3 p_filas NULL', 'oper', 229301, g1, r1, 'COP', null);
  perform t229.equiv('C4 p_filas es un objeto, no un arreglo', 'oper', 229301, g1, r1, 'COP', '{"modulo":"bloqueo"}'::jsonb);
  perform t229.equiv('C5 elemento que no es objeto (número)', 'oper', 229301, g1, r1, 'COP', '[1]'::jsonb);
  perform t229.equiv('C6 elemento que no es objeto (texto) tras uno válido', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo"},"x"]'::jsonb);
  perform t229.equiv('C7 una fila declara paquete_id ajeno', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","paquete_id":229302}]'::jsonb);
  perform t229.equiv('C8 paquete_id no numérico', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","paquete_id":"abc"}]'::jsonb);
  perform t229.equiv('C9 paquete_id decimal como texto (no entero)', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","paquete_id":"229301.5"}]'::jsonb);
  perform t229.equiv('C10 paquete inexistente', 'oper', 229999, g1, r1, 'COP', ok);
  perform t229.equiv('C11 paquete NULL', 'oper', null, g1, r1, 'COP', ok);
  perform t229.equiv('C12 generación NULL', 'oper', 229301, null, r1, 'COP', ok);
  perform t229.equiv('C13 revisión NULL', 'oper', 229301, g1, null, 'COP', ok);
  perform t229.equiv('C14 rol venta: sin permiso de escritura', 'vent', 229301, g1, r1, 'COP', ok);
  perform t229.equiv('C15 sin sesión (authenticated sin sub): sin permiso', null, 229301, g1, r1, 'COP', ok);
end $$;

-- ═ D · fallos a mitad del lote: el snapshot anterior sobrevive ═════════════════════════
do $$
declare g1 bigint := (select g1 from t229_tok); r1 bigint := (select r1 from t229_tok);
        v_prev jsonb;
begin
  perform t229.equiv('D1 precio_pvp_menor2 negativo en la fila 3 (CHECK)', 'oper', 229301, g1, r1, 'COP',
    '[{"modulo":"bloqueo","precio_pvp":1},{"modulo":"bloqueo","precio_pvp":2},{"modulo":"bloqueo","acomodacion":"infante","precio_pvp":3,"precio_pvp_menor2":-5}]'::jsonb);
  perform t229.equiv('D2 acomodación fuera del enum', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","acomodacion":"cuadruple"}]'::jsonb);
  perform t229.equiv('D3 módulo fuera del enum', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"inventado"}]'::jsonb);
  perform t229.equiv('D4 módulo ausente (NOT NULL)', 'oper', 229301, g1, r1, 'COP', '[{"precio_pvp":1}]'::jsonb);
  perform t229.equiv('D5 fecha inválida', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","fecha_ida":"no-es-fecha"}]'::jsonb);
  perform t229.equiv('D6 número inválido en noches', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","noches":"tres"}]'::jsonb);
  perform t229.equiv('D7 FK inexistente (hotel_id)', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","hotel_id":999999999}]'::jsonb);
  perform t229.equiv('D8 bloqueo_id y empaquetado_id a la vez (CHECK de origen)', 'oper', 229301, g1, r1, 'COP',
    format('[{"modulo":"bloqueo","bloqueo_id":%s,"empaquetado_id":229501}]', (select bloqueo_id from t229_ids))::jsonb);
  perform t229.equiv('D9 procedencia incoherente con las columnas planas (CHECK de la 180)', 'oper', 229301, g1, r1, 'COP',
    '[{"modulo":"bloqueo","temporada_ganadora":"X","es_promocion":false,"precio_final_autoritativo":false,"procedencia_temporadas":[{"temporada":"Y","es_promocion":false,"precio_final_autoritativo":false}]}]'::jsonb);
  perform t229.equiv('D10 procedencia como arreglo vacío (CHECK no vacía)', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","procedencia_temporadas":[]}]'::jsonb);
  perform t229.equiv('D11 procedencia que no es arreglo', 'oper', 229301, g1, r1, 'COP', '[{"modulo":"bloqueo","procedencia_temporadas":{"a":1}}]'::jsonb);
  -- el snapshot de partida sigue intacto tras los errores de arriba (cada caso se revirtió, pero verificamos la base real)
  select count(*) into g1 from public.tarifario_resultado where paquete_id = 229301;
  perform t229.afirma('D12 el snapshot de partida (2 filas) sigue en la base tras todos los casos', g1 = 2, 'filas=' || g1);
end $$;

-- ═ E · ACL ═════════════════════════════════════════════════════════════════════════
do $$
declare g1 bigint := (select g1 from t229_tok); r1 bigint := (select r1 from t229_tok); v_res text;
begin
  v_res := t229.q(format('select public.publicar_tarifario_resultado(229301, %s, %s, ''COP'', ''[]''::jsonb)::text', g1, r1), null, 'anon');
  perform t229.afirma('E1 anon no ejecuta la función vigente', v_res like 'ERR 42501%', v_res);
  perform t229.afirma('E2 authenticated sí; anon y public no (ACL de la 226 intacta)',
    has_function_privilege('authenticated', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)', 'EXECUTE')
    and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where p.oid = 'public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb)'::regprocedure and a.grantee = 0));
  perform t229.afirma('E3 el envoltorio 227 sigue ejecutable por authenticated y no por anon',
    has_function_privilege('authenticated', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.publicar_tarifario_resultado_63(bigint, bigint, bigint, text, jsonb, text, numeric)', 'EXECUTE'));
end $$;

-- ═ Z · conclusión ═══════════════════════════════════════════════════════════════════
do $$
declare v_total int; v_fallos int;
begin
  select count(*), count(*) filter (where not ok) into v_total, v_fallos from t229.res;
  raise notice '--- % comprobaciones, % fallos', v_total, v_fallos;
  if v_fallos = 0 and v_total >= 40 then raise notice 'TEST 229 EQUIVALENCIA: TODO OK (% comprobaciones)', v_total;
  else raise notice 'TEST 229 EQUIVALENCIA: HAY FALLOS O FALTAN COMPROBACIONES (% de % fallaron)', v_fallos, v_total; end if;
end $$;

rollback;
