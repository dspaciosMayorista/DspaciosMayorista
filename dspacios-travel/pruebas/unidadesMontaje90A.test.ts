import test from "node:test";
import assert from "node:assert/strict";
import {
  estadoConversion, filasUnidades, monedaDeComponente, publicacionDeVinculosGuardados, resolverPublicacionMontaje, resumenUnidades, ROL_NETA_BLOQUEO, ROL_REVENTA_BLOQUEO,
  type EntradaPublicacion, type VinculosGuardados,
} from "../lib/paquetes/unidadesMontaje.ts";
import { readFileSync } from "node:fs";

test("Bloqueo sin moneda acreditada NO se presenta como COP", () => {
  assert.deepEqual(monedaDeComponente("bloqueo", null), { moneda: null, acreditada: false });
  assert.deepEqual(monedaDeComponente("bloqueo", ""), { moneda: null, acreditada: false });
  assert.deepEqual(monedaDeComponente("bloqueo", "USD"), { moneda: "USD", acreditada: true });
});

test("hotel, servicio y Empaquetado sin dato se leen como COP (default de sus migraciones)", () => {
  for (const t of ["hotel", "servicio", "empaquetado"] as const) {
    assert.deepEqual(monedaDeComponente(t, undefined), { moneda: "COP", acreditada: true });
  }
});

test("conversión: coincide / requiere TRM / sin acreditar; nunca se supone tasa", () => {
  assert.equal(estadoConversion("COP", "COP"), "coincide");
  assert.equal(estadoConversion("USD", "USD"), "coincide");
  assert.equal(estadoConversion("COP", "USD"), "requiere_trm");
  assert.equal(estadoConversion("USD", "COP"), "requiere_trm");
  assert.equal(estadoConversion(null, "COP"), "sin_acreditar");
});

test("caso del dueño: paquete USD con hotel USD + tiquete COP", () => {
  const filas = filasUnidades(
    [
      { tipo: "hotel", nombre: "Hotel X", moneda: "USD" },
      { tipo: "bloqueo", nombre: "L93FYZ", moneda: "COP", importes: [
        { rol: ROL_NETA_BLOQUEO, valor: 500000 }, { rol: ROL_REVENTA_BLOQUEO, valor: 650000 },
      ] },
    ],
    "USD"
  );
  assert.deepEqual(filas.map((f) => f.conversion), ["coincide", "requiere_trm"]);
  assert.deepEqual(resumenUnidades(filas), { coinciden: 1, requierenTrm: 1, sinAcreditar: 0, sinPublicacion: 0 });
  // Los importes conservan su unidad de origen: no se convirtieron.
  assert.deepEqual(filas[1].importes.map((i) => i.valor), [500000, 650000]);
});

test("importes vacíos o no numéricos se omiten", () => {
  const [f] = filasUnidades([{ tipo: "bloqueo", nombre: "B", moneda: "COP", importes: [
    { rol: "a", valor: null }, { rol: "b", valor: undefined }, { rol: "c", valor: 10 },
  ] }], "COP");
  assert.deepEqual(f.importes, [{ rol: "c", valor: 10 }]);
});

// ═══ Moneda de publicación de la SELECCIÓN (espejo de la regla vigente de generarTarifario) ═══════════════════════════════════
const base: EntradaPublicacion = { modo63: false, hoteles: [], servicios: [], bloqueos: [], empaquetados: [] };
const publicable = (m: string) => ({ estado: "publicable", moneda: m });

test("hotel COP seleccionado con hotel USD disponible: la moneda sale de la selección (COP)", () => {
  // En page.tsx solo entran los hoteles ELEGIDOS; el hotel USD que está disponible pero sin elegir no cuenta.
  assert.deepEqual(resolverPublicacionMontaje({ ...base, hoteles: ["COP"] }), publicable("COP"));
});

test("paquete solo de servicios: sin hoteles, la moneda es la de los servicios (USD) y mezclar se rechaza", () => {
  assert.deepEqual(resolverPublicacionMontaje({ ...base, servicios: ["USD", "USD"] }), publicable("USD"));
  assert.deepEqual(resolverPublicacionMontaje({ ...base, servicios: [] }), publicable("COP"));
  const r = resolverPublicacionMontaje({ ...base, servicios: ["USD", "COP"] });
  assert.equal(r.estado, "rechazado");
  assert.match((r as { motivo: string }).motivo, /servicios elegidos tienen monedas distintas/);
});

test("hotel USD con servicio COP se rechaza (la moneda la fija el hotel)", () => {
  const r = resolverPublicacionMontaje({ ...base, hoteles: ["USD"], servicios: ["COP"] });
  assert.equal(r.estado, "rechazado");
  assert.match((r as { motivo: string }).motivo, /por el hotel/);
});

test("hoteles elegidos en monedas distintas se rechazan fuera del modo 63", () => {
  assert.equal(resolverPublicacionMontaje({ ...base, hoteles: ["COP", "USD"] }).estado, "rechazado");
  assert.deepEqual(resolverPublicacionMontaje({ ...base, modo63: true, hoteles: ["COP", "USD"], servicios: ["USD"] }), publicable("COP"));
});

test("selección incompatible que el generador rechaza: Bloqueo COP o sin acreditar contra hotel USD, y Empaquetado en otra moneda", () => {
  const conCop = resolverPublicacionMontaje({ ...base, hoteles: ["USD"], bloqueos: [{ etiqueta: "RAAA", moneda: "COP" }] });
  assert.equal(conCop.estado, "rechazado");
  assert.match((conCop as { motivo: string }).motivo, /RAAA/);
  const sinAcreditar = resolverPublicacionMontaje({ ...base, hoteles: ["USD"], bloqueos: [{ etiqueta: "RBBB", moneda: null }] });
  assert.equal(sinAcreditar.estado, "rechazado");
  // Sin acreditar contra paquete COP sí se acepta (se leyó siempre como COP).
  assert.deepEqual(resolverPublicacionMontaje({ ...base, hoteles: ["COP"], bloqueos: [{ etiqueta: "RBBB", moneda: null }] }), publicable("COP"));
  const emp = resolverPublicacionMontaje({ ...base, hoteles: ["COP"], empaquetados: [{ etiqueta: "BOG-MIA", moneda: "USD" }] });
  assert.equal(emp.estado, "rechazado");
  assert.match((emp as { motivo: string }).motivo, /Empaquetados BOG-MIA/);
});

test("modo 63: siempre COP, el Bloqueo no se compara pero un Empaquetado USD sí se rechaza (igual que el generador)", () => {
  assert.deepEqual(resolverPublicacionMontaje({ ...base, modo63: true, hoteles: ["USD"], bloqueos: [{ etiqueta: "R", moneda: "USD" }] }), publicable("COP"));
  assert.equal(resolverPublicacionMontaje({ ...base, modo63: true, empaquetados: [{ etiqueta: "X", moneda: "USD" }] }).estado, "rechazado");
});

test("sin publicación publicable las filas no prometen conversión", () => {
  const filas = filasUnidades([{ tipo: "hotel", nombre: "H", moneda: "USD" }, { tipo: "bloqueo", nombre: "B", moneda: null }], null);
  assert.deepEqual(filas.map((f) => f.conversion), ["sin_publicacion", "sin_publicacion"]);
  assert.deepEqual(resumenUnidades(filas), { coinciden: 0, requierenTrm: 0, sinAcreditar: 0, sinPublicacion: 2 });
});

test("page.tsx entrega al panel la publicación de la selección, no la derivada de los hoteles disponibles", () => {
  const src = readFileSync(new URL("../app/(dashboard)/dashboard/paquetes/[id]/page.tsx", import.meta.url), "utf8");
  // #90 D: la misma lectura y la misma evaluación que el generador y la cotización (fuentes GUARDADAS + moneda ELEGIDA).
  assert.ok(src.includes("cargarFuentesMoneda90(") && src.includes("evaluarPublicacion90("));
  assert.ok(src.includes("publicacionMontaje={publicacionMontaje}"));
  // La lectura de los vínculos guardados vive en el cargador compartido, no en las listas «disponibles» del editor.
  const cargador = readFileSync(new URL("../lib/reservar/fuentesMoneda90.ts", import.meta.url), "utf8");
  for (const t of ['from("armado_vuelos")', 'from("armado_empaquetados")', 'from("armado_hoteles")', 'from("armado_servicios")']) assert.ok(cargador.includes(t), t);
  assert.ok(!src.includes("resolverPublicacionMontaje"), "ya no deriva la publicación de las listas disponibles");
});

// ═══ Vínculos guardados: mismos criterios que generarTarifario, aunque el editor ya no los liste ═══════════════════════════════
const HOY = "2030-06-15";
const vinc = (over: Partial<VinculosGuardados> = {}): VinculosGuardados => ({
  modo63: false, hoy: HOY, vuelos: [], empaquetados: [], hoteles: [], servicios: [], permiteDestinoAereo: () => true, ...over,
});
const bloqueo = (id: number, over: Record<string, unknown> = {}) => ({
  bloqueo_id: id,
  bloqueos_vuelo: { id, record: "RFUERA", ruta: "BOG-MIA", fecha_ida: "2031-02-01", fecha_regreso: "2031-02-05", moneda: "COP", ...over },
});

test("Bloqueo vinculado que salió del rango de viaje (no está entre los disponibles) sigue contando: hotel USD + Bloqueo COP se rechaza", () => {
  // El editor solo lista vuelos dentro de fecha_viaje_inicio/fin; el generador lee armado_vuelos sin ese filtro.
  const r = publicacionDeVinculosGuardados(vinc({ hoteles: [{ hoteles: { moneda: "USD" } }], vuelos: [bloqueo(11)] }));
  assert.equal(r.estado, "rechazado");
  assert.match((r as { motivo: string }).motivo, /RFUERA/);
});

test("hoteles y servicios guardados cuentan aunque no aparezcan entre los disponibles; un join nulo cuenta como COP (igual que el generador)", () => {
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: [{ hoteles: { moneda: "COP" } }, { hoteles: { moneda: "USD" } }] })).estado, "rechazado");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: [{ hoteles: { moneda: "USD" } }], servicios: [{ servicios_adicionales: { moneda: "COP" } }] })).estado, "rechazado");
  assert.deepEqual(publicacionDeVinculosGuardados(vinc({ hoteles: [{ hoteles: null }] })), { estado: "publicable", moneda: "COP" });
  assert.deepEqual(publicacionDeVinculosGuardados(vinc({ servicios: [{ servicios_adicionales: { moneda: "USD" } }] })), { estado: "publicable", moneda: "USD" });
});

test("Empaquetado guardado: se descarta si está inactivo, sin fechas o fuera de vigencia de compra; si cuenta y difiere, rechaza", () => {
  const emp = (over: Record<string, unknown> = {}) => ({
    empaquetado_id: 5,
    empaquetados: { id: 5, record: null, ruta: "BOG-MIA", fecha_ida: "2031-02-01", fecha_regreso: "2031-02-05", moneda: "USD", activo: true, compra_inicio: null, compra_fin: null, ...over },
  });
  const hotelCop = [{ hoteles: { moneda: "COP" } }];
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelCop, empaquetados: [emp()] })).estado, "rechazado");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelCop, empaquetados: [emp({ activo: false })] })).estado, "publicable");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelCop, empaquetados: [emp({ fecha_regreso: null })] })).estado, "publicable");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelCop, empaquetados: [emp({ compra_fin: "2030-01-01" })] })).estado, "publicable");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelCop, empaquetados: [emp({ compra_inicio: "2030-12-01" })] })).estado, "publicable");
});

test("vínculos que el generador descarta no cuentan: Bloqueo sin fechas, sin ficha o con destino aéreo no permitido", () => {
  const hotelUsd = [{ hoteles: { moneda: "USD" } }];
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelUsd, vuelos: [bloqueo(1, { fecha_ida: null })] })).estado, "publicable");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelUsd, vuelos: [{ bloqueo_id: 2, bloqueos_vuelo: null }] })).estado, "publicable");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelUsd, vuelos: [bloqueo(3)], permiteDestinoAereo: () => false })).estado, "publicable");
  assert.equal(publicacionDeVinculosGuardados(vinc({ hoteles: hotelUsd, vuelos: [bloqueo(3)], permiteDestinoAereo: (t, id) => t === "bloqueo" && id === 3 })).estado, "rechazado");
});

test("modo 63 con vínculos guardados: COP y el Bloqueo no se compara", () => {
  assert.deepEqual(
    publicacionDeVinculosGuardados(vinc({ modo63: true, hoteles: [{ hoteles: { moneda: "USD" } }], vuelos: [bloqueo(9, { moneda: "USD" })] })),
    { estado: "publicable", moneda: "COP" }
  );
});

test("los criterios del helper siguen siendo los de generarTarifario (guarda contra divergencia)", () => {
  const g = readFileSync(new URL("../app/(dashboard)/dashboard/paquetes/actions.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // #90 D: el generador ya NO tiene copias propias de estos criterios: usa los predicados compartidos (aporteFuentes90.ts) que también usan
  // el panel y la cotización. Si alguien vuelve a escribir un filtro a mano, el veredicto del generador podría divergir de ellos.
  for (const frag of [
    "bloqueoAporta(v.b, permiteDestinoAereo)",
    "empaquetadoVueloAporta(v.e, hoyGen, permiteDestinoAereo)",
    "motivoDescarteVinculada(sal as never, fuente63, hoyGen,",
    "fuentesQueAportan90({",
    'const monedaDe = (m: string | null | undefined) => (m === "USD" ? "USD" : "COP");',
    'if (tipo === "bloqueo" && ((vuelosSel?.length ?? 0) + (empaquetadosSel?.length ?? 0)) > 0)',
  ]) assert.ok(g.includes(frag), "generarTarifario cambió; revisar aporteFuentes90.ts: " + frag);
  const p = readFileSync(new URL("../lib/reservar/aporteFuentes90.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const frag of [
    "!!b && !!b.fecha_ida && !!b.fecha_regreso && permite(\"bloqueo\", b.id)",
    "!!e && !!e.activo && !!e.fecha_ida && !!e.fecha_regreso",
    "empaquetadoVigente(e.compra_inicio ?? null, e.compra_fin ?? null, hoy)",
    "permite(\"empaquetado\", e.id)",
    "seleccionarSalidasVigentes(",
    "evaluarFuenteVinculada63(fuente, hoy)",
    "fuenteCoincideConSalida63(sal,",
  ]) assert.ok(p.includes(frag), "los criterios compartidos cambiaron: " + frag);
  const ignorados = g.includes("hoteles.map((h) => ({ id: h.hotel_id");
  assert.ok(ignorados, "el generador entrega al evaluador los hoteles del armado");
});
