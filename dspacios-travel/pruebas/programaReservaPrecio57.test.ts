// Corre en test:unit (glob pruebas/**/*.test.ts). Usa el arnés en memoria de
// pruebas/support/fechaNegocioArnes.ts (el mismo de fechaNegocioReservasContratos.react.ts).
//
// #57 — `reservarPrograma` REAL contra la BD en memoria del arnés:
//   · paridad: la ficha (`getProgramaDetalle`) y la reserva leen la MISMA BD y
//     cobran el mismo importe, con noches explícitas / NULL y modalidad nueva;
//   · confirmación del precio: si cambió, NO se crea contrato, CxP ni asientos,
//     se devuelve el nuevo importe y hace falta aceptarlo; un segundo cambio en
//     el reintento exige otra confirmación;
//   · regresión del contrato (venta, ítems, condición de pago, CxP y su asiento);
//   · base comisionable B2B: `ventas.impuesto` solo con impuesto del proveedor
//     verificable (modo `impuesto` con tarifa de proveedor).
import { DIA_BOGOTA, MOMENTOS, asientos, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");
const { getProgramaDetalle } = await import("../lib/programas.ts");
const { totalDesdePrecios } = await import("../lib/programas/precioReserva57.ts");
const { calcularNetoProgramaConModalidad } = await import("../lib/calc/programaPrecio.ts");

type Fila = Record<string, unknown>;
type BD = ReturnType<typeof usarBD>;

beforeEach(() => reloj(MOMENTOS[0][1]));
afterEach(() => soltarReloj());

// ── Semillas ───────────────────────────────────────────────────────────────
const programa = (over: Fila = {}): Fila => ({
  id: 3, nombre: "Circuito Andino", subtitulo: null, moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.03,
  asistencia_medica_dia: 4, modo_precio: "salida", dias: 8, noches: 7, proveedor_id: 9,
  vigencia_desde: null, vigencia_hasta: null, edad_nino_min: 2, edad_nino_max: 11, edad_infante_max: 1,
  condicion_pago_tipo: "anticipo_saldo", condicion_pago_pct_inicial: 0.3, condicion_pago_dias_saldo: 30,
  restriccion_comercial: "normal",
  regla_comisionable: false, regla_comisionable_modalidad_mk: "historica", regla_comisionable_modo: "pct",
  regla_comisionable_valor: 0, regla_comisionable_pct_comision: 0, regla_comisionable_impuesto_por_acomodacion: false,
  proveedores: { nombre: "Operador Andes", aplica_retencion: false, pct_retencion: 0 },
  programa_destinos_fijos: null,
  ...over,
});
const salida = (over: Fila = {}): Fila => ({
  id: 11, programa_id: 3, orden: 0, etiqueta: "Marzo", fecha_desde: "2027-03-01", fecha_hasta: "2027-03-08",
  noches: null, columna: null, bajo_solicitud: false,
  neto_sencilla: 1400, neto_doble: 1000, neto_triple: 900, neto_multiple: null, neto_nino: 700,
  tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null,
  impuesto_sencilla: null, impuesto_doble: null, impuesto_triple: null, impuesto_multiple: null,
  ...over,
});
const seed = (prog: Fila, salidas: Fila[]) => ({
  programas: [prog],
  programa_salidas: salidas,
  programa_categorias: [],
  programa_precios: [],
});
const RPCS = { congelar_condiciones_contrato: () => "OK" };

const entrada = (over: Fila = {}) => ({
  programaId: 3, categoriaId: 11, salidaId: 11, fechaIda: "2027-03-01", paxPorAcom: { doble: 1 }, ninos: 0,
  cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "2027-02-01", pasajeros: [] as never[], precioConfirmado: 0,
  ...over,
});

/** El importe que muestra la ficha (y por tanto el formulario) para la selección. */
async function importeFicha(bd: BD, sel: { salidaId?: number; categoriaId?: number; habs: Record<string, number>; ninos: number }) {
  const det = await getProgramaDetalle(bd.sb as never, 3);
  assert.ok(det);
  const precios = sel.salidaId != null
    ? det.salidas.find((s) => s.id === sel.salidaId)!.precios
    : det.categorias.find((c) => c.id === sel.categoriaId)!.precios;
  const adultos = precios.filter((p) => p.acomodacion !== "nino" && p.pvp != null).map((p) => ({ acomodacion: p.acomodacion, pvp: p.pvp }));
  const precioNino = precios.find((p) => p.acomodacion === "nino")?.pvp ?? null;
  return totalDesdePrecios({ adultos, precioNino, habitaciones: sel.habs, ninos: sel.ninos });
}

const TABLAS_DE_ESCRITURA = ["ventas", "contrato_items", "contrato_hoteles", "contrato_pasajeros", "cuentas_por_pagar", "asientos_contables", "asiento_lineas", "aliados_b2b"];
function afirmarSinEscrituras(bd: BD) {
  for (const t of TABLAS_DE_ESCRITURA) assert.equal(bd.filas(t).length, 0, `no debe haber filas en ${t}`);
  assert.equal(bd.llamadasRpc.length, 0, "no debe haber RPC de escritura (condiciones, pasajeros…)");
  const a = (globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas;
  assert.equal(a.seq, undefined, "no se debe consumir un número de contrato");
}

// ── Paridad ficha == reserva ───────────────────────────────────────────────
test("salida con noches NULL: la reserva cobra lo que muestra la ficha (asistencia por los 8 días del programa, no 7)", async () => {
  const bd = usarBD(seed(programa(), [salida()]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
  assert.equal(esperado, 1252 * 2, "doble = 2 pax; PVP/persona 1.252 con 8 días de asistencia");
  const r = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta.precio_venta, esperado);
  assert.equal(venta.moneda, "USD");
  // Las fechas del viaje NO cambian: el regreso sigue siendo ida + (días − 1).
  assert.equal(venta.fecha_regreso, "2027-03-08");
});

test("salida con noches explícitas: se usan esas noches (7) y la ficha coincide", async () => {
  const bd = usarBD(seed(programa(), [salida({ noches: 7 })]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
  assert.equal(esperado, 1247 * 2);
  const r = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("ventas")[0].precio_venta, esperado);
});

test("modalidad nueva con tarifa de proveedor: la reserva cobra el precio de la ficha (1.129), no el del neto histórico (1.135)", async () => {
  const prog = programa({
    regla_comisionable: true, regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final",
    regla_comisionable_modo: "pct", regla_comisionable_valor: 3, regla_comisionable_pct_comision: 10,
  });
  const bd = usarBD(seed(prog, [salida({ neto_doble: 903, tarifa_doble: 1000 })]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
  assert.equal(esperado, 1129 * 2);
  const r = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("ventas")[0].precio_venta, 1129 * 2);
});

test("modo categoría COP con fee: borde de redondeo 3.701.000 por persona y total = ficha", async () => {
  const prog = programa({ moneda: "COP", modo_precio: "categoria", pct_mk: 0.3, pct_fee_tarjeta: 0, asistencia_medica_dia: 0, dias: 5 });
  const bd = usarBD({
    programas: [prog], programa_salidas: [], programa_categorias: [{ id: 5, programa_id: 3, orden: 0, nombre: "Turista" }],
    programa_precios: [{ categoria_id: 5, acomodacion: "doble", neto: 2_590_000, bajo_solicitud: false }, { categoria_id: 5, acomodacion: "nino", neto: 1_000_000, bajo_solicitud: false }],
  }, RPCS);
  const esperado = await importeFicha(bd, { categoriaId: 5, habs: { doble: 1 }, ninos: 1 });
  assert.equal(esperado, 3_701_000 * 2 + 1_429_000, "2 pax + 1 niño");
  const r = await reservarPrograma(entrada({ categoriaId: 5, salidaId: undefined, paxPorAcom: { doble: 1 }, ninos: 1, precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta.precio_venta, esperado);
  const items = bd.filas("contrato_items");
  const sumaItems = items.reduce((s, i) => s + Number(i.tarifa_adulto) * Number(i.adultos) + Number(i.tarifa_nino) * Number(i.ninos), 0);
  assert.equal(sumaItems, esperado, "los ítems del contrato suman el total cobrado");
});

// ── Confirmación del precio ────────────────────────────────────────────────
test("precio distinto al confirmado: devuelve el nuevo importe y NO crea contrato, CxP, asientos ni número", async () => {
  const bd = usarBD(seed(programa(), [salida()]), RPCS);
  const r = await reservarPrograma(entrada({ precioConfirmado: 2400 }));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && "cambioPrecio" in r);
  if (!r.ok && "cambioPrecio" in r) assert.deepEqual(r.cambioPrecio, { anterior: 2400, nuevo: 2504, moneda: "USD" });
  afirmarSinEscrituras(bd);
});

test("sin importe confirmado (o NaN / negativo) no se reserva y se devuelve el importe a confirmar", async () => {
  for (const malo of [undefined, null, Number.NaN, -5]) {
    const bd = usarBD(seed(programa(), [salida()]), RPCS);
    const r = await reservarPrograma(entrada({ precioConfirmado: malo as never }));
    assert.equal(r.ok, false, String(malo));
    if (!r.ok && "cambioPrecio" in r) { assert.equal(r.cambioPrecio.anterior, null); assert.equal(r.cambioPrecio.nuevo, 2504); }
    else assert.fail("debía devolver cambioPrecio");
    afirmarSinEscrituras(bd);
  }
});

test("aceptación expresa y SEGUNDO cambio: cada reintento recalcula; solo el importe vigente crea el contrato", async () => {
  const bd = usarBD(seed(programa(), [salida()]), RPCS);
  // 1) el usuario confirmó un importe viejo.
  const r1 = await reservarPrograma(entrada({ precioConfirmado: 2400 }));
  assert.ok(!r1.ok && "cambioPrecio" in r1);
  const nuevo1 = !r1.ok && "cambioPrecio" in r1 ? r1.cambioPrecio.nuevo : -1;
  assert.equal(nuevo1, 2504);
  afirmarSinEscrituras(bd);
  // 2) el programa se edita ANTES del reintento (el proveedor sube el markup).
  bd.filas("programas")[0].pct_mk = 0.2;
  const r2 = await reservarPrograma(entrada({ precioConfirmado: nuevo1 }));
  assert.ok(!r2.ok && "cambioPrecio" in r2, "el importe aceptado dejó de ser vigente: otra confirmación");
  const nuevo2 = !r2.ok && "cambioPrecio" in r2 ? r2.cambioPrecio.nuevo : -1;
  assert.notEqual(nuevo2, nuevo1);
  if (!r2.ok && "cambioPrecio" in r2) assert.equal(r2.cambioPrecio.anterior, nuevo1);
  afirmarSinEscrituras(bd);
  // 3) acepta el vigente: ahora sí.
  const r3 = await reservarPrograma(entrada({ precioConfirmado: nuevo2 }));
  assert.equal(r3.ok, true, JSON.stringify(r3));
  assert.equal(bd.filas("ventas").length, 1);
  assert.equal(bd.filas("ventas")[0].precio_venta, nuevo2);
});

test("otros rechazos tampoco escriben (acomodación sin precio, selección vacía)", async () => {
  const bd = usarBD(seed(programa(), [salida()]), RPCS);
  const a = await reservarPrograma(entrada({ paxPorAcom: { cuadruple: 1 }, precioConfirmado: 1 }));
  assert.equal(a.ok, false);
  const b = await reservarPrograma(entrada({ paxPorAcom: {}, ninos: 0, precioConfirmado: 1 }));
  assert.equal(b.ok, false);
  afirmarSinEscrituras(bd);
});

// ── Regresión del contrato ─────────────────────────────────────────────────
test("regresión: venta pendiente, ítems, condición de pago congelada, CxP al proveedor (neto × pax) y su asiento", async () => {
  const prog = programa({ moneda: "COP", modo_precio: "categoria", pct_mk: 0.1, pct_fee_tarjeta: 0, asistencia_medica_dia: 0, dias: 5, noches: 4 });
  const bd = usarBD({
    programas: [prog], programa_salidas: [], programa_categorias: [{ id: 5, programa_id: 3, nombre: "Turista" }],
    programa_precios: [{ categoria_id: 5, acomodacion: "doble", neto: 1_000_000, bajo_solicitud: false }],
  }, RPCS);
  const esperado = await importeFicha(bd, { categoriaId: 5, habs: { doble: 1 }, ninos: 0 });
  assert.equal(esperado, 1_112_000 * 2);
  const r = await reservarPrograma(entrada({ categoriaId: 5, salidaId: undefined, fechaIda: "2026-10-30", plazo: "2026-10-10", precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  const [venta] = bd.filas("ventas");
  assert.equal(venta.estado, "pendiente");
  assert.equal(venta.tipo_paquete, "programa");
  assert.equal(venta.pax, 2);
  assert.equal(venta.costo_receptivo, 2_000_000);
  assert.equal(venta.impuesto, undefined, "un interno B2C no recibe impuesto");
  const [item] = bd.filas("contrato_items");
  assert.equal(item.descripcion, "1 hab Doble (2 pax) · Turista");
  const congelar = bd.llamadasRpc.find((c) => c.fn === "congelar_condiciones_contrato");
  assert.ok(congelar);
  const [fila] = congelar!.args.p_snapshot as Array<{ valor_componente: number; monto_exigido: number }>;
  assert.equal(fila.valor_componente, esperado);
  const [cxp] = bd.filas("cuentas_por_pagar");
  assert.equal(cxp.tipo_proveedor, "programa");
  assert.equal(cxp.valor_total, 2_000_000);
  assert.equal(cxp.fecha_obligacion, DIA_BOGOTA);
  assert.equal(asientos(bd, "cxp").length, 1);
});

// ── Base comisionable B2B ──────────────────────────────────────────────────
const reglaImpuesto = (modo: string, valor: number) => programa({
  regla_comisionable: true, regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final",
  regla_comisionable_modo: modo, regla_comisionable_valor: valor, regla_comisionable_pct_comision: 10,
});
// El neto persistido debe ser el VIGENTE de la regla (lo exige la reserva en modalidad nueva).
const salidaConTarifa = (modo: "pct" | "impuesto" | "ninguno" = "pct", valor = 3) =>
  salida({
    tarifa_doble: 1000,
    neto_doble: calcularNetoProgramaConModalidad({ tarifa: 1000, modo, valor, pctComision: 10 }, "base_neta_impuestos_al_final").neto,
  });

async function reservarB2B(prog: Fila, sal: Fila, over: Fila = {}) {
  const bd = usarBD(seed(prog, [sal]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: Number(over.ninos ?? 0) });
  const r = await reservarPrograma(entrada({ tipoAsesor: "agencia", agenciaNombre: "Viajes Sol", precioConfirmado: esperado, ...over }));
  assert.equal(r.ok, true, JSON.stringify(r));
  return { bd, r, venta: bd.filas("ventas")[0], esperado };
}

test("B2B, modo impuesto con tarifa de proveedor: ventas.impuesto = impuesto verificable × pax (2 pax)", async () => {
  const { venta, esperado } = await reservarB2B(reglaImpuesto("impuesto", 120), salidaConTarifa("impuesto", 120));
  assert.equal(venta.impuesto, 240);
  assert.equal(venta.tipo_asesor, "agencia");
  assert.equal(venta.precio_venta, esperado, "el impuesto no cambia el precio cobrado");
});

test("B2B, modo pct: la reducción de base NO es impuesto → ventas.impuesto sin escribir (aunque montoNoComisionable > 0)", async () => {
  const { venta, r } = await reservarB2B(reglaImpuesto("pct", 3), salidaConTarifa());
  assert.equal(venta.impuesto, undefined);
  assert.ok(r.ok && !r.advertencias, "sin aviso: la regla pct no declara impuesto");
});

test("B2B, modo ninguno: la regla no informa impuesto", async () => {
  const { venta } = await reservarB2B(reglaImpuesto("ninguno", 0), salidaConTarifa("ninguno", 0));
  assert.equal(venta.impuesto, undefined);
});

test("B2B, modo impuesto SIN tarifa de proveedor en la acomodación: no hay fuente → sin impuesto, con aviso del residual", async () => {
  const { venta, r } = await reservarB2B(reglaImpuesto("impuesto", 120), salida());
  assert.equal(venta.impuesto, undefined);
  assert.ok(r.ok && r.advertencias?.some((a) => /Base comisionable B2B/.test(a)), "reporta el residual, no lo oculta");
});

test("B2B, modo impuesto con niño: el niño no tiene tarifa de proveedor → el impuesto cubre solo a los adultos y se avisa", async () => {
  const { venta, r } = await reservarB2B(reglaImpuesto("impuesto", 120), salidaConTarifa("impuesto", 120), { ninos: 1 });
  assert.equal(venta.impuesto, 240);
  assert.ok(r.ok && r.advertencias?.some((a) => /1 pasajero\(s\) sin impuesto/.test(a)));
});

test("interno (B2C): nunca se escribe ventas.impuesto, aunque haya fuente fiscal", async () => {
  const bd = usarBD(seed(reglaImpuesto("impuesto", 120), [salidaConTarifa("impuesto", 120)]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
  const r = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("ventas")[0].impuesto, undefined);
});

test("la reserva B2B no crea comisión ni cuenta de cobro por su cuenta (solo hacia adelante, sin tocar históricos)", async () => {
  const { bd } = await reservarB2B(reglaImpuesto("impuesto", 120), salidaConTarifa("impuesto", 120));
  assert.equal(bd.filas("aliados_b2b").length, 0);
});

// ── Modalidad nueva: neto persistido (CxP) vs recalculado (PVP) ────────────
const nuevaPct = () => reglaImpuesto("pct", 3); // tarifa 1.000, pct 3 %, comisión 10 % → neto recalculado 903

test("neto VIGENTE (persistido == recalculado): se reserva; la CxP sale del neto persistido y el PVP del recalculado", async () => {
  const bd = usarBD(seed(nuevaPct(), [salida({ neto_doble: 903, tarifa_doble: 1000 })]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
  const r = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("cuentas_por_pagar")[0].valor_total, 903 * 2, "CxP = neto persistido × pax");
  assert.equal(bd.filas("ventas")[0].precio_venta, 1129 * 2);
});

test("neto OBSOLETO (USD): se rechaza antes del número y de toda escritura, pidiendo actualizar y recotizar", async () => {
  for (const persistido of [850, 910]) {
    const bd = usarBD(seed(nuevaPct(), [salida({ neto_doble: persistido, tarifa_doble: 1000 })]), RPCS);
    const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
    const r = await reservarPrograma(entrada({ precioConfirmado: esperado }));
    assert.equal(r.ok, false, `persistido ${persistido}`);
    if (!r.ok) {
      assert.ok(!("cambioPrecio" in r), "no es un cambio de precio: es una configuración que hay que corregir");
      assert.match(r.error, /Actualiza las tarifas de la salida.*vuelve a cotizar/);
      assert.doesNotMatch(r.error, /\d/, "el usuario (incluido `venta`) no ve netos del proveedor");
    }
    afirmarSinEscrituras(bd);
  }
});

test("neto OBSOLETO (COP, modo impuesto): rechazo sin CxP, contrato, asientos ni número", async () => {
  const prog = programa({
    moneda: "COP", pct_fee_tarjeta: 0.035, asistencia_medica_dia: 4500,
    regla_comisionable: true, regla_comisionable_modalidad_mk: "base_neta_impuestos_al_final",
    regla_comisionable_modo: "impuesto", regla_comisionable_valor: 150_000, regla_comisionable_pct_comision: 10,
  });
  const bd = usarBD(seed(prog, [salida({ tarifa_doble: 2_500_000, neto_doble: 2_250_000 })]), RPCS);
  const r = await reservarPrograma(entrada({ precioConfirmado: 1 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(!("cambioPrecio" in r) && /no coincide con el recalculado/.test(r.error), "gana el neto obsoleto sobre el cambio de precio");
  afirmarSinEscrituras(bd);
});

test("con niños: un adulto obsoleto bloquea; el niño (sin tarifa de proveedor) no se compara", async () => {
  const mal = usarBD(seed(nuevaPct(), [salida({ neto_doble: 850, tarifa_doble: 1000 })]), RPCS);
  const rm = await reservarPrograma(entrada({ ninos: 1, precioConfirmado: 1 }));
  assert.equal(rm.ok, false);
  afirmarSinEscrituras(mal);

  const bd = usarBD(seed(nuevaPct(), [salida({ neto_doble: 903, tarifa_doble: 1000 })]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 1 });
  const ok = await reservarPrograma(entrada({ ninos: 1, precioConfirmado: esperado }));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(bd.filas("cuentas_por_pagar")[0].valor_total, 903 * 2 + 700, "CxP = neto persistido × pax + niño");
});

test("actualizar y recotizar: corregida la salida, el mismo intento pasa", async () => {
  const bd = usarBD(seed(nuevaPct(), [salida({ neto_doble: 850, tarifa_doble: 1000 })]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
  const r1 = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r1.ok, false);
  afirmarSinEscrituras(bd);
  bd.filas("programa_salidas")[0].neto_doble = 903; // el equipo actualiza la salida
  const r2 = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(bd.filas("cuentas_por_pagar")[0].valor_total, 903 * 2);
});

test("fuera de la modalidad nueva no se exige: histórica con regla activa y tarifa reserva con el neto persistido", async () => {
  const prog = programa({ ...nuevaPct(), regla_comisionable_modalidad_mk: "historica" });
  const bd = usarBD(seed(prog, [salida({ neto_doble: 850, tarifa_doble: 1000 })]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 1 }, ninos: 0 });
  const r = await reservarPrograma(entrada({ precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("cuentas_por_pagar")[0].valor_total, 850 * 2);
});

// ── El precio cubre el costo + la asistencia de quienes pagan ──────────────
test("el precio cubre costo y asistencia (con fee que no cuenta como costo): se reserva", async () => {
  const bd = usarBD(seed(programa({ pct_fee_tarjeta: 0.035, asistencia_medica_dia: 4 }), [salida()]), RPCS);
  const esperado = await importeFicha(bd, { salidaId: 11, habs: { doble: 2 }, ninos: 1 });
  const r = await reservarPrograma(entrada({ paxPorAcom: { doble: 2 }, ninos: 1, infantes: 2, precioConfirmado: esperado }));
  assert.equal(r.ok, true, JSON.stringify(r));
});
