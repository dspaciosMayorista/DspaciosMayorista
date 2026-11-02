import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SolicitudPendiente, type DatosSolicitudHotel } from "../components/cotizacion/SolicitudPendiente.tsx";
import { serviciosParaSolicitud, vueloParaSolicitud } from "../lib/reservar/solicitudResumen.ts";
import { contieneImportes } from "../lib/reservar/solicitudHotel.ts";
import { NOTA_RECOMENDADOS } from "../lib/tarifario/solicitudVista.ts";

// #120 (PR #432) — documento de una solicitud pendiente de tarifa: resumen por secciones, solo con datos guardados, sin importes ni disponibilidad confirmada.

const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
const html = (datos: DatosSolicitudHotel | null) => renderToStaticMarkup(React.createElement(SolicitudPendiente, { codigo: "COT-1", datos }));

const VUELO_CRUDO = {
  aerolinea: "Avianca", ruta: "BOG - CTG - BOG", fecha_ida: "2027-03-10", fecha_regreso: "2027-03-13", vuelo_ida: "AV 9301", vuelo_regreso: "AV 9302",
  hora_salida_ida: "06:30:00", hora_llegada_ida: "07:55:00", hora_salida_reg: "18:10:00", hora_llegada_reg: "19:35:00",
  record: "L93FYZ", costo_neto: 900000, tarifa_para_empaquetar: 1200000, fee_infante: 50000, proveedor: { nombre: "Proveedor X" },
};
const BLOQUEO: DatosSolicitudHotel = {
  hotelNombre: "Hotel Caribe", paqueteNombre: "Cartagena marzo", destino: "CARTAGENA", modulo: "bloqueo", categoria: "Estándar", regimen: "PAM",
  habitaciones: { doble: 1 }, adultos: 2, menores: 1, edadesMenores: [6], fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", notas: "Aniversario",
  vuelo: vueloParaSolicitud(VUELO_CRUDO), servicios: serviciosParaSolicitud([{ servicios_adicionales: { nombre: "Traslado aeropuerto-hotel", categoria: "tour_traslado" } }, { servicios_adicionales: { nombre: "Asistencia médica", categoria: "asistencia" } }]),
};
const PORCION: DatosSolicitudHotel = { ...BLOQUEO, modulo: "porcion_terrestre", vuelo: null, paqueteNombre: "Porción San Andrés", destino: "SAN ANDRÉS", menores: 0, edadesMenores: [] };

describe("constructores puros", () => {
  test("el vuelo solo conserva lo confirmado de la salida: sin record, costos, tarifa ni proveedor", () => {
    const v = vueloParaSolicitud(VUELO_CRUDO);
    assert.deepEqual(v, { aerolinea: "Avianca", ruta: "BOG - CTG - BOG", fechaIda: "2027-03-10", fechaRegreso: "2027-03-13", vueloIda: "AV 9301", vueloRegreso: "AV 9302", salidaIda: "06:30", llegadaIda: "07:55", salidaRegreso: "18:10", llegadaRegreso: "19:35" });
    assert.equal(contieneImportes({ vuelo: v }), false);
    assert.doesNotMatch(JSON.stringify(v), /L93FYZ|Proveedor|900000|1200000|50000/);
  });
  test("lo que la salida no tiene queda null (no se inventa) y los servicios no repiten ni traen proveedor", () => {
    const v = vueloParaSolicitud({ ruta: "MDE - SMR", fecha_ida: "2027-04-01" });
    assert.equal(v.aerolinea, null); assert.equal(v.vueloIda, null); assert.equal(v.salidaIda, null);
    const s = serviciosParaSolicitud([{ servicios_adicionales: { nombre: "Tour", categoria: "otro" } }, { servicios_adicionales: { nombre: "Tour", categoria: "otro" } }, { servicios_adicionales: null }]);
    assert.deepEqual(s, [{ nombre: "Tour", categoria: "otro" }]);
  });
});

describe("documento pendiente", () => {
  test("bloqueo con vuelo: secciones, salida elegida con ruta, fechas, vuelos y horarios, y servicios", () => {
    const h = html(BLOQUEO);
    for (const t of ["sol-estado", "sol-paquete", "sol-hotel", "sol-fechas", "sol-componentes"]) assert.match(h, new RegExp(`data-testid="${t}"`));
    assert.match(h, /Estado y siguiente paso/); assert.match(h, /Paquete y destino/); assert.match(h, /Hotel, habitación y alimentación/); assert.match(h, /Fechas y viajeros/);
    assert.match(h, /Avianca · BOG - CTG - BOG/);
    assert.match(h, /10 mar 2027 · vuelo AV 9301 · sale 06:30 · llega 07:55/);
    assert.match(h, /13 mar 2027 · vuelo AV 9302 · sale 18:10 · llega 19:35/);
    assert.match(h, /10 mar 2027 al 13 mar 2027 · 3 noches/);
    assert.match(h, /1 Doble/); assert.match(h, /Estándar/); assert.match(h, /PAM/);
    assert.match(h, /Menores<\/dt><dd[^>]*>1 \(edades: 6\)/);
    assert.match(h, /Traslado aeropuerto-hotel/); assert.match(h, /Asistencia médica/);
    assert.match(h, /Tarifa y disponibilidad bajo solicitud/);
  });
  test("porción terrestre: fechas y servicios terrestres, sin vuelo inventado", () => {
    const h = html(PORCION);
    assert.match(h, /Porción terrestre \(sin vuelo\)/); assert.match(h, /Este paquete no incluye vuelo\./);
    assert.doesNotMatch(h, /Avianca|AV 93|sale 06:30|Ida<|Regreso</);
    assert.match(h, /Traslado aeropuerto-hotel/); assert.match(h, /10 mar 2027 al 13 mar 2027/);
    assert.doesNotMatch(h, /Menores/);
  });
  test("ningún importe, costo ni proveedor, y nada que afirme disponibilidad confirmada", () => {
    for (const d of [BLOQUEO, PORCION]) {
      const h = html(d);
      assert.doesNotMatch(h, /\$\s?\d|COP|USD|costo|neta|proveedor|L93FYZ|900000|1200000/i);
      assert.doesNotMatch(h, /disponibilidad (confirmada|garantizada)|cupo confirmado|reserva confirmada/i);
      assert.match(h, /no puede reservarse ni pagarse/);
    }
  });
  test("solicitud anterior sin esos campos: no inventa vuelo ni servicios y muestra lo que sí tiene", () => {
    const h = html({ hotelNombre: "Hotel Viejo", categoria: "A confirmar", regimen: "A confirmar", habitaciones: { sencilla: 2 }, adultos: 2, fechaIda: "2027-05-01", fechaRegreso: "2027-05-04" });
    assert.doesNotMatch(h, /data-testid="sol-componentes"/); assert.doesNotMatch(h, /Vuelo/);
    assert.match(h, /2 Sencilla/); assert.match(h, /Por confirmar con el asesor/);
  });
  test("móvil: una columna y texto que corta en lugar de desbordar; escritorio en dos", () => {
    const h = html(BLOQUEO);
    assert.match(h, /grid-cols-1[^"]*sm:grid-cols-2/); assert.match(h, /break-words/); assert.match(h, /px-4/);
    assert.doesNotMatch(h, /whitespace-nowrap|w-\[\d{3,}px\]|min-w-\[/);
  });
});

describe("cableado: creación y valoración usan la misma fuente de vuelo", () => {
  const accion = leer("app/tarifario/solicitudHotelActions.ts");
  test("la solicitud congela vuelo y servicios con resolverDatosVuelo y falla cerrado si no se pueden leer", () => {
    assert.match(accion, /resolverDatosVuelo\(admin, bloqueoId \? \{ tipo: "bloqueo", id: bloqueoId \} : \{ tipo: "empaquetado", id: empaquetadoId! \}\)/);
    assert.match(accion, /if \(!rv\.ok \|\| !rv\.data\) return \{ ok: false, error: ERROR_GENERICO \}/);
    assert.match(accion, /eq\("incluido", true\)/);
    assert.match(accion, /modulo, edadesMenores: input\.edadesMenores, vuelo, servicios,/);
  });
  test("al valorar, la cotización abierta arma vuelos e ítems con el mismo resolverDatosVuelo, y el documento pendiente solo sale mientras esté pendiente", () => {
    const r = leer("app/(dashboard)/dashboard/reservar/actions.ts");
    const i = r.indexOf("const vuelosSnap"); assert.ok(i > 0);
    assert.match(r.slice(0, i), /resolverDatosVuelo\(createAdminClient\(\), origen\)/);
    for (const p of ["app/cot/[token]/page.tsx", "app/cotizacion/[id]/page.tsx", "app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx"]) assert.match(leer(p), /estaPendienteTarifa\(c(ot)?\.estado\)/, p);
  });
  test("la frase bajo «Hoteles recomendados» es la pedida", () => {
    assert.equal(NOTA_RECOMENDADOS, "¿Buscas otra opción? Elige origen, destino y fechas para ver más hoteles.");
  });
});
