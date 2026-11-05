// #82 — paridad de los servicios VINCULADOS: la unidad de cobro es la de la ficha (por grupo se cobra UNA vez; por persona, con la regla del infante) en
// netas+markup, solo PVP por componente y solo PVP general; y el mismo cobro llega a la tarjeta, al checkout, a la cotización y al contrato (la conversión
// real, con CxP, se prueba en supabase/scripts/test_277_*.sql con estos mismos números).
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FichaServicioDin } from "../lib/paqueteDinamico/servicioFicha.ts";

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const vigencia = { nombre: "2099", fecha_inicio: "2099-01-01", fecha_fin: "2099-12-31", compra_inicio: null, compra_fin: null, prioridad: 1, precio_infante: 30_000, recargo_individual: 0 };
const fichaGrupo = { id: 101, nombre: "Cena show", modo: "grupo" as const, liquidacion: null, moneda: "COP", temporadas: [{ ...vigencia, precio_persona: null, precio_infante: null }], grupos: [{ pax_desde: 1, pax_hasta: 6, precio: 600_000, temporada: "2099" }] };
const fichaPersona = { id: 102, nombre: "Tour Islas", modo: "persona" as const, liquidacion: null, moneda: "COP", temporadas: [{ ...vigencia, precio_persona: 100_000 }], grupos: [] };
const fichaPersonaInfanteGratis = { ...fichaPersona, id: 103, nombre: "Tour gratis infante", temporadas: [{ ...vigencia, precio_persona: 100_000, precio_infante: 0 }] };
const fichas = new Map<number, FichaServicioDin>([[101, fichaGrupo], [102, fichaPersona], [103, fichaPersonaInfanteGratis]]);

// Hotel manual (capacidad 2, infante hasta 2, niño hasta 10). Netos = PVP × 0,8 para que el markup del 20 % deje los mismos PVP en los dos esquemas.
const PVP = { sencilla: 1_200_000, doble: 1_000_000, triple: 900_000, multiple: 800_000, nino: 500_000, nino2: 400_000, infante: 0 };
const NETO = Object.fromEntries(Object.entries(PVP).map(([k, v]) => [k, v * 0.8]));
const hotel = (esq: "neta_markup" | "solo_pvp") => ({
  id: 1, hotel_id: null, nombre: "Hotel M", categoria: "Suite", regimen: "PC", descripcion: null, foto_url: null, proveedor: "H", pvp_general: null,
  neto: esq === "neta_markup" ? NETO : {}, pvp: esq === "solo_pvp" ? PVP : {}, capacidad_ninos: 2, edad_infante_max: 2, edad_nino_max: 10,
});
const filaPaquete = (esq: "neta_markup" | "solo_pvp", modo: "general" | "por_componente" | null) => ({
  id: 1, nombre: "Paquete", moneda: "COP", esquema: esq, pvp_modo: modo, pct_mk: esq === "neta_markup" ? 0.2 : 0, usa_vuelo: false, usa_hotel: true, usa_servicios: true, noches: 3,
  pvp_general: modo === "general" ? { sencilla: 1, doble: 1_500_000, triple: 1, multiple: 1, nino: 600_000, nino2: 500_000, infante: 100_000 } : null, total_declarado: null,
});
const srv = (esq: "neta_markup" | "solo_pvp", pvpInfantePersona: number | null) => [
  { id: 1, servicio_id: 101, nombre: "Cena show", proveedor: "Operador", neto: null, pvp: esq === "solo_pvp" ? 720_000 : null, pvp_infante: null },
  { id: 2, servicio_id: 102, nombre: "Tour Islas", proveedor: "Operador", neto: null, pvp: esq === "solo_pvp" ? 120_000 : null, pvp_infante: pvpInfantePersona },
];

async function vender(esq: "neta_markup" | "solo_pvp", modo: "general" | "por_componente" | null, opts: { edades?: number[]; pvpInfante?: number | null; servicios?: ReturnType<typeof srv> } = {}) {
  const { armarPaqueteCalc } = await import("../lib/paqueteDinamico/modelo.ts");
  const { resolverMenores, reglasHotelManual } = await import("../lib/paqueteDinamico/menores.ts");
  const { resolverServiciosVinculados } = await import("../lib/paqueteDinamico/serviciosVinculados.ts");
  const { adultosDe, liquidarPaquete } = await import("../lib/paqueteDinamico/calculo.ts");
  const { construirCotizacionDin } = await import("../lib/paqueteDinamico/cotizacion.ts");
  const filas = opts.servicios ?? srv(esq, opts.pvpInfante === undefined ? 40_000 : opts.pvpInfante);
  const calc = armarPaqueteCalc(filaPaquete(esq, modo) as never, hotel(esq) as never, null, filas as never);
  const m = resolverMenores({ habitaciones: { doble: 1 }, edades: opts.edades ?? [5, 8, 1], reglas: reglasHotelManual({ capacidadNinos: 2, edadInfanteMax: 2, edadNinoMax: 10 }) });
  if (!m.ok) throw new Error(m.error);
  const comp = { habitaciones: { doble: 1 }, ninos: m.ninos, ninos2: m.ninos2, infantes: m.infantes, edadesMenores: m.edades };
  const r = resolverServiciosVinculados({
    calc, noches: 3, fechaIda: "2099-06-10", servicios: filas as never, fichas,
    pax: { adultos: adultosDe(comp), ninos: comp.ninos + comp.ninos2, infantes: comp.infantes, menoresDeDos: m.menoresDeDos },
  });
  if (!r.ok) return { error: r.error } as const;
  const liq = liquidarPaquete(calc, comp, r.resueltos);
  const cot = construirCotizacionDin({
    paqueteId: 1, paqueteNombre: "Paquete", destino: "CARTAGENA", hotelId: 1, vueloId: null, calc, composicion: comp, resueltos: r.resueltos,
    cliente: { nombres: "Ana", apellidos: "P", tipoDoc: "CC", numeroDoc: "1", telefono: "3", email: "a@x.co" }, fechaIda: "2099-06-10", fechaRegreso: "2099-06-13", vigenciaHasta: "2099-06-01",
    tipoAsesor: "interno", asesorInterno: "X", agenciaNombre: "", freelanceNombre: "",
  });
  if (!cot.ok) throw new Error(cot.error);
  return { liq, cot, comp, m } as const;
}
const linea = (v: Awaited<ReturnType<typeof vender>>, ref: string) => { if ("error" in v) throw new Error(v.error); return v.liq.lineas.find((l) => l.ref === ref)!; };

describe("el cliente declara DOS adultos, dos niños (Niño 1 y Niño 2) y un infante de 1 año", async () => {
  test("solo PVP por componente: el servicio por GRUPO se cobra UNA vez; el de persona, con silla + PVP de infante", async () => {
    const v = await vender("solo_pvp", "por_componente");
    if ("error" in v) throw new Error(v.error);
    assert.deepEqual([v.m.ninos, v.m.ninos2, v.m.infantes, v.m.menoresDeDos], [1, 1, 1, 1]);
    const cena = linea(v, "servicio:1"), tour = linea(v, "servicio:2");
    assert.equal(cena.valor, 720_000); // una vez, NO 720.000 × 4
    assert.equal(cena.cantidad, 1);
    assert.match(cena.descripcion, /Cena show · 1 grupo \(4 pasajeros con silla\)/);
    assert.equal(tour.valor, 4 * 120_000 + 40_000); // 4 con silla + 1 infante
    assert.equal(tour.cantidad, 5);
    assert.match(tour.descripcion, /4 personas \+ 1 infante \(menor de 2 años\)/);
    assert.deepEqual([cena.exigeCosto, cena.costoNeto, tour.exigeCosto, tour.costoNeto], [true, 0, true, 0]);
    assert.equal(v.liq.total, 2_900_000 + 720_000 + 520_000);
  });
  test("netas+markup: el cobro sale de la ficha (grupo una vez; persona con tarifa de infante) y el costo queda calculado", async () => {
    const v = await vender("neta_markup", null);
    const cena = linea(v, "servicio:1"), tour = linea(v, "servicio:2");
    assert.deepEqual([cena.valor, cena.costoNeto, cena.cantidad, cena.exigeCosto], [750_000, 600_000, 1, false]);
    assert.deepEqual([tour.valor, tour.costoNeto, tour.cantidad, tour.exigeCosto], [538_000, 430_000, 5, false]); // 4 × 100.000 + 30.000 = 430.000 → +20 %
    assert.match(cena.descripcion, /1 grupo \(4 pasajeros con silla\)/);
  });
  test("solo PVP general: el servicio no lleva PVP, pero guarda la cantidad de la ficha (1 grupo / 4 personas + 1 infante) y exige costo", async () => {
    const v = await vender("solo_pvp", "general");
    const cena = linea(v, "servicio:1"), tour = linea(v, "servicio:2");
    assert.deepEqual([cena.valor, cena.cantidad, cena.exigeCosto], [0, 1, true]);
    assert.deepEqual([tour.valor, tour.cantidad, tour.exigeCosto], [0, 5, true]);
    assert.match(tour.descripcion, /4 personas \+ 1 infante/);
  });
  test("el total de la tarjeta/checkout es el de la cotización y el del contrato: Σ componentes = precio de venta = ítem del documento", async () => {
    for (const [esq, modo] of [["solo_pvp", "por_componente"], ["solo_pvp", "general"], ["neta_markup", null]] as const) {
      const v = await vender(esq, modo);
      if ("error" in v) throw new Error(v.error);
      const suma = v.cot.servicios.reduce((s, f) => s + f.valor, 0);
      assert.equal(suma, v.liq.total, `${esq}/${modo}: componentes = total`);
      assert.equal(Number(v.cot.cabecera.precio_venta), v.liq.total);
      const det = v.cot.cabecera.detalle as { items: { valor: number }[]; venta: { precio_venta: number } };
      assert.equal(det.items[0].valor, v.liq.total);
      assert.equal(det.venta.precio_venta, v.liq.total);
    }
  });
  test("lo que se guarda para costos/CxP lleva la unidad en el nombre del componente y respeta exige_costo según el esquema", async () => {
    const a = await vender("solo_pvp", "por_componente");
    if ("error" in a) throw new Error(a.error);
    const filas = a.cot.servicios.filter((f) => f.componente.startsWith("servicio:"));
    assert.deepEqual(filas.map((f) => f.exige_costo), [true, true]);
    assert.ok(filas[0].nombre_servicio.includes("1 grupo (4 pasajeros con silla)"));
    assert.ok(filas[1].nombre_servicio.includes("4 personas + 1 infante"));
    const n = await vender("neta_markup", null);
    if ("error" in n) throw new Error(n.error);
    const fn = n.cot.servicios.filter((f) => f.componente.startsWith("servicio:"));
    assert.deepEqual(fn.map((f) => [f.exige_costo, f.costo_neto]), [[false, 600_000], [false, 430_000]]);
  });
});

describe("regla del infante en solo PVP (nunca gratis en silencio)", async () => {
  test("la ficha cobra al infante y el paquete no define su PVP: se rechaza con motivo", async () => {
    const v = await vender("solo_pvp", "por_componente", { pvpInfante: null });
    assert.ok("error" in v);
    assert.match(("error" in v && v.error) || "", /cobra al infante/);
  });
  test("0 es un PVP de infante explícito y válido; y sin infante no hace falta", async () => {
    const v = await vender("solo_pvp", "por_componente", { pvpInfante: 0 });
    assert.equal(linea(v, "servicio:2").valor, 4 * 120_000);
    const sin = await vender("solo_pvp", "por_componente", { pvpInfante: null, edades: [5, 8] });
    assert.equal(linea(sin, "servicio:2").valor, 4 * 120_000);
  });
  test("si la ficha NO cobra al infante (tarifa 0 en la ficha), no se exige PVP de infante", async () => {
    const filas = [{ id: 3, servicio_id: 103, nombre: "Tour gratis infante", proveedor: "Operador", neto: null, pvp: 120_000, pvp_infante: null }];
    const v = await vender("solo_pvp", "por_componente", { servicios: filas });
    assert.equal(linea(v, "servicio:3").valor, 4 * 120_000);
  });
  test("cobraInfante: solo por persona, con tarifa > 0 o sin tarifa propia (paga como adulto)", async () => {
    const { cobraInfante } = await import("../lib/paqueteDinamico/servicioFicha.ts");
    assert.equal(cobraInfante(fichaPersona), true);
    assert.equal(cobraInfante(fichaPersonaInfanteGratis), false);
    assert.equal(cobraInfante(fichaGrupo), false);
    assert.equal(cobraInfante({ modo: "persona", temporadas: [{ ...vigencia, precio_persona: 100_000, precio_infante: null }] }), true);
  });
});

describe("capacidad por grupo en solo PVP: cinco niños", async () => {
  test("2 adultos + 5 niños (7 con silla) en un servicio por grupo 1–6 se rechaza; con un menor de 2 años (6) se acepta y se cobra UNA vez", async () => {
    const { cobrarServicioPvp } = await import("../lib/paqueteDinamico/servicioFicha.ts");
    const r = cobrarServicioPvp(fichaGrupo, { adultos: 2, ninos: 5, infantes: 0, menoresDeDos: 0 }, { persona: 720_000, infante: null });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /de 1 a 6 pasajeros/);
    const ok = cobrarServicioPvp(fichaGrupo, { adultos: 2, ninos: 4, infantes: 1, menoresDeDos: 1 }, { persona: 720_000, infante: null });
    assert.deepEqual(ok.ok && [ok.valor, ok.cantidad, ok.paxConSilla], [720_000, 1, 6]);
  });
});

describe("cableado: mismo cobro en todas las etapas", () => {
  test("el servidor usa UN solo resolutor de servicios vinculados (tarjeta, checkout y cotización llaman al mismo núcleo)", () => {
    assert.match(sinComentarios(leer("lib/paqueteDinamico/seleccion.ts")), /resolverServiciosVinculados\(\{/);
    assert.match(sinComentarios(leer("app/tarifario/checkout/dinamico/actions.ts")), /resolverSeleccionDin\(admin,/);
    assert.match(sinComentarios(leer("app/(dashboard)/dashboard/cotizaciones/din-actions.ts")), /resolverSeleccionDin\(admin,/);
    assert.match(sinComentarios(leer("app/tarifario/checkout/dinamico/page.tsx")), /evaluarSeleccionDin\(/);
  });
  test("montaje: PVP por grupo, PVP de infante y validación en servidor; la columna se guarda con el paquete", () => {
    const f = sinComentarios(["PaqueteTotalForm.tsx", "VueloFilaDin.tsx", "ServicioFilaDin.tsx", "HotelFilaDin.tsx"].map((x) => leer("app/(dashboard)/dashboard/paquetes/total/" + x)).join(" "));
    assert.match(f, /por grupo \(una vez\)/);
    assert.match(f, /aria-label="PVP infante"/);
    const a = sinComentarios(leer("app/(dashboard)/dashboard/paquetes/total/actions.ts"));
    assert.match(a, /cobra al infante \(menor de 2 años\): define su PVP de infante/);
    assert.match(a, /pvp_infante: porComp && s\.servicioId != null \? s\.pvpInfante : null/);
    assert.match(leer("supabase/migrations/20260601000277_paquete_dinamico_hotel_menores.sql"), /add column if not exists pvp_infante numeric\(15,2\)/);
  });
});
