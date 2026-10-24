import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aCop63, aporteVueloVinculada63, configAereaVinculadaValida63, copiarDeFuente63, esModo63, evaluarFuenteVinculada63,
  feeACop63, fuenteCoincideConSalida63, huellaOferta63, impuestoPorPersona63, impuestoTotal63, normalizarModoOferta,
  recordAusente63, redondearCentavos63, validarTrm63, MODO_OFERTA_63, type FuenteEmpaquetado63,
} from "../lib/reservar/ofertaDinamica63.ts";
import { equivalenteCop63, validarObligacion63 } from "../lib/reservar/importeObligacion63.ts";
import { camposCxP63, sumaEquivalentesCop63 } from "../lib/reservar/payloadFinanciero63.ts";
import { aporteVuelo, componerTarifa, marcar, precioMenorDeDos, redondearVenta } from "../lib/calc/paquetes.ts";
import { descripcionLineaMenor, tarifarMenores, contarMenoresDeDos } from "../lib/reservar/menoresDeDos.ts";

// #63 — reglas PURAS del modo COP con TRM y de la salida vinculada a Empaquetados sin record. Los vectores FX1–FX3 son los
// del contrato (re-base 2 sobre 3cfe731c) y se calculan con el MOTOR REAL (`marcar`, `componerTarifa`, `precioMenorDeDos`),
// no con aritmética reescrita: si el motor o los helpers cambian, estas pruebas lo ven.

const MK = 0.2;
const R = 1_130_000; // tarifa_para_empaquetar (precio final del aéreo)
const F = 80_500;    // fee de infante

/** Aporte de hotel/servicio en COP: neto (en su moneda) × TRM, y luego el markup — el orden del contrato. */
const aporte = (neto: number, moneda: string, trm: number) => marcar(aCop63(neto, moneda, trm), MK);

describe("TRM del modo 63: positiva, persistida, sin valor por defecto", () => {
  test("acepta un número finito > 0 (número o texto numérico)", () => {
    assert.deepEqual(validarTrm63(4000), { ok: true, trm: 4000 });
    assert.deepEqual(validarTrm63(3987.65), { ok: true, trm: 3987.65 });
    assert.deepEqual(validarTrm63("4010.5"), { ok: true, trm: 4010.5 });
  });
  for (const malo of [null, undefined, "", "  ", 0, -1, "-4000", Number.NaN, Number.POSITIVE_INFINITY, "abc", true, false]) {
    test(`rechaza ${JSON.stringify(malo)} (nunca cae a 1 ni a una TRM de referencia)`, () => {
      const r = validarTrm63(malo);
      assert.equal(r.ok, false);
    });
  }
  test("el modo solo es 63 si dice exactamente cop_trm_63; cualquier otra cosa es el de siempre", () => {
    assert.equal(normalizarModoOferta("cop_trm_63"), "cop_trm_63");
    for (const v of ["legacy", "", null, undefined, "COP_TRM_63", "cop"]) assert.equal(normalizarModoOferta(v), "legacy");
    assert.equal(esModo63("cop_trm_63"), true);
    assert.equal(esModo63("legacy"), false);
  });
});

describe("conversión a COP y fee exacto (R1)", () => {
  test("USD × TRM sin redondear; COP tal cual", () => {
    assert.equal(aCop63(100, "USD", 4000), 400_000);
    assert.equal(aCop63(100_000, "COP", 4000), 100_000);
    assert.equal(aCop63(100, undefined, 4000), 100, "sin moneda = COP");
    assert.equal(aCop63(103.5, "USD", 3987.65), 412_721.775);
  });
  test("R1 · el fee de una salida manual USD se convierte con la TRM del paquete y CONSERVA los centavos", () => {
    assert.equal(feeACop63(25, "USD", 3987.65), 99_691.25);
    assert.notEqual(feeACop63(25, "USD", 3987.65), 99_691, "no se redondea al peso");
    assert.notEqual(feeACop63(25, "USD", 3987.65), 100_000, "ni al mil");
  });
  test("el fee de una fuente COP queda exacto y un fee en cero o negativo es 0", () => {
    assert.equal(feeACop63(80_500, "COP", 4000), 80_500);
    assert.equal(feeACop63(0, "USD", 4000), 0);
    assert.equal(feeACop63(-5, "COP", 4000), 0);
    assert.equal(feeACop63(Number.NaN, "COP", 4000), 0);
  });
  test("redondeo a centavos sin el error de coma flotante", () => {
    assert.equal(redondearCentavos63(1.005), 1.01);
    assert.equal(redondearCentavos63(99_691.25000000001), 99_691.25);
    assert.equal(redondearCentavos63(2.675), 2.68);
    assert.equal(redondearCentavos63(10), 10);
  });
});

describe("FX1 · modo cop_trm_63, TRM 4.000, MK 20 %, 2 adultos + 1 menor de 1 año", () => {
  const TRM = 4000;
  const hotelAdulto = aporte(100, "USD", TRM);   // 400.000 → 500.000
  const hotelInfante = aporte(10, "USD", TRM);   // 40.000 → 50.000
  const tourAdulto = aporte(10, "USD", TRM);     // 40.000 → 50.000

  test("los aportes salen del neto convertido ANTES del markup", () => {
    assert.equal(hotelAdulto, 500_000);
    assert.equal(hotelInfante, 50_000);
    assert.equal(tourAdulto, 50_000);
  });

  const adulto = componerTarifa({ aporteHotel: hotelAdulto, aporteServicios: tourAdulto, aporteVuelo: aporteVueloVinculada63(R), impuesto: R, moneda: "COP" });
  test("adulto = techo(500.000 + 50.000 + R) = 1.680.000; 2 adultos = 3.360.000", () => {
    assert.equal(adulto.pvp, 1_680_000);
    assert.equal(adulto.pvp * 2, 3_360_000);
  });

  const casos: [string, number, number][] = [
    ["tour de infante USD 0 (gratis)", 0, 130_500],
    ["tour sin precio de infante (paga como adulto)", 10, 180_500],
    ["tour de infante USD 5", 5, 155_500],
  ];
  for (const [nombre, netoTourInfanteUsd, esperado] of casos) {
    test(`infante de 1 año con ${nombre}: ${esperado}`, () => {
      const infante = precioMenorDeDos({ aporteHotel: hotelInfante, aporteServiciosMenor: aporte(netoTourInfanteUsd, "USD", TRM), feeInfante: F, moneda: "COP" });
      assert.equal(infante, esperado);
      assert.equal(adulto.pvp * 2 + infante, 3_360_000 + esperado);
    });
  }

  test("variantes de hotel: sin hotel de infante = solo F; F = 0 y sin hotel = 0; hotel USD 10,075 redondea solo la parte de hotel", () => {
    assert.equal(precioMenorDeDos({ aporteHotel: 0, aporteServiciosMenor: 0, feeInfante: F, moneda: "COP" }), 80_500);
    assert.equal(precioMenorDeDos({ aporteHotel: 0, aporteServiciosMenor: 0, feeInfante: 0, moneda: "COP" }), 0);
    assert.equal(precioMenorDeDos({ aporteHotel: aporte(10.075, "USD", TRM), aporteServiciosMenor: 0, feeInfante: F, moneda: "COP" }), 131_500);
  });

  test("niño de 2 años (adulto en vuelo y servicios): 1.230.000, ocupa silla; total 4.590.000", () => {
    const nino2 = componerTarifa({ aporteHotel: hotelInfante, aporteServicios: tourAdulto, aporteVuelo: aporteVueloVinculada63(R), impuesto: R, moneda: "COP" }).pvp;
    assert.equal(nino2, 1_230_000);
    assert.equal(adulto.pvp * 2 + nino2, 4_590_000);
  });

  test("MUST FAIL (guardas contra el defecto): F dos veces, R en la fila infante, MK sobre R, doble o ninguna conversión de TRM", () => {
    const infanteBien = precioMenorDeDos({ aporteHotel: hotelInfante, aporteServiciosMenor: 0, feeInfante: F, moneda: "COP" });
    assert.notEqual(infanteBien, 211_000, "F cobrado dos veces");
    assert.notEqual(infanteBien, 1_230_000, "R en la fila de infante");
    const conMkSobreR = componerTarifa({ aporteHotel: hotelAdulto, aporteServicios: tourAdulto, aporteVuelo: aporteVuelo(R, true, MK, 0), impuesto: R, moneda: "COP" }).pvp;
    assert.equal(conMkSobreR, 1_963_000);
    assert.notEqual(adulto.pvp, conMkSobreR, "MK sobre R (R/0,8)");
    const sinTrm = componerTarifa({ aporteHotel: marcar(100, MK), aporteServicios: marcar(10, MK), aporteVuelo: R, impuesto: R, moneda: "COP" }).pvp;
    assert.notEqual(adulto.pvp, sinTrm, "sin convertir la TRM");
    const dobleTrm = componerTarifa({ aporteHotel: marcar(100 * TRM * TRM, MK), aporteServicios: tourAdulto, aporteVuelo: R, impuesto: R, moneda: "COP" }).pvp;
    assert.notEqual(adulto.pvp, dobleTrm, "TRM aplicada dos veces");
  });

  test("BNC: el infante de 1 año no genera BNC; tiquete = R × pax con silla; fijo = importe × pax con silla", () => {
    const total = adulto.pvp * 2 + 130_500;
    const tiquete2 = impuestoTotal63({ impuestoPorPersona: impuestoPorPersona63({ tipo: "tiquete", tarifaParaEmpaquetar: R, fijo: 100_000 }), paxConSilla: 2 });
    assert.equal(tiquete2, 2_260_000);
    assert.equal(total - tiquete2, 1_230_500);
    const fijo2 = impuestoTotal63({ impuestoPorPersona: impuestoPorPersona63({ tipo: "fijo", tarifaParaEmpaquetar: R, fijo: 100_000 }), paxConSilla: 2 });
    assert.equal(fijo2, 200_000);
    assert.equal(total - fijo2, 3_290_500);
    // con el niño de 2 años (3 pax con silla)
    const total3 = adulto.pvp * 2 + 1_230_000;
    const tiquete3 = impuestoTotal63({ impuestoPorPersona: R, paxConSilla: 3 });
    assert.equal(tiquete3, 3_390_000);
    assert.equal(total3 - tiquete3, 1_200_000);
    assert.equal(total3 - impuestoTotal63({ impuestoPorPersona: 100_000, paxConSilla: 3 }), 4_290_000);
  });

  test("una vinculada con impuesto_tipo = tiquete NO cae al fijo (el defecto que el código anterior tendría)", () => {
    assert.equal(impuestoPorPersona63({ tipo: "tiquete", tarifaParaEmpaquetar: R, fijo: 0 }), R);
    assert.equal(impuestoPorPersona63({ tipo: "fijo", tarifaParaEmpaquetar: R, fijo: 0 }), 0);
  });
});

describe("FX2 · COP puro: el redondeo cae UNA vez sobre el total", () => {
  test("hotel neto 413.700 → 517.125; adulto = techo(517.125 + R) = 1.648.000; infante 20.000 → 25.000 + F = 105.500", () => {
    const adulto = componerTarifa({ aporteHotel: aporte(413_700, "COP", 4000), aporteServicios: 0, aporteVuelo: R, impuesto: R, moneda: "COP" }).pvp;
    assert.equal(adulto, 1_648_000);
    const infante = precioMenorDeDos({ aporteHotel: aporte(20_000, "COP", 4000), aporteServiciosMenor: 0, feeInfante: F, moneda: "COP" });
    assert.equal(infante, 105_500);
    const total = adulto * 2 + infante;
    assert.equal(total, 3_401_500);
    assert.equal(total - 2_260_000, 1_141_500);
    assert.equal(total - 200_000, 3_201_500);
  });
  test("una vinculada con TA o con markup es doble margen: la configuración no es válida (el CHECK de la base lo repite)", () => {
    assert.equal(configAereaVinculadaValida63({ aplica_mk: false, ta: 0 }), true);
    assert.equal(configAereaVinculadaValida63({ aplica_mk: true, ta: 0 }), false);
    assert.equal(configAereaVinculadaValida63({ aplica_mk: false, ta: 50_000 }), false);
    const dobleMargen = componerTarifa({ aporteHotel: aporte(413_700, "COP", 4000), aporteServicios: 0, aporteVuelo: aporteVuelo(R, false, MK, 50_000), impuesto: R, moneda: "COP" }).pvp;
    assert.equal(dobleMargen, 1_698_000);
  });
});

describe("FX3 · USD con TRM no redonda, y la salida MANUAL en USD (R1)", () => {
  const TRM = 3987.65;
  test("adulto 1.646.000 · infante 52.000 + F = 132.500", () => {
    assert.equal(componerTarifa({ aporteHotel: aporte(103.5, "USD", TRM), aporteServicios: 0, aporteVuelo: R, impuesto: R, moneda: "COP" }).pvp, 1_646_000);
    assert.equal(precioMenorDeDos({ aporteHotel: aporte(10.35, "USD", TRM), aporteServiciosMenor: 0, feeInfante: F, moneda: "COP" }), 132_500);
  });
  test("cambiar la TRM a 4.010 mueve el adulto a 1.649.000 (la TRM entra por el neto)", () => {
    assert.equal(componerTarifa({ aporteHotel: aporte(103.5, "USD", 4010), aporteServicios: 0, aporteVuelo: R, impuesto: R, moneda: "COP" }).pvp, 1_649_000);
  });
  test("salida manual con fee USD 25: F = 99.691,25 y el infante cuesta 52.000 + 99.691,25 = 151.691,25 (centavos exactos)", () => {
    const fee = feeACop63(25, "USD", TRM);
    assert.equal(fee, 99_691.25);
    assert.equal(precioMenorDeDos({ aporteHotel: aporte(10.35, "USD", TRM), aporteServiciosMenor: 0, feeInfante: fee, moneda: "COP" }), 151_691.25);
  });
});

describe("R2 · los rótulos de menores son LOS DE LA 226, sin variantes (menoresDeDos.ts no se edita)", () => {
  test("Infante · …, Infante (2 años) · … y Niño 1 (menor de 2 años) · …", () => {
    assert.equal(descripcionLineaMenor({ clase: "infante", menorDeDos: true }, "Estándar", "PAE"), "Infante · Estándar / PAE");
    assert.equal(descripcionLineaMenor({ clase: "infante", menorDeDos: false }, "Estándar", "PAE"), "Infante (2 años) · Estándar / PAE");
    assert.equal(descripcionLineaMenor({ clase: "nino", menorDeDos: true }, "Estándar", "PAE"), "Niño 1 (menor de 2 años) · Estándar / PAE");
  });
  test("la vinculada usa el conteo y la tarifa de menores de la 226 tal cual (un menor de 2 años no ocupa silla)", () => {
    const m2 = contarMenoresDeDos([30, 30, 1], 2, { infante: 1, nino: 0, nino2: 0 });
    assert.deepEqual(m2, { infante: 1, nino: 0, nino2: 0 });
    const t = tarifarMenores({ totales: { infante: 1, nino: 0, nino2: 0 }, menoresDeDos: m2, pvp: { infante: 1_230_000 }, pvpMenor2: { infante: 130_500 } });
    assert.equal(t.ok, true);
    if (t.ok) { assert.equal(t.total, 130_500); assert.equal(t.paxConSilla, 0); assert.equal(t.menoresDeDos, 1); }
  });
});

describe("elegibilidad de la fuente: Empaquetado SIN record", () => {
  const HOY = "2026-10-22";
  const fuente = (o: Partial<FuenteEmpaquetado63> = {}): FuenteEmpaquetado63 => ({
    id: 5, activo: true, record: null, compra_inicio: null, compra_fin: null, fecha_ida: "2026-11-20", fecha_regreso: "2026-11-23",
    ruta: "BOG - CTG - BOG", aerolinea: "JetSMART", moneda: "COP", tarifa_proveedor: 1_000_000, tarifa_para_empaquetar: R, fee_infante: F, ...o,
  });
  test("PNR ausente = null o vacío tras recortar; cualquier texto (incluso PROMOCION) ES un record", () => {
    for (const v of [null, undefined, "", "   "]) assert.equal(recordAusente63(v), true);
    for (const v of ["ABC123", "PROMOCION", " x "]) assert.equal(recordAusente63(v), false);
  });
  test("elegible: activa, sin record, ventana abierta, viaje futuro, COP, con tarifa", () => {
    assert.equal(evaluarFuenteVinculada63(fuente(), HOY).ok, true);
    assert.equal(evaluarFuenteVinculada63(fuente({ record: "  " }), HOY).ok, true);
  });
  const rechazos: [string, Partial<FuenteEmpaquetado63> | null, string][] = [
    ["inexistente", null, "no_existe"],
    ["inactiva", { activo: false }, "inactiva"],
    ["activo null (fallo cerrado)", { activo: null }, "inactiva"],
    ["con record", { record: "L93FYZ" }, "con_record"],
    ["con texto en el record", { record: "PROMOCION" }, "con_record"],
    ["sin fechas", { fecha_regreso: null }, "sin_fechas"],
    ["compra aún no inicia", { compra_inicio: "2026-10-23" }, "compra_no_iniciada"],
    ["compra vencida", { compra_fin: "2026-10-21" }, "compra_vencida"],
    ["viaje pasado", { fecha_ida: "2026-10-21", fecha_regreso: "2026-10-24" }, "viaje_pasado"],
    // 230: USD ya es una moneda válida de la fuente; lo no soportado es cualquier otra (o ninguna).
    ["moneda EUR (no soportada)", { moneda: "EUR" }, "moneda_no_soportada"],
    ["sin tarifa para empaquetar", { tarifa_para_empaquetar: 0 }, "sin_tarifa"],
  ];
  for (const [nombre, over, motivo] of rechazos) {
    test(`rechaza: ${nombre}`, () => {
      const r = evaluarFuenteVinculada63(over === null ? null : fuente(over), HOY);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, motivo);
    });
  }
  test("límites inclusivos: compra_inicio = hoy, compra_fin = hoy y viaje que sale hoy son elegibles", () => {
    assert.equal(evaluarFuenteVinculada63(fuente({ compra_inicio: HOY, compra_fin: HOY, fecha_ida: HOY }), HOY).ok, true);
  });
  test("la copia de la salida debe coincidir con la fuente VIVA; si cambió, se pide actualizar (nunca se cobra con la copia vieja)", () => {
    const f = fuente();
    const copia = copiarDeFuente63(f);
    assert.equal(copia.aplica_mk, false);
    assert.equal(copia.ta, 0);
    assert.equal(copia.moneda, "COP");
    assert.equal(copia.valor_tiquete, R);
    assert.equal(copia.fee_infante, F);
    assert.deepEqual(fuenteCoincideConSalida63({ ...copia, empaquetado_id: 5 }, f), { ok: true });
    const cambiada = fuenteCoincideConSalida63({ ...copia }, fuente({ tarifa_para_empaquetar: 1_200_000, fee_infante: 90_000, ruta: "MDE - CTG - MDE" }));
    assert.equal(cambiada.ok, false);
    if (!cambiada.ok) assert.deepEqual(cambiada.campos.sort(), ["fee de infante", "ruta", "tarifa para empaquetar"]);
  });
  test("aporte del aéreo de una vinculada = R tal cual; R inválido = 0", () => {
    assert.equal(aporteVueloVinculada63(R), R);
    assert.equal(aporteVueloVinculada63(-1), 0);
    assert.equal(aporteVueloVinculada63(Number.NaN), 0);
  });
});

describe("huella de la oferta (cotización → aceptación)", () => {
  const base = {
    paqueteId: 70, salidaId: 11, modo: MODO_OFERTA_63, trm: 4000, generacion: 3, revisionFuente: 5, precioVenta: 3_490_500, moneda: "COP",
    tarifaParaEmpaquetar: R, feeInfante: F, fechaIda: "2026-11-20", fechaRegreso: "2026-11-23",
  } as const;
  test("es determinista y cambia con cualquier dato que el cliente vio", () => {
    const h = huellaOferta63({ ...base });
    assert.equal(h, huellaOferta63({ ...base }));
    assert.match(h, /^[0-9a-f]{64}$/);
    for (const cambio of [
      { precioVenta: 3_491_500 }, { trm: 4010 }, { generacion: 4 }, { revisionFuente: 6 }, { tarifaParaEmpaquetar: 1_200_000 },
      { feeInfante: 90_000 }, { fechaIda: "2026-11-21" }, { salidaId: 12 }, { moneda: "USD" },
    ]) {
      assert.notEqual(huellaOferta63({ ...base, ...cambio }), h, JSON.stringify(cambio));
    }
  });
  test("el costo N (tarifa_proveedor) NO entra a la huella: un dato extra con el costo no la altera ni se puede leer de ella", () => {
    const h = huellaOferta63({ ...base });
    const conCosto = { ...base, tarifa_proveedor: 1_000_000 } as unknown as Parameters<typeof huellaOferta63>[0];
    assert.equal(huellaOferta63(conCosto), h, "la huella ignora cualquier campo de costo");
  });
});

describe("obligaciones (CxP) del modo 63: moneda de origen + equivalente COP congelado", () => {
  const TRM = 4000;
  test("equivalente = valor × TRM con centavos; COP no se toca", () => {
    assert.equal(equivalenteCop63(210, "USD", TRM), 840_000);
    assert.equal(equivalenteCop63(2_080_500, "COP", TRM), 2_080_500);
    assert.equal(equivalenteCop63(25, "USD", 3987.65), 99_691.25);
  });
  test("costos FX1: hotel USD 210 = COP 840.000; tour USD 20/30/25 = COP 80.000/120.000/100.000", () => {
    assert.equal(sumaEquivalentesCop63([{ valor: 210, moneda: "USD" }], TRM), 840_000);
    for (const [usd, cop] of [[20, 80_000], [30, 120_000], [25, 100_000]] as const) assert.equal(sumaEquivalentesCop63([{ valor: usd, moneda: "USD" }], TRM), cop);
  });
  test("campos de la CxP: moneda de origen, equivalente y TRM", () => {
    assert.deepEqual(camposCxP63({ valor: 210, moneda: "USD" }, TRM), { moneda: "USD", valor_cop: 840_000, trm: 4000 });
    assert.deepEqual(camposCxP63({ valor: 2_080_500, moneda: "COP" }, TRM), { moneda: "COP", valor_cop: 2_080_500, trm: 4000 });
  });
  test("validarObligacion63 rechaza equivalente ausente, TRM inválida o incoherente (fallo cerrado antes de escribir)", () => {
    assert.equal(validarObligacion63({ moneda: "USD", valor_total: 210, valor_cop: 840_000, trm: 4000 }).ok, true);
    assert.equal(validarObligacion63({ moneda: "USD", valor_total: 210, valor_cop: null, trm: 4000 }).ok, false);
    assert.equal(validarObligacion63({ moneda: "USD", valor_total: 210, valor_cop: 210, trm: 4000 }).ok, false, "el nominal USD no es el equivalente");
    assert.equal(validarObligacion63({ moneda: "USD", valor_total: 210, valor_cop: 840_000, trm: null }).ok, false);
  });
  test("el redondeo de venta del motor sigue siendo al mil en COP (sin tocar el motor)", () => {
    assert.equal(redondearVenta(1_647_125, "COP"), 1_648_000);
  });
});
