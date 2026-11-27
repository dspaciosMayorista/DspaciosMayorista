-- REVISIÓN CONSOLIDADA — después de las semillas y de fijar los perfiles de las cuentas reales.
-- 1) Las filas de usuarios que crearon las semillas originales (cuentas ficticias de cada recorrido automático, sin contraseña) se DESACTIVAN: no son cuentas de la revisión y no deben aparecer como personal activo.
update public.usuarios set activo = false where email not like '%@consolidada.test' and activo is true;
-- 2) #11 presencia observada (relativa a AHORA) de las cuentas reales: superadmin 3 min, agencia aliada 4 min y administración 8 min = recientes (≤ 10 min); gerencia 2 h = hoy; freelance 3 días. Sin observación: operaciones, venta, venta2, control de vuelo, minorista.
--    Al entrar con una cuenta, su fila se crea/actualiza sola (a lo sumo una vez cada 4 min).
insert into public.presencia_usuario (usuario_id, visto_en)
select u.id, now() - m * interval '1 minute' from (values ('superadmin', 3), ('aliado', 4), ('administracion', 8), ('gerencia', 120), ('freelance', 4320)) v(a, m)
  join public.usuarios u on u.email = v.a || '@consolidada.test' on conflict (usuario_id) do update set visto_en = excluded.visto_en;
-- 3) #11 contexto de auditoría (último cambio guardado) de algunas cuentas.
insert into public.auditoria (creado_en, actor_id, actor_email, actor_rol, accion, tabla, registro_id)
select now() - v.m * interval '1 minute', u.id, u.email, u.rol::text, 'UPDATE', 'ventas', 'revision'
  from (values ('superadmin', 4), ('superadmin', 70), ('administracion', 12), ('administracion', 90), ('gerencia', 200)) v(a, m)
  join public.usuarios u on u.email = v.a || '@consolidada.test';
-- 4) #13 avisos en la campana: UNA ejecución del generador diario (como el cron) con las cuentas reales ya activas y los paquetes en su estado final.
select public.generar_avisos_compra();
