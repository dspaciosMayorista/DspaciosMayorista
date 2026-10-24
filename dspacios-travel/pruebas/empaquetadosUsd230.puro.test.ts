import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aCop63,
  copiarDeFuente63,
  evaluarFuenteVinculada63,
  feeACop63,
  fuenteCoincideConSalida63,
  monedaValida63,
} from "../lib/reservar/ofertaDinamica63.ts";
import { camposSospechososUsd, mensajeValorSospechoso, PREGUNTA_VALOR_USD } from "../lib/vuelos/monedaSospechosa.ts";
import { resolverOfertaSalida63 } from "../lib/reservar/prepararOferta63.ts";
import { camposCxP63, sumaEquivalentesCop63 } from "../lib/reservar/payloadFinanciero63.ts";
import { equivalenteCop63, validarObligacion63 } from "../lib/reservar/importeObligacion63.ts";

// #90 / migración 230 — Empaquetados (y sus salidas vinculadas) en USD: piezas PURAS.

const HOY = "2026-10-22";
const fuente = (o: Record<string, unknown> = {}) => ({
  id: 5, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: "2027-02-10", fecha_regreso: "2027-02-14",
  ruta: "MDE - SDQ - MDE", aerolinea: "WINGO", moneda: "USD", tarifa_proveedor: 380, tarifa_para_empaquetar: 415, fee_infante: 45, ...o,
});

describe("elegibilidad de la fuente: COP o USD", () => {
  test("una fuente en USD es elegible (antes se rechazaba con 'moneda_no_soportada')", () => {
    assert.equal(evaluarFuenteVinculada63(fuente(), HOY).ok, true);
    assert.equal(evaluarFuenteVinculada63(fuente({ moneda: "COP", tarifa_para_empaquetar: 1_328_000 }), HOY).ok, true);
  });
  for (const m of ["EUR", "", null, undefined, "usd"]) {
    test(`moneda ${JSON.stringify(m)} NO se infiere como COP: se rechaza`, () => {
      const r = evaluarFuenteVinculada63(fuente({ moneda: m }), HOY);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "moneda_no_soportada");
    });
  }
  test("monedaValida63 solo acepta COP y USD exactos", () => {
    assert.equal(monedaValida63("COP"), true);
    assert.equal(monedaValida63("USD"), true);
    assert.equal(monedaValida63("usd"), false);
    assert.equal(monedaValida63(null), false);
  });
});

describe("copia de la salida desde la fuente", () => {
  test("la salida vinculada copia la moneda USD de su fuente, con R y F tal cual y sin markup ni TA", () => {
    const c = copiarDeFuente63(fuente());
    assert.equal(c.moneda, "USD");
    assert.equal(c.valor_tiquete, 415);
    assert.equal(c.fee_infante, 45);
    assert.equal(c.aplica_mk, false);
    assert.equal(c.ta, 0);
  });
  test("una fuente en COP sigue copiándose en COP (compatibilidad con la 227)", () => {
    assert.equal(copiarDeFuente63(fuente({ moneda: "COP", tarifa_para_empaquetar: 1_328_000, fee_infante: 144_000 })).moneda, "COP");
  });
  test("coincidencia: una moneda distinta entre la salida y su fuente pide actualizar ('moneda')", () => {
    const f = fuente();
    const copia = { ...copiarDeFuente63(f), empaquetado_id: 5 };
    assert.equal(fuenteCoincideConSalida63(copia, f).ok, true);
    const r = fuenteCoincideConSalida63({ ...copia, moneda: "COP" }, f);
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.campos, ["moneda"]);
  });
  test("coincidencia: si la salida no trae el dato de moneda (lectura antigua) no se compara", () => {
    const f = fuente();
    const { moneda, ...sinMoneda } = { ...copiarDeFuente63(f), empaquetado_id: 5 };
    void moneda;
    assert.equal(fuenteCoincideConSalida63(sinMoneda, f).ok, true);
  });
});

describe("conversión del tiquete y del fee (una sola vez × TRM)", () => {
  test("415 USD × 3.200 = 1.328.000 y fee 45 USD = 144.000 (centavos exactos)", () => {
    assert.equal(aCop63(415, "USD", 3200), 1_328_000);
    assert.equal(feeACop63(45, "USD", 3200), 144_000);
  });
  test("TRM con decimales: el fee conserva los centavos, R se redondea solo al final en el PVP", () => {
    assert.equal(feeACop63(45, "USD", 3717.55), 167_289.75);
    assert.equal(aCop63(415, "USD", 3717.55), 415 * 3717.55);
  });
  test("COP no se convierte nunca", () => {
    assert.equal(aCop63(1_328_000, "COP", 3200), 1_328_000);
  });
});

describe("regla del dueño: tiquete en COP con valor menor a 1.000 es USD", () => {
  const campos = (a: number, b: number, c: number) => [
    { etiqueta: "La tarifa proveedor/sistema", valor: a },
    { etiqueta: "La tarifa para empaquetar", valor: b },
    { etiqueta: "El fee de infante", valor: c },
  ];
  test("COP con 380/415/45 → los tres son sospechosos", () => {
    assert.deepEqual(camposSospechososUsd("COP", campos(380, 415, 45)), ["La tarifa proveedor/sistema", "La tarifa para empaquetar", "El fee de infante"]);
  });
  test("USD nunca es sospechoso, ni COP con 0 (fee sin cargo) ni con valores >= 1.000", () => {
    assert.deepEqual(camposSospechososUsd("USD", campos(380, 415, 45)), []);
    assert.deepEqual(camposSospechososUsd("COP", campos(200_000, 242_022, 0)), []);
    assert.deepEqual(camposSospechososUsd("COP", campos(1000, 1000, 1000)), [], "1.000 exacto ya no es 'menor a mil'");
  });
  test("999 en COP sí es sospechoso; cadenas vacías/NaN no", () => {
    assert.deepEqual(camposSospechososUsd("COP", [{ etiqueta: "x", valor: 999 }]), ["x"]);
    assert.deepEqual(camposSospechososUsd("COP", [{ etiqueta: "x", valor: "" }, { etiqueta: "y", valor: Number.NaN }]), []);
  });
  test("el mensaje arranca con la pregunta del dueño y nombra los campos", () => {
    const m = mensajeValorSospechoso(["La tarifa para empaquetar"]);
    assert.ok(m.startsWith(PREGUNTA_VALOR_USD));
    assert.match(m, /tarifa para empaquetar/);
  });
});

// ── resolverOfertaSalida63 con un lector falso ─────────────────────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
function lector(tablas: Record<string, Fila[]>) {
  return {
    from(tabla: string) {
      const filtros: ((r: Fila) => boolean)[] = [];
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; };
      b.in = (c: string, v: unknown[]) => { filtros.push((r) => v.includes(r[c])); return b; };
      b.maybeSingle = () => Promise.resolve({ data: (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r)))[0] ?? null, error: null });
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }).then(res, rej);
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}
const paquete = (o: Fila = {}) => ({ id: 70, modo_oferta: "cop_trm_63", trm_oferta: 3200, impuesto_tipo: "tiquete", impuesto_fijo: 0, tarifario_generacion_publicada: 3, tarifario_revision_publicada: 5, destino_id: 1, destinos_aereos_alternativos: false, tipo: "dinamico", ...o });
const salida = (o: Fila = {}) => ({
  id: 11, paquete_id: 70, empaquetado_id: 5, moneda: "USD", fecha_ida: "2099-02-10", fecha_regreso: "2099-02-14", ruta: "MDE - SDQ - MDE", aerolinea: "WINGO", valor_tiquete: 415, fee_infante: 45, ...o,
});
const fuenteViva = (o: Fila = {}) => fuente({ fecha_ida: "2099-02-10", fecha_regreso: "2099-02-14", destino_id: 1, ...o });

describe("resolverOfertaSalida63: R y F de una vinculada en USD salen convertidos y con la moneda de origen", () => {
  test("vinculada USD: R = 415 × TRM, F = 45 × TRM, monedaAereo USD", async () => {
    const r = await resolverOfertaSalida63(lector({ armado_paquetes: [paquete()], salidas_dinamicas: [salida()], empaquetados: [fuenteViva()], destinos: [{ id: 1, nombre: "SANTO DOMINGO", pais: "República Dominicana", activo: true }], armado_paquete_destinos_aereos: [] }) as never, 70, 11);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (r.ok && r.oferta) {
      assert.equal(r.oferta.tarifaParaEmpaquetar, 1_328_000);
      assert.equal(r.oferta.feeInfante, 144_000);
      assert.equal(r.oferta.monedaAereo, "USD");
      assert.equal(r.oferta.vinculada, true);
    }
  });
  test("vinculada COP: R tal cual y monedaAereo COP (compatibilidad con la 227)", async () => {
    const r = await resolverOfertaSalida63(lector({
      armado_paquetes: [paquete()], salidas_dinamicas: [salida({ moneda: "COP", valor_tiquete: 1_130_000, fee_infante: 80_500 })],
      empaquetados: [fuenteViva({ moneda: "COP", tarifa_para_empaquetar: 1_130_000, fee_infante: 80_500 })], destinos: [{ id: 1, nombre: "X", pais: "Colombia", activo: true }], armado_paquete_destinos_aereos: [],
    }) as never, 70, 11);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (r.ok && r.oferta) {
      assert.equal(r.oferta.tarifaParaEmpaquetar, 1_130_000);
      assert.equal(r.oferta.feeInfante, 80_500);
      assert.equal(r.oferta.monedaAereo, "COP");
    }
  });
  test("la salida en COP con la fuente en USD se rechaza pidiendo actualizar", async () => {
    const r = await resolverOfertaSalida63(lector({ armado_paquetes: [paquete()], salidas_dinamicas: [salida({ moneda: "COP" })], empaquetados: [fuenteViva()], destinos: [{ id: 1, nombre: "X", pais: "R", activo: true }], armado_paquete_destinos_aereos: [] }) as never, 70, 11);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /moneda/);
  });
  test("salida MANUAL en USD: convertida y monedaAereo USD", async () => {
    const r = await resolverOfertaSalida63(lector({ armado_paquetes: [paquete()], salidas_dinamicas: [salida({ empaquetado_id: null, valor_tiquete: 100, fee_infante: 25 })] }) as never, 70, 11);
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    if (r.ok && r.oferta) {
      assert.equal(r.oferta.tarifaParaEmpaquetar, 320_000);
      assert.equal(r.oferta.feeInfante, 80_000);
      assert.equal(r.oferta.monedaAereo, "USD");
    }
  });
});

describe("obligación aérea: moneda de origen USD con su equivalente COP (valor_cop_63 / trm_63)", () => {
  test("campos de la CxP: (2 × 380 + 45) USD a 3.200 = 2.576.000 COP", () => {
    const c = camposCxP63({ valor: 2 * 380 + 45, moneda: "USD" }, 3200);
    assert.deepEqual(c, { moneda: "USD", valor_cop: 2_576_000, trm: 3200 });
    assert.equal(validarObligacion63({ moneda: "USD", valor_total: 805, valor_cop: c.valor_cop, trm: 3200 }).ok, true);
  });
  test("el costo del contrato (COP) es la suma de los equivalentes y coincide con la CxP", () => {
    assert.equal(equivalenteCop63(805, "USD", 3200), 2_576_000);
    assert.equal(sumaEquivalentesCop63([{ valor: 805, moneda: "USD" }, { valor: 1_000_000, moneda: "COP" }], 3200), 3_576_000);
  });
  test("una obligación COP sigue igual (valor_cop = valor)", () => {
    assert.deepEqual(camposCxP63({ valor: 2_080_500, moneda: "COP" }, 3200), { moneda: "COP", valor_cop: 2_080_500, trm: 3200 });
  });
});

describe("la migración 230 (texto): lo que debe contener y lo que NO debe tocar", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260601000230_empaquetados_usd.sql", import.meta.url), "utf8");
  test("amplía los CHECK a COP/USD y exige la misma moneda en la salida vinculada", () => {
    assert.match(sql, /empaquetados_moneda_chk check \(moneda in \('COP', 'USD'\)\)/);
    assert.match(sql, /salidas_dinamicas_vinculada_chk check \(empaquetado_id is null or \(aplica_mk = false and ta = 0\)\)/);
    assert.match(sql, /salida_vinculada_moneda/);
    assert.match(sql, /before insert or update of empaquetado_id, paquete_id, moneda on public\.salidas_dinamicas/);
  });
  test("la moneda de un empaquetado invalida el tarifario (226) y el contador de costos de #63", () => {
    assert.match(sql, /update of activo, compra_inicio, compra_fin, tarifa_para_empaquetar, fee_infante, fecha_ida, fecha_regreso, ruta, moneda\s+on public\.empaquetados/);
    assert.match(sql, /after update of proveedor_id, tarifa_proveedor, moneda on public\.empaquetados/);
  });
  test("aceptar_oferta_63 acepta USD y compara la moneda de la salida; ya no exige COP", () => {
    assert.match(sql, /v_e\.moneda not in \('COP', 'USD'\)/);
    assert.match(sql, /v_s\.moneda is distinct from v_e\.moneda/);
    assert.doesNotMatch(sql, /v_e\.moneda is distinct from 'COP'/);
  });
  test("no toca el publicador, la cotización ni la RPC financiera, ni datos", () => {
    assert.doesNotMatch(sql, /create or replace function public\.(publicar_tarifario_resultado|crear_cotizacion_oferta_63|p63_registrar_financiero|registrar_financiero_contrato)/);
    // (aceptar_oferta_63 conserva sus propios INSERT/UPDATE de p63_*; lo que NO hace la migración es escribir datos de vuelos/paquetes/contratos.)
    assert.doesNotMatch(sql, /(insert into|delete from)\s+public\.(empaquetados|salidas_dinamicas|armado_|tarifario_resultado|bloqueos_vuelo|ventas|cuentas_por_pagar)/i);
    assert.doesNotMatch(sql, /update public\.(empaquetados|salidas_dinamicas)\s+set/i, "la corrección de datos va en un script aparte");
  });
});
