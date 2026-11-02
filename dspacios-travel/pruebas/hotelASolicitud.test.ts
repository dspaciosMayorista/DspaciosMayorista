import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluarHotelPorFechas, type DatosHotelPaquete } from "../lib/reservar/liquidacionHotel.ts";
import {
  aplicarNetaSolicitud, contieneImportes, mismaEleccion, tarifaSinteticaPorTipo, toleranciaCentavos, validarNeta, validarReparto, TEXTO_BAJO_SOLICITUD, estaPendienteTarifa,
  type ConteosViajeros, type NetaSolicitud,
} from "../lib/reservar/solicitudHotel.ts";
import { evaluarOcupacionSolicitud, repartirAdultosReales, errorPlazasLibres } from "../lib/reservar/solicitudOcupacion.ts";
import { ajusteRedondeoReparto, repartoDeReferencia, DESCRIPCION_AJUSTE_REDONDEO } from "../lib/reservar/solicitudHotel.ts";
import { distribuirPorHabitaciones } from "../lib/reservar/distribucionHabitaciones.ts";
import { defaultAcomConfig, validarReservaHabitaciones } from "../lib/acomodaciones.ts";
import { cxpEnUsdConEquivalente, decidirTrmCosto } from "../lib/finanzas/costoTrmCarrito.ts";
import { claveSolicitudHotel, validarEntradaSolicitudHotel } from "../lib/reservar/solicitudHotelEntrada.ts";
import { aporteVuelo } from "../lib/calc/paquetes.ts";
import { paqueteVendibleHoy } from "../lib/tarifario/datosSolicitud.ts";

// #120 · Hotel a solicitud con la regla CONFIRMADA por el dueño: la neta es el TOTAL del hotel para toda la estadía; sin niños se carga a los adultos; con niños, «adultos»
// (niños $0) o «distribuir» (neta por adulto y por niño que suma la total); infantes SIEMPRE $0. La neta entra por el MISMO motor (evaluarHotelPorFechas) como tarifa sintética
// por tipo. Ejecución real (sin Supabase) para los TRES tipos de paquete: porción terrestre (sin vuelo), bloqueo (vuelo con markup) y empaquetado (vuelo con TA).

const HOY = "2026-01-01";
const IDA = "2026-09-01";
const REGRESO = "2026-09-04"; // 3 noches
const NETA_TOTAL = 1_200_000;
const CON_NINOS: ConteosViajeros = { adultos: 2, ninos: 1, infantes: 1 };
const SIN_NINOS: ConteosViajeros = { adultos: 2, ninos: 0, infantes: 0 };

/** Hotel SIN ninguna tarifa (ni temporada con precio): así llega un hotel bajo solicitud. */
function datosSinTarifa(pctMk = 0.2): DatosHotelPaquete {
  return {
    paquete: { pct_mk: pctMk, impuesto_fijo: 0, destino_nombre: "Cartagena", fecha_viaje_inicio: "2026-01-01", fecha_viaje_fin: "2026-12-31" },
    armadoHotel: { categorias: ["Estandar"], regimenes: ["PC"], hotel_nombre: "Hotel A Solicitud", hotel_moneda: "COP" },
    temporadas: [], tarifas: [], serviciosIncluidos: [], blackouts: [],
  };
}

function reparto(entrada: unknown, c: ConteosViajeros) {
  const r = validarReparto(entrada, c);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r : (null as never);
}
function liquidar(entrada: unknown, c: ConteosViajeros, vuelo?: { aporte: number; feeInfante: number; impuesto: number } | null, pctMk = 0.2) {
  const { reparto: rp } = reparto(entrada, c);
  const sintetica = tarifaSinteticaPorTipo({ reparto: rp, noches: 3, categoria: "A confirmar", regimen: "A confirmar", fechaIda: IDA, fechaRegreso: REGRESO });
  assert.ok(sintetica, "la tarifa sintética debe existir");
  const r = evaluarHotelPorFechas(aplicarNetaSolicitud(datosSinTarifa(pctMk), { sintetica: sintetica!, vuelo: vuelo ?? null }), IDA, 3);
  assert.ok(r && r.combos.length, "debe liquidar");
  return r!.combos[0];
}

describe("hotel sin tarifa (único hotel del paquete)", () => {
  test("sin neta el motor no inventa precio: ningún combo", () => {
    assert.deepEqual(evaluarHotelPorFechas(datosSinTarifa(), IDA, 3)?.combos ?? [], []);
  });
  test("una solicitud pública no lleva importes ni reparto (y se detecta si alguien los cuela)", () => {
    assert.equal(contieneImportes({ paqueteId: 1, hotelId: 2, habitaciones: { doble: 1 }, edadesMenores: [7, 1], cliente: { nombres: "A" } }), false);
    assert.equal(contieneImportes({ precio_venta: 0, detalle: { solicitudHotel: { notas: "x" } } }), false);
    assert.equal(contieneImportes({ pvpPorAcom: { doble: 1000 } }), true);
    assert.equal(contieneImportes({ reparto: { modo: "distribuir" } }), true);
    assert.equal(contieneImportes({ a: [{ b: { netaNino: 5 } }] }), true);
  });
  test("texto exacto que ve el cliente", () => {
    assert.equal(TEXTO_BAJO_SOLICITUD, "Tarifa y disponibilidad bajo solicitud");
    assert.equal(estaPendienteTarifa("pendiente_tarifa"), true);
    assert.equal(estaPendienteTarifa("abierta"), false);
  });
});

describe("regla de reparto: validación", () => {
  test("SIN niños: el hotel se carga a los adultos, sin elección; un número a secas = neta total a adultos", () => {
    const r = reparto(NETA_TOTAL, SIN_NINOS);
    assert.deepEqual(r.reparto, { modo: "adultos", adultos: 2, ninos: 0, infantes: 0, netaAdulto: 600_000, netaNino: 0, netaInfante: 0 });
    assert.equal(r.netaTotal, NETA_TOTAL);
  });
  test("CON niños, «adultos»: niños e infantes con neta hotelera $0", () => {
    const r = reparto({ netaTotal: NETA_TOTAL, modo: "adultos" }, CON_NINOS);
    assert.deepEqual([r.reparto.netaAdulto, r.reparto.netaNino, r.reparto.netaInfante], [600_000, 0, 0]);
  });
  test("CON niños, «distribuir»: adultos × neta adulto + niños × neta niño = neta total; el infante queda en $0", () => {
    const r = reparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000 }, CON_NINOS);
    assert.deepEqual([r.reparto.modo, r.reparto.netaAdulto, r.reparto.netaNino, r.reparto.netaInfante], ["distribuir", 500_000, 200_000, 0]);
  });
  test("distribuir: admite SOLO el redondeo mínimo de centavos (un centavo por persona)", () => {
    // 2 adultos × 333.333,33 + 1 niño × 333.333,33 = 999.999,99 (1 centavo de diferencia) → pasa
    assert.ok(validarReparto({ netaTotal: 1_000_000, modo: "distribuir", netaAdulto: 333_333.33, netaNino: 333_333.33 }, CON_NINOS).ok);
    assert.ok(toleranciaCentavos(3) < 0.031);
    // 5 centavos de diferencia → no pasa
    const mal = validarReparto({ netaTotal: 1_000_000, modo: "distribuir", netaAdulto: 333_333.31, netaNino: 333_333.33 }, CON_NINOS);
    assert.equal(mal.ok, false);
  });
  test("RECHAZOS: suma que no cuadra, infante con neta ≠ 0, distribución sin niños, modo inválido, importes en «adultos», neta inválida", () => {
    const noCuadra = validarReparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 199_000 }, CON_NINOS);
    assert.ok(!noCuadra.ok && /no cuadra/.test(noCuadra.error) && /faltan 1000/.test(noCuadra.error), noCuadra.ok ? "" : noCuadra.error);
    assert.ok(!validarReparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000, netaInfante: 1000 }, CON_NINOS).ok, "infante con neta ≠ 0");
    assert.ok(!validarReparto({ netaTotal: NETA_TOTAL, modo: "adultos", netaInfante: 5 }, CON_NINOS).ok, "infante con neta ≠ 0 también en «adultos»");
    assert.ok(validarReparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000, netaInfante: 0 }, CON_NINOS).ok, "infante en 0 explícito es válido");
    const sinNinos = validarReparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 600_000, netaNino: 1 }, SIN_NINOS);
    assert.ok(!sinNinos.ok && /no hay niños/i.test(sinNinos.error), "distribución sin niños");
    assert.ok(!validarReparto({ netaTotal: NETA_TOTAL, modo: "otro" }, CON_NINOS).ok);
    assert.ok(!validarReparto({ netaTotal: NETA_TOTAL, modo: "adultos", netaAdulto: 600_000 }, CON_NINOS).ok, "«adultos» no lleva importes por tipo");
    assert.ok(!validarReparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 0, netaNino: 1_200_000 / 1 }, CON_NINOS).ok, "adulto en 0");
    for (const mala of [0, -5, "abc", "", null, undefined, NaN, Infinity, 1e13]) assert.equal(validarNeta(mala).ok, false, String(mala));
    assert.ok(!validarReparto(NETA_TOTAL, { adultos: 0, ninos: 0, infantes: 0 }).ok, "sin adultos no se puede cargar");
  });
  test("idempotencia: MISMA elección = no-op; otra distribución u otra neta = distinta", () => {
    const a = reparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000 }, CON_NINOS);
    const cp = (x: typeof a): NetaSolicitud => ({ netaTotal: x.netaTotal, moneda: "COP", reparto: x.reparto });
    const igual = reparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000 }, CON_NINOS);
    const otra = reparto({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 450_000, netaNino: 300_000 }, CON_NINOS);
    const aAdultos = reparto({ netaTotal: NETA_TOTAL, modo: "adultos" }, CON_NINOS);
    const otraNeta = reparto({ netaTotal: NETA_TOTAL + 1, modo: "adultos" }, CON_NINOS);
    assert.equal(mismaEleccion(cp(a), cp(igual)), true);
    assert.equal(mismaEleccion(cp(a), cp(otra)), false);
    assert.equal(mismaEleccion(cp(a), cp(aAdultos)), false);
    assert.equal(mismaEleccion(cp(aAdultos), cp(otraNeta)), false);
  });
});

describe("ocupación de la solicitud (misma regla del motor)", () => {
  const regla = { infanteMax: 1, ninoMax: 12 };
  const doble = { acomodacion: "doble" as const, pax_tarifa: 2, pax_max: 4, adt_min: 2, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 };
  test("adultos = habitaciones × pax de tarifa; menores por edad: 1 año = infante, 7 años = niño", () => {
    const r = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7, 1], reglas: [doble], reglaEdad: regla });
    assert.deepEqual(r, { ok: true, conteos: { adultos: 2, ninos: 1, infantes: 1 } });
    const dos = evaluarOcupacionSolicitud({ habitaciones: { doble: 1, sencilla: 1 }, edadesMenores: [], reglas: [doble], reglaEdad: regla });
    assert.deepEqual(dos, { ok: true, conteos: { adultos: 3, ninos: 0, infantes: 0 } });
  });
  test("SIN hotel_acomodaciones rigen los defaults del motor: una doble (pax_max 2) NO admite menores, y el motivo se dice antes de enviar", () => {
    assert.deepEqual(evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [], reglas: [], reglaEdad: regla }), { ok: true, conteos: { adultos: 2, ninos: 0, infantes: 0 } });
    const r = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7], reglas: [], reglaEdad: regla });
    assert.ok(!r.ok && /admite máximo 0 niño/.test(r.error), r.ok ? "" : r.error);
  });
  test("configurada con cupo se admite; sin cupo para infantes o niños de más se rechaza; una edad de adulto se rechaza", () => {
    assert.equal(evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [5, 6, 7], reglas: [doble], reglaEdad: regla }).ok, false, "tres niños en una doble con cupo 2");
    assert.equal(evaluarOcupacionSolicitud({ habitaciones: { doble: 2 }, edadesMenores: [5, 6, 7], reglas: [doble], reglaEdad: regla }).ok, true, "con dos habitaciones sí cabe");
    const adulto = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [15], reglas: [doble], reglaEdad: regla });
    assert.ok(!adulto.ok && /tarifa de adulto/.test(adulto.error));
  });
});

describe("ocupación REAL: una doble con 1 adulto real + 1 niño real tiene 2 viajeros (no «2 adultos + 1 niño»)", () => {
  const regla = { infanteMax: 1, ninoMax: 12 };
  const doble = { acomodacion: "doble" as const, pax_tarifa: 2, pax_max: 4, adt_min: 2, adt_max: 2, chd_min: 0, chd_max: 2, inf_min: 0, inf_max: 2 };
  test("1 adulto real + 1 niño en una doble: conteos reales 1 adulto + 1 niño (el niño ocupa la segunda plaza que se cobra como adulto)", () => {
    const r = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7], adultosReales: 1, reglas: [doble], reglaEdad: regla } as never);
    assert.deepEqual(r, { ok: true, conteos: { adultos: 1, ninos: 1, infantes: 0 } });
  });
  test("con infante: el infante no ocupa plaza ni sustituye al adulto: 1 adulto + 1 niño + 1 infante", () => {
    const r = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7, 1], adultosReales: 1, reglas: [doble], reglaEdad: regla } as never);
    assert.deepEqual(r, { ok: true, conteos: { adultos: 1, ninos: 1, infantes: 1 } });
  });
  test("sin hotel_acomodaciones (defaults del motor, pax_max 2) también cabe: 2 personas reales en una doble de 2", () => {
    const r = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7], adultosReales: 1, reglas: [], reglaEdad: regla } as never);
    assert.deepEqual(r, { ok: true, conteos: { adultos: 1, ninos: 1, infantes: 0 } });
  });
  test("un niño de más sobre los adultos reales sigue exigiendo cupo de niño: 1 adulto + 2 niños en una doble de 2 (sin config) se rechaza", () => {
    const r = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7, 8], adultosReales: 1, reglas: [], reglaEdad: regla } as never);
    assert.equal(r.ok, false);
  });
  test("RECHAZOS: la plaza libre solo la ocupa un NIÑO (ni un infante ni nadie ficticio), no se puede tener 0 adultos ni más que las plazas", () => {
    const sinNino = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [], adultosReales: 1, reglas: [doble], reglaEdad: regla } as never);
    assert.ok(!sinNino.ok && /niño/.test(sinNino.error), sinNino.ok ? "" : sinNino.error);
    const soloInfante = evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [1], adultosReales: 1, reglas: [doble], reglaEdad: regla } as never);
    assert.equal(soloInfante.ok, false, "un infante no ocupa la segunda plaza de adulto");
    for (const mal of [0, -1, 3, 1.5, "1"]) assert.equal(evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7], adultosReales: mal, reglas: [doble], reglaEdad: regla } as never).ok, false, `adultosReales=${String(mal)}`);
    const sencilla = evaluarOcupacionSolicitud({ habitaciones: { sencilla: 1 }, edadesMenores: [7], adultosReales: 0, reglas: [], reglaEdad: regla } as never);
    assert.equal(sencilla.ok, false, "una sencilla no tiene plaza libre para un niño sin adulto");
  });
  test("sin adultosReales todo sigue igual (compatibilidad): doble = 2 adultos + el niño", () => {
    assert.deepEqual(evaluarOcupacionSolicitud({ habitaciones: { doble: 1 }, edadesMenores: [7], reglas: [doble], reglaEdad: regla }), { ok: true, conteos: { adultos: 2, ninos: 1, infantes: 0 } });
  });
});

describe("TRM de costos: CxP en USD con equivalente congelado (mismo modelo del carrito)", () => {
  test("cxpEnUsdConEquivalente: moneda USD, importe a centavos, equivalente = valor × TRM a centavos y TRM de 4 decimales intacta", () => {
    const f = cxpEnUsdConEquivalente({ valor_total: 1000.8, tipo_proveedor: "hotel" }, 4000.5);
    assert.deepEqual(f, { valor_total: 1000.8, tipo_proveedor: "hotel", moneda: "USD", valor_cop_costo: 4003700.4, trm_costo: 4000.5 });
    const g = cxpEnUsdConEquivalente({ valor_total: 33.333 }, 4123.4567);
    assert.equal(g.valor_total, 33.33);
    assert.equal(g.valor_cop_costo, Math.round(33.33 * 4123.4567 * 100) / 100);
    assert.equal(cxpEnUsdConEquivalente({ valor_total: 0 }, 4000).valor_cop_costo, 0);
    assert.equal(cxpEnUsdConEquivalente({ valor_total: -5 }, 4000).valor_total, 0, "nunca negativa");
  });
  test("decidirTrmCosto (la misma del carrito): sin TRM o inválida se detiene; solo personal interno; costos en cero no la piden", () => {
    assert.equal(decidirTrmCosto({ requiere: true, recibida: undefined, esInterno: true, congelada: null }).ok, false);
    for (const mala of ["abc", 0, -1, ""]) assert.equal(decidirTrmCosto({ requiere: true, recibida: mala, esInterno: true, congelada: null }).ok, false, String(mala));
    assert.deepEqual(decidirTrmCosto({ requiere: true, recibida: "4000,5", esInterno: true, congelada: null }), { ok: true, trm: 4000.5 });
    const ext = decidirTrmCosto({ requiere: true, recibida: 4000, esInterno: false, congelada: null });
    assert.ok(!ext.ok && /personal interno/.test(ext.error));
    assert.deepEqual(decidirTrmCosto({ requiere: false, recibida: undefined, esInterno: true, congelada: null }), { ok: true, trm: null });
  });
});

describe("ocupación real: reparto de adultos entre habitaciones y distribución de niños", () => {
  test("repartirAdultosReales: cada habitación conserva ≥1 adulto; las plazas libres se quitan de la primera habitación que pueda cederlas (determinista)", () => {
    assert.deepEqual(repartirAdultosReales([2], 1), { ok: true, adultosPorHabitacion: [1], plazasLibres: 1 });
    assert.deepEqual(repartirAdultosReales([2, 2], 3), { ok: true, adultosPorHabitacion: [1, 2], plazasLibres: 1 });
    assert.deepEqual(repartirAdultosReales([2, 2], 2), { ok: true, adultosPorHabitacion: [1, 1], plazasLibres: 2 });
    assert.deepEqual(repartirAdultosReales([3, 2], 2), { ok: true, adultosPorHabitacion: [1, 1], plazasLibres: 3 });
    assert.deepEqual(repartirAdultosReales([2, 2], 4), { ok: true, adultosPorHabitacion: [2, 2], plazasLibres: 0 });
    assert.equal(repartirAdultosReales([2, 2], 1).ok, false, "2 habitaciones necesitan al menos 2 adultos");
    assert.equal(repartirAdultosReales([2], 3).ok, false);
    assert.equal(repartirAdultosReales([1], 0).ok, false);
    assert.equal(repartirAdultosReales([2], "1").ok, false);
  });
  test("errorPlazasLibres: solo un niño ocupa la plaza de adulto libre", () => {
    assert.equal(errorPlazasLibres(2, 2, 0), null);
    assert.equal(errorPlazasLibres(2, 1, 1), null);
    assert.match(errorPlazasLibres(2, 1, 0) ?? "", /niño/);
    assert.match(errorPlazasLibres(4, 2, 1) ?? "", /plazas libres/);
  });
  test("distribuirPorHabitaciones: el niño de una habitación con 1 adulto ocupa SU plaza (mínimo de niños de esa habitación), y los totales son los reales", () => {
    const doble = (extra = {}) => ({ acom: "doble" as const, config: { ...defaultAcomConfig("doble"), pax_max: 4, chd_max: 2, inf_max: 2, ...extra } });
    const d = distribuirPorHabitaciones({ adultosDeclarados: 3, ninos: 1, infantes: 0, habitaciones: [doble(), doble()], adultosPorHabitacion: [1, 2] });
    assert.ok(d.ok);
    if (d.ok) { assert.deepEqual(d.habitaciones.map((h) => [h.adultos, h.nino + h.nino2]), [[1, 1], [2, 0]]); assert.deepEqual(d.totales, { adultos: 3, nino: 1, nino2: 0, infantes: 0 }); }
    // sin el parámetro todo sigue igual (compatibilidad): adultos = pax_tarifa por habitación
    const igual = distribuirPorHabitaciones({ adultosDeclarados: 4, ninos: 1, infantes: 0, habitaciones: [doble(), doble()] });
    assert.ok(igual.ok && igual.totales.adultos === 4);
    // una habitación con 1 adulto cuyo hotel no admite niños (chd_max 0) no puede ocupar la plaza libre
    const sinNinos = distribuirPorHabitaciones({ adultosDeclarados: 1, ninos: 1, infantes: 0, habitaciones: [doble({ chd_max: 0 })], adultosPorHabitacion: [1] });
    assert.ok(!sinNinos.ok && /necesita 1 niño/.test(sinNinos.error), sinNinos.ok ? "" : sinNinos.error);
    // adultos por habitación fuera de rango
    for (const mal of [[0], [3], [1, 1]]) assert.equal(distribuirPorHabitaciones({ adultosDeclarados: 1, ninos: 1, infantes: 0, habitaciones: [doble()], adultosPorHabitacion: mal }).ok, false);
  });
  test("validarReservaHabitaciones con adultosReales: 1 adulto + 1 niño en una doble de 2 cuadra con edades reales; sin el parámetro se exigen los 2 adultos de siempre", () => {
    const base = { habitaciones: { doble: 1 }, reglas: [], ninosDeclarados: 1, infantesDeclarados: 0 };
    const real = { adultos: 1, ninos: 1, infantes: 0, sinFecha: 0 };
    assert.deepEqual(validarReservaHabitaciones({ ...base, real, adultosReales: 1 }).errores, []);
    assert.ok(validarReservaHabitaciones({ ...base, real }).errores.length > 0, "sin adultosReales, 1 adulto + 1 niño en una doble no cuadra (hoteles tarifados, sin cambios)");
    assert.ok(validarReservaHabitaciones({ ...base, real: { adultos: 2, ninos: 1, infantes: 0, sinFecha: 0 }, adultosReales: 1 }).errores.length > 0, "2 adultos reales con 1 declarado se rechaza");
  });
});

describe("mismo total en «adultos» y en «distribuir» (el residuo de redondeo va en una línea explícita)", () => {
  const netaDist = (modo: "adultos" | "distribuir", netaAdulto: number, netaNino: number) => ({ netaTotal: 1_200_000, moneda: "COP" as const, reparto: { modo, adultos: 1, ninos: 1, infantes: 0, netaAdulto, netaNino, netaInfante: 0 as const } });
  const totalPorMotor = (entrada: unknown, c: ConteosViajeros, vuelo: { aporte: number; feeInfante: number; impuesto: number }) => {
    const combo = liquidar(entrada, c, vuelo);
    const p = combo.precios; const m2 = combo.preciosMenor2 ?? {};
    return c.adultos * (p.doble ?? 0) + c.ninos * (p.nino ?? 0) + c.infantes * ((m2.infante ?? p.infante) ?? 0);
  };
  test("el motor, por persona, suma distinto (causa del defecto) y ajusteRedondeoReparto cierra la diferencia sin tocar importes por viajero", () => {
    const vuelo = { aporte: 500_000, feeInfante: 50_000, impuesto: 400_000 };
    const c: ConteosViajeros = { adultos: 1, ninos: 1, infantes: 0 };
    const adultos = totalPorMotor({ netaTotal: 1_200_000, modo: "adultos" }, c, vuelo);
    const distribuido = totalPorMotor({ netaTotal: 1_200_000, modo: "distribuir", netaAdulto: 701_000, netaNino: 499_000 }, c, vuelo);
    assert.equal(adultos, 2_500_000);
    assert.equal(distribuido, 2_501_000, "la suma por viajero redondea cada importe al millar: +1.000");
    const aj = ajusteRedondeoReparto({ totalReferencia: adultos, total: distribuido, personasQueCargan: 2, unidad: 1000 });
    assert.deepEqual(aj, { ok: true, ajuste: -1000 });
    assert.equal(distribuido + (aj.ok ? aj.ajuste : 0), adultos, "el total vendido es el mismo");
  });
  test("el ajuste puede ser + o − y 0 cuando no hay residuo; un residuo mayor que el redondeo posible NO se absorbe (rechazo)", () => {
    assert.deepEqual(ajusteRedondeoReparto({ totalReferencia: 3_150_000, total: 3_151_000, personasQueCargan: 3, unidad: 1000 }), { ok: true, ajuste: -1000 });
    assert.deepEqual(ajusteRedondeoReparto({ totalReferencia: 3_152_000, total: 3_151_000, personasQueCargan: 3, unidad: 1000 }), { ok: true, ajuste: 1000 });
    assert.deepEqual(ajusteRedondeoReparto({ totalReferencia: 3_150_000, total: 3_150_000, personasQueCargan: 3, unidad: 1000 }), { ok: true, ajuste: 0 });
    assert.deepEqual(ajusteRedondeoReparto({ totalReferencia: 100, total: 101, personasQueCargan: 2, unidad: 1 }), { ok: true, ajuste: -1 });
    const grande = ajusteRedondeoReparto({ totalReferencia: 3_150_000, total: 3_160_000, personasQueCargan: 3, unidad: 1000 });
    assert.ok(!grande.ok && /redondeo posible/.test(grande.error));
    assert.equal(ajusteRedondeoReparto({ totalReferencia: Number.NaN, total: 1, personasQueCargan: 1, unidad: 1000 }).ok, false);
  });
  test("repartoDeReferencia: la misma neta, mismos conteos, todo a los adultos (niños e infantes $0)", () => {
    const r = repartoDeReferencia(netaDist("distribuir", 701_000, 499_000));
    assert.deepEqual(r.reparto, { modo: "adultos", adultos: 1, ninos: 1, infantes: 0, netaAdulto: 1_200_000, netaNino: 0, netaInfante: 0 });
    assert.equal(r.netaTotal, 1_200_000);
    const dos = repartoDeReferencia({ netaTotal: 1_000_000, moneda: "USD", reparto: { modo: "distribuir", adultos: 3, ninos: 1, infantes: 1, netaAdulto: 1, netaNino: 1, netaInfante: 0 } });
    assert.equal(dos.reparto.netaAdulto, 333_333.333333);
    assert.equal(dos.moneda, "USD");
  });
  test("USD: el tope es 1 USD por persona que carga hotel (no 1.000): +1 con 3 personas pasa; 4 USD de diferencia se rechaza, y esa misma diferencia sí cabría con la unidad de COP", () => {
    assert.deepEqual(ajusteRedondeoReparto({ totalReferencia: 2902, total: 2901, personasQueCargan: 3, unidad: 1 }), { ok: true, ajuste: 1 });
    assert.deepEqual(ajusteRedondeoReparto({ totalReferencia: 2902, total: 2899, personasQueCargan: 3, unidad: 1 }), { ok: true, ajuste: 3 }, "justo en el tope (1 USD × 3 personas)");
    const rechazo = ajusteRedondeoReparto({ totalReferencia: 2902, total: 2898, personasQueCargan: 3, unidad: 1 });
    assert.ok(!rechazo.ok && /redondeo posible \(±3\)/.test(rechazo.error), rechazo.ok ? "" : rechazo.error);
    assert.equal(ajusteRedondeoReparto({ totalReferencia: 2902, total: 2898, personasQueCargan: 3, unidad: 1000 }).ok, true, "con la unidad de COP el mismo 4 pasaría: por eso en USD la unidad DEBE ser 1");
    assert.deepEqual(ajusteRedondeoReparto({ totalReferencia: 2902.5, total: 2901, personasQueCargan: 3, unidad: 1 }), { ok: true, ajuste: 1.5 }, "centavos: el ajuste conserva los centavos");
  });
  test("texto único de la línea de ajuste", () => assert.equal(DESCRIPCION_AJUSTE_REDONDEO, "Ajuste de redondeo del reparto del hotel"));
  test("entrada pública: adultos opcional entero 1..40; entra a la clave solo cuando se envía", () => {
    const base = { paqueteId: 1, hotelId: 2, fechaIda: "2026-09-01", fechaRegreso: "2026-09-04", habitaciones: { doble: 1 }, edadesMenores: [7], cliente: { nombres: "Ana", apellidos: "P", tipoDoc: "CC", numeroDoc: "1", telefono: "3", email: "" } };
    const sin = validarEntradaSolicitudHotel(base, HOY);
    const con = validarEntradaSolicitudHotel({ ...base, adultos: 1 }, HOY);
    assert.ok(sin.ok && con.ok);
    if (sin.ok && con.ok) { assert.equal(sin.input.adultos, null); assert.equal(con.input.adultos, 1); assert.notEqual(claveSolicitudHotel(sin.input), claveSolicitudHotel(con.input)); assert.equal(claveSolicitudHotel(sin.input).includes("adultos"), false); }
    for (const mal of [0, -1, 41, 1.5, "2", true]) assert.equal(validarEntradaSolicitudHotel({ ...base, adultos: mal }, HOY).ok, false, String(mal));
  });
});

describe("asignación de neta → markup del paquete y total completo, por tipo de viajero", () => {
  test("PORCIÓN TERRESTRE sin niños: neta 1.200.000 a 2 adultos → 750.000 por adulto con markup 20 % (hotel 1.500.000)", () => {
    const c = liquidar(NETA_TOTAL, SIN_NINOS);
    assert.equal(c.precios.doble, 750_000);
    assert.equal(c.precios.doble * 2, 1_500_000);
    assert.ok(Math.abs((c.netos?.doble ?? 0) * 2 - NETA_TOTAL) < 0.01, "la suma de netas vuelve a la neta");
  });

  test("«ADULTOS» con niño e infante: los adultos cargan todo el hotel; niño e infante $0 de hotel", () => {
    const c = liquidar({ netaTotal: NETA_TOTAL, modo: "adultos" }, CON_NINOS);
    assert.equal(c.precios.doble, 750_000);
    assert.equal(c.precios.nino, 0);
    assert.equal(c.precios.infante, 0);
    assert.equal(c.netos?.nino, 0); assert.equal(c.netos?.infante, 0);
  });

  test("«DISTRIBUIR» (500.000 por adulto, 200.000 por niño): PVP por tipo con el motor; infante $0; el costo suma la neta", () => {
    const c = liquidar({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000 }, CON_NINOS);
    assert.equal(c.precios.doble, 625_000); // 500.000 / 0,8
    assert.equal(c.precios.nino, 250_000);  // 200.000 / 0,8
    assert.equal(c.precios.nino2, 250_000);
    assert.equal(c.precios.infante, 0);
    assert.ok(Math.abs((c.netos?.doble ?? 0) * 2 + (c.netos?.nino ?? 0) + (c.netos?.infante ?? 0) - NETA_TOTAL) < 0.01);
  });

  test("BLOQUEO: vuelo con markup (320.000 → 400.000) se suma a CADA tipo; el infante paga solo vuelo (su fee si es menor de 2 años)", () => {
    const vuelo = { aporte: aporteVuelo(320_000, true, 0.2, 0), feeInfante: 50_000, impuesto: 320_000 };
    assert.equal(vuelo.aporte, 400_000);
    const c = liquidar({ netaTotal: NETA_TOTAL, modo: "distribuir", netaAdulto: 500_000, netaNino: 200_000 }, CON_NINOS, vuelo);
    assert.equal(c.precios.doble, 625_000 + 400_000);
    assert.equal(c.precios.nino, 250_000 + 400_000);
    assert.equal(c.precios.infante, 400_000); // infante de 2 años (clase del hotel): hotel $0 + vuelo de adulto
    assert.equal(c.preciosMenor2?.infante, 50_000); // menor de 2 años: hotel $0 + solo el fee de infante
  });

  test("EMPAQUETADO: vuelo con TA (costo + TA, sin markup)", () => {
    const vuelo = { aporte: aporteVuelo(300_000, false, 0.2, 20_000), feeInfante: 0, impuesto: 300_000 };
    assert.equal(vuelo.aporte, 320_000);
    assert.equal(liquidar(NETA_TOTAL, SIN_NINOS, vuelo).precios.doble, 750_000 + 320_000);
  });

  test("el markup sale del paquete: con otro %mk cambia el total y la neta no", () => {
    assert.equal(liquidar(NETA_TOTAL, SIN_NINOS, null, 0.25).precios.doble, 800_000); // 600.000 / 0,75
  });

  test("sin neta por adulto o noches no hay tarifa sintética (nunca precio ficticio)", () => {
    assert.equal(tarifaSinteticaPorTipo({ reparto: { netaAdulto: 0, netaNino: 0 }, noches: 3, categoria: "a", regimen: "b", fechaIda: IDA, fechaRegreso: REGRESO }), null);
    assert.equal(tarifaSinteticaPorTipo({ reparto: { netaAdulto: 5, netaNino: 0 }, noches: 0, categoria: "a", regimen: "b", fechaIda: IDA, fechaRegreso: REGRESO }), null);
  });
});

describe("entrada pública", () => {
  const entradaBuena = {
    paqueteId: 5, hotelId: 9, fechaIda: "2026-09-01", fechaRegreso: "2026-09-04", habitaciones: { doble: 1 },
    cliente: { nombres: "Ana", apellidos: "Pérez", numeroDoc: "123", telefono: "300" },
  };
  test("la solicitud pública valida fechas, habitaciones, menores y cliente", () => {
    assert.equal(validarEntradaSolicitudHotel(entradaBuena, HOY).ok, true);
    assert.equal(validarEntradaSolicitudHotel({ ...entradaBuena, fechaIda: "2025-12-31" }, HOY).ok, false);
    assert.equal(validarEntradaSolicitudHotel({ ...entradaBuena, fechaRegreso: "2026-09-01" }, HOY).ok, false);
    assert.equal(validarEntradaSolicitudHotel({ ...entradaBuena, habitaciones: { doble: 0 } }, HOY).ok, false);
    assert.equal(validarEntradaSolicitudHotel({ ...entradaBuena, habitaciones: { doble: 99 } }, HOY).ok, false);
    assert.equal(validarEntradaSolicitudHotel({ ...entradaBuena, edadesMenores: [3, 40] }, HOY).ok, false);
    assert.equal(validarEntradaSolicitudHotel({ ...entradaBuena, cliente: { ...entradaBuena.cliente, numeroDoc: "" } }, HOY).ok, false);
    assert.equal(validarEntradaSolicitudHotel({ ...entradaBuena, bloqueoId: 1, empaquetadoId: 2 }, HOY).ok, false);
  });
  test("un precio mandado por el navegador no sobrevive a la validación", () => {
    const r = validarEntradaSolicitudHotel({ ...entradaBuena, precio_venta: 1, neta: 5, pvp: 9, reparto: { modo: "x" } }, HOY);
    assert.ok(r.ok);
    if (r.ok) assert.equal(contieneImportes(r.input), false);
  });
  test("la clave de la solicitud es estable (reintento/doble clic = misma cotización)", () => {
    const a = validarEntradaSolicitudHotel(entradaBuena, HOY);
    const b = validarEntradaSolicitudHotel({ ...entradaBuena, cliente: { ...entradaBuena.cliente, nombres: "ANA " } }, HOY);
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) assert.equal(claveSolicitudHotel(a.input), claveSolicitudHotel(b.input));
  });
});

describe("paquete vendible hoy (el paquete con un único hotel a solicitud sigue apareciendo)", () => {
  test("compra abierta y viaje vigente", () => {
    assert.equal(paqueteVendibleHoy({ tipo: "bloqueo", fecha_compra_inicio: null, fecha_compra_fin: null, fecha_viaje_fin: null }, HOY), true);
    assert.equal(paqueteVendibleHoy({ tipo: "bloqueo", fecha_compra_inicio: "2026-02-01", fecha_compra_fin: null, fecha_viaje_fin: null }, HOY), false);
    assert.equal(paqueteVendibleHoy({ tipo: "bloqueo", fecha_compra_inicio: null, fecha_compra_fin: "2025-12-31", fecha_viaje_fin: null }, HOY), false);
    assert.equal(paqueteVendibleHoy({ tipo: "porcion_terrestre", fecha_compra_inicio: null, fecha_compra_fin: null, fecha_viaje_fin: "2025-12-31" }, HOY), false);
  });
});
