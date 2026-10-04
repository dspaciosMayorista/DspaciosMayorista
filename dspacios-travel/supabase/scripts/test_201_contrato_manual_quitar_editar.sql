-- SOLO base local/desechable con las migraciones hasta 201. Siempre termina en ROLLBACK.
-- Contrato MANUAL en la silla (migración 201):
--   · quitar_contrato_manual(silla, plazo, esperado): si el pasajero se queda,
--     pide el plazo EN la misma acción (hoy o futuro, Bogotá) y deja la silla
--     RETENIDA en plazo; sin pasajero, disponible. Firma vieja (bigint): usa el
--     plazo guardado y lo exige vigente.
--   · editar_contrato_manual(silla, referencia, esperado): reemplaza la
--     referencia en una sola operación, conservando pasajero, plazo y estado;
--     valida referencia y permisos como al asignarla; versión bajo candado;
--     auditoría anterior → nueva. Un contrato de la app no se edita aquí.
-- Incluye sillas LEGADAS (pasajero + contrato manual, SIN plazo, como las 152
-- del preflight), errores de escritura a mitad de operación y permisos.
-- Concurrencia real (dos operadores): test_201_contrato_manual_concurrencia.sh.
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'OK %', p_msg;
end $$;
create function pg_temp.falla(p_sql text, p_patron text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_patron in sqlerrm) > 0 then raise notice 'OK % -> «%»', p_msg, sqlerrm; return; end if;
    raise exception 'FALLO: % (error inesperado: %)', p_msg, sqlerrm;
  end;
  raise exception 'FALLO: % (no fallo)', p_msg;
end $$;
create function pg_temp.como(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
create temp table fx (clave text primary key, id bigint);
grant select on fx to public;
create function pg_temp.id(p text) returns bigint language sql stable as $$ select id from fx where clave = p $$;
create function pg_temp.s(p_n int) returns bigint language sql stable as $$
  select s.id from public.sillas s where s.bloqueo_id = (select id from fx where clave = 'PM201') and s.numero_silla = p_n
$$;
create function pg_temp.version(p_id bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('updated_at', s.updated_at) from public.sillas s where s.id = p_id
$$;
create function pg_temp.foto(p_id bigint) returns text language sql stable as $$
  select (to_jsonb(s) - 'updated_at')::text from public.sillas s where s.id = p_id
$$;
create function pg_temp.hoy() returns date language sql stable as $$ select public.fecha_negocio(now()) $$;
create function pg_temp.cambios(p_patron text) returns bigint language sql stable as $$
  select count(*) from public.bloqueo_cambios where bloqueo_id = (select id from fx where clave = 'PM201') and detalle like p_patron
$$;

-- ── Usuarios: control_vuelo mayorista, venta mayorista, control_vuelo minorista ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f2021', 'cv-man@local.test'),
  ('00000000-0000-0000-0000-0000000f2022', 'venta-man@local.test'),
  ('00000000-0000-0000-0000-0000000f2023', 'cvmin-man@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'CV man' where id = '00000000-0000-0000-0000-0000000f2021';
update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = true, nombre = 'Venta man' where id = '00000000-0000-0000-0000-0000000f2022';
update public.usuarios set rol = 'control_vuelo', tenant = 'minorista', activo = true, nombre = 'CV min' where id = '00000000-0000-0000-0000-0000000f2023';

insert into public.destinos (nombre) values ('DESTINO MAN 201');
insert into fx select 'destino', id from public.destinos where nombre = 'DESTINO MAN 201';
insert into public.proveedores (nombre) values ('PROVEEDOR MAN 201');
insert into fx select 'proveedor', id from public.proveedores where nombre = 'PROVEEDOR MAN 201';
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision)
values ('PM201', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 40, 400000, 14, 'serie');
insert into fx select record, id from public.bloqueos_vuelo where record = 'PM201';
insert into public.sillas (bloqueo_id, numero_silla, estado) select pg_temp.id('PM201'), g, 'disponible' from generate_series(1, 14) g;

-- Contratos de la app: uno de mayorista (orgánico en la #9), uno de minorista
-- (referencia "interna" sin permiso para mayorista) y dos que hacen ambigua "DTM-9903".
insert into public.ventas (numero_contrato, cliente, tenant, estado) values
  ('DTM-9901', 'organico', 'mayorista', 'confirmado'),
  ('MIN-9902', 'minorista ajeno', 'minorista', 'confirmado'),
  ('DTM-9903', 'ambiguo a', 'mayorista', 'confirmado'),
  ('MIN-DTM-9903', 'ambiguo b', 'minorista', 'confirmado');

-- Sillas LEGADAS: pasajero + contrato manual, confirmadas, SIN plazo (#1–#5).
update public.sillas set contrato_manual = 'EXT-L' || numero_silla, estado = 'confirmada',
       pasajero_nombres = 'LEGADO ' || numero_silla, pasajero_apellidos = 'SIN PLAZO', numero_doc = '10' || numero_silla, plazo = null
 where bloqueo_id = pg_temp.id('PM201') and numero_silla between 1 and 5;
-- #6 contrato manual SIN pasajero; #7 con pasajero y plazo VENCIDO; #8 datos sin nombre;
-- #9 contrato de la app; #10 devuelta con contrato manual; #11/#12 para editar; #13 manual
-- con referencia de otra agencia; #14 libre.
update public.sillas set contrato_manual = 'EXT-6', estado = 'confirmada' where id = pg_temp.s(6);
update public.sillas set contrato_manual = 'EXT-7', estado = 'confirmada', pasajero_nombres = 'VENCIDO', plazo = pg_temp.hoy() - 2 where id = pg_temp.s(7);
update public.sillas set contrato_manual = 'EXT-8', estado = 'confirmada', numero_doc = '888' where id = pg_temp.s(8);
update public.sillas set numero_contrato = 'DTM-9901', estado = 'confirmada', pasajero_nombres = 'ORGANICO' where id = pg_temp.s(9);
update public.sillas set contrato_manual = 'EXT-10', estado = 'devuelta', pasajero_nombres = 'DEVUELTA' where id = pg_temp.s(10);
update public.sillas set contrato_manual = 'EXT-11', estado = 'confirmada', pasajero_nombres = 'EDITAR', pasajero_apellidos = 'ONCE',
       numero_doc = '1111', plazo = pg_temp.hoy() + 9 where id = pg_temp.s(11);
update public.sillas set contrato_manual = 'EXT-12', estado = 'confirmada', pasajero_nombres = 'DOCE' where id = pg_temp.s(12);
update public.sillas set contrato_manual = 'MIN-9902', estado = 'confirmada', pasajero_nombres = 'AJENO' where id = pg_temp.s(13);
insert into fx select 'n_ventas', count(*) from public.ventas;

-- ═══ 1. Quitar: pasajero que se queda → plazo en la misma acción ══════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2021');
create temp table antes1 as select pg_temp.foto(pg_temp.s(1)) f;
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, null, %L::jsonb)', pg_temp.s(1), pg_temp.version(pg_temp.s(1))),
  'Indica la fecha de plazo', 'legada sin plazo: quitar sin fecha se rechaza');
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, %L::date, %L::jsonb)', pg_temp.s(1), pg_temp.hoy() - 1, pg_temp.version(pg_temp.s(1))),
  'ya pasó', 'quitar con un plazo de ayer se rechaza');
select pg_temp.ok(pg_temp.foto(pg_temp.s(1)) = (select f from antes1), '  ...la silla 1 quedó exactamente igual');
select public.quitar_contrato_manual(pg_temp.s(1), pg_temp.hoy(), pg_temp.version(pg_temp.s(1)));
select pg_temp.ok((select estado::text = 'en_plazo' and contrato_manual is null and plazo = pg_temp.hoy()
                     and pasajero_nombres = 'LEGADO 1' and numero_doc = '101' from public.sillas where id = pg_temp.s(1)),
  'legada + plazo de HOY: queda retenida en plazo con su pasajero (el día del plazo es válido)');
select public.quitar_contrato_manual(pg_temp.s(2), pg_temp.hoy() + 5, pg_temp.version(pg_temp.s(2)));
select pg_temp.ok((select estado::text = 'en_plazo' and plazo = pg_temp.hoy() + 5 from public.sillas where id = pg_temp.s(2)),
  'legada + plazo futuro: retenida hasta esa fecha');
select pg_temp.ok(not exists (select 1 from public.sillas where bloqueo_id = pg_temp.id('PM201')
                                and estado = 'disponible' and pasajero_nombres is not null),
  'ninguna silla queda disponible con nombre');
select public.quitar_contrato_manual(pg_temp.s(7), pg_temp.hoy() + 1, pg_temp.version(pg_temp.s(7)));
select pg_temp.ok((select estado::text = 'en_plazo' and plazo = pg_temp.hoy() + 1 from public.sillas where id = pg_temp.s(7)),
  'plazo guardado VENCIDO: la acción fija el plazo nuevo (nunca nace una retención vencida)');

-- ═══ 2. Quitar: sin pasajero, datos sin nombre, estados no vendibles ══════
select public.quitar_contrato_manual(pg_temp.s(6), null, pg_temp.version(pg_temp.s(6)));
select pg_temp.ok((select estado::text = 'disponible' and contrato_manual is null and plazo is null from public.sillas where id = pg_temp.s(6)),
  'sin pasajero: queda disponible, sin plazo');
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, %L::date, %L::jsonb)', pg_temp.s(8), pg_temp.hoy() + 3, pg_temp.version(pg_temp.s(8))),
  'datos sin el nombre del pasajero', 'datos sin nombre: se pide completarlo o borrarlos');
select public.quitar_contrato_manual(pg_temp.s(10), null, pg_temp.version(pg_temp.s(10)));
select pg_temp.ok((select estado::text = 'devuelta' and contrato_manual is null and plazo is null from public.sillas where id = pg_temp.s(10)),
  'devuelta: conserva su estado y no se vuelve retención');
select pg_temp.ok(pg_temp.cambios('Silla 1: contrato manual EXT-L1 quitado → retenida en plazo hasta %') = 1
                  and pg_temp.cambios('Silla 6: contrato manual EXT-6 quitado → disponible') = 1,
  'cada quitar deja su línea en el historial del record');

-- ═══ 3. Quitar: versión, firma vieja, permisos ════════════════════════════
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, %L::date, %L::jsonb)', pg_temp.s(3), pg_temp.hoy() + 2, '{"updated_at":"2000-01-01T00:00:00Z"}'),
  'cambió desde que la viste', 'versión vieja: no se quita nada');
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, %L::date, %L::jsonb)', pg_temp.s(3), pg_temp.hoy() + 2, '{}'),
  'Falta la versión', 'sin versión: rechazada');
select pg_temp.falla(format('select public.quitar_contrato_manual(%s)', pg_temp.s(3)),
  'no tiene fecha de plazo: quita el contrato desde Vuelos', 'firma vieja sobre una legada sin plazo: rechazada (no deja nombre en disponible)');
select pg_temp.ok((select contrato_manual = 'EXT-L3' and estado::text = 'confirmada' from public.sillas where id = pg_temp.s(3)),
  '  ...la silla 3 sigue con su contrato');
reset role;
update public.sillas set plazo = pg_temp.hoy() + 4 where id = pg_temp.s(4);
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2021');
select public.quitar_contrato_manual(pg_temp.s(4));
select pg_temp.ok((select estado::text = 'en_plazo' and plazo = pg_temp.hoy() + 4 from public.sillas where id = pg_temp.s(4)),
  'firma vieja con plazo guardado vigente: retenida (compatibilidad de despliegue)');
select pg_temp.como('00000000-0000-0000-0000-0000000f2022');
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, %L::date, %L::jsonb)', pg_temp.s(5), pg_temp.hoy() + 2, pg_temp.version(pg_temp.s(5))),
  'Sin permiso para operar vuelos', 'rol venta: no quita');
select pg_temp.como('00000000-0000-0000-0000-0000000f2021');
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, %L::date, %L::jsonb)', pg_temp.s(13), pg_temp.hoy() + 2, pg_temp.version(pg_temp.s(13))),
  'Sin permiso sobre el contrato', 'referencia de un contrato de otra agencia: no la quita');
reset role;
select pg_temp.ok((select count(*) from public.vuelos_firmas_antiguas_uso where firma = 'quitar_contrato_manual(bigint)') = 1,
  'solo la llamada vieja que terminó bien quedó registrada (la rechazada no)');

-- ═══ 4. Editar la referencia manual ═══════════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2021');
create temp table antes11 as select s.* from public.sillas s where s.id = pg_temp.s(11);
select public.editar_contrato_manual(pg_temp.s(11), '  EXT-11B  ', pg_temp.version(pg_temp.s(11)));
select pg_temp.ok((select s.contrato_manual = 'EXT-11B' and s.estado = a.estado and s.plazo = a.plazo
                          and s.pasajero_nombres = a.pasajero_nombres and s.pasajero_apellidos = a.pasajero_apellidos
                          and s.numero_doc = a.numero_doc and s.numero_contrato is null and s.updated_at > a.updated_at
                     from public.sillas s, antes11 a where s.id = a.id),
  'editar: reemplaza la referencia (recortada) y conserva pasajero, plazo y estado');
reset role;
select pg_temp.ok(pg_temp.cambios('Silla 11: contrato manual EXT-11 → EXT-11B') = 1, 'historial del record: anterior → nueva');
select pg_temp.ok(exists (select 1 from public.auditoria where tabla = 'sillas' and accion ilike '%update%'
                            and antes ->> 'contrato_manual' = 'EXT-11' and despues ->> 'contrato_manual' = 'EXT-11B'
                            and actor_id = '00000000-0000-0000-0000-0000000f2021'),
  'auditoría: fila con el valor anterior y el nuevo, y quién lo hizo');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2021');
create temp table v11 as select pg_temp.version(pg_temp.s(11)) v;
select public.editar_contrato_manual(pg_temp.s(11), 'EXT-11B', (select v from v11));
select pg_temp.ok(pg_temp.version(pg_temp.s(11)) = (select v from v11), 'misma referencia: sin cambios (la versión no se mueve)');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(11), '   ', pg_temp.version(pg_temp.s(11))),
  'Escribe el número de contrato manual', 'referencia vacía: rechazada');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(11), 'EXT' || chr(9) || '9', pg_temp.version(pg_temp.s(11))),
  'caracteres no admitidos', 'referencia con caracteres de control: rechazada como al asignar');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(11), 'DTM-9903', pg_temp.version(pg_temp.s(11))),
  'más de un contrato', 'referencia ambigua: rechazada como al asignar');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(11), 'MIN-9902', pg_temp.version(pg_temp.s(11))),
  'Sin permiso sobre el contrato', 'referencia a un contrato de otra agencia: sin permiso');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(13), 'EXT-13', pg_temp.version(pg_temp.s(13))),
  'Sin permiso sobre el contrato', 'sin permiso sobre la referencia ACTUAL: tampoco se edita');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(9), 'EXT-9', pg_temp.version(pg_temp.s(9))),
  'generado por la aplicación', 'contrato de la app: no se edita desde la celda');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(14), 'EXT-14', pg_temp.version(pg_temp.s(14))),
  'no tiene contrato manual que editar', 'silla sin contrato manual: nada que editar');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(11), 'EXT-11C', '{"updated_at":"2000-01-01T00:00:00Z"}'),
  'cambió desde que la viste', 'versión vieja: no se cambia nada');
select pg_temp.como('00000000-0000-0000-0000-0000000f2022');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(12), 'EXT-12B', pg_temp.version(pg_temp.s(12))),
  'Sin permiso para operar vuelos', 'rol venta: no edita');
select pg_temp.como('00000000-0000-0000-0000-0000000f2023');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(12), 'EXT-12B', pg_temp.version(pg_temp.s(12))),
  'Sin permiso para operar vuelos', 'usuario de minorista: no opera Vuelos (regla de la 194)');
select pg_temp.como('00000000-0000-0000-0000-0000000f2021');
select public.editar_contrato_manual(pg_temp.s(12), 'DTM-9901', pg_temp.version(pg_temp.s(12)));
select pg_temp.ok((select contrato_manual = 'DTM-9901' and estado::text = 'confirmada' and pasajero_nombres = 'DOCE'
                     from public.sillas where id = pg_temp.s(12)),
  'referencia a un contrato propio de la app con permiso: se acepta (mismo criterio que asignar)');
reset role;
select pg_temp.ok((select contrato_manual = 'EXT-11B' from public.sillas where id = pg_temp.s(11)), 'los rechazos no tocaron la silla 11');

-- ═══ 5. Errores de escritura a mitad de operación: todo o nada ════════════
create function pg_temp.romper() returns trigger language plpgsql as $$
begin raise exception 'FALLO_FORZADO_HISTORIAL'; end $$;
create trigger zz_romper before insert on public.bloqueo_cambios for each row execute function pg_temp.romper();
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2021');
create temp table antes_err as select pg_temp.foto(pg_temp.s(3)) f3, pg_temp.foto(pg_temp.s(11)) f11;
select pg_temp.falla(format('select public.quitar_contrato_manual(%s, %L::date, %L::jsonb)', pg_temp.s(3), pg_temp.hoy() + 2, pg_temp.version(pg_temp.s(3))),
  'FALLO_FORZADO_HISTORIAL', 'quitar con el historial fallando: error');
select pg_temp.falla(format('select public.editar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(11), 'EXT-11Z', pg_temp.version(pg_temp.s(11))),
  'FALLO_FORZADO_HISTORIAL', 'editar con el historial fallando: error');
reset role;
drop trigger zz_romper on public.bloqueo_cambios;
select pg_temp.ok((select pg_temp.foto(pg_temp.s(3)) = f3 and pg_temp.foto(pg_temp.s(11)) = f11 from antes_err),
  '  ...ninguna de las dos dejó la silla a medias (contrato y estado intactos)');

-- ═══ 6. Las 5 legadas, de una vez: la firma nueva las retiene, la vieja no deja nombres sueltos ══
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.id('PM201') and numero_silla between 1 and 5
                     and estado = 'en_plazo' and contrato_manual is null and plazo is not null) = 3
                  and (select count(*) from public.sillas where bloqueo_id = pg_temp.id('PM201') and numero_silla in (3, 5)
                     and estado = 'confirmada' and contrato_manual is not null and plazo is null) = 2,
  'legadas: las quitadas quedaron retenidas con plazo; las demás siguen con su contrato, sin tocarlas');
select pg_temp.ok((select count(*) from public.ventas) = pg_temp.id('n_ventas'), 'ninguna operación creó ni borró ventas');

rollback;
\echo 'test_201_contrato_manual_quitar_editar: TODAS LAS PRUEBAS PASARON'
