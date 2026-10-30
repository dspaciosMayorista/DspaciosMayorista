-- ─────────────────────────────────────────────────────────────────────────
-- 224 · HOTFIX (fase 1, ADITIVA) — vista de `empaquetados` SIN netos para los roles sin acceso financiero.
--
-- PROBLEMA. Desde la 156, `"empaquetados: lectura operativa"` deja leer la tabla completa a `venta`
-- y a `control_vuelo`. RLS filtra FILAS, no columnas: con su token, `venta` puede pedir
--     GET /rest/v1/empaquetados?select=tarifa_proveedor,fee_infante,...
-- aunque la aplicación no se las muestre (`venta` ni siquiera entra al módulo Vuelos). Es el mismo
-- problema que las migraciones 144 (`ventas`) y 146 (`contrato_servicios`) cerraron. Los permisos por
-- columna no sirven: en Supabase todos los usuarios comparten el rol de base de datos `authenticated`,
-- así que un `revoke` de columna se lo quitaría también a superadmin.
--
-- SOLUCIÓN EN DOS NÚMEROS (patrón 148/149, despliegue A decidido por el Coordinador):
--   · 224 (ESTE ARCHIVO, aditiva): crea `public.empaquetados_basica`, una vista SIN columnas de costo que
--     hace su propio control de rol, con sus grants. NO QUITA ACCESO A NADIE: `venta` conserva la policy de
--     la tabla base, así que el código viejo y el nuevo funcionan con ella aplicada.
--   · 225 (`20260601000225_neto_empaquetados_cierre.sql`): quita a `venta` la lectura de la tabla base. Se
--     aplica DESPUÉS de desplegar el código que lee la vista (`lib/reservar/computo.ts`, única lectura de
--     `empaquetados` con la sesión de `venta`).
--   Orden: 1) correr la 224 · 2) desplegar el código · 3) validar con un usuario `venta` real reservando un
--   vuelo de Sistema · 4) correr la 225. Invertirlo (225 antes del despliegue) deja a `venta` sin poder
--   reservar Sistema ("El empaquetado seleccionado ya no existe").
--
-- QUIÉN LEE QUÉ (evidencia en bitacora-hotfix-224.md, diagnóstico 1.3), una vez aplicada la 225:
--   · superadmin, gerencia, administracion, operaciones, control_vuelo → conservan la tabla base con
--     costos. `control_vuelo` administra el inventario de Empaquetados: los formularios Nuevo/Editar le
--     muestran y le hacen editar "Tarifa proveedor/sistema (neto)" y su policy de escritura (156) ya lo
--     incluye.
--   · venta → solo la vista (`mi_rol()` devuelve 'venta' en su `where`).
--   · agencia / freelance / cliente_final / anon → siguen sin leer nada (la policy exige `mi_rol()`).
--
-- COLUMNAS QUE LA VISTA NO EXPONE: tarifa_proveedor (neto), fee_infante (costo al proveedor),
-- tarifa_para_empaquetar (precio de reventa con margen), estado_pago (pago al proveedor) y notas (texto
-- libre que puede traer importes). `venta` no necesita ninguna. La lista de columnas es explícita: una
-- columna futura de `empaquetados` NO aparece en la vista salvo que alguien la agregue a propósito.
--
-- No hay columna de tenant en `empaquetados` (catálogo global, como `bloqueos_vuelo`): el control es por rol.
--
-- Rollback: rollback_224_neto_empaquetados.sql (retira la vista; se NIEGA si la 225 sigue aplicada).
-- Preflight: preflight_224_neto_empaquetados.sql · Postcheck: postcheck_224_neto_empaquetados.sql ·
-- Pruebas: test_224_neto_empaquetados.sql / test_224_fases.sh / test_224_api.sh (CI desechable).
-- ─────────────────────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.empaquetados') is null or to_regprocedure('public.mi_rol()') is null then
    raise exception '224: falta public.empaquetados (156) o public.mi_rol(); aplica las migraciones anteriores primero.';
  end if;
end $$;

-- ── La vista segura: SIN columnas de costo ────────────────────────────────
-- No es `security_invoker`: se evalúa con los privilegios de su dueño (que no está sujeto a la RLS de
-- la tabla base), y el `where` ES la frontera de acceso — igual que `ventas_basica` (144/148).
-- `mi_rol()` lee la sesión real del que llama (request.jwt.claims) y devuelve NULL para un usuario
-- inactivo o ausente (140): con NULL ninguna rama es verdadera y la vista devuelve 0 filas.
-- `security_barrier = true`: ninguna función del que consulta puede ver filas antes de ese `where`.
create or replace view public.empaquetados_basica
  with (security_barrier = true, security_invoker = false)
as
  select
    e.id, e.record, e.aerolinea, e.proveedor_id, e.destino_id, e.ruta, e.origen,
    e.vuelo_ida, e.fecha_ida, e.hora_salida_ida, e.hora_llegada_ida,
    e.vuelo_regreso, e.fecha_regreso, e.hora_salida_reg, e.hora_llegada_reg,
    e.compra_inicio, e.compra_fin, e.estado_emision, e.activo,
    e.created_at, e.updated_at
  from public.empaquetados e
  where public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta','control_vuelo');

comment on view public.empaquetados_basica is
  'Migración 224. empaquetados SIN columnas de costo (tarifa_proveedor, fee_infante, tarifa_para_empaquetar, estado_pago, notas). Es la puerta de lectura del rol venta a los empaquetados (a la tabla base deja de entrar con la migración 225, para que no pueda pedir los netos por la API). Control de rol en su propio where (security_barrier). Los roles financieros y control_vuelo siguen leyendo la tabla base.';

revoke all on public.empaquetados_basica from public, anon, authenticated, service_role;
-- Solo `authenticated`: la vista decide por `mi_rol()` (sesión del usuario). El servidor con service-role lee
-- la tabla base directamente (salta la RLS), así que no necesita la vista.
grant select on public.empaquetados_basica to authenticated;

notify pgrst, 'reload schema';

commit;
