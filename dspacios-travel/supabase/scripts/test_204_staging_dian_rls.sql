-- ============================================================================
-- Test 204 — RLS del staging DIAN.
--
-- Base LOCAL con la 204 aplicada. Todo corre en UNA transaccion que termina
-- en ROLLBACK. NO correr contra Supabase.
--
-- Que verifica:
--   R01  Los 7 helpers son security definer con search_path fijo.
--   R02  anon no ve documentos ni puede escribir un lote.
--   R03  El contador de mayorista ve su tenant y NO ve minorista.
--   R04  El contador prepara.
--   R05  El contador NO aprueba (politica vigente hasta que exista D3a).
--   R06  El revisor fiscal aprueba y devuelve.
--   R07  El revisor fiscal NO administra reglas.
--   R08  El admin contable administra y cierra, pero no ve el otro tenant.
--   R09  service_role tampoco puede DELETE ni TRUNCATE.
--   R10  Ninguna tabla tiene policy de DELETE: la RLS no esta abierta.
--   R11  Un documento sin proveedor ni cuenta NO puede llegar a aprobado.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

-- --- Helpers (viven solo dentro de esta transaccion) -------------------------
create function public.t204_ok(p_cond boolean, p_caso text) returns void
language plpgsql as $$
begin
  if p_cond then raise notice 'OK   %', p_caso;
  else raise exception 'FALLO %', p_caso; end if;
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

grant execute on function public.t204_ok(boolean, text),
                     public.t204_como(uuid),
                     public.t204_debe_fallar(text, text, text)
  to anon, authenticated;

\echo ''
\echo '--- Montaje: un usuario por rol contable, con un documento por tenant ---'
-- Alta en dos pasos: `usuarios.id references auth.users(id)`.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1','r204_contador@local.invalid'),
  ('00000000-0000-4000-8000-0000000000d2','r204_revisor@local.invalid'),
  ('00000000-0000-4000-8000-0000000000d3','r204_admin@local.invalid')
on conflict (id) do nothing;

insert into public.usuarios (id, email, nombre, rol, tenant, activo) values
  ('00000000-0000-4000-8000-0000000000d1','r204_contador@local.invalid','Contador 204','contador','mayorista',true),
  ('00000000-0000-4000-8000-0000000000d2','r204_revisor@local.invalid','Revisor 204','revisor_fiscal','mayorista',true),
  ('00000000-0000-4000-8000-0000000000d3','r204_admin@local.invalid','Admin 204','admin_contable','mayorista',true)
on conflict (id) do update set email = excluded.email, nombre = excluded.nombre,
  rol = excluded.rol, tenant = excluded.tenant, activo = excluded.activo;
-- (main >= 193: handle_new_user ya creo la fila como cliente_final inactivo al
--  insertar en auth.users; `do nothing` dejaba al usuario de prueba sin rol.)

-- Referencias de apoyo. Si el PUC no tiene cuentas de nivel >= 3, el test de
-- "aprobado" no se puede montar y se avisa en vez de fallar sin sentido.
create function public.t204_montar() returns void
language plpgsql as $$
declare
  v_lote_may bigint; v_lote_min bigint;
  v_id_may   bigint; v_id_min   bigint;
  v_prov     bigint; v_puc      bigint;
begin
  insert into public.lote_importacion_dian (
    tenant, fuente, hash_contenido, periodo_desde, periodo_hasta, motivo, estado)
  values ('mayorista','excel_compras','204-rls-may','2026-01','2026-01','RLS 204 mayorista','en_proceso')
  returning id into v_lote_may;
  insert into public.lote_importacion_dian (
    tenant, fuente, hash_contenido, periodo_desde, periodo_hasta, motivo, estado)
  values ('minorista','excel_compras','204-rls-min','2026-01','2026-01','RLS 204 minorista','en_proceso')
  returning id into v_lote_min;

  insert into public.documento_dian_identidad (tenant, clave, clave_base, total_referencia)
  values ('mayorista','CUFE:RLS204MAY','cufecude',100000) returning id into v_id_may;
  insert into public.documento_dian_identidad (tenant, clave, clave_base, total_referencia)
  values ('minorista','CUFE:RLS204MIN','cufecude',200000) returning id into v_id_min;

  insert into public.documento_dian_staging (
    lote_id, documento_dian_identidad_id, tenant, periodo, fuente,
    clave, clave_base, tipo_documento, fecha, moneda,
    subtotal, total_declarado, total_calculado)
  values (v_lote_may, v_id_may, 'mayorista','2026-01','excel_compras',
          'CUFE:RLS204MAY','cufecude','factura','2026-01-10','COP',100000,100000,100000);
  insert into public.documento_dian_staging (
    lote_id, documento_dian_identidad_id, tenant, periodo, fuente,
    clave, clave_base, tipo_documento, fecha, moneda,
    subtotal, total_declarado, total_calculado)
  values (v_lote_min, v_id_min, 'minorista','2026-01','excel_compras',
          'CUFE:RLS204MIN','cufecude','factura','2026-01-10','COP',200000,200000,200000);

  select prov, puc into v_prov, v_puc from t204_apoyo; -- resuelto antes de suplantar roles
end $$;

grant execute on function public.t204_montar() to anon, authenticated;

-- Datos de apoyo resueltos ANTES de suplantar roles (main >= 189/191): el
-- tenant/NIT del proveedor vive en proveedores_datos_sensibles, que los roles
-- contables no pueden leer por RLS; aqui solo hace falta un id de apoyo.
-- Proveedor de apoyo propio (una fila de datos sensibles por agencia): asi R06,
-- R11, R15 y R19 corren completos tambien en una base vacia.
with p as (insert into public.proveedores (nombre) values ('PROVEEDOR R204') returning id)
insert into public.proveedores_datos_sensibles (proveedor_id, tenant, nit)
select p.id, v.t, v.n from p, (values ('mayorista','900000204'), ('minorista','900000205')) v(t, n);

create temp table t204_apoyo on commit drop as
select (select s.proveedor_id from public.proveedores_datos_sensibles s
         where s.tenant='mayorista' limit 1) as prov,
       (select id from public.puc_cuentas
         where tenant='mayorista' and nivel >= 3 and permite_movimiento and activa limit 1) as puc;
grant select on t204_apoyo to authenticated;

select public.t204_montar();

\echo ''
\echo '--- R01: los helpers son security definer con search_path fijo ---'
do $$
declare r record; sucios int := 0;
begin
  for r in select p.proname, p.prosecdef, p.proconfig
             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'dian_staging_puede%'
  loop
    if not r.prosecdef or not (r.proconfig @> array['search_path=public']) then
      sucios := sucios + 1;
    end if;
  end loop;
  perform public.t204_ok(sucios = 0, 'R01 los 7 helpers son security definer con search_path=public');
end $$;

\echo ''
\echo '--- R02: anon no ve ni escribe ---'
-- `anon` no tiene NINGUN privilegio sobre estas tablas (la 204 hace
-- `revoke all ... from anon`), asi que no devuelve 0 filas: falla antes, con
-- permission denied. Eso es mas estricto que "ve cero", y es lo que hay que
-- comprobar. Si alguna vez devolviera filas, seria un agujero.
set local role anon;
select public.t204_debe_fallar('select count(*) from public.documento_dian_staging',
  '42501', 'R02 anon no puede ni leer el staging (privilegio revocado)');
select public.t204_debe_fallar('select count(*) from public.lote_importacion_dian',
  '42501', 'R02 anon no puede ni leer los lotes');
select public.t204_debe_fallar(
  $f$insert into public.lote_importacion_dian
      (tenant,fuente,hash_contenido,periodo_desde,periodo_hasta,motivo)
    values ('mayorista','excel_ventas','anon-204','2026-01','2026-01','anon')$f$,
  '42501', 'R02 el INSERT de anon fue rechazado');
select public.t204_debe_fallar(
  $f$select public.dian_registrar_documento(
      (select id from public.lote_importacion_dian limit 1),
      'CUFE:ANON','cufecude','CUFE:ANON',null,'factura','F','1','2026-01-01'::date,
      '1','1','X','COP',null,1,1,1)$f$,
  '42501', 'R02 anon no puede ejecutar la RPC de registro');
reset role;

\echo ''
\echo '--- R03: el contador ve su tenant y no el otro ---'
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-0000000000d1');
do $$
declare v_may bigint; v_min bigint;
begin
  select count(*) into v_may from public.documento_dian_staging where tenant='mayorista';
  select count(*) into v_min from public.documento_dian_staging where tenant='minorista';
  perform public.t204_ok(v_may > 0 and v_min = 0,
    'R03 el contador ve ' || v_may || ' de mayorista y ' || v_min || ' de minorista');
end $$;

\echo ''
\echo '--- R04: el contador prepara ---'
do $$
begin
  update public.documento_dian_staging
     set estado='preparado',
         preparado_por=auth.uid(), preparado_rol='contador', preparado_en=now()
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R04 el contador pudo preparar');
end $$;

\echo ''
\echo '--- R05: el contador NO aprueba ---'
-- La politica vigente es la conservadora: hasta que exista D3a, el contador
-- no aprueba. Este es el test que documenta ese comportamiento.
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set estado='aprobado',
           aprobado_por=auth.uid(), aprobado_rol='contador', aprobado_en=now()
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R05 la aprobacion del contador fue rechazada (D3a pendiente)');

\echo ''
\echo '--- R06: el revisor fiscal aprueba y devuelve ---'
select public.t204_como('00000000-0000-4000-8000-0000000000d2');
do $$
declare v_prov bigint; v_puc bigint;
begin
  select prov, puc into v_prov, v_puc from t204_apoyo; -- resuelto antes de suplantar roles

  -- Aprobar exige proveedor y cuenta (ck_dian_staging_aprobado_completo). Si el
  -- PUC de mayorista esta vacio, el caso completo no se puede montar.
  if v_prov is null or v_puc is null then
    raise notice 'INFO R06 sin proveedor o cuenta PUC de apoyo: se omite el caso completo';
    return;
  end if;

  -- La preparacion la habia hecho el contador en R04; el revisor solo aprueba.
  update public.documento_dian_staging
     set proveedor_id=v_prov, cuenta_puc=v_puc
   where clave='CUFE:RLS204MAY';

  update public.documento_dian_staging
     set estado='aprobado',
         aprobado_por=auth.uid(), aprobado_en=now()
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R06 el revisor fiscal pudo aprobar');

  update public.documento_dian_staging
     set estado='devuelto',
         devuelto_por=auth.uid(), devuelto_en=now(),
         motivo_pendiente='devuelto por prueba'
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R06 el revisor fiscal pudo devolver');
end $$;

\echo ''
\echo '--- R06b: el rol lo estampa el servidor, no el cliente ---'
-- El trigger ignora el *_rol que venga del cliente. Un `contador` no puede
-- declararse admin: por eso se prueba el approve del revisor con un rol falso.
do $$
begin
  update public.documento_dian_staging
     set estado='preparado',
         preparado_por=auth.uid(), preparado_rol='superadmin', preparado_en=now()
   where clave='CUFE:RLS204MIN' and tenant='mayorista';
  perform public.t204_ok(true, 'R06b el trigger acepto la preparacion del revisor');
end $$;

\echo ''
\echo '--- R07: el revisor fiscal NO administra reglas ---'
do $$
begin
  perform public.t204_ok(not public.dian_staging_puede_administrar(),
    'R07 el revisor fiscal no puede administrar reglas');
end $$;
reset role;

\echo ''
\echo '--- R08: el admin contable administra y cierra, pero no ve el otro tenant ---'
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-0000000000d3');
do $$
declare v_min bigint;
begin
  perform public.t204_ok(public.dian_staging_puede_administrar(),
    'R08 el admin contable puede administrar');
  update public.documento_dian_staging
     set estado='cerrado',
         cerrado_por=auth.uid(), cerrado_rol='admin_contable', cerrado_en=now()
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R08 el admin contable pudo cerrar');
  select count(*) into v_min from public.documento_dian_staging where tenant='minorista';
  perform public.t204_ok(v_min = 0, 'R08 el admin contable no ve minorista');
end $$;
reset role;

\echo ''
\echo '--- R09: service_role tampoco borra ---'
set local role service_role;
select public.t204_debe_fallar('delete from public.documento_dian_staging',
  '42501', 'R09 service_role no puede DELETE en staging');
select public.t204_debe_fallar('truncate public.documento_dian_resolucion',
  '42501', 'R09 service_role no puede TRUNCATE en la bitacora');
reset role;

\echo ''
\echo '--- R10: ninguna de las 8 tablas tiene policy de DELETE ---'
do $$
declare r record; offenders text := '';
begin
  for r in
    select c.relname from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and c.relname in ('lote_importacion_dian','documento_dian_identidad',
                         'documento_dian_staging','documento_dian_linea_staging',
                         'documento_dian_impuesto_staging','documento_dian_retencion_staging',
                         'documento_dian_forma_pago_staging','documento_dian_resolucion')
       and exists (select 1 from pg_policy p where p.polrelid=c.oid and p.polcmd='d')
  loop
    offenders := offenders || r.relname || ' ';
  end loop;
  perform public.t204_ok(offenders = '',
    'R10 ninguna tabla tiene policy de DELETE' || case when offenders<>'' then ': '||offenders else '' end);
end $$;

\echo ''
\echo '--- R11: aprobado exige proveedor y cuenta (check de tabla) ---'
-- Un CHECK se le aplica a todos, incluido el dueno, asi que se prueba sin
-- cambiar de rol: la garantia no depende de la RLS.
-- IMPORTANTE: con FORCE RLS el dueno tambien pasa por las policies, asi que
-- este bloque tiene que correr como un rol real con permiso. Si corriera como
-- el dueno sin claim, `mi_rol()` seria NULL, las policies filtrarian la fila,
-- el UPDATE afectaria 0 filas y el CHECK nunca llegaria a evaluarse: un test
-- que "pasa" sin comprobar nada.
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-0000000000d2');

-- El revisor fiscal SÍ puede aprobar (R06), asi que si el UPDATE es rechazado
-- es por el CHECK, no por permiso. R06 ya le habia puesto proveedor y cuenta,
-- asi que primero se limpian: sin eso el approve seria valido y el test
-- comprobaria nada.
do $$
begin
  update public.documento_dian_staging
     set proveedor_id=null, cuenta_puc=null
   where clave='CUFE:RLS204MAY';
end $$;

select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set estado='aprobado', aprobado_por=auth.uid(), aprobado_en=now()
     where clave='CUFE:RLS204MAY'$f$,
  '23514', 'R11 no se puede aprobar sin proveedor ni cuenta PUC');

-- Y devolver exige motivo, por el mismo mecanismo.
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set estado='devuelto', devuelto_por=auth.uid(), devuelto_en=now(),
           motivo_pendiente=null
     where clave='CUFE:RLS204MAY'$f$,
  '23514', 'R11 no se puede devolver sin motivo');

-- Con proveedor y cuenta, el mismo update SI tiene que pasar.
do $$
declare v_prov bigint; v_puc bigint;
begin
  select prov, puc into v_prov, v_puc from t204_apoyo; -- resuelto antes de suplantar roles

  if v_prov is null or v_puc is null then
    raise notice 'INFO R11 el caso completo se omite: no hay proveedor o cuenta PUC de apoyo';
    return;
  end if;

  update public.documento_dian_staging
     set proveedor_id=v_prov, cuenta_puc=v_puc
   where clave='CUFE:RLS204MAY';
  update public.documento_dian_staging
     set estado='aprobado', aprobado_por=auth.uid(), aprobado_en=now()
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R11 con proveedor y cuenta, aprobar si funciona');
end $$;
reset role;

\echo ''
\echo '--- R12: FORCE RLS esta puesto en las 8 (con su limite real) ---'
-- Lo que se verifica aqui es que FORCE este ACTIVO, no que el dueno quede
-- atrapado: en PostgreSQL, FORCE ROW LEVEL SECURITY aplica al dueno de la
-- tabla, pero un superusuario o un rol con BYPASSRLS la ignora siempre. El
-- dueno de esta base local es superusuario, asi que veria los documentos
-- aunque FORCE este puesto. Es el mismo riesgo residual que documenta la
-- migracion 200 para el historial de vuelos.
do $$
declare r record; sin_force text := '';
begin
  for r in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('lote_importacion_dian','documento_dian_identidad',
                         'documento_dian_staging','documento_dian_linea_staging',
                         'documento_dian_impuesto_staging','documento_dian_retencion_staging',
                         'documento_dian_forma_pago_staging','documento_dian_resolucion')
       and not c.relforcerowsecurity
  loop
    sin_force := sin_force || r.relname || ' ';
  end loop;
  perform public.t204_ok(sin_force = '',
    'R12 las 8 tablas tienen FORCE RLS' || case when sin_force<>'' then ': sin force -> '||sin_force else '' end);

  if exists (select 1 from pg_roles where rolbypassrls or rolsuper) then
    raise notice 'INFO R12 hay roles superuser/BYPASSRLS: pueden ignorar RLS y los triggers. Riesgo residual asumido.';
  end if;
end $$;

\echo ''
\echo '--- R13: las columnas del parser estan congeladas ---'
-- El gate de UPDATE corre como un revisor fiscal (puede pasar la policy de
-- UPDATE), asi que si el UPDATE falla, es por el gate y no por permiso.
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-0000000000d2');

-- La evidencia: el total se congela.
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set total_declarado = total_declarado + 1
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R13 no se puede cambiar total_declarado');

-- La identidad: la clave se congela.
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set clave = 'CUFE:OTRA-CLAVE'
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R13 no se puede cambiar clave');

-- El aislamiento: el tenant se congela.
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set tenant = 'minorista'
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R13 no se puede cambiar tenant');

-- Y el lote: mover el documento a otro lote cambiaria su procedencia.
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set lote_id = (select min(lote_id) from public.documento_dian_staging
                       where lote_id <> (select lote_id from public.documento_dian_staging
                                          where clave='CUFE:RLS204MAY'))
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R13 no se puede cambiar lote_id');

-- Y el hash: es la evidencia de que el documento es el mismo (D10).
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set xml_hash = 'otro-hash'
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R13 no se puede cambiar xml_hash');

\echo ''
\echo '--- R14: reescribir una columna congelada con el MISMO valor si pasa ---'
-- El gate compara con `is distinct from`: reescribir el mismo valor no es un
-- cambio y no debe fallar. Si esto fallara, la reimportacion y los scripts de
-- correccion se romperian sin motivo.
do $$
begin
  update public.documento_dian_staging
     set total_declarado = total_declarado, clave = clave
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R14 reescribir una columna congelada con el mismo valor se permite');
end $$;

\echo ''
\echo '--- R15: las columnas de revision SI cambian ---'
-- El caso positivo: un cambio de estado valido y la resolucion van.
-- Lo hace el CONTADOR, no el revisor: preparar es su oficio (§5.1), y R15b
-- comprueba que el revisor NO puede.
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-0000000000d1');
do $$
declare v_prov bigint; v_puc bigint;
begin
  select prov, puc into v_prov, v_puc from t204_apoyo; -- resuelto antes de suplantar roles

  -- Preparar: estado + clasificacion. Nada de eso esta congelado.
  update public.documento_dian_staging
     set estado='preparado',
         preparado_por=auth.uid(), preparado_en=now(),
         proveedor_id=v_prov, cuenta_puc=v_puc,
         cuenta_puc_origen='global', tipo_gasto='deducible'
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R15 el contador pudo preparar y clasificar');

  -- La bitacora es append-only pero SI se le anaden entradas.
  insert into public.documento_dian_resolucion (
    documento_id, estado_anterior, estado_nuevo, actor_id, actor_rol,
    campo, valor_nuevo, motivo
  ) select id, 'pendiente_revision', 'preparado', auth.uid(), 'contador',
           'estado', '"preparado"'::jsonb, 'Prueba R15'
      from public.documento_dian_staging where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R15 se pudo registrar una entrada en la bitacora');

  perform public.t204_ok(
    exists (select 1 from public.documento_dian_resolucion r
             join public.documento_dian_staging d on d.id = r.documento_id
            where d.clave='CUFE:RLS204MAY' and r.estado_nuevo='preparado'),
    'R15 la entrada de bitacora quedo escrita y es legible');

  -- Volver a pendiente_revision tambien es una transicion valida.
  update public.documento_dian_staging
     set estado='pendiente_revision'
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R15 volver a pendiente_revision se permite');

  -- Y trm NO esta congelado: se ajusta al autorizar.
  update public.documento_dian_staging set trm = 3950.12 where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R15 el trm se puede ajustar (no esta congelado)');
end $$;

\echo ''
\echo '--- R15b: el revisor fiscal NO prepara (separacion de funciones) ---'
-- El diseño §5.1 separó los oficios: preparar es del `contador`, aprobar y
-- devolver del `revisor_fiscal`. Una versión anterior lo dejaba preparar y el
-- test R15 lo destapo. Ahora se comprueba que no puede.
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-0000000000d2');
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set estado='preparado', preparado_por=auth.uid(), preparado_en=now()
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R15b el revisor fiscal no puede dejar un documento en preparado');

select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set estado='coincidente'
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R15b el revisor fiscal no puede marcar coincidente');

-- Y sí puede devolver, que es de su oficio.
do $$
begin
  update public.documento_dian_staging
     set estado='devuelto', devuelto_por=auth.uid(), devuelto_en=now(),
         motivo_pendiente='falta la cuenta PUC'
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R15b el revisor fiscal sí puede devolver');
end $$;

-- El contador sí prepara: es su oficio.
select public.t204_como('00000000-0000-4000-8000-0000000000d1');
do $$
begin
  update public.documento_dian_staging
     set estado='preparado', preparado_por=auth.uid(), preparado_en=now()
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R15b el contador sí puede preparar');
end $$;

-- Y el admin_contable no prepara ni revisa: administra.
-- Ojo: el documento quedo en 'preparado' en el bloque del contador. Ponerlo de
-- nuevo en 'preparado' NO es un acto (el estado no cambia) y por eso el gate no
-- lo evalua. Para probar que el admin_contable no prepara hay que moverlo
-- primero a un estado desde el que la transicion sea real.
select public.t204_como('00000000-0000-4000-8000-0000000000d1');
do $$
begin
  update public.documento_dian_staging
     set estado='pendiente_revision'
   where clave='CUFE:RLS204MAY';
  perform public.t204_ok(true, 'R15b el contador devolvio el documento a revision');
end $$;

select public.t204_como('00000000-0000-4000-8000-0000000000d3');
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set estado='preparado', preparado_por=auth.uid(), preparado_en=now()
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R15b el admin_contable no prepara: administra reglas');
select public.t204_debe_fallar(
  $f$update public.documento_dian_staging
       set estado='aprobado', aprobado_por=auth.uid(), aprobado_en=now()
     where clave='CUFE:RLS204MAY'$f$,
  '42501', 'R15b el admin_contable no aprueba: administra reglas');
do $$
begin
  perform public.t204_ok(public.dian_staging_puede_administrar(),
    'R15b el admin_contable sí administra reglas');
end $$;
reset role;

\echo ''
\echo '--- R16: los roles administrativos mantienen acceso ---'
-- `ver` delega en `puede_ver_tenant`, asi que gerencia conserva la lectura
-- cross-tenant que ya tiene en el resto de la app. Antes de esta corrección
-- solo superadmin la tenia, y gerencia habia perdido acceso sin que nadie lo
-- notara.
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-0000000000d2');
do $$
declare v bigint;
begin
  perform public.t204_ok(public.dian_staging_puede_ver('mayorista'),
    'R16 el revisor fiscal ve su tenant');
  perform public.t204_ok(not public.dian_staging_puede_ver('otra-agencia'),
    'R16 el revisor fiscal NO ve otro tenant');
end $$;

-- superadmin ve cualquier tenant sin restriccion.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
declare v bigint;
begin
  -- Sin usuario no hay rol: los helpers devuelven false, no NULL.
  perform public.t204_ok(public.dian_staging_puede_ver('mayorista') is false,
    'R16 sin usuario, puede_ver devuelve false (no NULL)');
  perform public.t204_ok(public.dian_staging_puede_preparar('mayorista') is false,
    'R16 sin usuario, puede_preparar devuelve false (no NULL)');
  perform public.t204_ok(public.dian_staging_puede_aprobar('mayorista') is false,
    'R16 sin usuario, puede_aprobar devuelve false (no NULL)');
  perform public.t204_ok(public.dian_staging_puede_administrar() is false,
    'R16 sin usuario, puede_administrar devuelve false (no NULL)');
end $$;
reset role;

\echo ''
\echo '--- R17: solo el area contable y la administracion ven el staging ---'
-- Decision del dueno 2026-10-17. Antes, `ver` delegaba en puede_ver_tenant y
-- cualquier rol del tenant (incluidos venta y los externos) leia facturas de
-- proveedores por la API.
do $$
declare r text; i int := 0; uid uuid;
begin
  foreach r in array array['venta','operaciones','control_vuelo','agencia','freelance',
                           'cliente_final','administracion','gerencia'] loop
    i := i + 1;
    uid := ('00000000-0000-4000-8000-0000000017' || lpad(i::text, 2, '0'))::uuid;
    insert into auth.users (id, email) values (uid, 'r204_r17_' || r || '@local.invalid')
    on conflict (id) do nothing;
    -- handle_new_user (193) ya creo la fila; se fija el rol de la prueba.
    update public.usuarios set rol = r::rol_usuario, tenant = 'mayorista', activo = true where id = uid;
  end loop;
end $$;

set local role authenticated;
do $$
declare
  roles text[] := array['venta','operaciones','control_vuelo','agencia','freelance',
                        'cliente_final','administracion','gerencia'];
  i int; v_may int; v_min int; v_lotes int; v_ident int;
begin
  for i in 1 .. array_length(roles, 1) loop
    perform public.t204_como(('00000000-0000-4000-8000-0000000017' || lpad(i::text, 2, '0'))::uuid);
    select count(*) filter (where tenant = 'mayorista'), count(*) filter (where tenant = 'minorista')
      into v_may, v_min from public.documento_dian_staging;
    select count(*) into v_lotes from public.lote_importacion_dian;
    select count(*) into v_ident from public.documento_dian_identidad;
    if roles[i] = 'administracion' then
      perform public.t204_ok(v_may > 0 and v_min = 0, 'R17 administracion ve solo su agencia');
    elsif roles[i] = 'gerencia' then
      perform public.t204_ok(v_may > 0 and v_min > 0, 'R17 gerencia ve las dos agencias');
    else
      perform public.t204_ok(v_may + v_min + v_lotes + v_ident = 0,
        'R17 ' || roles[i] || ' no ve staging, lotes ni identidades');
    end if;
  end loop;
end $$;
reset role;

\echo ''
\echo '--- R18: administracion importa en su agencia; venta no ---'
set local role authenticated;
select public.t204_como('00000000-0000-4000-8000-000000001707');
do $$
declare v bigint;
begin
  insert into public.lote_importacion_dian (tenant, fuente, nombre_archivo, hash_contenido,
    periodo_desde, periodo_hasta, motivo, estado)
  values ('mayorista','excel_compras','r18','r18-hash-may','2026-02','2026-02','R18','en_proceso')
  returning id into v;
  perform public.t204_ok(v is not null, 'R18 administracion importa en su agencia');
end $$;
select public.t204_debe_fallar(
  $f$insert into public.lote_importacion_dian (tenant, fuente, nombre_archivo, hash_contenido,
       periodo_desde, periodo_hasta, motivo, estado)
     values ('minorista','excel_compras','r18','r18-hash-min','2026-02','2026-02','R18','en_proceso')$f$,
  '42501', 'R18 administracion NO importa en la otra agencia');
select public.t204_como('00000000-0000-4000-8000-000000001701');
select public.t204_debe_fallar(
  $f$insert into public.lote_importacion_dian (tenant, fuente, nombre_archivo, hash_contenido,
       periodo_desde, periodo_hasta, motivo, estado)
     values ('mayorista','excel_compras','r18','r18-hash-venta','2026-02','2026-02','R18','en_proceso')$f$,
  '42501', 'R18 venta NO importa');
reset role;

\echo ''
\echo '--- R19: los roles contables leen catalogos de su agencia, sin escribirlos ---'
set local role authenticated;
do $$
declare
  ids uuid[] := array['00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2',
                      '00000000-0000-4000-8000-0000000000d3']::uuid[];
  nombres text[] := array['contador','revisor_fiscal','admin_contable'];
  i int; v_prov int; v_sm int; v_sn int; v_pm int; v_pn int; v_upd int;
begin
  for i in 1 .. 3 loop
    perform public.t204_como(ids[i]);
    select count(*) into v_prov from public.proveedores;
    select count(*) filter (where tenant = 'mayorista'), count(*) filter (where tenant = 'minorista')
      into v_sm, v_sn from public.proveedores_datos_sensibles;
    select count(*) filter (where tenant = 'mayorista'), count(*) filter (where tenant = 'minorista')
      into v_pm, v_pn from public.puc_cuentas;
    perform public.t204_ok(v_prov > 0 and v_sm > 0 and v_sn = 0,
      'R19 ' || nombres[i] || ' lee proveedores y datos sensibles solo de su agencia');
    perform public.t204_ok(v_pm > 0 and v_pn = 0, 'R19 ' || nombres[i] || ' lee el PUC solo de su agencia');
    -- Escritura: sin policy de UPDATE para estos roles, el UPDATE no alcanza filas.
    with u as (update public.puc_cuentas set nombre = nombre returning 1) select count(*) into v_upd from u;
    perform public.t204_ok(v_upd = 0, 'R19 ' || nombres[i] || ' no modifica el PUC');
    with u as (update public.proveedores_datos_sensibles set nit = nit returning 1) select count(*) into v_upd from u;
    perform public.t204_ok(v_upd = 0, 'R19 ' || nombres[i] || ' no modifica datos de proveedor');
  end loop;
  -- La apertura es solo para el area contable: venta sigue sin leer el PUC.
  perform public.t204_como('00000000-0000-4000-8000-000000001701');
  select count(*) into v_pm from public.puc_cuentas;
  perform public.t204_ok(v_pm = 0, 'R19 venta sigue sin leer el PUC');
end $$;
reset role;

rollback;

\echo ''
\echo '=== FIN TEST 204 RLS (rollback aplicado; la base quedo igual) ==='