-- ═══════════════════════════════════════════════════════════════════════════
-- Preparación de CONCURRENCIA (dos conexiones REALES) contra la cadena de
-- migraciones REAL 1→163 + la migración 164 real (Commit 7 — cierre operativo).
--
-- A diferencia de `test_164_concurrencia.sql`/`.sh` (que corren contra el
-- ESPEJO manual de `test_164_schema.sql` en Docker), este script y su pareja
-- `test_164_concurrencia_real.sh` usan la MIGRACIÓN 164 REAL, aplicada sobre
-- el esquema completo 1→163 (vía `supabase/scripts/pruebas/local-desde-cero.sh`
-- + la 164), sin Docker — corren en cualquier PostgreSQL desechable local.
-- Preferencia explícita del dueño: "usa la migración 164 real como autoridad
-- en las pruebas". No reemplazan al espejo Docker (decisión ya aprobada de
-- Commits anteriores, no se reabre) — lo complementan con una vía que SÍ se
-- puede ejecutar de punta a punta en entornos sin Docker (ej. CI, este mismo
-- sandbox).
--
-- Deja tres cotizaciones limpias, CADA UNA SIN pago previo (para que la
-- primera llamada real a `registrar_pago_previo` sea la que compite):
--   201 · COP · reutilizable para pruebas de humo posteriores.
--   202 · USD · T4': dos PRIMEROS pagos concurrentes con TRM distintas (en
--         COP la TRM congelada siempre es 1 por definición del motor —
--         `v_trm_congelada := case when moneda='COP' then 1 else ...` — así
--         que la carrera de TRM solo es real en una cotización en USD).
--   203 · COP · T3': doble-click con la MISMA clave de idempotencia.
-- Precondición: migraciones 1→163 + la 164 real ya aplicadas en la BD.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

insert into auth.users (id, email, aud, role) values
  ('cccccccc-0000-0000-0000-000000000001','conc-actor@t','authenticated','authenticated')
on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('cccccccc-0000-0000-0000-000000000001','conc-actor@t','CONC ACTOR','superadmin', true,'mayorista')
on conflict (id) do update set
  email=excluded.email, nombre=excluded.nombre, rol=excluded.rol,
  activo=excluded.activo, tenant=excluded.tenant;

create or replace function _t164r_mk_cot_sin_pago(p_clave text, p_moneda text default 'COP')
returns bigint language plpgsql as $$
declare v_cot bigint;
begin
  insert into public.cotizaciones
    (tenant, estado, tipo, cliente, cliente_documento, destino, fecha_salida, fecha_regreso,
     pax, precio_venta, moneda, asesor, payload, detalle)
  values
    ('mayorista', 'abierta', 'manual', 'CLIENTE CONC '||p_clave, 'CC '||substr(p_clave,1,6),
     'CARTAGENA', '2026-10-01', '2026-10-04', 2, 3000000, p_moneda, 'Asesor CONC',
     jsonb_build_object(
       'cliente', jsonb_build_object('nombres','Cliente','apellidos',p_clave,'tipoDoc','CC',
         'numeroDoc', substr(replace(p_clave,'-',''),1,10), 'nacimiento','1990-01-01','telefono','300123'),
       'tipoAsesor','interno','ninos',0,'tarifaNino',0,'recobro',0,'recobroAliado',0,
       'observaciones','conc-'||p_clave),
     '{}'::jsonb)
  returning id into v_cot;
  insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
  values (v_cot, 0, 'hotel', NULL, 'Hotel Conc Test', 'PROV HOTEL CONC', 1000000);
  return v_cot;
end $$;

do $$
declare v201 bigint; v202 bigint; v203 bigint;
begin
  -- Nunca se borran cotizaciones/condiciones previas de corridas anteriores:
  -- una vez que una gana la carrera del primer pago, el candado de
  -- inmutabilidad de la 164 (trg_..._bloquear_congeladas, Commit 4/6) impide
  -- borrar `cotizacion_condiciones` de una cotización ya congelada — y ESO
  -- es exactamente lo que este guard debe respetar, no rodear. Cada corrida
  -- crea 3 cotizaciones NUEVAS con etiqueta única (evita cualquier colisión
  -- con corridas previas); el runner bash toma siempre las 3 MÁS RECIENTES.
  v201 := _t164r_mk_cot_sin_pago('201-'||extract(epoch from clock_timestamp())::text, 'COP');
  v202 := _t164r_mk_cot_sin_pago('202-'||extract(epoch from clock_timestamp())::text, 'USD');
  v203 := _t164r_mk_cot_sin_pago('203-'||extract(epoch from clock_timestamp())::text, 'COP');

  -- Publica los ids reales generados (autoincrementales) para que el runner
  -- bash los use tal cual.
  raise notice 'CONC_IDS %,%,%', v201, v202, v203;
end $$;

select 'ready' as estado;
