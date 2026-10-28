// Se ejecuta con npm run test:react (loader del arnés).
// #75 — Documentos de la cotización HIJA elegida y del contrato (componentes REALES renderizados a HTML):
//   · NETO: la tarifa por persona nunca es una cifra que multiplicada no da el total (caso del dueño: 2 adultos, $1.330.455,25);
//   · vuelo manual: «Pasajeros: 2» sin la marca interna ni la frase larga; aviso UNA vez; precio del vuelo una sola vez (en el total);
//   · Incluye / No incluye y descripción editada que la hija hereda de la plantilla de la opción (crear_hija copia `plantilla_hija.detalle` tal cual);
//   · cotización manual: la tarifa guardada redondeada no se muestra si no cuadra con el valor.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";

const { renderToStaticMarkup } = await import("react-dom/server");
const { ContratoDocumento } = await import("../components/contrato/ContratoDocumento.tsx");
const { CotizacionManualDocumento } = await import("../components/contrato/CotizacionManualDocumento.tsx");
const { presentacionDesdeEdicion, errorEdicion } = await import("../components/cotizacion/PresentacionComparativaEditor.tsx");
const { aplicarDescripciones } = await import("../lib/cotizacion/comparativa.ts");
const { descripcionCotizacionManual, tramosVueloManual, validarServicioManual } = await import("../lib/cart/servicioManual.ts");

const plano = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const venta = {
  numero_contrato: "", cliente: "Agencia Aliada", cliente_documento: "900", cliente_direccion: null, cliente_telefono: null, asesor: "Asesora",
  asesor_firma_nombre: "Asesora", asesor_firma_cargo: "Asesor/a", asesor_firma_cc: null, asesor_firma_tel: null, estado: "pendiente",
  fecha_emision: "2030-01-10", fecha_salida: "2030-03-01", pax: 2, plan_nombre: null, tours_traslados: null, asistencia_medica: null, moneda: "COP", tenant: "mayorista",
};
function doc(extra: Record<string, unknown>) {
  const props = { venta, pasajeros: [], hoteles: [], vuelos: [], items: [], totalPagado: 0, esCotizacion: true, codigo: "COT-1", agencia: null, condiciones: null, ...extra };
  return plano(renderToStaticMarkup(createElement(ContratoDocumento, props as unknown as Parameters<typeof ContratoDocumento>[0])));
}
const hab = (id: number, adultos: number, tarifa: number, descripcion = "Hotel Almirante — CARTAGENA · 1 hab Doble (2 pax) · Estándar / PAM") =>
  ({ id, numero_contrato: "", descripcion, adultos, ninos: 0, tarifa_adulto: tarifa, tarifa_nino: 0, orden: id, modo_precio: null, valor_total: null });

describe("hija NETO: tarifa por persona que cuadra con el total", () => {
  test("2 adultos, total exigible $1.330.455,25: reparto 1 × 665.227,63 + 1 × 665.227,62 (nunca 665.227,63 sola, ni ≈)", () => {
    const t = doc({ items: [hab(1, 2, 700_000)], netoTotalExigible: 1_330_455.25 });
    assert.match(t, /Total del contrato \$ 1\.330\.455,25/);
    assert.match(t, /1 × \$ 665\.227,63 1 × \$ 665\.227,62/);
    assert.doesNotMatch(t, /≈/);
    assert.doesNotMatch(t, /700\.000|1\.400\.000/, "nada del PVP");
  });
  test("adultos + menor + vuelo manual: cada parte cuadra, el vuelo no se reparte en el hotel y se suma una sola vez", () => {
    const m = validarServicioManual({ clase: "vuelo", nombre: "Avianca", pax: 2, precio: 900_000, moneda: "COP", impuestoNoComisionable: 0, tramo: "ida_regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", hotelRef: "item-0", horaIda: "08:15", horaRegreso: null }, "COP");
    assert.ok(m.ok);
    if (!m.ok) return;
    const vuelos = tramosVueloManual(m.valor, true).map((v, i) => ({ id: i + 1, numero_contrato: "", ...v }));
    const items = [
      hab(1, 2, 500_000),
      { id: 2, numero_contrato: "", descripcion: "Hotel Almirante — CARTAGENA · Niño 1 · Estándar / PAM", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 250_000, orden: 2, modo_precio: null, valor_total: null },
      { id: 3, numero_contrato: "", descripcion: descripcionCotizacionManual(m.valor), adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, orden: 3, modo_precio: "total", valor_total: 900_000 },
    ];
    const t = doc({ items, vuelos, netoTotalExigible: 1_850_000.35 });
    assert.match(t, /Total del contrato \$ 1\.850\.000,35/);
    assert.doesNotMatch(t, /Vuelo manual|pasajeros en este vuelo/, "sin la marca interna ni la frase larga");
    assert.equal(t.split("Pasajeros: 2").length - 1, 2, "una vez en cada tramo (dato del tramo)");
    assert.equal(t.split("sujeto a confirmación de disponibilidad y tarifa").length - 1, 1, "el aviso UNA sola vez");
    assert.doesNotMatch(t, /Vuelo · Avianca/, "la línea del vuelo no se pinta en la tabla");
    assert.match(t, /incluye el valor de los vuelos/);
  });
});

describe("hija heredada de la opción: descripción editada e Incluye / No incluye", () => {
  test("el texto editado y el Incluye de la plantilla aparecen en el documento hijo; sin Incluye no hay sección", () => {
    const original = hab(1, 2, 300_000);
    const ed = aplicarDescripciones([original], [{ indice: 0, original: original.descripcion, texto: "Plan Caribe · Hotel Almirante, habitación doble" }]);
    assert.ok(ed.ok);
    if (!ed.ok) return;
    // crear_hija (migraciones 211/251): v_det := plantilla_hija->'detalle'; la página pasa detalle.items / incluye / noIncluye al documento.
    const detalle = { items: ed.items, incluye: "Alojamiento 3 noches\nDesayunos", noIncluye: "Propinas" };
    const t = doc({ items: detalle.items, incluye: detalle.incluye, noIncluye: detalle.noIncluye });
    assert.match(t, /Plan Caribe · Hotel Almirante, habitación doble/);
    assert.doesNotMatch(t, /1 hab Doble \(2 pax\)/);
    assert.match(t, /Incluye \/ No incluye Incluye Alojamiento 3 noches Desayunos No incluye Propinas/);
    assert.match(t, /Total del contrato \$ 600\.000/, "importes intactos");
    assert.doesNotMatch(doc({ items: [original] }), /Incluye \/ No incluye/);
  });
});

describe("cotización manual: tarifa guardada redondeada", () => {
  const render = (items: unknown[]) => plano(renderToStaticMarkup(createElement(CotizacionManualDocumento, {
    codigo: "COT-2", venta: { cliente: "Ana", destino: "CARTAGENA", fecha_salida: "2030-03-01", fecha_regreso: "2030-03-04", pax: 2, moneda: "COP" }, items, cliente: {}, incluye: null, noIncluye: null,
    vigenciaHasta: null, fechaEmision: "2030-01-10", agencia: null,
  } as unknown as Parameters<typeof CotizacionManualDocumento>[0])));
  test("1.330.455 entre 2: no se imprime 665.228 (× 2 = 1.330.456) sino la tarifa que cuadra, 665.227,50", () => {
    const t = render([{ descripcion: "PAQUETE", cantidad: 2, tarifa_unit: 665_228, valor: 1_330_455 }]);
    assert.doesNotMatch(t, /665\.228/);
    assert.match(t, /\$ 665\.227,50/);
  });
  test("1.000.000 entre 3: reparto honesto; si la tarifa guardada cuadra, se ve tal cual", () => {
    assert.match(render([{ descripcion: "PAQUETE", cantidad: 3, tarifa_unit: 333_333, valor: 1_000_000 }]), /1 × \$ 333\.333,34 2 × \$ 333\.333,33/);
    assert.match(render([{ descripcion: "PAQUETE", cantidad: 2, tarifa_unit: 500_000, valor: 1_000_000 }]), /\$ 500\.000/);
  });
});

describe("editor de presentación: lo que se ve es lo que se envía", () => {
  const opciones = [{ clave: "A/doble", titulo: "Opción A · Hotel A", lineas: [{ indice: 0, descripcion: "Hotel A · 1 hab Doble" }], incluyeSugerido: "Alojamiento en Hotel A", noIncluyeSugerido: "" }];
  test("sin cambios viaja la propuesta y ninguna descripción; con cambios, solo lo editado", () => {
    assert.deepEqual(presentacionDesdeEdicion(opciones, {}), { "A/doble": { incluye: "Alojamiento en Hotel A", noIncluye: "", descripciones: [] } });
    assert.deepEqual(presentacionDesdeEdicion(opciones, { "A/doble": { noIncluye: "Propinas", textos: { 0: "Plan A" } } }),
      { "A/doble": { incluye: "Alojamiento en Hotel A", noIncluye: "Propinas", descripciones: [{ indice: 0, original: "Hotel A · 1 hab Doble", texto: "Plan A" }] } });
  });
  test("descripción vacía o demasiado larga: se avisa antes de enviar", () => {
    assert.match(errorEdicion(opciones, { "A/doble": { textos: { 0: " " } } }) ?? "", /entre 3 y 200/);
    assert.equal(errorEdicion(opciones, {}), null);
  });
});
