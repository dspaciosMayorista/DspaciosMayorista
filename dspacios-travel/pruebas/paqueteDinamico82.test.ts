import test from "node:test";
import assert from "node:assert/strict";
import {
  agruparPorComponente, costosFaltantes, liquidarPaquete, totalPorPersona, validarPaquete, verificarCuadre,
  type PaqueteDin,
} from "../lib/paqueteDinamico/calculo.ts";

const cero = { nino: 0, nino2: 0, infante: 0 };
const base = (o: Partial<PaqueteDin>): PaqueteDin => ({
  esquema: "neta_markup", pvpModo: null, moneda: "COP", pctMk: 0.2, usaVuelo: true, usaHotel: true, usaServicios: true,
  vuelo: { neto: { adulto: 800000, nino: 600000, infante: 100000 }, pvp: { adulto: null, nino: null, infante: null } },
  hotel: { nombre: "Hotel X", neto: { sencilla: 1000000, doble: 700000, triple: 600000, multiple: 500000, nino: 300000, nino2: 200000, infante: 0 }, pvp: {} },
  servicios: [{ id: "s1", nombre: "Tour", neto: 100000, pvp: null }],
  ...o,
});
const comp = { habitaciones: { doble: 1 }, ninos: 1, ninos2: 0, infantes: 1 };

test("neta + markup: cada línea redondeada, total = suma, desglose cuadra", () => {
  const r = liquidarPaquete(base({}), comp);
  assert.equal(r.adultos, 2);
  assert.ok(verificarCuadre(r.lineas, r.total));
  // hotel doble: 700000/(0.8)=875000 ×2 ; vuelo adulto 1.000.000×2 ; tour 125000×3 (2 adultos+1 niño)
  const g = agruparPorComponente(r.lineas);
  assert.equal(g.find((l) => l.ref === "servicio:s1")!.valor, 375000);
  assert.equal(g.find((l) => l.ref === "vuelo")!.valor, 2 * 1000000 + 750000 + 125000);
  assert.equal(g.reduce((s, l) => s + l.valor, 0), r.total);
  // con neto conocido no se exige costo
  assert.deepEqual(costosFaltantes(g), []);
});

test("infante en 0 es gratis, no 'no cargado'", () => {
  const p = base({});
  assert.equal(totalPorPersona(p, "infante"), 125000 /* vuelo 100000/.8 */ + 0);
  const q = base({ hotel: { nombre: "H", neto: { sencilla: 1, doble: 1, triple: 1, multiple: 1, nino: 1, nino2: 1 }, pvp: {} } });
  assert.ok(validarPaquete(q).some((m) => /infante/.test(m)));
});

test("solo PVP por componente: no inventa costos y los exige", () => {
  const p = base({
    esquema: "solo_pvp", pvpModo: "por_componente",
    vuelo: { neto: { adulto: null, nino: null, infante: null }, pvp: { adulto: 900000, nino: 700000, infante: 0 } },
    hotel: { nombre: "H", neto: {}, pvp: { sencilla: 900000, doble: 800000, triple: 700000, multiple: 600000, nino: 300000, nino2: 200000, infante: 0 } },
    servicios: [{ id: "s1", nombre: "Tour", neto: null, pvp: 150000 }],
  });
  assert.deepEqual(validarPaquete(p), []);
  const r = liquidarPaquete(p, comp);
  const g = agruparPorComponente(r.lineas);
  assert.ok(g.every((l) => l.costoNeto === 0 && l.exigeCosto));
  assert.equal(costosFaltantes(g).length, 3);
  assert.ok(verificarCuadre(r.lineas, r.total));
  // con costos reales y proveedor ya no faltan
  const ok = g.map((l) => ({ ...l, costoNeto: 1000, proveedor: "P" }));
  assert.deepEqual(costosFaltantes(ok), []);
  assert.equal(costosFaltantes([{ ...g[0], costoNeto: 1000, proveedor: " " }]).length, 1);
});

test("solo PVP general: precio por acomodación y componentes con costo pendiente", () => {
  const p = base({ esquema: "solo_pvp", pvpModo: "general", pvpGeneral: { sencilla: 3e6, doble: 2.5e6, triple: 2e6, multiple: 1.8e6, nino: 1e6, nino2: 8e5, infante: 0 } });
  const r = liquidarPaquete(p, comp);
  assert.equal(r.total, 2 * 2.5e6 + 1e6 + 0);
  const g = agruparPorComponente(r.lineas);
  assert.equal(g.find((l) => l.ref === "paquete")!.valor, r.total);
  assert.equal(costosFaltantes(g).length, 3); // vuelo, hotel, tour
  assert.ok(verificarCuadre(g, r.total));
});

test("total declarado que no cuadra con el desglose se rechaza", () => {
  const p = base({
    esquema: "solo_pvp", pvpModo: "por_componente",
    vuelo: { neto: { adulto: null, nino: null, infante: null }, pvp: { adulto: 900000, nino: 700000, infante: 0 } },
    hotel: { nombre: "H", neto: {}, pvp: { sencilla: 900000, doble: 800000, triple: 700000, multiple: 600000, nino: 300000, nino2: 200000, infante: 0 } },
    servicios: [{ id: "s1", nombre: "Tour", neto: null, pvp: 150000 }],
    totalDeclarado: { doble: 1_850_000 },
  });
  assert.deepEqual(validarPaquete(p), []);            // 800000+900000+150000
  p.totalDeclarado = { doble: 1_900_000 };
  assert.ok(validarPaquete(p).some((m) => /no cuadra/.test(m)));
});

test("USD redondea al dólar entero y configuración inválida lanza", () => {
  const p = base({ moneda: "USD", hotel: { nombre: "H", neto: { sencilla: 101, doble: 101, triple: 101, multiple: 101, nino: 0, nino2: 0, infante: 0 }, pvp: {} }, usaVuelo: false, usaServicios: false });
  assert.equal(totalPorPersona(p, "doble"), 127); // 101/0.8=126.25 → 127
  assert.throws(() => liquidarPaquete(base({ pctMk: 1 }), comp));
  assert.throws(() => liquidarPaquete(base({}), { ...comp, habitaciones: {} }));
});
