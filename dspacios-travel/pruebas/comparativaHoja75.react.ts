// Se ejecuta con el loader React (esbuild), no con test:unit.
//
// #75 — Hoja imprimible de la comparativa (`ComparativaHoja`) y tarifa real de menores (`menoresDeOpcion`):
//   · Incluye/No incluye: una vez si es común a todas las opciones, dentro de cada opción si difiere; nada si no existe;
//   · tarifa de menores: la REAL del snapshot (manual y carrito), nunca la de adulto; sin menores o en NETO no se muestra;
//   · cada opción con su total, sin total global; vuelos/servicios bajo su opción y sin importe propio;
//   · ni costos, ni proveedores, ni plataformas, ni comisión/NETO en el documento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { construirComparativaManual, menoresDeOpcion, menoresNoDesglosables, agruparPorHotel, resumenDeOpcion, type EntradaComparativaManual, type OpcionVista } from "@/lib/cotizacion/comparativa";
import { ComparativaHoja, type MadreHoja } from "@/components/cotizacion/ComparativaHoja";
import type { ResumenHotelUI } from "@/lib/cotizacion/comparativaAcciones";

function entrada(sobre: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual {
  return {
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123456", telefono: "3001112233", email: "a@x.test", nacimiento: "1990-01-01" },
    destino: "Cartagena", fechaIda: "2026-11-10", fechaRegreso: "2026-11-14", pax: 2, ninos: 0, tarifaNino: 0,
    recobro: 0, recobroAliado: 0, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor", agenciaNombre: "",
    freelanceNombre: "", plazo: "", vigenciaHasta: "2026-10-20", observaciones: "", incluye: "Desayuno\nTraslados", noIncluye: "Propinas",
    servicios: [
      { tipo: "aereo", plataforma: "PlataformaSecreta", nombre: "Aéreo BOG-CTG", proveedor: "ProveedorSecreto", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "Hoteles A", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "A" },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel B con un nombre muy largo para probar el salto de línea en la tarjeta de la opción", proveedor: "Hoteles B", costoNeto: 560000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "B" },
    ],
    ...sobre,
  };
}
const MADRE: MadreHoja = { codigo: "CMP-001", cliente: "Ana Pérez", destino: "Cartagena", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-14", pax: 2, moneda: "COP", vigencia_hasta: "2026-10-20", created_at: "2026-10-15T10:00:00Z", tenant: "mayorista" };

function armar(sobre: Partial<EntradaComparativaManual> = {}) {
  const r = construirComparativaManual(entrada(sobre), { hoy: "2026-10-15" });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const vistas: OpcionVista[] = r.datos.opciones.map((o) => ({ opcionRef: o.opcion_ref, acomodacionRef: o.acomodacion_ref, etiqueta: o.etiqueta, moneda: o.moneda, tarifaPersona: o.tarifa_persona, total: o.total, orden: o.orden }));
  const resumenes: Record<string, ResumenHotelUI> = {};
  for (const o of r.datos.opciones) {
    const res = resumenDeOpcion(o.resumen_publico);
    const m = menoresDeOpcion(o.resumen_publico, o.plantilla_hija, o.etiqueta);
    if (m.length) res.menores = m;
    resumenes[`${o.opcion_ref}/${o.acomodacion_ref}`] = res; resumenes[o.opcion_ref] ??= res;
  }
  return { opciones: r.datos.opciones, grupos: agruparPorHotel(vistas), resumenes };
}
const html = (grupos: ReturnType<typeof armar>["grupos"], resumenes: Record<string, ResumenHotelUI>, vencida = false, madre = MADRE) =>
  renderToStaticMarkup(h(ComparativaHoja, { madre, grupos, resumenes, vencida, identidad: null }));
const cuenta = (s: string, t: string) => s.split(t).length - 1;
const COP = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

test("manual con un niño: muestra su tarifa real (no la de adulto) en CADA opción", () => {
  const { opciones, grupos, resumenes } = armar({ ninos: 1, tarifaNino: 150000 });
  for (const o of opciones) {
    assert.deepEqual(menoresDeOpcion(o.resumen_publico, o.plantilla_hija, o.etiqueta), [{ descripcion: "Niño", cantidad: 1, tarifa: 150000 }]);
    assert.notEqual(o.tarifa_persona, 150000);
  }
  const s = html(grupos, resumenes);
  assert.equal(cuenta(s, "1 × Niño"), 2);
  assert.equal(cuenta(s, COP(150000)), 2);
  assert.match(s, /Tarifa por adulto/);
});

test("sin menores cotizados no se inventa ninguna línea de menor", () => {
  const { opciones, grupos, resumenes } = armar();
  for (const o of opciones) assert.deepEqual(menoresDeOpcion(o.resumen_publico, o.plantilla_hija, o.etiqueta), []);
  assert.doesNotMatch(html(grupos, resumenes), /× Niño|Infante/);
});

test("carrito: usa las líneas de menores del snapshot (infante sin costo = «Sin costo») y recorta el hotel", () => {
  const plantilla = { detalle: { items: [
    { descripcion: "Hotel X — CARTAGENA · 1 hab Doble (2 pax) · Estándar / PC", adultos: 2, ninos: 0, tarifa_adulto: 500000, tarifa_nino: 0 },
    { descripcion: "Hotel X — CARTAGENA · Niño 1 · Estándar / PC", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 320000 },
    { descripcion: "Hotel X — CARTAGENA · Infante · Estándar / PC", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 0 },
    { descripcion: "Hotel X — Bernalo total", adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0 },
  ] } };
  const m = menoresDeOpcion({}, plantilla, "Hotel X");
  assert.deepEqual(m, [
    { descripcion: "Niño 1 · Estándar / PC", cantidad: 1, tarifa: 320000 },
    { descripcion: "Infante · Estándar / PC", cantidad: 1, tarifa: 0 },
  ]);
  const grupos = agruparPorHotel([{ opcionRef: "A", acomodacionRef: "doble", etiqueta: "Hotel X", moneda: "COP", tarifaPersona: 500000, total: 1320000, orden: 0 }]);
  const s = html(grupos, { "A/doble": { menores: m }, A: { menores: m } });
  assert.match(s, /Sin costo/);
  assert.match(s, new RegExp(COP(320000)));
});

test("una opción NETO no muestra tarifa de menores (las líneas están a PVP)", () => {
  const plantilla = { detalle: { items: [{ descripcion: "Hotel X · Niño 1", adultos: 0, ninos: 1, tarifa_nino: 320000 }] } };
  assert.deepEqual(menoresDeOpcion({ total_exigible: 900000 }, plantilla, "Hotel X"), []);
});

test("Incluye/No incluye: igual en todas → UNA sola vez; distinto → dentro de cada opción; ausente → nada", () => {
  const comun = armar();
  const s1 = html(comun.grupos, comun.resumenes);
  assert.equal(cuenta(s1, ">No incluye<"), 1);
  assert.match(s1, /Incluye \/ No incluye \(todas las opciones\)/);
  assert.match(s1, /Desayuno/);

  const g = comun.grupos;
  const distinto = { ...comun.resumenes, "A/unica": { ...comun.resumenes["A/unica"], incluye: "Cena", noIncluye: "Spa" }, A: { ...comun.resumenes["A/unica"], incluye: "Cena", noIncluye: "Spa" } };
  const s2 = html(g, distinto);
  assert.doesNotMatch(s2, /todas las opciones\)/);
  assert.match(s2, /Cena/);
  assert.match(s2, /Desayuno/);
  assert.equal(cuenta(s2, ">No incluye<"), 2);

  const vacio = armar({ incluye: "", noIncluye: "" });
  const sinTextos = Object.fromEntries(Object.entries(vacio.resumenes).map(([k, v]) => [k, { ...v, incluye: null, noIncluye: null }]));
  assert.doesNotMatch(html(vacio.grupos, sinTextos), /Incluye<|No incluye/);
});

test("cada opción con SU total, sin total global, y sin costos, proveedores, plataformas ni NETO", () => {
  const { opciones, grupos, resumenes } = armar({ ninos: 1, tarifaNino: 150000 });
  const s = html(grupos, resumenes);
  assert.match(s, /Opción A/); assert.match(s, /Opción B/);
  for (const o of opciones) assert.match(s, new RegExp(COP(o.total)));
  assert.doesNotMatch(s, new RegExp(COP(opciones[0].total + opciones[1].total)));
  assert.equal(cuenta(s, "Total de este hotel"), 2);
  assert.doesNotMatch(s, /Gran total|Total general|Total cotización/);
  for (const prohibido of ["ProveedorSecreto", "PlataformaSecreta", "Hoteles A", "Booking", COP(400000), COP(800000), /comisi/i, /NETO/, /recobro/i]) {
    if (typeof prohibido === "string") assert.ok(!s.includes(prohibido), `no debe aparecer ${prohibido}`);
    else assert.doesNotMatch(s, prohibido);
  }
});

test("vuelos y servicios adicionales cuelgan de su opción, sin importe propio", () => {
  const { grupos } = armar();
  const r: ResumenHotelUI = {
    vuelos: [{ tramo: "ida", origen: "BOG", destino: "CTG", fecha: "2026-11-10", hora: "08:15", nota: "Vuelo manual · 2 pax" }],
    otros: [{ nombre: "Tour islas", pax: 2, fechaIda: "2026-11-11", fechaRegreso: null }],
    servicios: [{ nombre: "Traslado", precio: 99999 }],
  };
  const s = html(grupos, { "A/unica": r, A: r, "B/unica": {}, B: {} });
  const [antesB] = s.split("data-testid=\"opcion-B\"");
  assert.match(antesB, /Vuelo ida: BOG/);
  assert.match(antesB, /Tour islas/);
  assert.equal(cuenta(s, "Vuelo ida"), 1);
  assert.ok(!s.includes("99.999") && !s.includes("99999"));
});

test("encabezado: marca, código, emisión y vigencia; vencida avisa; textos largos con ruptura; icono, no emoji", () => {
  const { grupos, resumenes } = armar();
  const s = html(grupos, resumenes);
  assert.match(s, /COTIZACIÓN COMPARATIVA/); assert.match(s, /CMP-001/); assert.match(s, /\/marca\/logo-white\.png/);
  assert.match(s, /Válida hasta/); assert.match(s, /Emisión/);
  assert.match(s, /break-words/);
  assert.doesNotMatch(s, /[\u{1F300}-\u{1FAFF}✅❌✓✕⏳]/u);
  assert.match(html(grupos, resumenes, true), /VENCIÓ/);
  // La hoja no copia cláusulas contractuales ni datos bancarios del contrato.
  assert.doesNotMatch(s, /Datos de pago|cuenta corriente|CLÁUSULA|Bancolombia/i);
});

test("identidad: la de la agencia acreditada; Minorista sin dato propio nunca hereda el RNT de Mayorista", () => {
  const { grupos, resumenes } = armar();
  const min = renderToStaticMarkup(h(ComparativaHoja, { madre: { ...MADRE, tenant: "minorista" }, grupos, resumenes, vencida: false, identidad: null }));
  assert.doesNotMatch(min, /RNT|NIT|147090|901.654/);
  const propia = renderToStaticMarkup(h(ComparativaHoja, { madre: { ...MADRE, tenant: "minorista" }, grupos, resumenes, vencida: false, identidad: { razon_social: "Minorista SAS", nit: "800.1", rnt: "55555", correo: "m@x.test" } }));
  assert.match(propia, /RNT 55555/); assert.match(propia, /Minorista SAS · NIT 800.1 · RNT 55555/);
  assert.doesNotMatch(propia, /147090/);
  const may = renderToStaticMarkup(h(ComparativaHoja, { madre: MADRE, grupos, resumenes, vencida: false, identidad: null }));
  assert.match(may, /RNT 147090/);
});

test("opción NETO con líneas de menores a PVP: no se muestran como tarifa y se explica el límite (sin la palabra NETO)", () => {
  const plantilla = { detalle: { items: [{ descripcion: "Hotel X · Niño 1", adultos: 0, ninos: 1, tarifa_nino: 320000 }] } };
  assert.equal(menoresNoDesglosables({ total_exigible: 900000 }, plantilla, "Hotel X"), true);
  assert.equal(menoresNoDesglosables({ total_exigible: 900000 }, { detalle: { items: [] } }, "Hotel X"), false, "sin menores cotizados no hay nada que explicar");
  assert.equal(menoresNoDesglosables({}, plantilla, "Hotel X"), false, "una opción PVP muestra su tarifa, no el aviso");
  const grupos = agruparPorHotel([{ opcionRef: "A", acomodacionRef: "doble", etiqueta: "Hotel X", moneda: "COP", tarifaPersona: null, total: 900000, orden: 0 }]);
  const s = html(grupos, { "A/doble": { menoresNoDesglosables: true }, A: { menoresNoDesglosables: true } });
  assert.match(s, /no se desglosa con seguridad/);
  assert.ok(!s.includes(COP(320000)) && !/NETO/.test(s));
});

test("las condiciones van pegadas al último bloque que las precede (break-before-avoid): nunca solas en una hoja", () => {
  const { grupos, resumenes } = armar();
  const s = html(grupos, resumenes);
  assert.match(s, /<section class="[^"]*break-before-avoid[^"]*" data-testid="condiciones-hoja"/, "las condiciones se pegan a lo anterior");
  assert.match(s, /<section class="[^"]*break-inside-avoid[^"]*" data-testid="condiciones-hoja"/, "y no se parten");
});
