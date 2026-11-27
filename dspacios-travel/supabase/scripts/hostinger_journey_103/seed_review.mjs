// NOT atomic: the Auth users are created first and the data afterwards in separate transactions, so a failure can leave a partial synthetic state; every statement is idempotent, so running it again completes it.
// Owner REVIEW seed (#103): synthetic data for the consolidated walkthrough (docs/tecnico/owner-walkthrough-103.md). Local, disposable, no real person or supplier.
// Runs against the harness's dedicated PostgreSQL container and its marked database only (validated first). Idempotent. Carried over from the seed of the verified compiled-app walkthroughs, plus a named date set and a two-stay contract (DTM-2004).
import fs from "node:fs";
import path from "node:path";
import { ajustesRevision, cargarConfig, contrasenaRevision, escribirCredenciales, guardarEstadoRevision, psql, requerir, sqlDesechable, validarBdDesechable } from "./lib.mjs";

const a = ajustesRevision();
validarBdDesechable(a);                                                  // BEFORE anything is written: dedicated container + marked disposable database
const cfg = cargarConfig(a), sql = sqlDesechable(a), pass = contrasenaRevision(cfg), p = cfg.puertos;
const USUARIOS = [["sup103@walk.test", "Super Walk", "superadmin"], ["admin103@walk.test", "Admin Walk", "administracion"], ["ops103@walk.test", "Ops Walk", "operaciones"], ["venta103@walk.test", "Venta Walk", "venta"]];

for (const [email, nombre, rol] of USUARIOS) {
  const r = await fetch(`http://127.0.0.1:${p.gateway}/auth/v1/admin/users`, { method: "POST", headers: { "content-type": "application/json", apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` }, body: JSON.stringify({ email, password: pass, email_confirm: true }) });
  const j = await r.json(); requerir(r.ok || /already|registered/i.test(JSON.stringify(j)), `create ${email}: ${JSON.stringify(j)}`);
  const id = j.id ?? sql(`select id from auth.users where email = '${email}'`);
  sql(`insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('${id}', '${email}', '${nombre}', '${rol}', true, 'mayorista') on conflict (id) do update set rol = excluded.rol, activo = true, tenant = 'mayorista'`);
}

psql(a, a.db, `
begin;
insert into public.destinos (id, nombre) values (20301, 'CARTAGENA WALK') on conflict do nothing;
insert into public.proveedores (id, nombre) values (20301, 'Hotel Prueba 103'), (20302, 'Receptivo 103'), (20303, 'Aerolínea Walk') on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id, moneda, edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max, pax_min, pax_max, activo)
  values (20301, 20301, 'Hotel Prueba 103', 20301, 'COP', 0, 5, 6, 12, 1, 6, true) on conflict do nothing;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo) values (20301, 20301, 'ALTA', '2026-11-25', '2027-03-31', 1, 'tarifa') on conflict do nothing;
insert into public.tarifa_hotel (hotel_id, tipo_habitacion, alimentacion, temporada, neto_sencilla, neto_doble, neto_nino, neto_nino2, neto_infante)
  select 20301, 'Estandar', 'PAM', 'ALTA', 160000, 100000, 50000, 30000, 40000 where not exists (select 1 from public.tarifa_hotel where hotel_id = 20301);
insert into public.hotel_acomodaciones (hotel_id, acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max)
  select 20301, a.acomodacion::public.acomodacion_tipo, a.pax_tarifa, a.pax_max, a.adt_min, a.adt_max, a.chd_min, a.chd_max, a.inf_min, a.inf_max
  from (values ('doble', 2, 4, 2, 2, 0, 2, 0, 2), ('sencilla', 1, 2, 1, 1, 0, 1, 0, 1)) a(acomodacion, pax_tarifa, pax_max, adt_min, adt_max, chd_min, chd_max, inf_min, inf_max) on conflict do nothing;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor) values
  (20302, 20301, 'Promo Semana Santa', '2027-03-20', '2027-04-05', 5, 'descuento_pct', 10),
  (20303, 20301, 'Promo sin digitar', '2027-03-01', '2027-03-10', 4, 'descuento_pct', 5) on conflict do nothing;
insert into public.hotel_codigos_promocion (hotel_id, vigencia_id, requerido, codigo, nota)
  select * from (values (20301::bigint, 20302::bigint, true, 'SS-2027-X', 'Pedir en el asunto'), (20301, 20303, true, null, null)) v(hotel_id, vigencia_id, requerido, codigo, nota)
  where not exists (select 1 from public.hotel_codigos_promocion where hotel_id = 20301);
insert into public.hotel_blackouts (hotel_id, fecha_inicio, fecha_fin, total, motivo)
  select 20301, '2027-02-10', '2027-02-12', true, 'Mantenimiento Walk' where not exists (select 1 from public.hotel_blackouts where hotel_id = 20301 and motivo = 'Mantenimiento Walk');
insert into public.conjuntos_fechas (nombre, anio, tipo, rangos) values ('Semana Santa Walk', 2027, 'semana_santa', '[{"fecha_inicio":"2027-03-25","fecha_fin":"2027-03-28"}]') on conflict do nothing;
-- two packages that carry a persisted «tariffs not updated» debt (the change is aged 20 minutes): the hotel page resumes it by itself
insert into public.armado_paquetes (id, nombre, tipo, noches, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, moneda, moneda_publicacion, activo, tarifario_revision_fuente, tarifario_revision_publicada, tarifario_estado)
  select p, 'Paquete Walk ' || p, 'porcion_terrestre', 3, 20301, 0.2, 'fijo', 0, '2026-11-25', '2027-03-31', 'COP', 'COP', true, 4, 1, 'pendiente' from unnest(array[20301, 20302]) p on conflict do nothing;
insert into public.armado_hoteles (paquete_id, hotel_id, categorias, regimenes) select p, 20301, array['Estandar'], array['PAM'] from unnest(array[20301, 20302]) p where not exists (select 1 from public.armado_hoteles where paquete_id = p);
insert into public.tarifario_cambio_fuente (paquete_id, revision, alcance, motivo, creado_en) select p, 4, 'aditivo', 'walkthrough', now() - interval '20 minutes' from unnest(array[20301, 20302]) p where not exists (select 1 from public.tarifario_cambio_fuente where paquete_id = p);
-- a second catalogue hotel with its own required code, used by the two-stay contract DTM-2004
insert into public.hoteles (id, destino_id, nombre) select 20310, destino_id, 'Otro Hotel 103' from public.hoteles where id = 20301 on conflict do nothing;
insert into public.hotel_temporadas (id, hotel_id, nombre, fecha_inicio, fecha_fin, prioridad, tipo, descuento_valor) values (20311, 20310, 'Promo Otro Hotel', '2027-03-30', '2027-04-10', 5, 'descuento_pct', 10) on conflict do nothing;
insert into public.hotel_codigos_promocion (hotel_id, vigencia_id, requerido, codigo) select 20310, 20311, true, 'OTRO-CODE' where not exists (select 1 from public.hotel_codigos_promocion where hotel_id = 20310);
commit;
begin;
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, fecha_regreso, pax, estado, asesor, precio_venta) values
  ('DTM-2001', 'Cliente Walkthrough', 'mayorista', 'CARTAGENA', '2027-03-26', '2027-03-30', 3, 'pendiente', 'Admin Walk', 3000000),
  ('DTM-2002', 'Otro Cliente', 'mayorista', 'CARTAGENA', '2027-05-01', '2027-05-04', 2, 'pendiente', 'Admin Walk', 2000000),
  ('DTM-2003', 'Tercer Cliente', 'mayorista', 'CARTAGENA', '2027-05-10', '2027-05-14', 2, 'pendiente', 'Admin Walk', 2200000),
  ('DTM-2004', 'Cliente Dos Estancias', 'mayorista', 'CARTAGENA', '2027-03-26', '2027-04-02', 2, 'pendiente', 'Admin Walk', 3500000) on conflict (numero_contrato) do nothing;
insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, categoria, alimentacion, acomodacion, detalle_acomodacion, fecha_ingreso, fecha_salida, proveedor)
  select 'DTM-2001', 'Hotel Prueba 103', 'Cartagena', 'Estandar', 'Todo incluido', 'Doble', '1 hab doble + 1 niño', '2027-03-26', '2027-03-30', 'Hotel Prueba 103' where not exists (select 1 from public.contrato_hoteles where numero_contrato = 'DTM-2001');
insert into public.contrato_hoteles (numero_contrato, nombre, ciudad, categoria, alimentacion, acomodacion, fecha_ingreso, fecha_salida, proveedor)
  select 'DTM-2004', n.nombre, 'Cartagena', 'Estandar', n.alim, 'Doble', n.ingreso::date, n.salida::date, 'Hotel Prueba 103'
  from (values ('Hotel Prueba 103', 'Todo incluido', '2027-03-26', '2027-03-30'), ('Otro Hotel 103', 'Desayuno', '2027-03-30', '2027-04-02')) n(nombre, alim, ingreso, salida) where not exists (select 1 from public.contrato_hoteles where numero_contrato = 'DTM-2004');
insert into public.contrato_servicios (numero_contrato, tipo, descripcion, proveedor, alcance_traslado)
  select 'DTM-2001', 'traslado', 'Traslado aeropuerto - hotel', 'Receptivo 103', 'ida_regreso' where not exists (select 1 from public.contrato_servicios where numero_contrato = 'DTM-2001');
insert into public.contrato_pasajeros (numero_contrato, nombre, fecha_nacimiento)
  select * from (values ('DTM-2001', 'Ana Walk', '1985-05-01'::date), ('DTM-2001', 'Luis Walk', '1983-02-11'), ('DTM-2001', 'Sofía Walk', '2017-08-10'), ('DTM-2004', 'Marta Dos', '1980-01-15'), ('DTM-2004', 'Pedro Dos', '1978-09-03')) v(c, n, f)
  where not exists (select 1 from public.contrato_pasajeros where numero_contrato = v.c);
commit;
insert into public.cuentas_por_pagar (id, numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, moneda, tenant) values
  (20301, 'DTM-2001', 'Proveedor Pago 103', 'hotel', 'Hotel Prueba 103', 4000000, 'COP', 'mayorista'), (20302, 'DTM-2002', 'Proveedor Pago 103', 'hotel', 'Traslados', 2500000, 'COP', 'mayorista'),
  (20303, 'DTM-2003', 'Proveedor Pago 103', 'receptivo', 'Tour Walk', 300, 'USD', 'mayorista') on conflict do nothing;
insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm, tenant)
  select * from (values (20301::bigint, '2027-01-15'::date, 1500000::numeric, 1::numeric, 'mayorista'), (20302, '2027-01-15', 2500000, 1, 'mayorista'), (20303, '2027-01-15', 100, 4000, 'mayorista'), (20303, '2027-01-20', 50, 4100, 'mayorista')) v(c, f, valor, trm, t)
  where not exists (select 1 from public.cxp_pagos where cuenta_por_pagar_id in (20301, 20302, 20303));
`, { input: true });                                                  // stdin, like the verified original seed: explicit BEGIN/COMMIT blocks
console.log(`review data ready: ${USUARIOS.length} accounts, 4 contracts (DTM-2001…2004), hotel 20301 with codes/closure/debt, 3 payment obligations. Credentials: see the review folder (review_credentials.txt).`);
const pdf = path.join(a.work, "soporte-walk.pdf");                    // synthetic payment proof used by walkthrough step W9
if (!fs.existsSync(pdf)) fs.writeFileSync(pdf, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("comprobante de pago sintético ".repeat(60))]));
escribirCredenciales(a, cfg);                                          // the credentials sheet is always regenerated from the config (never edited by hand)
guardarEstadoRevision(a, { seeded: true, seededAt: new Date().toISOString() });   // from now on up/down/pg-destroy refuse to touch this review without explicit confirmation
