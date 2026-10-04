-- SOLO base local/desechable con las migraciones hasta 201. Siempre termina en ROLLBACK.
-- Retención en plazo SIN contrato (decisión del dueño): creación con pasajero y
-- plazo, no vendible, vencimiento por fecha de negocio de Bogotá, liberación
-- MANUAL con nueva comprobación bajo candado, auditoría, permisos y tenant, y
-- que ni el cron (liberar_vencidas) ni la retención toquen ventas.
-- Concurrencia real: supabase/scripts/test_201_retencion_concurrencia.sh.
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
  select s.id from public.sillas s where s.bloqueo_id = (select id from fx where clave = 'PT201') and s.numero_silla = p_n
$$;
create function pg_temp.version(p_id bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('updated_at', s.updated_at) from public.sillas s where s.id = p_id
$$;
create function pg_temp.foto(p_id bigint) returns text language sql stable as $$
  select (to_jsonb(s) - 'updated_at')::text from public.sillas s where s.id = p_id
$$;
-- La misma consulta que usa la pantalla de Vuelos para el aviso.
create function pg_temp.vencidas(p_bloqueo bigint) returns int[] language sql stable as $$
  select coalesce(array_agg(s.numero_silla order by s.numero_silla), '{}') from public.sillas s
   where s.bloqueo_id = p_bloqueo and s.estado = 'en_plazo' and s.numero_contrato is null and s.contrato_manual is null
     and s.plazo < public.fecha_negocio(now())
$$;

-- ── Usuarios: control_vuelo, venta, operaciones MINORISTA, control_vuelo inactivo ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f2011', 'cv-ret@local.test'),
  ('00000000-0000-0000-0000-0000000f2012', 'venta-ret@local.test'),
  ('00000000-0000-0000-0000-0000000f2013', 'opmin-ret@local.test'),
  ('00000000-0000-0000-0000-0000000f2014', 'cvinac-ret@local.test');
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = true, nombre = 'CV ret' where id = '00000000-0000-0000-0000-0000000f2011';
update public.usuarios set rol = 'venta', tenant = 'mayorista', activo = true, nombre = 'Venta ret' where id = '00000000-0000-0000-0000-0000000f2012';
update public.usuarios set rol = 'operaciones', tenant = 'minorista', activo = true, nombre = 'Op min ret' where id = '00000000-0000-0000-0000-0000000f2013';
update public.usuarios set rol = 'control_vuelo', tenant = 'mayorista', activo = false, nombre = 'CV inactivo' where id = '00000000-0000-0000-0000-0000000f2014';

insert into public.destinos (nombre) values ('DESTINO RET 201');
insert into fx select 'destino', id from public.destinos where nombre = 'DESTINO RET 201';
insert into public.proveedores (nombre) values ('PROVEEDOR RET 201');
insert into fx select 'proveedor', id from public.proveedores where nombre = 'PROVEEDOR RET 201';
insert into public.bloqueos_vuelo (record, destino_id, proveedor_id, fecha_ida, tarifa_neta, cupos_total, modalidad_emision)
values ('PT201', pg_temp.id('destino'), pg_temp.id('proveedor'), current_date + 30, 400000, 6, 'serie');
insert into fx select record, id from public.bloqueos_vuelo where record = 'PT201';
insert into public.sillas (bloqueo_id, numero_silla, estado) select pg_temp.id('PT201'), g, 'disponible' from generate_series(1, 6) g;
-- Contrato PENDIENTE con plazo vencido en la #6 (lo atiende el cron) y otro pendiente vigente.
insert into public.ventas (numero_contrato, cliente, tenant, estado, plazo, bloqueo_ref_id) values
  ('DTM-8301', 'pendiente vencido', 'mayorista', 'pendiente', public.fecha_negocio(now()) - 1, pg_temp.id('PT201')),
  ('DTM-8302', 'pendiente vigente', 'mayorista', 'pendiente', public.fecha_negocio(now()) + 3, null);
update public.sillas set numero_contrato = 'DTM-8301', estado = 'en_plazo', pasajero_nombres = 'CONTRATO VENCIDO', plazo = public.fecha_negocio(now()) - 1
 where id = pg_temp.s(6);
create temp table ventas_antes as select numero_contrato, estado::text estado from public.ventas;
insert into fx select 'n_ventas', count(*) from public.ventas;

-- ═══ 1. Fecha de negocio de Bogotá (UTC−5) en el límite del día ════════════
select pg_temp.ok(public.fecha_negocio('2026-10-04 04:59:59+00') = date '2026-10-03', '04:59 UTC del 4 = aún 3 de octubre en Bogotá');
select pg_temp.ok(public.fecha_negocio('2026-10-04 05:00:00+00') = date '2026-10-04', '05:00 UTC del 4 = 4 de octubre en Bogotá');
select pg_temp.ok(public.fecha_negocio('2026-10-03 23:30:00-05') = date '2026-10-03', '23:30 en Bogotá sigue siendo el mismo día');
-- La regla de vencimiento (una sola definición, la usan asignar y liberar) en el límite exacto.
select pg_temp.ok(not public._retencion_vencida(date '2026-10-03', public.fecha_negocio('2026-10-04 04:59:59+00')),
  'plazo 3-oct: a las 04:59 UTC del 4 (aun 3 en Bogota) NO esta vencida: el dia del plazo se puede asignar');
select pg_temp.ok(public._retencion_vencida(date '2026-10-03', public.fecha_negocio('2026-10-04 05:00:00+00')),
  'plazo 3-oct: a las 05:00 UTC del 4 (ya 4 en Bogota) esta vencida: el dia siguiente no se asigna');
select pg_temp.ok(not public._retencion_vencida(null, date '2026-10-04'), 'sin plazo no es una retencion vencida');

-- ═══ 2. Crear una retención: pasajero Y plazo, nunca en el pasado ══════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.s(1), '{"pasajero_nombres":"SIN PLAZO"}'),
  'indica el pasajero (nombre o apellido) y la fecha de plazo', 'pasajero sin plazo: validacion');
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.s(1),
  json_build_object('numero_doc', '1', 'plazo', (public.fecha_negocio(now()) + 2)::text)::text),
  'indica el pasajero (nombre o apellido) y la fecha de plazo', 'plazo sin pasajero: validacion');
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.s(1),
  json_build_object('pasajero_nombres', 'AYER', 'plazo', (public.fecha_negocio(now()) - 1)::text)::text),
  'ya pasó', 'plazo anterior a hoy (Bogota): validacion');
-- El propio día del plazo vale (aún no vence).
select public.editar_pasajero_silla(pg_temp.s(1), json_build_object('pasajero_nombres', 'HOY', 'pasajero_apellidos', 'PLAZO',
  'plazo', public.fecha_negocio(now())::text)::jsonb);
select public.editar_pasajero_silla(pg_temp.s(2), json_build_object('pasajero_nombres', 'FUTURO', 'plazo', (public.fecha_negocio(now()) + 5)::text)::jsonb);
select public.editar_pasajero_silla(pg_temp.s(3), json_build_object('pasajero_nombres', 'SE VENCERA', 'numero_doc', '333',
  'plazo', public.fecha_negocio(now())::text)::jsonb);
reset role;
select pg_temp.ok((select bool_and(estado::text = 'en_plazo' and numero_contrato is null and contrato_manual is null) from public.sillas where id in (pg_temp.s(1), pg_temp.s(2), pg_temp.s(3))),
  'las tres quedan retenidas en_plazo, sin contrato');
select pg_temp.ok((select estado::text = 'disponible' and not public._silla_con_datos(s) from public.sillas s where id = pg_temp.s(4)), 'la #4 sigue vacia y disponible');

-- ═══ 3. No vendible: ni se cuenta ni se reserva ═══════════════════════════
select pg_temp.ok((select cupos_disponibles from public.cupos_por_bloqueo where id = pg_temp.id('PT201')) = 2, 'cupos_disponibles = 2 (#4 y #5): las retenciones no cuentan');
select pg_temp.ok((select count(*) from public.sillas s where s.bloqueo_id = pg_temp.id('PT201') and public._silla_libre(s)) = 2, '_silla_libre coincide');

-- ═══ 4. Escritura directa por la API (permitida por la 199): misma regla ═══
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select pg_temp.falla(format('update public.sillas set pasajero_nombres = %L where id = %s', 'DIRECTO SIN PLAZO', pg_temp.s(4)),
  'RETENCION_INCOMPLETA', 'API: pasajero sin plazo en silla sin contrato: rechazado');
update public.sillas set pasajero_nombres = 'DIRECTO', plazo = public.fecha_negocio(now()) + 1 where id = pg_temp.s(4);
reset role;
select pg_temp.ok((select estado::text from public.sillas where id = pg_temp.s(4)) = 'en_plazo', 'API: pasajero + plazo deriva en_plazo (la 199 sigue sin dejar escribir estado)');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
update public.sillas set pasajero_nombres = null, plazo = null where id = pg_temp.s(4);
reset role;
select pg_temp.ok((select estado::text from public.sillas where id = pg_temp.s(4)) = 'disponible', 'API: vaciar la retencion la devuelve a disponible');

-- ═══ 5. Vencimiento y aviso: plazo < fecha de negocio ═════════════════════
select pg_temp.ok(pg_temp.vencidas(pg_temp.id('PT201')) = '{}', 'con plazo de hoy ninguna retencion esta vencida');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.s(1), pg_temp.version(pg_temp.s(1))),
  'aún no vence', 'el propio dia del plazo no se libera');
reset role;
-- Pasa un día (el dueño simula el tiempo; la app no deja fijar un plazo pasado).
update public.sillas set plazo = public.fecha_negocio(now()) - 1 where id in (pg_temp.s(1), pg_temp.s(3));
select pg_temp.ok(pg_temp.vencidas(pg_temp.id('PT201')) = '{1,3}', 'aviso: vencidas #1 y #3 (la #2 vence despues; la #6 tiene contrato)');

-- ═══ 6. Liberación manual con nueva comprobación bajo candado ═════════════
create temp table v1 as select pg_temp.version(pg_temp.s(1)) v;
grant select on v1 to public;
-- Otro operador corrige la #1 después de que la pantalla la mostró: la versión cambia.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select public.editar_pasajero_silla(pg_temp.s(1), json_build_object('pasajero_nombres', 'HOY CORREGIDO', 'pasajero_apellidos', 'PLAZO',
  'plazo', (public.fecha_negocio(now()) - 1)::text)::jsonb);
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.s(1), (select v from v1)),
  'cambió desde que la viste', 'version vieja: no borra la edicion de otro operador');
reset role;
select pg_temp.ok((select pasajero_nombres from public.sillas where id = pg_temp.s(1)) = 'HOY CORREGIDO', 'la correccion del otro operador sigue ahi');
create temp table antes_lib as select s.id, s.numero_silla, s.bloqueo_id, s.pasajero_nombres, s.numero_doc from public.sillas s where s.id = pg_temp.s(3);
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select pg_temp.ok((public.liberar_retencion_vencida(pg_temp.s(3), pg_temp.version(pg_temp.s(3))) ->> 'numero_silla') = '3', 'liberar la #3 vencida con la version vigente');
reset role;
select pg_temp.ok((select estado::text = 'disponible' and not public._silla_con_datos(s) and plazo is null
                     and id = (select id from antes_lib) and numero_silla = 3 and bloqueo_id = pg_temp.id('PT201')
                     from public.sillas s where s.id = pg_temp.s(3)),
  'la #3 queda disponible, sin datos personales, con su id/record/numero_silla');
select pg_temp.ok(exists (select 1 from public.bloqueo_cambios where bloqueo_id = pg_temp.id('PT201')
                           and detalle like 'Silla 3: retención vencida (plazo %) liberada → disponible' and registrado_por = 'CV ret'),
  'bloqueo_cambios registra quien libero, que silla y que plazo');
select pg_temp.ok(exists (select 1 from public.auditoria where tabla = 'sillas' and registro_id = pg_temp.s(3)::text
                           and antes ->> 'pasajero_nombres' = 'SE VENCERA' and antes ->> 'numero_doc' = '333'
                           and despues ->> 'pasajero_nombres' is null),
  'la auditoria conserva la imagen anterior (pasajero y documento)');
select pg_temp.ok(pg_temp.vencidas(pg_temp.id('PT201')) = '{1}', 'el aviso baja a 1 (#1)');

-- ═══ 7. Rechazos que no tocan nada ═══════════════════════════════════════
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.s(2), pg_temp.version(pg_temp.s(2))),
  'aún no vence', 'retencion vigente: no se libera');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.s(6), pg_temp.version(pg_temp.s(6))),
  'ya tiene contrato', 'silla en_plazo CON contrato: no es una retencion');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.s(4), pg_temp.version(pg_temp.s(4))),
  'ya no está retenida', 'silla disponible: nada que liberar');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.s(1), '{}'),
  'Falta la versión', 'sin version: no libera a ciegas');
-- Decisión del dueño: una retención VENCIDA no recibe contrato hasta actualizar
-- su plazo a hoy o a una fecha futura (con la firma vieja y con la nueva).
create temp table s1_vencida as select pg_temp.foto(pg_temp.s(1)) f;
grant select on s1_vencida to public;
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L)', pg_temp.s(1), 'EXT-RET-1'),
  'venció (plazo', 'retencion vencida: no recibe contrato (firma vieja)');
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(1), 'EXT-RET-1', pg_temp.version(pg_temp.s(1))),
  'Actualiza el plazo a hoy o a una fecha futura', 'retencion vencida: no recibe contrato (firma con version vigente)');
select pg_temp.ok((select f from s1_vencida) = pg_temp.foto(pg_temp.s(1)), 'el rechazo no toco la silla');
-- Actualizar el plazo al propio día (hoy en Bogotá) la vuelve asignable.
select public.editar_pasajero_silla(pg_temp.s(1), json_build_object('pasajero_nombres', 'HOY CORREGIDO', 'pasajero_apellidos', 'PLAZO',
  'plazo', public.fecha_negocio(now())::text)::jsonb);
select public.asignar_contrato_manual(pg_temp.s(1), 'EXT-RET-1', pg_temp.version(pg_temp.s(1)));
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.s(1), pg_temp.version(pg_temp.s(1))),
  'ya tiene contrato', 'tras asignarle contrato ya no se libera como retencion');
reset role;
select pg_temp.ok((select estado::text = 'confirmada' and contrato_manual = 'EXT-RET-1' and pasajero_nombres = 'HOY CORREGIDO'
                     and plazo = public.fecha_negocio(now()) from public.sillas where id = pg_temp.s(1)),
  'con el plazo actualizado a hoy, asignar confirma la retencion con su pasajero');

-- ═══ 8. Permisos y tenant ═════════════════════════════════════════════════
update public.sillas set plazo = public.fecha_negocio(now()) - 1 where id = pg_temp.s(2);
create temp table s2_antes as select pg_temp.foto(pg_temp.s(2)) f;
-- El id se fija como dueño: sin permiso, la RLS ni siquiera deja ver la silla.
insert into fx select 's2', pg_temp.s(2);
create temp table v2 as select pg_temp.version(pg_temp.s(2)) v;
grant select on v2 to public;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2012');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.id('s2'), (select v from v2)),
  'Sin permiso para operar vuelos', 'rol venta: no libera');
select pg_temp.como('00000000-0000-0000-0000-0000000f2013');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.id('s2'), '{"updated_at":"2026-01-01T00:00:00Z"}'),
  'Sin permiso para operar vuelos', 'operaciones de MINORISTA: no libera (AUT-1)');
select pg_temp.como('00000000-0000-0000-0000-0000000f2014');
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.id('s2'), '{"updated_at":"2026-01-01T00:00:00Z"}'),
  'Sin permiso para operar vuelos', 'usuario inactivo: no libera');
select set_config('request.jwt.claims', '{}', true);
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.id('s2'), '{"updated_at":"2026-01-01T00:00:00Z"}'),
  'Sesión requerida', 'sin sesion: no libera');
reset role;
set local role anon;
select pg_temp.falla(format('select public.liberar_retencion_vencida(%s, %L::jsonb)', pg_temp.id('s2'), '{"updated_at":"2026-01-01T00:00:00Z"}'),
  'permission denied', 'anon: sin EXECUTE');
reset role;
select pg_temp.ok((select f from s2_antes) = pg_temp.foto(pg_temp.s(2)), 'ningun rechazo toco la #2');

-- ═══ 9. El cron atiende SOLO contratos pendientes; la retención no toca ventas ═
select pg_temp.ok((public.liberar_vencidas(public.fecha_negocio(now())) ->> 'liberadas')::int = 1, 'liberar_vencidas: 1 contrato vencido (DTM-8301)');
select pg_temp.ok((select estado::text = 'disponible' and numero_contrato is null and not public._silla_con_datos(s) from public.sillas s where id = pg_temp.s(6)),
  'la silla del contrato vencido se libero (regla de la 196)');
select pg_temp.ok((select estado::text = 'en_plazo' and pasajero_nombres = 'FUTURO' and numero_contrato is null from public.sillas where id = pg_temp.s(2)),
  'la retencion vencida sin contrato NO la toco el cron (liberacion solo manual)');
select pg_temp.ok((select count(*) from public.ventas) = pg_temp.id('n_ventas'), 'ninguna venta creada ni borrada');
select pg_temp.ok(not exists (select 1 from public.ventas v join ventas_antes a using (numero_contrato)
                               where v.estado::text is distinct from a.estado and v.numero_contrato <> 'DTM-8301'),
  'solo cambio DTM-8301 (cancelado); DTM-8302 sigue pendiente');
select pg_temp.ok((select estado::text from public.ventas where numero_contrato = 'DTM-8301') = 'cancelado', 'DTM-8301 cancelado por el cron');
-- Liberar a mano la retención no crea, cancela ni altera ninguna venta.
create temp table ventas_antes2 as select numero_contrato, (to_jsonb(v) - 'updated_at')::text f from public.ventas v;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select public.liberar_retencion_vencida(pg_temp.s(2), pg_temp.version(pg_temp.s(2)));
reset role;
select pg_temp.ok(not exists (select 1 from public.ventas v full join ventas_antes2 a using (numero_contrato)
                               where a.f is distinct from (to_jsonb(v) - 'updated_at')::text),
  'liberar la retencion no toco ninguna venta');
select pg_temp.ok(pg_temp.vencidas(pg_temp.id('PT201')) = '{}', 'el aviso queda en cero');
select pg_temp.ok((select count(*) from public.sillas where bloqueo_id = pg_temp.id('PT201')) = 6
                  and (select array_agg(numero_silla order by numero_silla) from public.sillas where bloqueo_id = pg_temp.id('PT201')) = '{1,2,3,4,5,6}',
  'identidad historica: las 6 sillas y sus numeros intactos');

-- ═══ 10. Acciones con la versión que vio el operador ═════════════════════
-- Retención nueva en la #2 y en la #3 (vigentes).
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select public.editar_pasajero_silla(pg_temp.s(2), json_build_object('pasajero_nombres', 'VER DOS', 'plazo', (public.fecha_negocio(now()) + 3)::text)::jsonb);
select public.editar_pasajero_silla(pg_temp.s(3), json_build_object('pasajero_nombres', 'VER TRES', 'plazo', (public.fecha_negocio(now()) + 3)::text)::jsonb);
reset role;
create temp table vv as select pg_temp.version(pg_temp.s(2)) v2, pg_temp.version(pg_temp.s(3)) v3;
grant select on vv to public;
-- Otro operador corrige ambas después de que la pantalla las mostró.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select public.editar_pasajero_silla(pg_temp.s(2), json_build_object('pasajero_nombres', 'VER DOS CORREGIDO', 'plazo', (public.fecha_negocio(now()) + 3)::text)::jsonb);
select public.editar_pasajero_silla(pg_temp.s(3), json_build_object('pasajero_nombres', 'VER TRES CORREGIDO', 'plazo', (public.fecha_negocio(now()) + 3)::text)::jsonb);
reset role;
create temp table vfoto as select pg_temp.foto(pg_temp.s(2)) f2, pg_temp.foto(pg_temp.s(3)) f3;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select pg_temp.falla(format('select public.liberar_silla(%s, %L::jsonb)', pg_temp.s(2), (select v2 from vv)),
  'cambió desde que la viste', 'Borrar con version vieja: rechazado');
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(3), 'EXT-VER', (select v3 from vv)),
  'cambió desde que la viste', 'asignar con version vieja: rechazado');
select pg_temp.falla(format('select public.editar_pasajero_silla(%s, %L::jsonb)', pg_temp.s(2),
  json_build_object('pasajero_nombres', 'PISA', 'plazo', (public.fecha_negocio(now()) + 3)::text,
                    'esperado', json_build_object('numero_contrato', null, 'contrato_manual', null, 'updated_at', (select v2 ->> 'updated_at' from vv)))::text),
  'cambió desde que la viste', 'editar con version vieja: rechazado');
select pg_temp.falla(format('select public.liberar_silla(%s, %L::jsonb)', pg_temp.s(2), '{}'), 'Falta la versión', 'Borrar sin version: rechazado');
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(3), 'EXT-VER', '{"updated_at":"no-es-fecha"}'),
  'Versión de la silla inválida', 'asignar con version invalida: rechazado');
reset role;
select pg_temp.ok((select f2 from vfoto) = pg_temp.foto(pg_temp.s(2)) and (select f3 from vfoto) = pg_temp.foto(pg_temp.s(3)),
  'ningun rechazo borro ni asigno nada (las correcciones del otro operador siguen)');
-- Con la versión vigente sí se aplican.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select public.asignar_contrato_manual(pg_temp.s(3), 'EXT-VER', pg_temp.version(pg_temp.s(3)));
select public.liberar_silla(pg_temp.s(2), pg_temp.version(pg_temp.s(2)));
reset role;
select pg_temp.ok((select contrato_manual = 'EXT-VER' and estado::text = 'confirmada' and pasajero_nombres = 'VER TRES CORREGIDO' from public.sillas where id = pg_temp.s(3)),
  'asignar con la version vigente confirma la retencion con su pasajero');
select pg_temp.ok((select estado::text = 'disponible' and not public._silla_con_datos(s) from public.sillas s where id = pg_temp.s(2)),
  'Borrar con la version vigente libera la silla');
-- Firmas VIEJAS (compatibilidad de despliegue): siguen funcionando, SIN comprobar versión.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select public.editar_pasajero_silla(pg_temp.s(4), json_build_object('pasajero_nombres', 'VIEJA', 'plazo', (public.fecha_negocio(now()) + 3)::text)::jsonb);
select public.asignar_contrato_manual(pg_temp.s(4), 'EXT-VIEJA');
select public.liberar_silla(pg_temp.s(4));
reset role;
select pg_temp.ok((select estado::text = 'disponible' and contrato_manual is null and not public._silla_con_datos(s) from public.sillas s where id = pg_temp.s(4)),
  'firmas viejas (sin version) siguen operando: compatibilidad, SIN proteccion');
-- Permisos de las firmas nuevas.
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2012');
select pg_temp.falla(format('select public.liberar_silla(%s, %L::jsonb)', pg_temp.s(3), pg_temp.version(pg_temp.s(3))), 'Sin permiso para operar vuelos', 'venta: no libera');
select pg_temp.falla(format('select public.asignar_contrato_manual(%s, %L, %L::jsonb)', pg_temp.s(5), 'X', '{"updated_at":"2026-01-01T00:00:00Z"}'), 'Sin permiso para operar vuelos', 'venta: no asigna');
reset role;
set local role anon;
select pg_temp.falla('select public.liberar_silla(1, ''{}''::jsonb)', 'permission denied', 'anon: sin EXECUTE en liberar_silla(bigint, jsonb)');
select pg_temp.falla('select public.asignar_contrato_manual(1, ''X'', ''{}''::jsonb)', 'permission denied', 'anon: sin EXECUTE en asignar_contrato_manual(bigint, text, jsonb)');
reset role;

-- ═══ 11. Registro de uso de las firmas sin versión (evidencia para su cierre) ═
select pg_temp.ok((select count(*) from public.vuelos_firmas_antiguas_uso where firma = 'liberar_silla(bigint)') >= 1,
  'liberar_silla(bigint) quedo registrada');
select pg_temp.ok((select count(*) from public.vuelos_firmas_antiguas_uso where firma = 'asignar_contrato_manual(bigint,text)') >= 1,
  'asignar_contrato_manual(bigint,text) quedo registrada');
select pg_temp.ok((select count(*) from public.vuelos_firmas_antiguas_uso where firma = 'editar_pasajero_silla sin esperado.updated_at') >= 1,
  'editar sin esperado.updated_at quedo registrada');
create temp table uso_antes as select count(*) n from public.vuelos_firmas_antiguas_uso;
grant select on uso_antes to public;
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select public.editar_pasajero_silla(pg_temp.s(5), json_build_object('pasajero_nombres', 'CON VERSION', 'plazo', (public.fecha_negocio(now()) + 2)::text,
  'esperado', json_build_object('numero_contrato', null, 'contrato_manual', null, 'updated_at', (select s.updated_at from public.sillas s where s.id = pg_temp.s(5))))::jsonb);
select public.asignar_contrato_manual(pg_temp.s(5), 'EXT-CON-VERSION', pg_temp.version(pg_temp.s(5)));
select public.liberar_silla(pg_temp.s(5), pg_temp.version(pg_temp.s(5)));
reset role;
select pg_temp.ok((select count(*) from public.vuelos_firmas_antiguas_uso) = (select n from uso_antes),
  'las firmas con version NO se registran como uso antiguo');
select pg_temp.ok((select bool_and(actor_id = '00000000-0000-0000-0000-0000000f2011' and actor_rol = 'control_vuelo') from public.vuelos_firmas_antiguas_uso where firma not like 'marca:%'),
  'cada registro guarda quien llamo y con que rol');
set local role authenticated;
select pg_temp.como('00000000-0000-0000-0000-0000000f2011');
select pg_temp.falla('select count(*) from public.vuelos_firmas_antiguas_uso', 'permission denied', 'la API no lee el registro');
reset role;

rollback;
