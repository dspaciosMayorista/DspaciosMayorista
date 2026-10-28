// #75 — Lógica PURA de la presentación de la comparativa y de su hija: reparto honesto de la tarifa por persona (caso del dueño: $0,01),
// formato con centavos, Incluye / No incluye y descripción editables (solo texto), vuelos agrupados por tiquete y nota visible del vuelo manual.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatoExacto, repartoPorPersona, tarifaCuadra, textoReparto } from "../lib/contrato/repartoTarifa.ts";
import { valoresNetosDocumento } from "../lib/contrato/valoresNetosDocumento.ts";
import {
  aplicarDescripciones, construirComparativaManual, leerPresentacionComparativa, lineasEditables, nombrePaqueteItem, tarifaPersonaCarrito,
  tarifaVisibleOpcion, tiquetesDeOpcion, type EntradaComparativaManual,
} from "../lib/cotizacion/comparativa.ts";
import { sugerirIncluyeCarrito } from "../lib/cotizacion/incluye.ts";
import { notaVueloManual, tramosVueloManual, validarServicioManual } from "../lib/cart/servicioManual.ts";

const cent = (n: number) => Math.round(n * 100);

describe("reparto de la tarifa por persona (error de $0,01 del dueño)", () => {
  test("2 adultos, ítem NETO $1.330.455,25: no hay tarifa exacta; el reparto 665.227,63 + 665.227,62 suma EXACTAMENTE el total", () => {
    // Lo que se mostraba: 665.227,63 (redondeo de 665.227,625) → 2 × 665.227,63 = 1.330.455,26 ≠ 1.330.455,25.
    assert.equal(tarifaCuadra(1_330_455.25, 2, 665_227.63), false);
    const r = repartoPorPersona(1_330_455.25, 2);
    assert.ok(r && !r.exacto);
    if (!r || r.exacto) return;
    assert.deepEqual(r.partes, [{ tarifa: 665_227.63, cantidad: 1 }, { tarifa: 665_227.62, cantidad: 1 }]);
    assert.equal(r.partes.reduce((s, p) => s + cent(p.tarifa) * p.cantidad, 0), cent(1_330_455.25));
    assert.equal(textoReparto(r, (n) => formatoExacto(n, "COP")).replace(/\s/g, " "), "1 × $ 665.227,63 + 1 × $ 665.227,62");
  });
  test("división exacta: una sola tarifa; 3 personas con 1 centavo de resto: 1 paga un centavo más", () => {
    assert.deepEqual(repartoPorPersona(1_330_454, 2), { exacto: true, tarifa: 665_227 });
    assert.deepEqual(repartoPorPersona(100.02, 3), { exacto: true, tarifa: 33.34 });
    const r = repartoPorPersona(100.03, 3);
    assert.ok(r && !r.exacto);
    if (r && !r.exacto) assert.deepEqual(r.partes, [{ tarifa: 33.35, cantidad: 1 }, { tarifa: 33.34, cantidad: 2 }]);
    assert.equal(repartoPorPersona(10, 0), null);
    assert.equal(repartoPorPersona(Number.NaN, 2), null);
  });
  test("formato con centavos: 1.330.455,25 se ve con sus centavos; un entero, como siempre (formatMoneda lo redondeaba a 1.330.455)", () => {
    assert.match(formatoExacto(1_330_455.25, "COP"), /1\.330\.455,25/);
    assert.match(formatoExacto(665_227.6, "COP"), /665\.227,60/);
    assert.doesNotMatch(formatoExacto(1_330_455, "COP"), /,/);
    assert.equal(formatoExacto(1234.5, "USD"), "USD $1,234.50");
  });
  test("documento NETO del carrito: la parte de los adultos es EXACTA y de ella sale el reparto (no del promedio redondeado)", () => {
    const it = { id: 1, adultos: 2, ninos: 0, tarifa_adulto: 700_000, tarifa_nino: 0, modo_precio: "por_persona", valor_total: null };
    const v = valoresNetosDocumento([it], 1_330_455.25)!.get(1)!;
    assert.equal(v.adultoTotal, 1_330_455.25);
    assert.equal(v.adultoAproximado, true);
    assert.equal(cent(v.tarifaAdulto * 2), cent(1_330_455.25), "el promedio sin redondear sí cuadra; el problema era mostrarlo redondeado");
  });
  test("NETO con adultos, menores y vuelo incluido: cada parte reparte su NETO y el documento suma exactamente el exigible", () => {
    const items = [
      { id: 1, adultos: 2, ninos: 0, tarifa_adulto: 500_000, tarifa_nino: 0, modo_precio: null },
      { id: 2, adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 250_000, modo_precio: null },
      { id: 3, adultos: 0, ninos: 0, tarifa_adulto: 0, tarifa_nino: 0, modo_precio: "total", valor_total: 900_000 }, // vuelo manual (línea oculta)
    ];
    const exigible = 1_850_000.35;
    const v = valoresNetosDocumento(items as never, exigible)!;
    const suma = [...v.values()].reduce((s, x) => s + cent(x.total), 0);
    assert.equal(suma, cent(exigible));
    for (const [id, cantidad, campo] of [[1, 2, "adultoTotal"], [2, 1, "ninoTotal"]] as const) {
      const parte = v.get(id)![campo];
      const r = repartoPorPersona(parte, cantidad)!;
      const reconstruido = r.exacto ? cent(r.tarifa) * cantidad : r.partes.reduce((s, p) => s + cent(p.tarifa) * p.cantidad, 0);
      assert.equal(reconstruido, cent(parte), `línea ${id}: el reparto mostrado suma su parte NETO`);
    }
  });
});

describe("tarifa visible de una opción", () => {
  test("manual PVP: 1.330.455 entre 2 adultos: la tarifa guardada (665.228, redondeada) no cuadra; la que cuadra es 665.227,50", () => {
    const resumen = { ninos: 0, items: [{ descripcion: "PAQUETE", cantidad: 2, tarifa_unit: 665_228, valor: 1_330_455, orden: 0 }] };
    const t = tarifaVisibleOpcion(resumen, { payload: { servicios: [] }, detalle: {} }, 1_330_455)!;
    assert.equal(t.etiqueta, "Tarifa por persona");
    assert.equal(tarifaCuadra(1_330_455, 2, 665_228), false);
    assert.deepEqual(t.reparto, { exacto: true, tarifa: 665_227.5 });
    const impar = tarifaVisibleOpcion({ ninos: 0, items: [{ cantidad: 3, valor: 1_000_000, orden: 0 }] }, {}, 1_000_000)!;
    assert.equal(impar.reparto.exacto, false, "1.000.000 entre 3: reparto honesto, no 333.333,33 × 3");
  });
  test("manual con niño: «Tarifa por adulto» sobre la línea del paquete; NETO (total_exigible) → null", () => {
    const resumen = { ninos: 1, items: [{ descripcion: "X", cantidad: 2, tarifa_unit: 500_000, valor: 1_000_000, orden: 0 }, { descripcion: "Tarifa por niño", cantidad: 1, tarifa_unit: 150_000, valor: 150_000, orden: 1 }] };
    assert.deepEqual(tarifaVisibleOpcion(resumen, {}, 1_150_000)?.reparto, { exacto: true, tarifa: 500_000 });
    assert.equal(tarifaVisibleOpcion(resumen, {}, 1_150_000)?.etiqueta, "Tarifa por adulto");
    assert.equal(tarifaVisibleOpcion({ ...resumen, total_exigible: 1_000_000 }, {}, 1_150_000), null);
  });
  test("carrito: la tarifa del motor por adulto (no hotel/pax redondeado); con vuelo en el total se rotula como del alojamiento; mixta → null", () => {
    const pl = (items: unknown[]) => ({ payload: { items: [{}] }, detalle: { items } });
    const hab = { descripcion: "Hotel · 1 hab Doble (2 pax)", adultos: 2, ninos: 0, tarifa_adulto: 295_000, tarifa_nino: 0 };
    const menor = { descripcion: "Hotel · Niño 1", adultos: 0, ninos: 1, tarifa_adulto: 0, tarifa_nino: 120_000 };
    const t = tarifaVisibleOpcion({}, pl([hab, menor]), 590_000 + 120_000 + 900_000)!;
    assert.deepEqual(t.reparto, { exacto: true, tarifa: 295_000 });
    assert.equal(t.etiqueta, "Tarifa por adulto");
    assert.equal(t.soloHotel, true, "el total incluye el vuelo: la tarifa es del alojamiento, no de toda la opción");
    assert.equal(tarifaVisibleOpcion({}, pl([hab]), 590_000)!.soloHotel, false);
    assert.equal(tarifaVisibleOpcion({}, pl([hab, { ...hab, tarifa_adulto: 400_000, adultos: 1 }]), 990_000), null);
    // La columna que se guarda para opciones nuevas: la del motor (antes Math.round(hotel con menores / pax total)).
    assert.equal(tarifaPersonaCarrito([hab, menor]), 295_000);
    assert.equal(tarifaPersonaCarrito([{ descripcion: "Servicio · Tour", adultos: 1, tarifa_adulto: 85_000 }]), null, "un tour no es una tarifa por persona");
  });
});

describe("presentación editable (solo texto)", () => {
  test("validación de la entrada: forma, claves, largo y caracteres de control", () => {
    assert.deepEqual(leerPresentacionComparativa(undefined), { ok: true, datos: null });
    for (const malo of [[], "x", { "Z/doble": {} }, { "A/doble": { incluye: 5 } }, { "A/doble": { incluye: "a\u0007b" } }, { "A/doble": { incluye: "x".repeat(3001) } },
      { "A/doble": { descripciones: [{ indice: 0, original: "a", texto: "ab" }] } }, { "A/doble": { descripciones: [{ indice: -1, original: "a", texto: "abc" }] } }]) {
      assert.equal(leerPresentacionComparativa(malo).ok, false, JSON.stringify(malo));
    }
    const ok = leerPresentacionComparativa({ "A/doble": { incluye: "  Hotel\r\nDesayuno  ", descripciones: [{ indice: 0, original: "Mismo", texto: "Mismo" }, { indice: 1, original: "Viejo", texto: "  Nuevo   texto " }] } });
    assert.ok(ok.ok && ok.datos);
    if (ok.ok && ok.datos) {
      assert.equal(ok.datos["A/doble"].incluye, "Hotel\nDesayuno");
      assert.deepEqual(ok.datos["A/doble"].descripciones, [{ indice: 1, original: "Viejo", texto: "Nuevo texto" }], "una línea sin cambio no viaja");
    }
  });
  test("solo se editan líneas editables y que siguen siendo las cotizadas; nunca importes", () => {
    const items = [
      { descripcion: "Hotel — CTG · 1 hab Doble (2 pax)", adultos: 2, tarifa_adulto: 1 },
      { descripcion: "Servicio · City tour", adultos: 1, tarifa_adulto: 2 },
      { descripcion: "Vuelo · Avianca BOG → CTG (ida y regreso) · 2030-01-01 → 2030-01-04 · 2 pax — sujeto a confirmación de disponibilidad y tarifa" },
      { descripcion: "Tarifa por niño", cantidad: 1 },
    ];
    assert.deepEqual(lineasEditables(items).map((l) => l.indice), [0]);
    const r = aplicarDescripciones(items, [{ indice: 0, original: items[0].descripcion, texto: "Plan Caribe" }]);
    assert.ok(r.ok);
    if (r.ok) { assert.equal(r.items[0].descripcion, "Plan Caribe"); assert.equal(r.items[0].tarifa_adulto, 1); assert.equal(items[0].descripcion, "Hotel — CTG · 1 hab Doble (2 pax)", "no muta la entrada"); }
    for (const i of [1, 2, 3]) assert.equal(aplicarDescripciones(items, [{ indice: i, original: items[i].descripcion, texto: "Otro" }]).ok, false);
    assert.equal(aplicarDescripciones(items, [{ indice: 0, original: "texto anterior", texto: "Otro" }]).ok, false);
  });
  test("propuesta de Incluye del carrito: solo lo que el snapshot cotizó", () => {
    const t = sugerirIncluyeCarrito({
      items: [{ hotelNombre: "Hotel Almirante", categoria: "Estándar", regimen: "PAM" }],
      serviciosIncluidos: [{ nombre: "Asistencia Assist Card", categoria: "asistencia" }],
      tours: [{ nombre: "City tour", categoria: "tour_traslado" }],
      manuales: [{ clase: "vuelo", nombre: "Avianca" }, { clase: "otro", nombre: "Traslado privado" }],
    });
    assert.deepEqual(t.split("\n"), ["Alojamiento en Hotel Almirante (Estándar, plan PAM)", "Asistencia médica (Asistencia Assist Card)", "City tour", "Tiquetes aéreos (Avianca)", "Traslado privado"]);
    assert.equal(sugerirIncluyeCarrito({}), "");
  });
});

describe("comparativa MANUAL: presentación por opción", () => {
  const entrada = (extra: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual => ({
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1", telefono: "3001112233", email: "", nacimiento: "" },
    destino: "Cartagena", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", pax: 2, moneda: "COP", ninos: 1, tarifaNino: 150_000, recobro: 0, recobroAliado: 0,
    tipoAsesor: "interno", asesorInterno: "Asesora", agenciaNombre: "", freelanceNombre: "", plazo: "", vigenciaHasta: "", observaciones: "", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "", nombre: "Avianca", proveedor: "", costoNeto: 500_000, modo: "ta", pctMarkup: 0, ta: 30_455 },
      { tipo: "hotel", plataforma: "", nombre: "Hotel A", proveedor: "", costoNeto: 800_000, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "A" },
      { tipo: "hotel", plataforma: "", nombre: "Hotel B", proveedor: "", costoNeto: 900_000, modo: "ta", pctMarkup: 0, ta: 0, opcionRef: "B" },
    ],
    ...extra,
  } as unknown as EntradaComparativaManual);
  const original = nombrePaqueteItem("Cartagena", "2030-03-01", "2030-03-04");

  test("sin edición: cada opción con SU hotel en el Incluye (no los de las demás)", () => {
    const r = construirComparativaManual(entrada(), { hoy: "2030-01-01" });
    assert.ok(r.ok);
    if (!r.ok) return;
    const [a, b] = r.datos.opciones;
    assert.match(String(a.resumen_publico.incluye), /Hotel A/);
    assert.doesNotMatch(String(a.resumen_publico.incluye), /Hotel B/);
    assert.match(String(b.resumen_publico.incluye), /Hotel B/);
  });
  test("con edición: descripción e Incluye/No incluye por opción en resumen, detalle y payload de la hija; importes iguales", () => {
    const base = construirComparativaManual(entrada(), { hoy: "2030-01-01" });
    const r = construirComparativaManual(entrada({ presentacion: {
      "A/unica": { incluye: "Tiquetes\nHotel A", noIncluye: "Propinas", descripciones: [{ indice: 0, original, texto: "Paquete Cartagena con vuelo" }] },
    } }), { hoy: "2030-01-01" });
    assert.ok(r.ok && base.ok);
    if (!r.ok || !base.ok) return;
    const a = r.datos.opciones[0];
    const det = a.plantilla_hija.detalle as { items: { descripcion: string; cantidad: number; tarifa_unit: number; valor: number }[]; incluye: string; noIncluye: string };
    assert.equal(det.items[0].descripcion, "Paquete Cartagena con vuelo");
    assert.deepEqual(det.items.map((i) => [i.cantidad, i.tarifa_unit, i.valor]), (base.datos.opciones[0].plantilla_hija.detalle as typeof det).items.map((i) => [i.cantidad, i.tarifa_unit, i.valor]));
    assert.equal(det.items[1].descripcion, "Tarifa por niño", "la línea de menores no cambia");
    assert.equal((a.resumen_publico.items as { descripcion: string }[])[0].descripcion, "Paquete Cartagena con vuelo");
    assert.equal(det.incluye, "Tiquetes\nHotel A");
    assert.equal((a.plantilla_hija.payload as { incluye: string }).incluye, "Tiquetes\nHotel A");
    assert.equal(a.total, base.datos.opciones[0].total);
    assert.deepEqual(r.datos.opciones[1].resumen_publico, base.datos.opciones[1].resumen_publico, "la opción B sin edición queda igual");
    assert.ok(!("presentacion" in (a.plantilla_hija.payload as object)), "la hija no arrastra la presentación de la madre");
  });
  test("una descripción desactualizada (cambiaron destino/fechas) o una opción inexistente se rechaza", () => {
    assert.equal(construirComparativaManual(entrada({ presentacion: { "A/unica": { descripciones: [{ indice: 0, original: "PAQUETE VIEJO", texto: "Nuevo" }] } } }), { hoy: "2030-01-01" }).ok, false);
    assert.equal(construirComparativaManual(entrada({ presentacion: { "C/unica": { incluye: "x" } } }), { hoy: "2030-01-01" }).ok, false);
  });
});

describe("vuelos: un bloque por tiquete y nota visible sin la marca interna", () => {
  const vuelo = (extra: Record<string, unknown> = {}) => ({ clase: "vuelo", nombre: "Avianca", pax: 2, precio: 900_000, moneda: "COP", impuestoNoComisionable: 0, tramo: "ida_regreso", origen: "BOG", destino: "CTG", fechaIda: "2030-03-01", fechaRegreso: "2030-03-04", hotelRef: "item-0", horaIda: "08:15", horaRegreso: null, ...extra });

  test("la nota guardada conserva «Vuelo manual»; lo visible es «Pasajeros: N» y el aviso", () => {
    const m = validarServicioManual(vuelo(), "COP");
    assert.ok(m.ok);
    if (!m.ok) return;
    const filas = tramosVueloManual(m.valor, true);
    assert.match(String(filas[0].servicios), /^Vuelo manual · pasajeros en este vuelo: 2/, "el dato interno no cambia");
    assert.deepEqual(notaVueloManual(filas[0].servicios), { pax: 2, aviso: "sujeto a confirmación de disponibilidad y tarifa" });
    assert.equal(notaVueloManual("Equipaje de mano"), null);
  });
  test("ida y regreso del MISMO vuelo forman un tiquete (aviso una vez); dos vuelos de ida distintos, dos tiquetes", () => {
    const uno = tiquetesDeOpcion({ payload: { manuales: [vuelo()] } }, [], "COP");
    assert.equal(uno.length, 1);
    assert.deepEqual(uno[0].tramos.map((t) => [t.direccion, t.origen, t.destino, t.fecha, t.hora]), [
      ["ida", "Bogotá (BOG)", "Cartagena (CTG)", "2030-03-01", "08:15"], ["regreso", "Cartagena (CTG)", "Bogotá (BOG)", "2030-03-04", null]]);
    assert.equal(uno[0].pax, 2);
    assert.equal(uno[0].aviso, "sujeto a confirmación de disponibilidad y tarifa");
    const dos = tiquetesDeOpcion({ payload: { manuales: [vuelo({ tramo: "ida", fechaRegreso: null, pax: 1 }), vuelo({ tramo: "ida", fechaRegreso: null, nombre: "Latam", pax: 1 })] } }, [], "COP");
    assert.deepEqual(dos.map((t) => t.tramos.length), [1, 1]);
  });
  test("sin snapshot de vuelos: se usan las filas públicas y solo se une una ida con su regreso inverso de la misma nota", () => {
    const nota = "Vuelo manual · pasajeros en este vuelo: 2 · sujeto a confirmación de disponibilidad y tarifa";
    const filas = [
      { tramo: "ida", origen: "Bogotá", destino: "Cartagena", fecha: "2030-03-01", hora: null, nota },
      { tramo: "regreso", origen: "Cartagena", destino: "Bogotá", fecha: "2030-03-04", hora: null, nota },
      { tramo: "ida", origen: "Bogotá", destino: "Santa Marta", fecha: "2030-03-01", hora: null, nota },
    ];
    assert.deepEqual(tiquetesDeOpcion(null, filas, null).map((t) => t.tramos.length), [2, 1]);
  });
});
