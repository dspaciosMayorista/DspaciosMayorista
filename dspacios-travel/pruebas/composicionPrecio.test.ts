import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluarHotelPorFechas, type DatosHotelPaquete, type FilaServicioIncluidoRaw } from "../lib/reservar/liquidacionHotel.ts";
import { construirComposicion, leerComposicion, leerComposicionCotizacion, type BaseMotor } from "../lib/cotizacion/composicionPrecio.ts";

// Composición del precio: se construye con lo que produjo el MOTOR REAL (evaluarHotelPorFechas) y debe reproducir sus precios.
const srv = (o: Partial<FilaServicioIncluidoRaw>): FilaServicioIncluidoRaw => {
  const s: FilaServicioIncluidoRaw = { incluido: true, precio_persona: 0, liquidacion: "paquete", servicio_id: 1, modo: "persona", nombre: "S", categoria: "otro", proveedor_id: null, rangos_grupo: [], ...o };
  return { ...s, vigencias: { servicioId: s.servicio_id, nombre: s.nombre ?? "S", conFranjas: new Set<string>(), temporadas: [{ nombre: "VIG", fecha_inicio: "2000-01-01", fecha_fin: "2099-12-31", precio_persona: s.precio_persona, precio_infante: s.precio_infante ?? null }], grupos: [] } };
};
function datos(opts: { fijo?: number | null; vuelo?: { aporte: number; feeInfante: number }; servicios: FilaServicioIncluidoRaw[] }): DatosHotelPaquete {
  return {
    paquete: { pct_mk: 0.2, pvp_infante_fijo: opts.fijo ?? null, impuesto_fijo: 50_000, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-12-31" },
    armadoHotel: { categorias: null, regimenes: null, hotel_nombre: "Hotel", hotel_moneda: "COP" },
    temporadas: [{ nombre: "ALTA", fecha_inicio: "2026-09-01", fecha_fin: "2026-09-15", prioridad: 1, compra_inicio: null, compra_fin: null, tipo: "tarifa", descuento_valor: null, rangos: [], blackouts: [], min_noches: 1, regimen_restringido: null }],
    tarifas: [{ tipo_habitacion: "Estandar", alimentacion: "PC", temporada: "ALTA", neto_sencilla: 150_000, neto_doble: 100_000, neto_triple: null, neto_multiple: null, neto_nino: 50_000, neto_nino2: 30_000, neto_infante: 40_000 }],
    serviciosIncluidos: opts.servicios, blackouts: [], ...(opts.vuelo ? { vuelo: opts.vuelo } : {}),
  };
}
const SERV = [
  srv({ servicio_id: 1, nombre: "Traslados", precio_persona: 80_000, precio_infante: 20_000 }),
  srv({ servicio_id: 2, nombre: "Asistencia", precio_persona: 41_000, precio_infante: 0, categoria: "asistencia" }),
];

function base(opts: Parameters<typeof datos>[0]) {
  const r = evaluarHotelPorFechas(datos(opts), "2026-09-05", 3)!;
  const combo = r.combos[0];
  const b: BaseMotor = { ...r.composicionBase!, netos: { ...combo.netos } };
  return { r, combo, b };
}
const sumaPersona = (c: { componentes: { venta: number }[] | null }) => c.componentes!.reduce((t, x) => t + x.venta, 0);

describe("composición con el motor real", () => {
  test("varias habitaciones y distintos pax: cada línea cuadra con el precio del motor y el total con el de la cotización", () => {
    const { combo, b } = base({ vuelo: { aporte: 400_001, feeInfante: 30_000 }, servicios: SERV });
    const lineasHab = [
      { acom: "sencilla", habitaciones: 1, pax: 1, pvp: combo.precios.sencilla },
      { acom: "doble", habitaciones: 2, pax: 4, pvp: combo.precios.doble },
    ];
    const total = lineasHab.reduce((t, l) => t + l.pax * l.pvp, 0);
    const c = construirComposicion({ base: b, moneda: "COP", trm: null, lineasHab, lineasMenores: [], adicionales: [], total });
    assert.ok(c.cuadra);
    assert.equal(c.total, total);
    for (const l of c.lineas) {
      assert.ok(l.componentes, l.clave);
      assert.ok(Math.abs(sumaPersona(l) - l.pvpPorPersona) < 0.01, `${l.clave}: ${sumaPersona(l)} vs ${l.pvpPorPersona}`);
    }
    const doble = c.lineas.find((l) => l.clave === "doble")!;
    const servs = doble.componentes!.filter((x) => x.tipo === "servicio");
    assert.deepEqual(servs.map((x) => x.nombre), ["Traslados", "Asistencia"]);
    // venta individual de cada servicio = su neto con el markup global del paquete (20 %): 80.000 → 100.000; 41.000 → 51.250
    assert.deepEqual(servs.map((x) => [x.neto, x.venta]), [[80_000, 100_000], [41_000, 51_250]]);
    assert.deepEqual(doble.componentes!.find((x) => x.tipo === "hotel"), { tipo: "hotel", nombre: "Hotel", neto: 300_000, venta: 375_000 });
    assert.ok(doble.componentes!.some((x) => x.tipo === "vuelo" && x.venta === 400_001 && x.neto === null));
    assert.equal(c.markup.pct, 0.2);
    assert.equal(c.impuestoIncluido, 50_000);
  });

  test("menor de 2 años: hotel de su clase + servicios de infante + fee del vuelo exacto + redondeo del resto", () => {
    const { combo, b } = base({ vuelo: { aporte: 400_000, feeInfante: 30_000 }, servicios: SERV });
    const pvp = combo.preciosMenor2!.infante;
    const c = construirComposicion({ base: b, moneda: "COP", trm: null, lineasHab: [], lineasMenores: [{ clase: "infante", cantidad: 1, tarifa: pvp, menorDeDos: true }], adicionales: [], total: pvp });
    const l = c.lineas[0];
    assert.ok(l.componentes);
    assert.ok(Math.abs(sumaPersona(l) - pvp) < 0.01);
    assert.ok(l.componentes!.some((x) => x.tipo === "vuelo" && x.nombre.startsWith("Fee de infante") && x.venta === 30_000));
  });

  test("PVP fijo del infante: no inventa componentes, lo dice", () => {
    const { combo, b } = base({ fijo: 49_000, servicios: [] });
    const c = construirComposicion({ base: b, moneda: "COP", trm: null, lineasHab: [], lineasMenores: [{ clase: "infante", cantidad: 2, tarifa: combo.precios.infante, menorDeDos: false }], adicionales: [], total: 98_000 });
    assert.equal(c.lineas[0].componentes, null);
    assert.match(c.lineas[0].nota ?? "", /PVP fijo/);
  });

  test("adicionales (servicio opcional, ajuste de redondeo) entran al total; si no suman, cuadra=false", () => {
    const { combo, b } = base({ servicios: [] });
    const lineasHab = [{ acom: "doble", habitaciones: 1, pax: 2, pvp: combo.precios.doble }];
    const t = 2 * combo.precios.doble;
    const ok = construirComposicion({
      base: b, moneda: "COP", trm: null, lineasHab, lineasMenores: [],
      adicionales: [{ tipo: "servicio_opcional", nombre: "Tour", total: 120_000 }, { tipo: "ajuste_redondeo", nombre: "Ajuste", total: -1_000 }], total: t + 119_000,
    });
    assert.ok(ok.cuadra);
    const mal = construirComposicion({ base: b, moneda: "COP", trm: null, lineasHab, lineasMenores: [], adicionales: [], total: t + 5 });
    assert.equal(mal.cuadra, false);
  });

  test("USD: el redondeo es al dólar entero", () => {
    const b: BaseMotor = { pctMk: 0.2, impuesto: 0, vuelo: 0, vueloNeto: null, feeInfante: 0, servicios: [], netos: { doble: 101 } };
    const pvp = Math.ceil(101 / 0.8);
    const c = construirComposicion({ base: b, moneda: "USD", trm: null, lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp }], lineasMenores: [], adicionales: [], total: 2 * pvp });
    assert.ok(c.lineas[0].componentes);
    assert.equal(c.moneda, "USD");
  });

  test("ida y vuelta por el guardado: lectura estricta y rechazo de formas inválidas", () => {
    const { combo, b } = base({ servicios: SERV });
    const c = construirComposicion({ base: b, moneda: "COP", trm: null, lineasHab: [{ acom: "doble", habitaciones: 1, pax: 2, pvp: combo.precios.doble }], lineasMenores: [], adicionales: [], total: 2 * combo.precios.doble });
    const ida = JSON.parse(JSON.stringify(c));
    assert.deepEqual(leerComposicion(ida), c);
    assert.ok(leerComposicionCotizacion({ version: 1, hoteles: [{ ref: "h1", nombre: "Hotel", composicion: ida }] }));
    assert.equal(leerComposicion({ ...ida, total: "x" }), null);
    assert.equal(leerComposicion({ ...ida, lineas: [{ ...ida.lineas[0], pax: null }] }), null);
    assert.equal(leerComposicionCotizacion({ version: 1, hoteles: [] }), null);
    assert.equal(leerComposicion(null), null);
  });
});

describe("cableado: privacidad y no-regresión", () => {
  const leer = (f: string) => readFileSync(f, "utf8");
  test("la migración 272 no abre la tabla a anon/authenticated", () => {
    const m = leer("supabase/migrations/20260601000272_cotizacion_composicion.sql");
    assert.match(m, /enable row level security/);
    assert.match(m, /revoke all on public\.cotizacion_composicion from public, anon, authenticated/);
    assert.doesNotMatch(m, /create policy/i);
    assert.doesNotMatch(m, /grant [^;]*(anon|authenticated)/i);
  });
  test("los dos flujos de cotización guardan la composición y los documentos de cliente no la leen", () => {
    assert.match(leer("app/(dashboard)/dashboard/reservar/actions.ts"), /guardarComposicion\(/);
    assert.match(leer("app/tarifario/checkout/actions.ts"), /guardarComposicion\(/);
    for (const f of ["app/cotizacion/[id]/page.tsx", "components/contrato/ContratoDocumento.tsx", "components/contrato/CotizacionManualDocumento.tsx"]) {
      assert.doesNotMatch(leer(f), /composicion(Precio|Servidor|Guardada)|cotizacion_composicion/i, f);
    }
  });
  test("la ficha solo lee la composición para roles con acceso a costos", () => {
    const p = leer("app/(dashboard)/dashboard/cotizaciones/[id]/page.tsx");
    assert.match(p, /esPagoAutorizado && !esManual && process\.env\.SUPABASE_SERVICE_ROLE_KEY \? await leerComposicionGuardada/);
    assert.match(p, /\{!esManual && esPagoAutorizado && <ComposicionPrecio/);
  });
});

import { claveComposicion, leerBaseGuardada, origenClaveDeFila, origenDeClave } from "../lib/tarifario/composicionTarifario.ts";

describe("composición del tarifario publicado (273)", () => {
  const leer = (f: string) => readFileSync(f, "utf8");
  test("la migración 273 es privada y no toca la tabla legible, la vista ni las RPC de publicación", () => {
    const m = leer("supabase/migrations/20260601000273_tarifario_resultado_composicion.sql");
    assert.match(m, /enable row level security/);
    assert.match(m, /revoke all on public\.tarifario_resultado_composicion from public, anon, authenticated/);
    assert.doesNotMatch(m, /create policy/i);
    assert.doesNotMatch(m, /grant [^;]*(anon|authenticated)/i);
    assert.doesNotMatch(m, /alter table public\.tarifario_resultado\b(?!_)/i);
    assert.doesNotMatch(m, /create (or replace )?(view|function)/i);
  });
  test("la llave es la misma al generar y al cotizar", () => {
    const g = claveComposicion({ ...origenClaveDeFila(7, null, null), hotelId: 1, categoria: "Estándar", regimen: "PC", fechaIda: "2030-01-05", noches: 3 });
    const c = claveComposicion({ ...origenDeClave({ tipo: "bloqueo", id: 7 }), hotelId: 1, categoria: "Estándar", regimen: "PC", fechaIda: "2030-01-05", noches: 3 });
    assert.equal(g, c);
    assert.notEqual(g, claveComposicion({ ...origenDeClave({ tipo: "empaquetado", id: 7 }), hotelId: 1, categoria: "Estándar", regimen: "PC", fechaIda: "2030-01-05", noches: 3 }));
  });
  test("lectura estricta de lo guardado: lo ilegible o con importes inválidos se rechaza", () => {
    const ok = { pctMk: 0.2, impuesto: 0, vuelo: 10, vueloNeto: 8, feeInfante: 1, servicios: [{ nombre: "S", neto: 1, netoMenor: 1 }], netos: { doble: 100 }, pvps: { doble: { pvp: 200, pvpMenor2: null } } };
    assert.ok(leerBaseGuardada(ok));
    assert.equal(leerBaseGuardada({ ...ok, netos: { doble: "x" } }), null);
    assert.equal(leerBaseGuardada({ ...ok, servicios: [{ nombre: "S", neto: null, netoMenor: 1 }] }), null);
    assert.equal(leerBaseGuardada({ ...ok, pvps: { doble: { pvp: NaN, pvpMenor2: null } } }), null);
    assert.equal(leerBaseGuardada(null), null);
  });
  test("el generador guarda la composición antes de publicar y solo en estadías exactas", () => {
    const g = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
    assert.match(g, /guardarComposicionesTarifario\(adminComp/);
    assert.ok(g.indexOf("guardarComposicionesTarifario(adminComp") < g.indexOf('cron.etapa("publicar")'));
    assert.match(g, /const componer = !masBarato && serviciosCuadran;/);
  });
});
