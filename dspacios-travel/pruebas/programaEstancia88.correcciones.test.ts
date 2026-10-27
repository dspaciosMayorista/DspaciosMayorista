// Corre en test:unit (glob pruebas/**/*.test.ts) con el arnés en memoria. Complementa programaEstancia88.reserva.test.ts.
//
// #88 — CORRECCIONES tras la primera auditoría. Cada bloque reproduce un fallo que existía y fija la regla del dueño:
//   1. Menores: con tarifa nocturna POR HABITACIÓN los menores van incluidos (sin suplemento hotelero ni neto_nino); con tarifa POR PERSONA
//      cada menor exige tarifa explícita. Cada noche se redondea y luego se suman.
//   2. Asistencia de la estancia COMPLETA (días incluidos + adicionales): proveedor configurado, una CxP, ni cobrada ni registrada dos veces.
//   3. USD: TRM de costos expresa ANTES de numerar; todas las CxP en USD con moneda, nominal, TRM y equivalente COP coherentes (modelo de la 236).
//   4. Escritura parcial: si falla la foto, el registro de costo, el pasajero o cualquier CxP, no hay éxito ni contrato utilizable; reintentos sin duplicados.
//   5. El modo hotel es solo para porciones terrestres (sin aéreo).
//   6. Itinerario incompleto: no se desplaza el último día.
import { MOMENTOS, asientos, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import {
  DIAS, RPCS, TABLAS_DE_ESCRITURA, afirmarSinEscrituras, entrada, hotel, inyectarFallo, noche, programa, semilla, type BD, type Fila,
} from "./support/programaHotel88.ts";
import { test, afterEach, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { cargarTablasPvp88 } = await import("../lib/programas/estanciaHotelDatos88.ts");
const { cotizarEstanciaDesdePvp } = await import("../lib/programas/precioReserva57.ts");
const { totalVisibleContratoItems } = await import("../lib/contrato/valorContratoItem.ts");

beforeEach(() => reloj(MOMENTOS[0][1]));
afterEach(() => soltarReloj());

const NOCHES_HAB = (over: Fila = {}) => noche({ unidad_cobro: "habitacion", desde: "2027-03-01", hasta: "2027-03-31", neto_sencilla: 110, neto_doble: 180, neto_triple: 250, neto_nino: null, ...over });

/** Lo que muestra la ficha/formulario (solo PVP) para la selección. */
async function cotizar(bd: BD, e: ReturnType<typeof entrada>) {
  const r = await cargarTablasPvp88(bd.sb as never, 3, bd.filas("programas")[0] as never);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("tablas");
  const tabla = r.tablas.find((t) => t.hotel.id === e.estancia.hotelId)!;
  return cotizarEstanciaDesdePvp(tabla, 3, {
    modalidad: e.estancia.modalidad, fechaEntrada: e.fechaIda, nochesAdicionales: e.estancia.nochesAdicionales, habitaciones: e.paxPorAcom, ninos: e.ninos,
  });
}
async function reservar(bd: BD, e: ReturnType<typeof entrada>) {
  const c = await cotizar(bd, e);
  assert.equal(c.ok, true, c.ok ? "" : c.error);
  if (!c.ok) throw new Error("cotización");
  const r = await reservarPrograma({ ...e, precioConfirmado: c.total });
  return { r, total: c.total };
}
const suma = (xs: Fila[], campo: string) => xs.reduce((s, x) => s + Number(x[campo] ?? 0), 0);

// ── 1. Menores ──────────────────────────────────────────────────────────────
describe("menores en las noches adicionales", () => {
  test("tarifa por HABITACIÓN: el menor va incluido (sin suplemento hotelero ni neto_nino); solo se cobra su asistencia", async () => {
    const bd = usarBD(semilla({ programa_hotel_noches: [NOCHES_HAB()] }), RPCS);
    const e = entrada({ nochesAdicionales: 2 }, { ninos: 1 });
    const { r, total } = await reservar(bd, e);
    assert.equal(r.ok, true, JSON.stringify(r));
    // Base: 748×2 adultos + menor 505. Noches (cada una redondeada y luego sumadas): habitación (180+8)/0.8245 → 229 + asistencia del menor 4/0.8245 → 5, por 2 noches.
    assert.equal(total, 1496 + 505 + (229 + 5) * 2);
    assert.equal(bd.filas("ventas")[0].precio_venta, total);
    assert.equal(bd.filas("contrato_programa_estancia")[0].precio_noches, 468);
    // Costo del hotel: la habitación × noches; el menor NO suma costo hotelero.
    assert.equal(bd.filas("contrato_programa_estancia_costo")[0].neto_noches, 360);
  });

  test("tarifa por HABITACIÓN: un neto_nino cargado se ignora (no se cobra ni se exige)", async () => {
    // Una base a la vez: el arnés tiene UNA base global (la última creada).
    const e = entrada({ nochesAdicionales: 2 }, { ninos: 2 });
    const a = await reservar(usarBD(semilla({ programa_hotel_noches: [NOCHES_HAB({ neto_nino: null })] }), RPCS), e);
    assert.equal(a.r.ok, true, JSON.stringify(a.r));
    const b = await reservar(usarBD(semilla({ programa_hotel_noches: [NOCHES_HAB({ neto_nino: 999 })] }), RPCS), e);
    assert.equal(b.r.ok, true, JSON.stringify(b.r));
    assert.equal(a.total, b.total);
  });

  test("tarifa POR PERSONA: cada menor exige tarifa explícita; sin ella no se cotiza ni se reserva y no se escribe nada", async () => {
    const bd = usarBD(semilla({ programa_hotel_noches: [noche({ desde: "2027-03-01", hasta: "2027-03-31", neto_nino: null })] }), RPCS);
    const e = entrada({ nochesAdicionales: 1 }, { ninos: 1 });
    const c = await cotizar(bd, e);
    assert.equal(c.ok, false);
    const r = await reservarPrograma({ ...e, precioConfirmado: 1 });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /tarifa adicional de menor/);
    afirmarSinEscrituras(bd);
  });

  test("noches mixtas (una vigencia por persona y otra por habitación): cada noche aplica la regla de SU unidad", async () => {
    const bd = usarBD(semilla({
      programa_hotel_noches: [
        noche({ desde: "2027-03-01", hasta: "2027-03-04", unidad_cobro: "persona", neto_nino: null }),
        NOCHES_HAB({ id: 2, desde: "2027-03-05", hasta: "2027-03-31" }),
      ],
    }), RPCS);
    // Noche del 4/mar es POR PERSONA y no hay tarifa de menor: se bloquea con la fecha exacta; la del 5/mar (habitación) no lo exigiría.
    const r1 = await reservarPrograma({ ...entrada({ nochesAdicionales: 2 }, { ninos: 1 }), precioConfirmado: 1 });
    assert.equal(r1.ok, false);
    assert.match(r1.ok ? "" : r1.error, /04\/03\/2027/);
    afirmarSinEscrituras(bd);
    // Con entrada el 2/mar la única noche extra es el 5/mar (habitación): el menor va incluido y cotiza sin tarifa de menor.
    const c = await cotizar(bd, entrada({ nochesAdicionales: 1 }, { ninos: 1, fechaIda: "2027-03-02" }));
    assert.equal(c.ok, true, c.ok ? "" : c.error);
  });
});

// ── 2. Asistencia de la estancia completa ───────────────────────────────────
describe("asistencia médica de la estancia completa", () => {
  test("una CxP de asistencia al proveedor configurado por (días incluidos + adicionales) × pax que pagan; el hotel no la incluye", async () => {
    const bd = usarBD(semilla(), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 3 }));
    assert.equal(r.ok, true, JSON.stringify(r));
    const venta = bd.filas("ventas")[0];
    // 4 USD × (4 días incluidos + 3 noches adicionales) × 2 pax = 56. Sin cobrarla dos veces: la parte del programa sigue siendo SOLO el neto.
    assert.equal(venta.costo_asistencia, 56);
    assert.equal(venta.costo_receptivo, 1880);
    const cxp = bd.filas("cuentas_por_pagar");
    const asistencia = cxp.filter((c) => c.tipo_proveedor === "asistencia");
    assert.equal(asistencia.length, 1, "una sola CxP de asistencia");
    assert.equal(asistencia[0].proveedor, "Asistencia Global");
    assert.equal(asistencia[0].valor_total, 56);
    assert.equal(cxp.filter((c) => c.tipo_proveedor === "programa").reduce((s, c) => s + Number(c.valor_total), 0), 1880, "el programa y el hotel no incluyen la asistencia");
    assert.equal(suma(cxp, "valor_total"), Number(venta.costo_receptivo) + Number(venta.costo_asistencia), "la suma de las CxP es el costo del contrato");
    const [costo] = bd.filas("contrato_programa_estancia_costo");
    assert.equal(costo.asistencia_total, 56);
    assert.equal(costo.asistencia_noches, 24);
    assert.equal(costo.proveedor_asistencia_id, 55);
  });

  test("0 noches adicionales: la asistencia son solo los días incluidos; los infantes no cuentan; los menores sí", async () => {
    const bd = usarBD(semilla(), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 0 }, { ninos: 1, infantes: 1 }));
    assert.equal(r.ok, true, JSON.stringify(r));
    // 4 USD × 4 días × (2 adultos + 1 menor) = 48; el infante no paga ni cubre asistencia.
    assert.equal(bd.filas("ventas")[0].costo_asistencia, 48);
    assert.equal(bd.filas("cuentas_por_pagar").find((c) => c.tipo_proveedor === "asistencia")?.valor_total, 48);
  });

  test("con costo de asistencia positivo y SIN proveedor configurado: se rechaza ANTES de numerar y no se escribe nada", async () => {
    const bd = usarBD(semilla({ programas: [programa({ proveedor_asistencia_id: null })] }), RPCS);
    const e = entrada({ nochesAdicionales: 2 });
    const c = await cotizar(bd, e);
    assert.equal(c.ok, true, "la cotización de precio no depende del proveedor");
    const r = await reservarPrograma({ ...e, precioConfirmado: c.ok ? c.total : 0 });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /proveedor de la asistencia/);
    afirmarSinEscrituras(bd);
    assert.equal((globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas.seq, undefined, "no se consumió un número de contrato");
  });

  test("proveedor de asistencia inexistente o sin asistencia diaria: el primero se rechaza, el segundo no necesita proveedor ni CxP", async () => {
    const huerfano = usarBD(semilla({ programas: [programa({ proveedor_asistencia_id: 999 })] }), RPCS);
    const r1 = await reservarPrograma({ ...entrada({ nochesAdicionales: 1 }), precioConfirmado: 1 });
    assert.equal(r1.ok, false);
    afirmarSinEscrituras(huerfano);

    const gratis = usarBD(semilla({ programas: [programa({ proveedor_asistencia_id: null, asistencia_medica_dia: 0 })] }), RPCS);
    const { r } = await reservar(gratis, entrada({ nochesAdicionales: 2 }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(gratis.filas("cuentas_por_pagar").filter((c) => c.tipo_proveedor === "asistencia").length, 0);
    assert.ok(!gratis.filas("ventas")[0].costo_asistencia, "sin asistencia no hay costo_asistencia");
  });

  test("cobertura de CxP: tras confirmar la venta no se vuelve a crear la asistencia ni el costo del programa", async () => {
    const { asegurarCuentasPorPagar } = await import("../lib/reservar/asegurarCuentasPorPagar.ts");
    const bd = usarBD(semilla(), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 3 }));
    assert.equal(r.ok, true, JSON.stringify(r));
    const antes = bd.filas("cuentas_por_pagar").length;
    const c = await asegurarCuentasPorPagar(String(bd.filas("ventas")[0].numero_contrato));
    assert.equal(c.ok, true);
    assert.equal(bd.filas("cuentas_por_pagar").length, antes);
  });
});

// ── 3. TRM de costos y equivalente COP (modelo de la 236) ───────────────────
describe("programas en USD: TRM de costos expresa y equivalente COP", () => {
  test("sin TRM de costos (o inválida) se rechaza ANTES de numerar y no se escribe nada", async () => {
    for (const malo of [null, "", "abc", 0, -5, Number.NaN]) {
      const bd = usarBD(semilla(), RPCS);
      const e = entrada({ nochesAdicionales: 1 }, { trmCosto: malo });
      const c = await cotizar(bd, e);
      const r = await reservarPrograma({ ...e, precioConfirmado: c.ok ? c.total : 0 });
      assert.equal(r.ok, false, String(malo));
      assert.match(r.ok ? "" : r.error, /TRM de costos/, String(malo));
      afirmarSinEscrituras(bd);
    }
  });

  test("una sola TRM congelada: CADA CxP en USD guarda moneda, nominal, TRM y equivalente COP coherentes; el asiento devenga el equivalente", async () => {
    const bd = usarBD(semilla({ programa_hoteles: [hotel({ proveedor_id: 77 })] }), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 3 }, { trmCosto: "4012.5" }));
    assert.equal(r.ok, true, JSON.stringify(r));
    const cxp = bd.filas("cuentas_por_pagar");
    assert.equal(cxp.length, 3, "programa (base) + hotel con otro proveedor (noches) + asistencia");
    for (const c of cxp) {
      assert.equal(c.moneda, "USD");
      assert.equal(c.trm_costo, 4012.5, "la MISMA TRM en todas");
      assert.equal(c.valor_cop_costo, Math.round(Number(c.valor_total) * 4012.5 * 100) / 100, `equivalente de ${c.servicio}`);
    }
    assert.equal(new Set(cxp.map((c) => c.trm_costo)).size, 1);
    assert.equal(bd.filas("contrato_programa_estancia_costo")[0].trm_costo, 4012.5);
    assert.equal(bd.filas("contrato_programa_estancia_costo")[0].moneda, "USD");
    // El devengo contable sale del equivalente en COP, no del nominal en dólares.
    const debe = suma(bd.filas("asiento_lineas"), "debe");
    assert.equal(debe, suma(cxp, "valor_cop_costo"));
    assert.equal(asientos(bd, "cxp").length, 3);
  });

  test("programa en COP: no pide TRM, las CxP son COP explícito y no llevan equivalente", async () => {
    const bd = usarBD(semilla({ programas: [programa({ moneda: "COP", pct_mk: 0.15, pct_fee_tarjeta: 0, asistencia_medica_dia: 4000 })],
      programa_hotel_precios: [{ id: 1, hotel_id: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad_servicios: "privado", bajo_solicitud: false, neto_sencilla: null, neto_doble: 600000, neto_triple: null, neto_multiple: null, neto_nino: null }],
      programa_hotel_noches: [noche({ desde: "2027-03-01", hasta: "2027-03-31", neto_doble: 100000, neto_nino: null })] }), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 2 }, { trmCosto: null }));
    assert.equal(r.ok, true, JSON.stringify(r));
    for (const c of bd.filas("cuentas_por_pagar")) {
      assert.equal(c.moneda, "COP");
      assert.equal(c.valor_cop_costo ?? null, null);
      assert.equal(c.trm_costo ?? null, null);
    }
    assert.equal(bd.filas("contrato_programa_estancia_costo")[0].trm_costo ?? null, null);
  });

  test("una TRM enviada en un programa COP no se guarda en ninguna parte", async () => {
    const bd = usarBD(semilla({ programas: [programa({ moneda: "COP", asistencia_medica_dia: 0 })],
      programa_hotel_precios: [{ id: 1, hotel_id: 1, desde: "2027-03-01", hasta: "2027-03-31", modalidad_servicios: "privado", bajo_solicitud: false, neto_sencilla: null, neto_doble: 600000, neto_triple: null, neto_multiple: null, neto_nino: null }],
      programa_hotel_noches: [] }), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 0 }, { trmCosto: 4000 }));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(bd.filas("cuentas_por_pagar").every((c) => c.trm_costo == null));
  });
});

// ── 4. Escritura parcial ────────────────────────────────────────────────────
describe("escritura parcial: o queda todo o no queda el contrato", () => {
  const PASAJEROS = [
    { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", fechaNacimiento: "1990-01-01", nacionalidad: "Colombiana" },
    { nombres: "Luis", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "2020", fechaNacimiento: "1988-05-05", nacionalidad: "Colombiana" },
  ];
  const e = () => entrada({ nochesAdicionales: 3 }, { pasajeros: PASAJEROS });
  const pasos: { nombre: string; preparar: (bd: BD) => () => number }[] = [
    { nombre: "la foto de la estancia", preparar: (bd) => inyectarFallo(bd, "contrato_programa_estancia", "insert", "foto: fallo inyectado", 1) },
    { nombre: "el registro de costo de la estancia", preparar: (bd) => inyectarFallo(bd, "contrato_programa_estancia_costo", "insert", "costo: fallo inyectado", 1) },
    { nombre: "los ítems del contrato", preparar: (bd) => inyectarFallo(bd, "contrato_items", "insert", "items: fallo inyectado", 1) },
    { nombre: "el hotel del contrato", preparar: (bd) => inyectarFallo(bd, "contrato_hoteles", "insert", "hoteles: fallo inyectado", 1) },
  ];
  for (const paso of pasos) {
    test(`falla ${paso.nombre}: no hay éxito, no queda ningún contrato ni CxP, y el reintento no duplica`, async () => {
      const bd = usarBD(semilla(), RPCS);
      const c = await cotizar(bd, e());
      assert.ok(c.ok);
      const total = c.ok ? c.total : 0;
      const inyecciones = paso.preparar(bd); // falla UNA vez: el reintento sobre la MISMA base debe salir bien
      const r = await reservarPrograma({ ...e(), precioConfirmado: total });
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.ok(inyecciones() >= 1, "el fallo se inyectó");
      assert.doesNotMatch(r.ok ? "" : r.error, /inyectado/, "no se expone el error crudo");
      afirmarSinEscrituras(bd);
      // Reintento: un solo contrato completo, sin restos ni duplicados del intento fallido.
      const ok = await reservarPrograma({ ...e(), precioConfirmado: total });
      assert.equal(ok.ok, true, JSON.stringify(ok));
      assert.equal(bd.filas("ventas").length, 1);
      assert.equal(bd.filas("contrato_programa_estancia").length, 1);
      assert.equal(bd.filas("contrato_programa_estancia_costo").length, 1);
      assert.equal(bd.filas("cuentas_por_pagar").filter((x) => x.tipo_proveedor === "asistencia").length, 1);
      assert.equal(bd.filas("contrato_items").filter((x) => x.modo_precio === "total").length, 1);
    });
  }

  test("falla la creación de pasajeros: se revierte el contrato", async () => {
    const bd = usarBD(semilla(), { ...RPCS, crear_pasajeros_contrato: () => ({ __error: { code: "P0001", message: "pasajeros: fallo inyectado" } }) });
    const c = await cotizar(bd, e());
    const r = await reservarPrograma({ ...e(), precioConfirmado: c.ok ? c.total : 0 });
    assert.equal(r.ok, false);
    afirmarSinEscrituras(bd);
  });

  test("falla la escritura financiera (CxP/costos): no hay éxito, se revierte el contrato completo y el reintento queda con UN juego de CxP", async () => {
    let fallar = true;
    const bd = usarBD(semilla(), {
      ...RPCS,
      registrar_financiero_contrato: (args) => {
        if (fallar) return { __error: { code: "P0001", message: "cxp: fallo inyectado" } };
        return bdPorDefecto(bd, args);
      },
    });
    const c = await cotizar(bd, e());
    const total = c.ok ? c.total : 0;
    const r = await reservarPrograma({ ...e(), precioConfirmado: total });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /no se generó/);
    afirmarSinEscrituras(bd);
    fallar = false;
    const ok = await reservarPrograma({ ...e(), precioConfirmado: total });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(bd.filas("ventas").length, 1);
    assert.equal(bd.filas("cuentas_por_pagar").filter((x) => x.tipo_proveedor === "asistencia").length, 1, "UNA CxP de asistencia");
    assert.equal(bd.filas("cuentas_por_pagar").filter((x) => x.tipo_proveedor === "programa").length, 1);
  });

  test("falla la escritura financiera Y la reversión: el error nombra el contrato y el contrato queda PENDIENTE (no confirmable), recuperable con su payload", async () => {
    const bd = usarBD(semilla(), {
      ...RPCS,
      registrar_financiero_contrato: () => ({ __error: { code: "P0001", message: "cxp: fallo inyectado" } }),
      revertir_contrato_incompleto: () => ({ __error: { code: "P0001", message: "revertir: fallo inyectado" } }),
    });
    const c = await cotizar(bd, e());
    const r = await reservarPrograma({ ...e(), precioConfirmado: c.ok ? c.total : 0 });
    assert.equal(r.ok, false);
    const numero = String(bd.filas("ventas")[0]?.numero_contrato);
    assert.match(r.ok ? "" : r.error, new RegExp(numero));
    assert.equal(bd.filas("ventas")[0].financiero_estado, "pendiente", "un contrato a medias nunca queda como completo");
    assert.equal(bd.filas("contrato_financiero_pendiente").length, 1, "queda el payload exacto para el reintento idempotente");
    assert.equal(bd.filas("cuentas_por_pagar").length, 0);
  });

  test("el asiento contable que no se pudo generar se reporta como aviso (no se oculta) y el contrato queda completo", async () => {
    const bd = usarBD(semilla(), RPCS);
    const c = await cotizar(bd, entrada({ nochesAdicionales: 1 }));
    inyectarFallo(bd, "asientos_contables", "insert", "asiento: fallo inyectado");
    const r = await reservarPrograma({ ...entrada({ nochesAdicionales: 1 }), precioConfirmado: c.ok ? c.total : 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.ok && (r.advertencias ?? []).some((a) => /asiento/i.test(a)), JSON.stringify(r));
    assert.equal(bd.filas("ventas")[0].financiero_estado, "completo");
  });

  test("los pasos del contrato quedan en un orden que no deja datos huérfanos: la escritura financiera es lo ÚLTIMO", async () => {
    const orden: string[] = [];
    const bd = usarBD(semilla(), { ...RPCS, registrar_financiero_contrato: (args) => { orden.push("financiero"); return bdPorDefecto(bd, args); } });
    const original = bd.sb.from.bind(bd.sb) as (t: string) => { insert?: (...a: unknown[]) => unknown };
    (bd.sb as unknown as { from: unknown }).from = (t: string) => {
      const b = original(t);
      if (["contrato_programa_estancia", "contrato_programa_estancia_costo", "contrato_items", "contrato_hoteles"].includes(t) && b.insert) {
        const ins = b.insert.bind(b);
        b.insert = (...a: unknown[]) => { orden.push(t); return ins(...a); };
      }
      return b;
    };
    const c = await cotizar(bd, e());
    const r = await reservarPrograma({ ...e(), precioConfirmado: c.ok ? c.total : 0 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(orden.at(-1), "financiero");
    for (const t of ["contrato_programa_estancia", "contrato_programa_estancia_costo", "contrato_items", "contrato_hoteles"]) assert.ok(orden.includes(t), t);
  });
});

// Emula la respuesta de `registrar_financiero_contrato` del arnés cuando una prueba la sustituye para fallar solo la primera vez.
function bdPorDefecto(bd: BD, args: Record<string, unknown>) {
  const numero = String(args.p_numero_contrato);
  const v = bd.filas("ventas").find((f) => f.numero_contrato === numero && f.tenant === args.p_tenant);
  if (!v) throw new Error(`el contrato ${numero} no existe`);
  Object.assign(v, args.p_costos as Fila, { financiero_estado: "completo" });
  const creadas = ((args.p_cxp as Fila[] | undefined) ?? []).map((c, i) => {
    const fila: Fila = { id: 9000 + bd.filas("cuentas_por_pagar").length + i, numero_contrato: numero, tenant: args.p_tenant, moneda: "COP", ...c };
    bd.filas("cuentas_por_pagar").push(fila);
    return { id: fila.id, tipo_proveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio, servicio_id: c.servicio_id ?? null, valor_total: c.valor_total };
  });
  return { creadas, eliminadas: [] };
}

// ── 5. Solo porciones terrestres ────────────────────────────────────────────
describe("el modo hotel no se combina con aéreo", () => {
  test("el servidor rechaza reservar un programa por hotel con transporte aéreo, sin escribir nada", async () => {
    for (const aereo of [{ tipo_transporte: "aereo" }, { tipo_transporte: null, incluye_aereo: true }]) {
      const bd = usarBD(semilla({ programas: [programa(aereo)] }), RPCS);
      const r = await reservarPrograma({ ...entrada({ nochesAdicionales: 0 }), precioConfirmado: 1 });
      assert.equal(r.ok, false, JSON.stringify(aereo));
      assert.match(r.ok ? "" : r.error, /terrestre/i);
      afirmarSinEscrituras(bd);
    }
  });
  test("«Salida terrestre» y «Porción terrestre» sí pueden usar el modo hotel", async () => {
    for (const tipo of ["ninguno", "terrestre"]) {
      const bd = usarBD(semilla({ programas: [programa({ tipo_transporte: tipo })] }), RPCS);
      const { r } = await reservar(bd, entrada({ nochesAdicionales: 1 }));
      assert.equal(r.ok, true, `${tipo}: ${JSON.stringify(r)}`);
    }
  });
});

// ── 6. Itinerario incompleto ────────────────────────────────────────────────
describe("itinerario incompleto: no se desplaza el último día", () => {
  const incompleto = (dias: number[]) => DIAS.filter((d) => dias.includes(d.dia));
  test("con noches adicionales y un itinerario al que le falta un día: se rechaza y no se escribe nada", async () => {
    for (const faltan of [[1, 2, 4], [1, 2, 3], [2, 3, 4]]) {
      const bd = usarBD(semilla({ programa_dias: incompleto(faltan) }), RPCS);
      const r = await reservarPrograma({ ...entrada({ nochesAdicionales: 1 }), precioConfirmado: 1 });
      assert.equal(r.ok, false, faltan.join(","));
      assert.match(r.ok ? "" : r.error, /itinerario/i);
      afirmarSinEscrituras(bd);
    }
  });
  test("PR #409: el itinerario incompleto NO se reserva ni siquiera sin noches adicionales (se exige 1..N siempre), antes de numerar y de toda escritura", async () => {
    const bd = usarBD(semilla({ programa_dias: incompleto([1, 2, 4]) }), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 0 }));
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.ok ? "" : r.error, /faltan los días 3/);
    assert.equal(bd.filas("ventas").length, 0);
  });
  test("itinerario completo: la recogida cae en el día correcto", async () => {
    const bd = usarBD(semilla(), RPCS);
    const { r } = await reservar(bd, entrada({ nochesAdicionales: 2 }));
    assert.equal(r.ok, true, JSON.stringify(r));
    const it = bd.filas("contrato_programa_estancia")[0].itinerario as { dia: number; titulo: string }[];
    assert.deepEqual(it.map((d) => [d.dia, d.titulo]), [[1, "Llegada"], [2, "Tour ciudad"], [3, "Playa"], [4, "Día libre"], [5, "Día libre"], [6, "Salida"]]);
  });
});

void TABLAS_DE_ESCRITURA;
void totalVisibleContratoItems;

// ── Hallazgo de la corrida contra PostgREST real ────────────────────────────
// La 245 agrega una SEGUNDA FK de programas a proveedores (proveedor_asistencia_id). Desde entonces, un embed `proveedores(...)` sin
// indicar la FK es ambiguo y PostgREST responde PGRST201: ni el listado de programas ni la reserva cargaban. El arnés en memoria no
// puede ver esto; esta guardia impide que un embed desde `programas` vuelva a quedar sin FK explícita.
describe("embeds de proveedores desde programas indican la FK (sin ambigüedad tras la 245)", () => {
  const archivos = ["app/(dashboard)/dashboard/producto/programas/page.tsx", "app/(dashboard)/dashboard/reservar/actions.ts", "lib/programas.ts"];
  for (const f of archivos) {
    test(f, async () => {
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      const selects = src.split(/\r?\n/).filter((l) => /\.select\(/.test(l) && /proveedores/.test(l) && /(programa_destinos_fijos|subtitulo)/.test(l));
      assert.ok(selects.length >= 1, "debe existir el select con el embed");
      for (const l of selects) {
        assert.match(l, /proveedores!programas_proveedor_id_fkey\(/, l.trim().slice(0, 120));
        assert.doesNotMatch(l, /[\s,"]proveedores\(/);
      }
    });
  }
});
