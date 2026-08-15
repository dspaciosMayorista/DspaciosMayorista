-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA · el bucket `contratos` separa las dos agencias  (migración 150)
--
-- Se pega en el editor SQL de Supabase, o se corre en local. Crea sus propios
-- datos de prueba y **termina en ROLLBACK**: no deja nada.
--
-- ⚠️ SE PUEDE CORRER ANTES Y DESPUÉS DE LA 150, Y ESE ES EL PUNTO.
--   Antes de la 150 debe FALLAR (las filas en rojo son el agujero). Después
--   debe pasar entera. Una prueba que solo se corre después no demuestra que
--   arreglara nada.
--
-- QUÉ HACE
--   Monta usuarios de las DOS agencias con todos los roles, tres contratos, dos
--   empleados de nómina y seis objetos en el bucket; después se hace pasar por
--   cada usuario y ejecuta de verdad SELECT, INSERT, UPDATE y DELETE sobre
--   `storage.objects`, comparando el resultado contra una matriz de expectativa
--   escrita a mano.
--
--   Se prueban las CUATRO operaciones, no solo la lectura: la policy de INSERT
--   es la que impide sembrar un archivo en la carpeta de otra agencia, y la de
--   UPDATE tiene dos mitades (`using` y `with check`) — sin la segunda se podría
--   mover un objeto propio a una carpeta ajena.
--
-- ⚠️ EN SUPABASE ALOJADO, `storage.objects` NO ADMITE DML DESDE SQL.
--   Los INSERT/UPDATE/DELETE de aquí abajo pueden reventar en el Supabase real
--   por ese motivo y NO porque la policy los rechace. El script lo distingue:
--   guarda el SQLERRM y marca esos casos como «no concluyente», en vez de
--   contarlos como aprobados. La prueba de verdad de escritura va por la API,
--   en `supabase/scripts/pruebas/storage-adjuntos.mjs`.
--   La comprobación de SELECT sí es concluyente en los dos entornos.
--
-- EL CASO QUE MOTIVÓ TODO
--   `ANA GOMEZ` existe en las DOS agencias, y hay un contrato a su nombre en
--   cada una. La de mayorista debe alcanzar el suyo y NO el de minorista, y al
--   revés. Es lo que produce el importador de minorista al escribir el nombre
--   del freelance en `ventas.asesor`.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ── Datos de prueba ──────────────────────────────────────────────────────
create temp table _u(ref text primary key, id uuid, rol text, tenant text, nombre text) on commit drop;
insert into _u(ref, id, rol, tenant, nombre) values
  ('super',   '00000000-0000-4000-8000-000000000001', 'superadmin',    'mayorista', 'PRUEBA Super'),
  ('ger_may', '00000000-0000-4000-8000-000000000002', 'gerencia',      'mayorista', 'PRUEBA Gerencia May'),
  ('adm_may', '00000000-0000-4000-8000-000000000003', 'administracion','mayorista', 'PRUEBA Admin May'),
  ('ope_may', '00000000-0000-4000-8000-000000000004', 'operaciones',   'mayorista', 'PRUEBA Oper May'),
  ('ven_may', '00000000-0000-4000-8000-000000000005', 'venta',         'mayorista', 'ANA GOMEZ'),
  ('adm_min', '00000000-0000-4000-8000-000000000006', 'administracion','minorista', 'PRUEBA Admin Min'),
  ('ven_min', '00000000-0000-4000-8000-000000000007', 'venta',         'minorista', 'ANA GOMEZ');

insert into auth.users(id, email)
  select id, ref || '@prueba.invalid' from _u
  on conflict (id) do nothing;

-- El trigger `on_auth_user_created` puede haber creado ya el perfil: se
-- normaliza con update, y se inserta solo lo que falte.
insert into public.usuarios(id, email, nombre, rol, activo, tenant)
  select u.id, u.ref || '@prueba.invalid', u.nombre, u.rol::rol_usuario, true, u.tenant from _u u
  on conflict (id) do nothing;
update public.usuarios p
   set nombre = u.nombre, rol = u.rol::rol_usuario, activo = true, tenant = u.tenant
  from _u u where p.id = u.id;

insert into public.ventas(numero_contrato, tenant, cliente, asesor, precio_venta) values
  ('PRUEBA-MAY-1', 'mayorista', 'Cliente', 'ANA GOMEZ',      1000),
  ('PRUEBA-MAY-2', 'mayorista', 'Cliente', 'OTRO ASESOR',    1000),
  ('PRUEBA-MIN-1', 'minorista', 'Cliente', 'ANA GOMEZ',      1000);

insert into public.pe_empleados(nombre, tenant) values ('PRUEBA Empleado May', 'mayorista');
insert into public.pe_empleados(nombre, tenant) values ('PRUEBA Empleado Min', 'minorista');

create temp table _emp(ref text primary key, id bigint) on commit drop;
insert into _emp
  select 'pe_may', id from public.pe_empleados where nombre = 'PRUEBA Empleado May'
  union all
  select 'pe_min', id from public.pe_empleados where nombre = 'PRUEBA Empleado Min';

insert into storage.buckets(id, name, public) values ('contratos','contratos',false)
  on conflict (id) do nothing;

-- Los seis objetos. `huerfano/` es un prefijo que no corresponde a ningún
-- contrato: representa un archivo histórico con otra forma de ruta.
create temp table _obj(ref text primary key, ruta text) on commit drop;
insert into _obj values
  ('may1',     'PRUEBA-MAY-1/adjunto.txt'),
  ('may2',     'PRUEBA-MAY-2/adjunto.txt'),
  ('min1',     'PRUEBA-MIN-1/adjunto.txt'),
  ('pe_may',   'pe-empleados/' || (select id from _emp where ref='pe_may') || '-1.txt'),
  ('pe_min',   'pe-empleados/' || (select id from _emp where ref='pe_min') || '-1.txt'),
  ('huerfano', 'huerfano/algo.txt');

insert into storage.objects(bucket_id, name)
  select 'contratos', ruta from _obj;

-- ── La matriz de expectativa, escrita a mano ─────────────────────────────
-- superadmin todo; gerencia/administracion/operaciones solo SU agencia;
-- `venta` solo SU agencia Y siendo el asesor; nómina solo gerencia y
-- administración de la agencia del empleado (refleja la RLS de `pe_empleados`);
-- prefijo desconocido, solo superadmin.
create temp table _esperado(usuario text, objeto text, permitido boolean) on commit drop;
insert into _esperado values
  ('super','may1',true),   ('super','may2',true),   ('super','min1',true),
  ('super','pe_may',true), ('super','pe_min',true), ('super','huerfano',true),

  ('ger_may','may1',true), ('ger_may','may2',true), ('ger_may','min1',false),
  ('ger_may','pe_may',true),('ger_may','pe_min',false),('ger_may','huerfano',false),

  ('adm_may','may1',true), ('adm_may','may2',true), ('adm_may','min1',false),
  ('adm_may','pe_may',true),('adm_may','pe_min',false),('adm_may','huerfano',false),

  -- operaciones no lee `pe_empleados`, así que tampoco sus archivos.
  ('ope_may','may1',true), ('ope_may','may2',true), ('ope_may','min1',false),
  ('ope_may','pe_may',false),('ope_may','pe_min',false),('ope_may','huerfano',false),

  -- Su contrato sí; el de un colega de su agencia no; el de su homónima de la
  -- otra agencia TAMPOCO, aunque el nombre coincida.
  ('ven_may','may1',true), ('ven_may','may2',false),('ven_may','min1',false),
  ('ven_may','pe_may',false),('ven_may','pe_min',false),('ven_may','huerfano',false),

  ('ven_min','may1',false),('ven_min','may2',false),('ven_min','min1',true),
  ('ven_min','pe_may',false),('ven_min','pe_min',false),('ven_min','huerfano',false),

  ('adm_min','may1',false),('adm_min','may2',false),('adm_min','min1',true),
  ('adm_min','pe_may',false),('adm_min','pe_min',true), ('adm_min','huerfano',false);

-- ── Ejecución ────────────────────────────────────────────────────────────
create temp table _res(
  usuario text, rol text, objeto text, operacion text,
  esperado boolean, obtenido boolean, detalle text
) on commit drop;

do $$
declare
  u        record;
  o        record;
  esp      boolean;
  got      boolean;
  det      text;
  n        integer;
  ruta_new text;
begin
  for u in select * from _u order by ref loop
    for o in select * from _obj order by ref loop
      select permitido into esp from _esperado e
        where e.usuario = u.ref and e.objeto = o.ref;

      -- ── SELECT ──────────────────────────────────────────────────────
      det := null;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims',
          json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
        select count(*) into n from storage.objects
          where bucket_id = 'contratos' and name = o.ruta;
        got := n > 0;
      exception when others then
        got := null; det := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '{}', true);
      insert into _res values (u.ref, u.rol, o.ref, 'SELECT', esp, got, det);

      -- ── INSERT (un objeto nuevo bajo el MISMO prefijo) ──────────────
      ruta_new := o.ruta || '.nuevo';
      det := null;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims',
          json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
        insert into storage.objects(bucket_id, name) values ('contratos', ruta_new);
        got := true;
      exception when others then
        got := false; det := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '{}', true);
      delete from storage.objects where bucket_id = 'contratos' and name = ruta_new;
      insert into _res values (u.ref, u.rol, o.ref, 'INSERT', esp, got, det);

      -- ── UPDATE ──────────────────────────────────────────────────────
      det := null;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims',
          json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
        update storage.objects set updated_at = now()
          where bucket_id = 'contratos' and name = o.ruta;
        get diagnostics n = row_count;
        got := n > 0;
      exception when others then
        got := null; det := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '{}', true);
      insert into _res values (u.ref, u.rol, o.ref, 'UPDATE', esp, got, det);

      -- ── DELETE (se deshace enseguida para no alterar los demás casos) ─
      det := null;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims',
          json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
        delete from storage.objects where bucket_id = 'contratos' and name = o.ruta;
        get diagnostics n = row_count;
        got := n > 0;
      exception when others then
        got := null; det := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '{}', true);
      insert into storage.objects(bucket_id, name)
        select 'contratos', o.ruta
        where not exists (select 1 from storage.objects
                           where bucket_id='contratos' and name = o.ruta);
      insert into _res values (u.ref, u.rol, o.ref, 'DELETE', esp, got, det);

    end loop;
  end loop;
end $$;

-- ── Resultados ───────────────────────────────────────────────────────────
-- Primero lo que está mal, y dentro de eso primero las FUGAS (alcanzó algo que
-- no debía), que son peores que un bloqueo de más.
select
  usuario, rol, objeto, operacion,
  esperado as "debía poder",
  obtenido as "pudo",
  case
    when obtenido is null then 'NO CONCLUYENTE — ' || coalesce(detalle, 'sin motivo')
    when obtenido = esperado then 'OK'
    when obtenido and not esperado then 'FUGA — alcanzó un archivo que no le corresponde'
    else 'BLOQUEO DE MÁS — no alcanzó un archivo que sí le corresponde'
  end as veredicto,
  detalle
from _res
where obtenido is distinct from esperado
order by (obtenido is null), (obtenido and not esperado) desc, usuario, objeto, operacion;

-- Resumen. `fugas = 0` y `bloqueos = 0` es lo que se busca.
select
  count(*)                                                              as comprobaciones,
  count(*) filter (where obtenido is not distinct from esperado)        as correctas,
  count(*) filter (where obtenido and not esperado)                     as fugas,
  count(*) filter (where obtenido is not null and not obtenido and esperado) as bloqueos_de_mas,
  count(*) filter (where obtenido is null)                              as no_concluyentes
from _res;

rollback;
