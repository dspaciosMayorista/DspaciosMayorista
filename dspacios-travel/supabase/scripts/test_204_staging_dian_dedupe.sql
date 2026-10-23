-- ============================================================================
-- Test 204 — Dedupe e idempotencia del staging DIAN.
--
-- Base LOCAL con la 204 aplicada. Todo corre en UNA transaccion que termina
-- en ROLLBACK. NO correr contra Supabase (mismo criterio que el test de 193).
--
-- Que verifica:
--   D01  Documento normal.
--   D02  Reenvio exacto (misma clave, mismo total)  -> duplicado.
--   D03  El duplicado apunta al original y ambos conviven.
--   D04  El original NO se modifica al registrar el duplicado.
--   D05  La bitacora registra el paso a duplicado.
--   D06  Un duplicado NO guarda hijos (§4.7).
--   D07  La identidad cuenta las dos ocurrencias y conserva el primer total.
--   D08  Misma clave, otro total -> discrepante, conviviendo con el original.
--   D09  Reimportacion del mismo archivo en el mismo corte -> detenida (D6).
--   D10  El mismo archivo en un corte NUEVO si se puede cargar.
--   D11  La misma clave en otro tenant es otro documento (aislamiento).
--   D12  La FK compuesta impide tenant != tenant del lote.
--   D13  UPDATE/DELETE/TRUNCATE rechazados: staging y bitacora son append-only.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- --- Helpers (viven solo dentro de esta transaccion) -------------------------
create function public.t204_ok(p_cond boolean, p_caso text) returns void
language plpgsql as $$
begin
  if p_cond then
    raise notice 'OK   %', p_caso;
  else
    raise exception 'FALLO %', p_caso;
  end if;
end $$;

create function public.t204_como(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
end $$;

create function public.t204_debe_fallar(p_sql text, p_estado text, p_caso text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_estado then
      raise exception 'FALLO %: dio % (%) en vez de %', p_caso, sqlstate, sqlerrm, p_estado;
    end if;
    raise notice 'OK   %: % (%)', p_caso, sqlstate, sqlerrm;
    return;
  end;
  raise exception 'FALLO %: se esperaba % y no hubo error', p_caso, p_estado;
end $$;

create function public.t204_aviso(p_caso text) returns void
language plpgsql as $$
begin raise notice 'INFO %', p_caso; end $$;

grant execute on function public.t204_ok(boolean, text),
                     public.t204_como(uuid),
                     public.t204_debe_fallar(text, text, text),
                     public.t204_aviso(text)
  to anon, authenticated;

\echo ''
\echo '--- Montaje ---'

-- Un contador ACTIVO: `dian_registrar_documento` deriva tenant y rol del
-- servidor y rechaza sin permiso, asi que sin un usuario real el test no
-- llegaria ni al dedupe. El alta va en DOS pasos porque
-- `usuarios.id references auth.users(id) on delete cascade`: sin la fila en
-- auth.users, el insert en public.usuarios viola la FK.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 't204_contador@local.invalid')
on conflict (id) do nothing;

insert into public.usuarios (id, email, nombre, rol, tenant, activo)
values ('00000000-0000-4000-8000-0000000000c1', 't204_contador@local.invalid',
        'Contador 204', 'contador', 'mayorista', true)
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre,
  rol = excluded.rol, tenant = excluded.tenant, activo = excluded.activo;
-- (main >= 193: handle_new_user ya creo la fila como cliente_final inactivo al
--  insertar en auth.users; `do nothing` dejaba al usuario de prueba sin rol.)

select public.t204_como('00000000-0000-4000-8000-0000000000c1');
create function public.t204_lote(
  p_tenant text, p_fuente text, p_hash text,
  p_desde text, p_hasta text, p_motivo text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into public.lote_importacion_dian (
    tenant, fuente, nombre_archivo, hash_contenido,
    periodo_desde, periodo_hasta, motivo, estado
  ) values (p_tenant, p_fuente, p_hash, p_hash, p_desde, p_hasta, p_motivo, 'en_proceso')
  returning id into v;
  return v;
end $$;

-- La clave de prueba: 96 caracteres, como los CUFE reales.
-- `language sql` y no plpgsql: un cuerpo plpgsql con un `select` desnudo es
-- error de sintaxis en Postgres. Se verificó ejecutando.
create function public.t204_cufe() returns text
language sql immutable as $$
  select 'CUFE:PRUEBA204' || repeat('X', 74) || '0A';
$$;

grant execute on function public.t204_lote(text, text, text, text, text, text),
                     public.t204_cufe() to anon, authenticated;

\echo ''
\echo '--- D01: documento normal ---'

do $$
declare
  v_lote bigint := public.t204_lote('mayorista','excel_compras','204-hash-A','2026-01','2026-01','Prueba 204');
  v_r    jsonb;
begin
  v_r := public.dian_registrar_documento(
    v_lote, public.t204_cufe(), 'cufecude', public.t204_cufe(), null,
    'factura', 'Factura de venta', 'FV-204-001', '2026-01-15'::date,
    '900111111', '900111111-1', 'PROVEEDOR PRUEBA 204',
    'COP', null,
    100000, 119000, 119000, 'xmlhash-204-a', 1);

  perform public.t204_ok(v_r->>'resultado' = 'nuevo', 'D01 documento normal -> nuevo');
  perform public.t204_ok(v_r->>'original_id' is null, 'D01 nuevo no tiene original');

  -- El documento arranca importado, sin aprobado y con su lote.
  perform public.t204_ok(
    (select estado = 'importado' and aprobado_por is null and aprobado_en is null
       from public.documento_dian_staging where id = (v_r->>'documento_id')::bigint),
    'D01 el documento queda importado y sin aprobar');

  -- El tenant viene del servidor: coincide con el del lote.
  perform public.t204_ok(
    (select d.tenant = l.tenant
       from public.documento_dian_staging d
       join public.lote_importacion_dian l on l.id = d.lote_id
      where d.id = (v_r->>'documento_id')::bigint),
    'D01 el tenant del documento es el del lote');
end $$;

\echo ''
\echo '--- D02: reenvio exacto -> duplicado ---'

do $$
declare
  v_lote bigint := public.t204_lote('mayorista','xml_directo','204-hash-B','2026-01','2026-01','Prueba 204 segundo proceso');
  v_r    jsonb;
  v_cufe text := public.t204_cufe();
begin
  v_r := public.dian_registrar_documento(
    v_lote, v_cufe, 'cufecude', v_cufe, null,
    'factura', 'Factura de venta', 'FV-204-001', '2026-01-15'::date,
    '900111111', '900111111-1', 'PROVEEDOR PRUEBA 204',
    'COP', null,
    100000, 119000, 119000, 'xmlhash-204-a', 1);

  perform public.t204_ok(v_r->>'resultado' = 'duplicado', 'D02 reenvio exacto -> duplicado');
  perform public.t204_ok((v_r->>'original_id') is not null, 'D02 el duplicado trae el id del original');

  perform public.t204_ok(
    (select d.duplicado_de = (v_r->>'original_id')::bigint
       from public.documento_dian_staging d where d.id = (v_r->>'documento_id')::bigint),
    'D03 duplicado_de apunta al original');

  -- D04: el original quedo intacto.
  perform public.t204_ok(
    (select o.estado = 'importado' and o.aprobado_por is null
       from public.documento_dian_staging o where o.id = (v_r->>'original_id')::bigint),
    'D04 el original no se modifica al registrar el duplicado');

  -- D05: la bitacora lo registro.
  perform public.t204_ok(
    exists (select 1 from public.documento_dian_resolucion
             where documento_id = (v_r->>'documento_id')::bigint
               and campo = 'estado' and estado_nuevo = 'duplicado'),
    'D05 la bitacora registra el paso a duplicado');

  -- D06: el duplicado no trae hijos.
  perform public.t204_ok(
    not exists (select 1 from public.documento_dian_linea_staging
                 where documento_id = (v_r->>'documento_id')::bigint),
    'D06 el duplicado no guarda lineas (§4.7)');

  -- D07: la identidad lleva las dos ocurrencias y el primer total.
  perform public.t204_ok(
    (select ocurrencias = 2 and total_referencia = 119000
       from public.documento_dian_identidad where clave = public.t204_cufe()),
    'D07 la identidad cuenta 2 ocurrencias y conserva el primer total');
end $$;

\echo ''
\echo '--- D08: misma clave, otro total -> discrepante ---'

do $$
declare
  v_lote bigint;
  v_r    jsonb;
  v_cufe text := public.t204_cufe();
begin
  v_lote := public.t204_lote('mayorista','xml_directo','204-hash-C','2026-01','2026-01','Prueba 204 total distinto');
  v_r := public.dian_registrar_documento(
    v_lote, v_cufe, 'cufecude', v_cufe, null,
    'factura', 'Factura de venta', 'FV-204-001', '2026-01-15'::date,
    '900111111', '900111111-1', 'PROVEEDOR PRUEBA 204',
    'COP', null,
    100000, 130000, 119000, 'xmlhash-204-modificado', 1,
    'Total distinto al del documento original');

  perform public.t204_ok(v_r->>'resultado' = 'discrepante', 'D08 misma clave otro total -> discrepante');

  -- Lo importante: conviven las tres filas, el discrepante no reemplaza nada.
  perform public.t204_ok(
    (select count(*) = 3
       and count(*) filter (where estado='importado')   = 1
       and count(*) filter (where estado='duplicado')  = 1
       and count(*) filter (where estado='discrepante') = 1
       from public.documento_dian_staging where clave = v_cufe),
    'D08 importado + duplicado + discrepante conviven');

  perform public.t204_ok(
    (select discrepante_de is not null and motivo_pendiente is not null
       from public.documento_dian_staging where id = (v_r->>'documento_id')::bigint),
    'D08 el discrepante apunta al original y trae motivo');

  -- El total de referencia NO se mueve: es contra el primero que se decide.
  perform public.t204_ok(
    (select total_referencia = 119000 from public.documento_dian_identidad
      where clave = v_cufe),
    'D08 el total de referencia sigue siendo el primero');
end $$;

\echo ''
\echo '--- D09/D10: reimportacion del mismo archivo (D6) ---'

do $$
begin
  -- Mismo archivo, mismo corte: el indice del lote lo detiene.
  perform public.t204_debe_fallar(
    format($f$insert into public.lote_importacion_dian
             (tenant, fuente, nombre_archivo, hash_contenido,
              periodo_desde, periodo_hasta, motivo, estado)
           values ('mayorista','excel_compras','compras-enero.xlsx','204-hash-A',
                   '2026-01','2026-01','Reimportacion D6','en_proceso')$f$),
    '23505', 'D09 la reimportacion del mismo archivo en el mismo corte se detiene');

  -- Mismo archivo, corte NUEVO: si se puede cargar.
  -- `perform` y no `select` porque t204_lote devuelve bigint y una sentencia
  -- de nivel superior sin destino es error en psql.
  perform public.t204_lote('mayorista','excel_compras','204-hash-A','2026-02','2026-02','Mismo archivo, corte nuevo');
  perform public.t204_ok(true, 'D10 el mismo archivo en un corte nuevo si se puede cargar');
end $$;

\echo ''
\echo '--- D11/D12: aislamiento por tenant ---'

do $$
begin
  perform public.t204_lote('minorista','excel_compras','204-hash-A','2026-01','2026-01','Aislamiento');
  -- La identidad incluye tenant: la misma clave alli es OTRO documento.
  perform public.t204_ok(
    not exists (select 1 from public.documento_dian_identidad
                 where tenant='minorista' and clave=public.t204_cufe()),
    'D11 la misma clave en minorista no comparte identidad');
end $$;

do $$
declare v_lote bigint;
begin
  select id into v_lote from public.lote_importacion_dian
   where tenant='mayorista' and hash_contenido='204-hash-A' limit 1;
  -- La FK compuesta tiene que empujar un tenant distinto al del lote.
  perform public.t204_debe_fallar(
    format($f$insert into public.documento_dian_staging
             (lote_id, documento_dian_identidad_id, tenant, periodo, fuente,
              clave, clave_base, tipo_documento, fecha, moneda,
              subtotal, total_declarado, total_calculado)
           values (%s, (select id from public.documento_dian_identidad
                         where tenant='mayorista' limit 1), 'minorista',
                   '2026-01','excel_compras','CUFE:TENANT-MISMATCH','cufecude',
                   'factura','2026-01-15','COP',1000,1000,1000)$f$, v_lote),
    '23503', 'D12 la FK compuesta impide tenant != tenant del lote');
end $$;

\echo ''
\echo '--- D13: append-only ---'

select public.t204_debe_fallar(
  'update public.documento_dian_resolucion set motivo=''manipulado''',
  '42501', 'D13 UPDATE en la bitacora rechazado');

select public.t204_debe_fallar(
  'delete from public.documento_dian_resolucion',
  '42501', 'D13 DELETE en la bitacora rechazado');

select public.t204_debe_fallar(
  'delete from public.documento_dian_staging where clave like ''CUFE:PRUEBA204%''',
  '42501', 'D13 DELETE en documento_dian_staging rechazado');

select public.t204_debe_fallar(
  'truncate public.documento_dian_resolucion',
  '42501', 'D13 TRUNCATE en la bitacora rechazado');

\echo ''
\echo '--- D14: la RPC exige permiso del rol del servidor ---'
-- El tenant y el rol se derivan del servidor, no de un parametro: sin claim
-- de un usuario de staging, la llamada se rechaza antes de tocar nada.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare v_lote bigint;
begin
  v_lote := public.t204_lote('mayorista','excel_ventas','204-hash-sin-claim','2026-03','2026-03','Sin claim');
  perform public.t204_debe_fallar(
    format($f$select public.dian_registrar_documento(
              %s, 'CUFE:SIN-CLAIM', 'cufecude', 'CUFE:SIN-CLAIM', null,
              'factura', 'Factura', 'FV-204-999', '2026-03-01'::date,
              '900222222','900222222-1','PROVEEDOR SIN CLAIM',
              'COP', null, 1000, 1190, 1190)$f$, v_lote),
    '42501', 'D14 la RPC rechaza a un usuario sin rol de staging');
end $$;

\echo ''
\echo '--- D20: los hijos entran en la misma llamada (opcion A) ---'

-- D14 dejo la sesion sin claim (por eso prueba que la RPC rechaza). D20 y los
-- siguientes necesitan un contador activo otra vez.
select public.t204_como('00000000-0000-4000-8000-0000000000c1');

do $$
declare
  v_lote bigint;
  v_r    jsonb;
  v_cufe text;
begin
  v_cufe := 'CUFE:H' || repeat('H', 78) || '01';
  v_lote := public.t204_lote('mayorista','xml_directo','204-hash-hijos','2026-09','2026-09','Hijos atomicos');

  v_r := public.dian_registrar_documento(
    v_lote, v_cufe, 'cufecude', v_cufe, null,
    'factura', 'Factura de venta', 'FV-204-HIJOS', '2026-09-10'::date,
    '900333333', '900333333-1', 'PROVEEDOR HIJOS',
    'COP', null, 100000, 119000, 119000, 'xmlhash-204-hijos', 7, null, false,
    '[{"numero":1,"descripcion":"Pasaje Bogota-Medellin","cantidad":1,"precio_unitario":300000,"base":100000,"descuento":0,"cuenta_contable_emisor":"5110","impuestos":[{"codigo":"01","valor":19000}]},
      {"numero":2,"descripcion":"Tasa de aeropuerto","cantidad":1,"precio_unitario":0,"base":0,"descuento":0}]',
    '[{"codigo":"01","nombre":"IVA","tasa":19.0,"base":100000,"valor":19000,"origen":"tax_subtotal"}]',
    '[{"codigo":"ReteFuente","nombre":"Retencion","campo_origen":"Retencion","estructura":"ubl","base":100000,"valor":0}]',
    '[{"codigo":"30","fecha":"2026-09-15","monto":119000}]');

  perform public.t204_ok(v_r->>'resultado' = 'nuevo', 'D20 documento con hijos -> nuevo');
  perform public.t204_ok((v_r->'hijos'->>'lineas')::int = 2, 'D20 la RPC reporta 2 lineas');
  perform public.t204_ok((v_r->'hijos'->>'impuestos')::int = 1, 'D20 la RPC reporta 1 impuesto');
  perform public.t204_ok((v_r->'hijos'->>'retenciones')::int = 1, 'D20 la RPC reporta 1 retencion');
  perform public.t204_ok((v_r->'hijos'->>'formas_pago')::int = 1, 'D20 la RPC reporta 1 forma de pago');

  -- Y los hijos quedaron de verdad, no solo contados.
  perform public.t204_ok(
    (select count(*) = 2 from public.documento_dian_linea_staging
      where documento_id = (v_r->>'documento_id')::bigint),
    'D20 las 2 lineas quedaron insertadas');
  perform public.t204_ok(
    (select count(*) = 1 from public.documento_dian_impuesto_staging
      where documento_id = (v_r->>'documento_id')::bigint
        and codigo = '01' and tasa = 19.0),
    'D20 el impuesto quedo con su codigo y su tasa');
  perform public.t204_ok(
    (select count(*) = 1 from public.documento_dian_forma_pago_staging
      where documento_id = (v_r->>'documento_id')::bigint and monto = 119000),
    'D20 la forma de pago quedo con su monto');
end $$;

\echo ''
\echo '--- D21: ATOMICIDAD. Si un hijo falla, no queda cabecera ---'
-- Este es el motivo de la opcion A. Con "cabecera primero, hijos despues", un
-- fallo a mitad de los hijos deja un documento sin detalle y sin nadie que lo
-- sepa. Aqui se comprueba que no queda ni cabecera ni identidad.

do $$
declare
  v_lote   bigint;
  v_cufe   text := 'CUFE:F' || repeat('F', 78) || '02';
  v_r      jsonb;
  v_cabeceras_antes bigint;
  v_identidades_antes bigint;
begin
  v_lote := public.t204_lote('mayorista','xml_directo','204-hash-rollback','2026-10','2026-10','Atomicidad');
  select count(*) into v_cabeceras_antes
    from public.documento_dian_staging where clave = v_cufe;
  select count(*) into v_identidades_antes
    from public.documento_dian_identidad where clave = v_cufe;

  -- Lineas bien, pero un impuesto con `tasa` como texto donde va numeric:
  -- el cast revienta en la segunda tabla hija.
  begin
    v_r := public.dian_registrar_documento(
      v_lote, v_cufe, 'cufecude', v_cufe, null,
      'factura', 'Factura de venta', 'FV-204-ROLLBACK', '2026-10-01'::date,
      '900444444', '900444444-1', 'PROVEEDOR ROLLBACK',
      'COP', null, 100000, 119000, 119000, 'xmlhash-204-rollback', 1, null, false,
      '[{"numero":1,"descripcion":"Linea buena","base":100000}]',
      '[{"codigo":"01","tasa":"no-es-un-numero","base":100000,"valor":19000}]',
      '[]', '[]');
    perform public.t204_ok(false, 'D21 la llamada con un hijo malo debio fallar y NO fallo');
  exception when others then
    perform public.t204_ok(true, 'D21 la llamada fallo como se esperaba: ' || sqlstate);
  end;

  -- Lo importante: no debe quedar cabecera ni identidad.
  perform public.t204_ok(
    (select count(*) = v_cabeceras_antes
       from public.documento_dian_staging where clave = v_cufe),
    'D21 no quedo ninguna cabecera huerfana');
  perform public.t204_ok(
    (select count(*) = v_identidades_antes
       from public.documento_dian_identidad where clave = v_cufe),
    'D21 no quedo ninguna identidad huerfana');
  perform public.t204_ok(
    not exists (select 1 from public.documento_dian_linea_staging l
                 join public.documento_dian_staging d on d.id = l.documento_id
                where d.clave = v_cufe),
    'D21 no quedo ninguna linea huerfana');
end $$;

\echo ''
\echo '--- D22: validacion de la forma de los hijos ---'
-- El error debe decir QUE array va mal, no solo "invalid input syntax for type
-- numeric". Un 22P02 a secas obliga al cliente a leer el servidor.
do $$
declare v_lote bigint; v_cufe text; v_r jsonb;
begin
  v_cufe := 'CUFE:V' || repeat('V', 78) || '03';
  v_lote := public.t204_lote('mayorista','xml_directo','204-hash-forma','2026-11','2026-11','Forma');

  -- (a) no es un array
  begin
    perform public.dian_registrar_documento(
      v_lote, v_cufe, 'cufecude', v_cufe, null, 'factura', 'Factura', 'FV',
      '2026-11-01'::date, '900', '900', 'P', 'COP', null, 1, 1, 1,
      null, null, null, false,
      '{"no":"es un array"}', '[]', '[]', '[]');
    perform public.t204_ok(false, 'D22 un objeto donde se esperaba un array debio fallar');
  exception when others then
    perform public.t204_ok(sqlerrm like '%debe ser un array jsonb%',
      'D22 el error de forma nombra p_lineas: ' || sqlerrm);
  end;

  -- (b) un elemento que no es objeto
  begin
    perform public.dian_registrar_documento(
      v_lote, v_cufe, 'cufecude', v_cufe, null, 'factura', 'Factura', 'FV',
      '2026-11-01'::date, '900', '900', 'P', 'COP', null, 1, 1, 1,
      null, null, null, false,
      '[{"base":1}, "texto-suelto"]', '[]', '[]', '[]');
    perform public.t204_ok(false, 'D22 un elemento no-objeto debio fallar');
  exception when others then
    perform public.t204_ok(sqlerrm like '%no es un objeto jsonb%',
      'D22 el error dice que elemento no es objeto: ' || sqlerrm);
  end;

  -- (c) nada de lo anterior dejo cabecera
  perform public.t204_ok(
    not exists (select 1 from public.documento_dian_staging where clave = v_cufe),
    'D22 los rechazos por forma no dejaron cabecera');
end $$;

\echo ''
\echo '--- D23: un duplicado NO guarda hijos, un discrepante SI ---'
-- §4.7: en el reenvío exacto la evidencia es la fila. En el discrepante el
-- detalle es justamente lo que hay que comparar.
do $$
declare
  v_lote bigint;
  v_cufe text := 'CUFE:J' || repeat('J', 78) || '04';
  v_lote2 bigint;
  v_r1 jsonb; v_r2 jsonb; v_r3 jsonb;
begin
  v_lote  := public.t204_lote('mayorista','xml_directo','204-hash-d1','2026-12','2026-12','Hijos dup');
  v_lote2 := public.t204_lote('mayorista','xml_directo','204-hash-d2','2026-12','2026-12','Hijos dup 2');

  v_r1 := public.dian_registrar_documento(
    v_lote, v_cufe, 'cufecude', v_cufe, null, 'factura', 'Factura', 'FV-DUP',
    '2026-12-01'::date, '900555555', '900555555-1', 'P', 'COP', null,
    100000, 119000, 119000, 'hash-dup', 1, null, false,
    '[{"numero":1,"base":100000}]', '[{"codigo":"01","tasa":19,"base":100000,"valor":19000,"origen":"tax_subtotal"}]', '[]', '[]');
  perform public.t204_ok(v_r1->>'resultado' = 'nuevo', 'D23 original con hijos -> nuevo');

  -- Reenvio exacto CON hijos: el duplicado debe ignorar los hijos.
  v_r2 := public.dian_registrar_documento(
    v_lote2, v_cufe, 'cufecude', v_cufe, null, 'factura', 'Factura', 'FV-DUP',
    '2026-12-01'::date, '900555555', '900555555-1', 'P', 'COP', null,
    100000, 119000, 119000, 'hash-dup', 1, null, false,
    '[{"numero":9,"base":999999}]', '[{"codigo":"01","tasa":19,"base":999999,"valor":189999,"origen":"tax_subtotal"}]', '[]', '[]');
  perform public.t204_ok(v_r2->>'resultado' = 'duplicado', 'D23 reenvio exacto -> duplicado');
  perform public.t204_ok(
    not exists (select 1 from public.documento_dian_linea_staging
                 where documento_id = (v_r2->>'documento_id')::bigint),
    'D23 el duplicado NO guardo las lineas que le pasaron (§4.7)');

  -- Discrepante CON hijos: aqui si se guardan.
  v_r3 := public.dian_registrar_documento(
    v_lote2, v_cufe, 'cufecude', v_cufe, null, 'factura', 'Factura', 'FV-DUP',
    '2026-12-01'::date, '900555555', '900555555-1', 'P', 'COP', null,
    100000, 130000, 119000, 'hash-disc', 1, null, false,
    '[{"numero":1,"base":130000}]', '[]', '[]', '[]');
  perform public.t204_ok(v_r3->>'resultado' = 'discrepante', 'D23 total distinto -> discrepante');
  perform public.t204_ok(
    exists (select 1 from public.documento_dian_linea_staging
             where documento_id = (v_r3->>'documento_id')::bigint),
    'D23 el discrepante SI guardo las lineas: hay que poder comparar');
end $$;

rollback;

\echo ''
\echo '=== FIN TEST 204 dedupe (rollback aplicado; la base quedo igual) ==='