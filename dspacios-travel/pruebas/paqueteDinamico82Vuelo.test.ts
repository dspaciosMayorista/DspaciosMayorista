// #82 — el VUELO se clasifica y se cobra por las EDADES declaradas (regla de reservas, lib/reservar/menoresDeDos.ts): menor de 2 años = fee/PVP de infante y SIN silla;
// desde los 2 años = tarifa de adulto y CON silla. No depende de cómo clasifique el hotel (Niño 1 / Niño 2 / infante). Vinculado o manual, igual.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ADULTO = 500_000, INFANTE = 100_000;
const PVP_HOTEL = { sencilla: 1_200_000, doble: 1_000_000, triple: 900_000, multiple: 800_000, nino: 500_000, nino2: 400_000, infante: 50_000 };
const filaPaquete = (esq: "neta_markup" | "solo_pvp") => ({
  id: 1, nombre: "Paquete", moneda: "COP", esquema: esq, pvp_modo: esq === "solo_pvp" ? "por_componente" : null, pct_mk: esq === "neta_markup" ? 0.2 : 0,
  usa_vuelo: true, usa_hotel: true, usa_servicios: false, noches: 3, pvp_general: null, total_declarado: null,
});
const hotel = (esq: "neta_markup" | "solo_pvp", infanteMax: number) => ({
  id: 1, hotel_id: null, nombre: "Hotel M", categoria: null, regimen: null, descripcion: null, foto_url: null, proveedor: "H", pvp_general: null,
  neto: esq === "neta_markup" ? Object.fromEntries(Object.entries(PVP_HOTEL).map(([k, v]) => [k, v * 0.8])) : {}, pvp: esq === "solo_pvp" ? PVP_HOTEL : {},
  capacidad_ninos: 2, edad_infante_max: infanteMax, edad_nino_max: 10,
});
type Vuelo = "manual" | "vinculado" | "historico";
const vuelo = (esq: "neta_markup" | "solo_pvp", tipo: Vuelo) => {
  const precios = esq === "neta_markup" ? { neto: { adulto: ADULTO * 0.8, infante: INFANTE * 0.8 }, pvp: {} } : { neto: {}, pvp: { adulto: ADULTO, infante: INFANTE } };
  // histórico: lleva además el «nino» que antes se cargaba; ya no se usa pero se conserva y no cambia ningún importe.
  const nino = tipo === "historico" ? (esq === "neta_markup" ? { neto: { ...precios.neto, nino: 123_456 } } : { pvp: { ...precios.pvp, nino: 123_456 } }) : {};
  return { id: 1, empaquetado_id: tipo === "vinculado" ? 5 : null, destino_id: null, aerolinea: "Avianca", ruta: "MDE - CTG - MDE", fecha_ida: null, fecha_regreso: null, proveedor: "Avianca", ...precios, ...nino };
};

async function vender(esq: "neta_markup" | "solo_pvp", tipo: Vuelo, edades: number[], infanteMaxHotel: number) {
  const { armarPaqueteCalc } = await import("../lib/paqueteDinamico/modelo.ts");
  const { resolverMenores, reglasHotelManual } = await import("../lib/paqueteDinamico/menores.ts");
  const { liquidarPaquete } = await import("../lib/paqueteDinamico/calculo.ts");
  const { construirCotizacionDin } = await import("../lib/paqueteDinamico/cotizacion.ts");
  const calc = armarPaqueteCalc(filaPaquete(esq) as never, hotel(esq, infanteMaxHotel) as never, vuelo(esq, tipo) as never, []);
  const m = resolverMenores({ habitaciones: { doble: 1 }, edades, reglas: reglasHotelManual({ capacidadNinos: 2, edadInfanteMax: infanteMaxHotel, edadNinoMax: 10 }) });
  if (!m.ok) throw new Error(m.error);
  const comp = { habitaciones: { doble: 1 }, ninos: m.ninos, ninos2: m.ninos2, infantes: m.infantes, edadesMenores: m.edades };
  const liq = liquidarPaquete(calc, comp);
  const cot = construirCotizacionDin({
    paqueteId: 1, paqueteNombre: "Paquete", destino: "CARTAGENA", hotelId: 1, vueloId: 1, calc, composicion: comp,
    cliente: { nombres: "Ana", apellidos: "P", tipoDoc: "CC", numeroDoc: "1", telefono: "3", email: "a@x.co" }, fechaIda: "2099-06-10", fechaRegreso: "2099-06-13", vigenciaHasta: "2099-06-01",
    tipoAsesor: "interno", asesorInterno: "X", agenciaNombre: "", freelanceNombre: "",
  });
  if (!cot.ok) throw new Error(cot.error);
  const vlineas = liq.lineas.filter((l) => l.componente === "vuelo");
  const hlineas = liq.lineas.filter((l) => l.componente === "hotel");
  const vuelo$ = vlineas.reduce((s, l) => s + l.valor, 0);
  return { m, liq, cot, vlineas, hlineas, vuelo$, hotelClases: [m.ninos, m.ninos2, m.infantes] };
}
const q = (v: Awaited<ReturnType<typeof vender>>, k: "adulto" | "infante") => v.vlineas.find((l) => l.descripcion.endsWith(k))?.cantidad ?? 0;

describe("pasajeros del vuelo por edad", async () => {
  const { vueloPasajeros } = await import("../lib/paqueteDinamico/calculo.ts");
  test("1 año = infante sin silla; 2 años = adulto con silla; el hotel no decide", () => {
    const base = { habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0 };
    assert.deepEqual(vueloPasajeros({ ...base, ninos: 1, edadesMenores: [1] }), { adultos: 2, menores: 1, menoresDeDos: 1, sillas: 2 });
    assert.deepEqual(vueloPasajeros({ ...base, infantes: 1, edadesMenores: [2] }), { adultos: 2, menores: 1, menoresDeDos: 0, sillas: 3 }); // el hotel lo llama infante; el vuelo lo cobra como adulto
    assert.deepEqual(vueloPasajeros({ ...base, ninos: 1, ninos2: 1, infantes: 1, edadesMenores: [1, 2, 5] }), { adultos: 2, menores: 3, menoresDeDos: 1, sillas: 4 });
  });
  test("composición anterior sin edades: los infantes declarados son los menores de 2 años", () => {
    assert.deepEqual(vueloPasajeros({ habitaciones: { doble: 1 }, ninos: 1, ninos2: 0, infantes: 1 }), { adultos: 2, menores: 2, menoresDeDos: 1, sillas: 3 });
  });
});

describe("importes y sillas del vuelo: edades 1 y 2, vuelo manual / vinculado / histórico, ambos esquemas", () => {
  for (const esq of ["neta_markup", "solo_pvp"] as const) for (const tipo of ["manual", "vinculado", "historico"] as const) {
    test(`${esq} · ${tipo}: 1 año paga el fee de infante y no ocupa silla; 2 años paga adulto y ocupa silla`, async () => {
      const a = await vender(esq, tipo, [1], 2);
      assert.deepEqual([q(a, "adulto"), q(a, "infante"), a.vuelo$], [2, 1, 2 * ADULTO + INFANTE]);
      const b = await vender(esq, tipo, [2], 2);
      assert.deepEqual([q(b, "adulto"), q(b, "infante"), b.vuelo$], [3, 0, 3 * ADULTO]);
      const c = await vender(esq, tipo, [1, 2], 2);
      assert.deepEqual([q(c, "adulto"), q(c, "infante"), c.vuelo$], [3, 1, 3 * ADULTO + INFANTE]);
    });
  }
  test("el dato histórico «nino» del vuelo se conserva pero no cambia ningún importe", async () => {
    const man = await vender("solo_pvp", "manual", [1, 2, 5], 2), his = await vender("solo_pvp", "historico", [1, 2, 5], 2);
    assert.equal(his.vuelo$, man.vuelo$);
    assert.equal(his.liq.total, man.liq.total);
  });
});

describe("cuando el hotel clasifica distinto, el vuelo NO cambia (solo el hotel)", () => {
  test("hotel con infante hasta 0 años: el menor de 1 año es «Niño 1» para el hotel, pero en el vuelo sigue siendo infante sin silla", async () => {
    const h0 = await vender("solo_pvp", "manual", [1], 0), h2 = await vender("solo_pvp", "manual", [1], 2);
    assert.deepEqual(h0.hotelClases, [1, 0, 0]); // Niño 1
    assert.deepEqual(h2.hotelClases, [0, 0, 1]); // infante
    assert.deepEqual([q(h0, "adulto"), q(h0, "infante"), h0.vuelo$], [q(h2, "adulto"), q(h2, "infante"), h2.vuelo$]);
    assert.equal(h0.vuelo$, 2 * ADULTO + INFANTE);
    assert.notEqual(h0.hlineas.reduce((s, l) => s + l.valor, 0), h2.hlineas.reduce((s, l) => s + l.valor, 0)); // el hotel sí cobra distinto
  });
  test("hotel con infante hasta 2 años: el menor de 2 años es «infante» para el hotel y paga el vuelo de ADULTO con silla", async () => {
    const h2 = await vender("solo_pvp", "vinculado", [2], 2);
    assert.deepEqual(h2.hotelClases, [0, 0, 1]);
    assert.deepEqual([q(h2, "adulto"), q(h2, "infante")], [3, 0]);
    const h1 = await vender("solo_pvp", "vinculado", [2], 1); // infante hasta 1: a los 2 el hotel lo llama niño; el vuelo, adulto con silla igual
    assert.deepEqual(h1.hotelClases, [1, 0, 0]);
    assert.equal(h1.vuelo$, h2.vuelo$);
  });
});

describe("de punta a punta: tarjeta = checkout = cotización = contrato (importes, sillas y CxP)", () => {
  test("Σ componentes = precio de venta = ítem del documento, en los dos esquemas", async () => {
    for (const esq of ["neta_markup", "solo_pvp"] as const) {
      const v = await vender(esq, "vinculado", [1, 2, 5], 2);
      assert.equal(v.cot.servicios.reduce((s, f) => s + f.valor, 0), v.liq.total);
      assert.equal(Number(v.cot.cabecera.precio_venta), v.liq.total);
      assert.equal((v.cot.cabecera.detalle as { items: { valor: number }[] }).items[0].valor, v.liq.total);
    }
  });
  test("el componente guarda la cantidad de sillas e infantes (se ve al registrar el costo y en la CxP) y el payload deja los pasajeros", async () => {
    const v = await vender("solo_pvp", "vinculado", [1, 2, 5], 2);
    const comp = v.cot.servicios.find((f) => f.componente === "vuelo")!;
    assert.equal(comp.nombre_servicio, "Vuelo · 4 sillas + 1 infante (menor de 2 años, sin silla)");
    assert.equal(comp.exige_costo, true);
    const dinamico = (v.cot.cabecera.payload as { dinamico: { pasajeros: Record<string, number> } }).dinamico;
    assert.deepEqual(dinamico.pasajeros, { adultos: 2, menores: 3, menoresDeDos: 1, sillas: 4 });
    const n = await vender("neta_markup", "vinculado", [1, 2, 5], 2);
    const cn = n.cot.servicios.find((f) => f.componente === "vuelo")!;
    assert.deepEqual([cn.exige_costo, cn.costo_neto], [false, 4 * ADULTO * 0.8 + INFANTE * 0.8]);
  });
});

describe("validación del vuelo (la tarifa «niño» ya no existe)", async () => {
  const { validarPaquete } = await import("../lib/paqueteDinamico/calculo.ts");
  const { armarPaqueteCalc } = await import("../lib/paqueteDinamico/modelo.ts");
  test("basta con adulto e infante; falta del infante se explica con la regla", () => {
    const ok = armarPaqueteCalc(filaPaquete("solo_pvp") as never, hotel("solo_pvp", 2) as never, vuelo("solo_pvp", "manual") as never, []);
    assert.deepEqual(validarPaquete(ok), []);
    const sin = armarPaqueteCalc(filaPaquete("solo_pvp") as never, hotel("solo_pvp", 2) as never, { ...vuelo("solo_pvp", "manual"), pvp: { adulto: ADULTO, nino: 300_000 } } as never, []);
    const msgs = validarPaquete(sin);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /infante.*menor de 2 años/);
  });
});

describe("pantallas", () => {
  const form = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/PaqueteTotalForm.tsx"));
  test("formulario de vuelo: adulto (ocupa silla) e infante (sin silla), con la regla; sin «PVP niño»", () => {
    assert.match(form, /data-testid="precios-vuelo"/);
    assert.match(form, /adulto y menor desde 2 años/);
    assert.match(form, /infante \(menor de 2 años\)/);
    assert.match(form, /Ocupa silla\./);
    assert.match(form, /Sin silla\. Escribe 0 si va gratis\./);
    assert.doesNotMatch(form, /\["adulto", "nino", "infante"\]/);
    assert.doesNotMatch(form, /nino: x\.tarifa_proveedor/);
  });
  test("tarjeta y checkout muestran la regla y las sillas/infantes por edad", () => {
    const t = sinComentarios(leer("app/tarifario/PorDinamicos.tsx"));
    assert.match(t, /data-testid="regla-vuelo"/);
    assert.match(t, /data-testid="sillas-vuelo"/);
    assert.match(sinComentarios(leer("app/tarifario/checkout/dinamico/CheckoutDinamico.tsx")), /data-testid="res-sillas"/);
    assert.match(sinComentarios(leer("app/tarifario/checkout/dinamico/actions.ts")), /vueloPasajeros\(sel\.composicion\)/);
  });
  test("ficha de servicio: nombre y borrar en la misma fila, campos en rejilla, ayuda del infante bajo su campo, reglas de cobro en lista", () => {
    assert.match(form, /data-testid="ficha-servicio"/);
    assert.match(form, /className="flex items-start gap-3"/);
    assert.match(form, /mt-3 grid items-start gap-3 sm:grid-cols-2/);
    assert.match(form, /<span className="mt-1 block text-xs text-gray-500">\{ficha\.cobraInfante/);
    assert.match(form, /<ul className="mt-1 list-disc space-y-0\.5 pl-4">/);
    assert.doesNotMatch(form, /grid items-end gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-5/);
  });
});
