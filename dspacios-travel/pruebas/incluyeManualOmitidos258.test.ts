import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { crearClienteFalso, type TablasFalsas } from "./support/fakeSupabase.ts";
import { presentarIncluye, normalizarNombre } from "../lib/tarifario/incluyePorSalida.ts";
import { descripcionParaSalida, descripcionConServicios, seccionesDescripcion, type DescripcionPaqueteRaw } from "../lib/tarifario/descripcionPaquete.ts";
import { adjuntarComposicionIncluidos } from "../lib/tarifario/composicionIncluidos.ts";
import { claveHuellaIncluidos, incluidosParaPayload, validarIncluidosConversion } from "../lib/reservar/incluidosCotizados.ts";
import { sugerirIncluyeCarrito } from "../lib/cotizacion/incluye.ts";
import type { ServicioEfectivo } from "../lib/reservar/serviciosPaquete.ts";

// «Incluye» manual libre que NOMBRA los servicios 50, 112, 132 y 133 (datos de prueba, no de producción). El texto guardado no se toca. En una salida SIN omisiones se
// presenta íntegro; en una salida CON algún servicio omitido el texto libre no se presenta como inclusión cierta (puede nombrar un servicio con otras palabras): se muestran
// solo las inclusiones acreditadas por la composición efectiva.
const S50 = { servicioId: 50, nombre: "Servicio 50" };
const S112 = { servicioId: 112, nombre: "Servicio 112" };
const T132 = { servicioId: 132, nombre: "Traslado 132" };
const T133 = { servicioId: 133, nombre: "Traslado 133" };
const ASIST = { servicioId: 1, nombre: "Asistencia 1" };
const TODOS = [S50, S112, T132, T133];

const INCLUYE_MANUAL = [
  "Alojamiento con desayuno",
  "Servicio 50",
  "• Servicio 112 (incluido)",
  "Traslado 132",
  "traslado 133",
  "Transfer aeropuerto-hotel-aeropuerto",
  "Asistencia médica",
].join("\n");
const lineas = INCLUYE_MANUAL.split("\n");

describe("presentación del «Incluye» por salida", () => {
  test("normalizarNombre ignora tildes, mayúsculas y signos", () => {
    assert.equal(normalizarNombre("  ASISTENCIA Médica: «Plan 1»  "), "asistencia medica plan 1");
  });

  test("salida SIN omisiones: el texto guardado se presenta ÍNTEGRO (incluidas las formas alternativas de nombrar un servicio)", () => {
    const p = presentarIncluye({ lineas, efectivos: [...TODOS, ASIST], omitidos: [] });
    assert.deepEqual(p.lineas, lineas);
    assert.equal(p.aviso, null);
  });

  test("traslado omitido NOMBRADO CON OTRAS PALABRAS («Transfer aeropuerto-hotel-aeropuerto»): no se presenta como inclusión cierta", () => {
    const p = presentarIncluye({ lineas, efectivos: [S50, T132, S112, ASIST], omitidos: [T133] });
    assert.ok(!p.lineas.some((l) => /transfer/i.test(l)), "el texto libre no verificable no se afirma");
    assert.ok(p.noConfirmadas.includes("Transfer aeropuerto-hotel-aeropuerto"));
    assert.match(p.aviso ?? "", /Transfer aeropuerto-hotel-aeropuerto/);
    assert.match(p.aviso ?? "", /otras palabras/);
  });

  test("con omisiones solo se presenta lo ACREDITADO por la composición efectiva (por su nombre de catálogo), no el resto del texto libre", () => {
    const p = presentarIncluye({ lineas, efectivos: [S50, T132, ASIST], omitidos: [S112, T133] });
    assert.deepEqual(p.lineas.slice().sort(), ["Servicio 50", "Traslado 132", "Asistencia 1"].sort());
    assert.ok(!p.lineas.includes("Alojamiento con desayuno") && !p.lineas.includes("Asistencia médica"), "texto libre no verificable: fuera");
    assert.deepEqual(p.retiradas.sort(), ["• Servicio 112 (incluido)", "traslado 133"].sort());
  });

  test("50, 112, 132 y 133 omitidos: solo queda lo efectivo del catálogo (la asistencia permanente), nunca texto libre", () => {
    const p = presentarIncluye({ lineas, efectivos: [ASIST], omitidos: TODOS });
    assert.deepEqual(p.lineas, ["Asistencia 1"]);
    assert.ok(p.aviso);
  });

  test("una lista cuyos fragmentos son exactamente nombres de servicios se conserva solo con los efectivos", () => {
    const p = presentarIncluye({ lineas: ["Traslado 132 y Traslado 133", "Servicio 50, Servicio 112"], efectivos: [T132, S50], omitidos: [T133, S112] });
    assert.deepEqual(p.lineas, ["Traslado 132", "Servicio 50"]);
    assert.equal(p.aviso, null, "todo verificado: nada que avisar");
  });
});

// ── Composición por salida desde la base (cliente falso) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Paquete 70 dinámico con 3 salidas. 50 y 112 tienen vigencia que cubre solo la 1ª salida; 132 y 133 (traslados) no tienen ninguna vigencia → omitidos en todas. La asistencia 1 es
// asistencia SIN vigencias con tarifa base: permanente, efectiva en todas.
const FECHAS = ["2026-12-05", "2027-02-10", "2027-03-15"];
const vig = (servicio_id: number, ini: string, fin: string, precio: number) => ({
  id: servicio_id * 10, servicio_id, nombre: "V", fecha_inicio: ini, fecha_fin: fin, compra_inicio: null, compra_fin: null, prioridad: 1, precio_persona: precio, precio_infante: null, recargo_individual: null,
});
const catalogo = [...TODOS.map((s) => ({ ...s, categoria: "tour_traslado", base: 99999 })), { ...ASIST, categoria: "asistencia", base: 20000 }];
const tablas: TablasFalsas = {
  armado_paquetes: [{ id: 70, tipo: "dinamico" }],
  armado_servicios: catalogo.map((s) => ({ paquete_id: 70, servicio_id: s.servicioId, modo: "persona", incluido: true, servicios_adicionales: { nombre: s.nombre } })),
  servicios_adicionales: catalogo.map((s) => ({ id: s.servicioId, nombre: s.nombre, categoria: s.categoria, precio_persona: s.base, precio_infante: null, recargo_individual: null })),
  servicio_temporadas: [vig(50, "2026-12-01", "2026-12-31", 50000), vig(112, "2026-12-01", "2026-12-31", 87000)],
  servicio_tarifa_pax: [],
  armado_vuelos: [], armado_empaquetados: [],
  salidas_dinamicas: FECHAS.map((f) => ({ paquete_id: 70, fecha_ida: f, activo: true })),
};
const manual = (): DescripcionPaqueteRaw => ({ incluye: INCLUYE_MANUAL, noIncluye: "Gastos personales", tarifasEspeciales: null, condicionesComerciales: null });
const admin = () => crearClienteFalso(tablas, { joins: { armado_servicios: { servicios_adicionales: "servicio_id" } } }) as unknown as Parameters<typeof adjuntarComposicionIncluidos>[0];

describe("composición por salida y presentación en cada fecha (paquete 70)", () => {
  test("con y sin cobertura: la 1ª salida incluye 50 y 112; las otras no; 132 y 133 (sin vigencias) se omiten siempre; la asistencia permanente nunca", async () => {
    const mapa = await adjuntarComposicionIncluidos(admin(), { 70: manual() });
    const c = mapa[70].composicion!;
    assert.equal(mapa[70].composicionNoDisponible, undefined);
    assert.deepEqual(c.omitidosPorFecha[FECHAS[0]].sort((a, b) => a - b), [132, 133]);
    assert.deepEqual(c.omitidosPorFecha[FECHAS[1]].sort((a, b) => a - b), [50, 112, 132, 133]);
    assert.deepEqual(c.omitidosPorFecha[FECHAS[2]].sort((a, b) => a - b), [50, 112, 132, 133]);
  });

  test("el texto guardado NO cambia; cada salida presenta solo lo que acredita su composición efectiva", async () => {
    const mapa = await adjuntarComposicionIncluidos(admin(), { 70: manual() });
    assert.equal(mapa[70].incluye, INCLUYE_MANUAL, "el texto manual sigue intacto en la base/estado");
    const items = (f: string | null) => seccionesDescripcion(descripcionParaSalida(mapa[70], f).descripcion).find((s) => s.titulo === "El programa incluye")?.items ?? [];
    assert.deepEqual(items(FECHAS[0]).slice().sort(), ["Servicio 50", "Servicio 112", "Asistencia 1"].sort(), "cubierta por 50 y 112 + asistencia permanente; 132/133 omitidos y el texto libre no se afirma");
    assert.deepEqual(items(FECHAS[1]), ["Asistencia 1"], "descubierta: solo la asistencia permanente acreditada");
    assert.deepEqual(items(null), ["Asistencia 1"], "sin salida elegida no se promete un servicio que falta en alguna");
  });

  test("una salida SIN omisiones conserva el texto guardado íntegro", async () => {
    const tablasCompletas: TablasFalsas = { ...tablas, servicio_temporadas: [...[S50, S112, T132, T133].map((s) => vig(s.servicioId, "2026-01-01", "2030-12-31", 1000))] };
    const cli = crearClienteFalso(tablasCompletas, { joins: { armado_servicios: { servicios_adicionales: "servicio_id" } } }) as unknown as Parameters<typeof adjuntarComposicionIncluidos>[0];
    const mapa = await adjuntarComposicionIncluidos(cli, { 70: manual() });
    assert.deepEqual(mapa[70].composicion!.omitidosPorFecha, {});
    assert.equal(descripcionParaSalida(mapa[70], FECHAS[0]).descripcion?.incluye, INCLUYE_MANUAL);
  });

  test("la presentación en vivo (búsqueda por fechas) usa la composición de ESA fecha", () => {
    const { descripcion, aviso } = descripcionConServicios(manual(), [S50, ASIST], [S112, T132, T133]);
    assert.ok(!/112|132|133|transfer/i.test(descripcion.incluye ?? ""));
    assert.match(descripcion.incluye ?? "", /Servicio 50/);
    assert.ok(aviso);
  });

  test("si la composición no se puede calcular, el «Incluye» manual NO se presenta (falla cerrado)", async () => {
    const roto = crearClienteFalso({ ...tablas, armado_servicios: undefined as never }) as unknown as Parameters<typeof adjuntarComposicionIncluidos>[0];
    const mapa = await adjuntarComposicionIncluidos(roto, { 70: manual() }, () => {});
    assert.equal(mapa[70].composicionNoDisponible, true);
    assert.equal(descripcionParaSalida(mapa[70], FECHAS[0]).descripcion?.incluye, null);
    assert.equal(mapa[70].noIncluye, "Gastos personales", "lo demás se conserva");
  });
});

// ── Documento y reintento de conversión ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const clave = claveHuellaIncluidos("llave-de-prueba")!;
const efectivo = (s: { servicioId: number; nombre: string }, costoNeto: number): ServicioEfectivo => ({ servicioId: s.servicioId, nombre: s.nombre, categoria: "tour_traslado", incluido: true, costoNeto, proveedorId: 7 });
const ref = "h1";
const item = { ref, paqueteId: 70, pax: 2 };
const convertir = (cotizados: ServicioEfectivo[], actuales: ServicioEfectivo[]) => validarIncluidosConversion({
  hotelNombre: "Hotel", item, fechasCotizadas: { ida: FECHAS[0], regreso: "2026-12-08" },
  recalculo: { totalPax: 2, fechaIda: FECHAS[0], fechaRegreso: "2026-12-08", incluidos: actuales },
  guardados: incluidosParaPayload(cotizados, { ref, paqueteId: 70 }, clave), clave,
});

describe("documento y conversión con servicios omitidos", () => {
  test("el «Incluye» del documento sale de los servicios efectivos de la cotización: lo omitido no figura", () => {
    const efectivos = [efectivo(S50, 100000), efectivo(S112, 174000)];
    const payload = { items: [{ ref, hotelNombre: "Hotel", categoria: "Estándar", regimen: "PAE" }], serviciosIncluidos: incluidosParaPayload(efectivos, { ref, paqueteId: 70 }, clave), tours: [] };
    const texto = sugerirIncluyeCarrito(payload);
    assert.match(texto, /Servicio 50/);
    assert.match(texto, /Servicio 112/);
    assert.ok(!/132|133/.test(texto), "los traslados omitidos no aparecen");
    const sinCobertura = sugerirIncluyeCarrito({ ...payload, serviciosIncluidos: [] });
    assert.ok(!/Servicio (50|112)|Traslado/.test(sinCobertura), "salida descubierta: ningún servicio receptivo en el documento");
  });

  test("reintento de conversión: con la misma composición pasa; si la composición cambió (se omite uno cotizado, o aparece uno nuevo) se rechaza y no se sustituye", () => {
    const cot = [efectivo(S50, 100000), efectivo(S112, 174000)];
    assert.equal(convertir(cot, cot).ok, true);
    assert.equal(convertir(cot, cot).ok, true, "el reintento idéntico no cambia nada");
    const seOmite = convertir(cot, [efectivo(S50, 100000)]);
    assert.equal(seOmite.ok, false);
    if (!seOmite.ok) assert.match(seOmite.error, /servicios incluidos del paquete cambiaron/);
    const aparece = convertir([efectivo(S50, 100000)], cot);
    assert.equal(aparece.ok, false);
    if (!aparece.ok) assert.match(aparece.error, /servicios incluidos del paquete cambiaron/);
  });

  test("misma composición pero otro costo neto (la tarifa cambió): se rechaza", () => {
    const r = convertir([efectivo(S50, 100000)], [efectivo(S50, 120000)]);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /cambió desde la cotización/);
  });
});
