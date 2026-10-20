// #57 — Inyección de fallo: el precio exigible debe cubrir el costo del programa y
// la asistencia de los pasajeros a quienes se les cobra (sin contar el fee).
//
// Con datos consistentes el motor de PVP siempre cobra ≥ costo (marca hacia
// arriba), así que el rechazo no se alcanza por datos. Para probar el control de
// punta a punta se SUSTITUYE el motor de PVP (`lib/calc/programaPrecio.ts`) por
// uno que cobra exactamente `neto + asistencia×días + delta` por persona:
//   · delta = 0   → precio == costo: cubre (borde).
//   · delta = −1  → un peso/dólar menos por persona: NO cubre → se rechaza.
// En cada rechazo: sin contrato, CxP, asientos, pasajeros ni número.
import { MOMENTOS, reloj, soltarReloj, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, mock, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const real = await import("../lib/calc/programaPrecio.ts");
let delta = 0;
const costoUnitario = (neto: number, asistenciaDia?: number, dias?: number | null) =>
  Number(neto) + (Number(asistenciaDia) || 0) * Math.max(0, Number(dias) || 0);

mock.module("../lib/calc/programaPrecio.ts", {
  namedExports: {
    ...real,
    pvpPrograma: (neto: number, opt: { asistenciaDia?: number; dias?: number | null }) => costoUnitario(neto, opt.asistenciaDia, opt.dias) + delta,
    calcularPvpAcomodacionSalida: (i: { neto: number | null; opt: { asistenciaDia?: number; dias?: number | null } }) =>
      i.neto == null || !(Number(i.neto) > 0) ? null : costoUnitario(i.neto, i.opt.asistenciaDia, i.opt.dias) + delta,
  },
});

const { reservarPrograma } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

type Fila = Record<string, unknown>;
type BD = ReturnType<typeof usarBD>;

let espiaLog: ReturnType<typeof mock.method>;
beforeEach(() => { delta = 0; reloj(MOMENTOS[0][1]); espiaLog = mock.method(console, "error", () => {}); });
afterEach(() => { soltarReloj(); espiaLog.mock.restore(); });

const programa = (over: Fila = {}): Fila => ({
  id: 3, nombre: "Circuito Andino", subtitulo: null, moneda: "USD", pct_mk: 0.15, pct_fee_tarjeta: 0.035,
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
const RPCS = { congelar_condiciones_contrato: () => "OK" };
const entrada = (over: Fila = {}) => ({
  programaId: 3, categoriaId: 11, salidaId: 11, fechaIda: "2027-03-01", paxPorAcom: { doble: 1 }, ninos: 0,
  cliente: { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "1010", telefono: "300", email: "" },
  tipoAsesor: "interno" as const, asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "",
  plazo: "2027-02-01", pasajeros: [] as never[], precioConfirmado: 0,
  ...over,
});

const TABLAS = ["ventas", "contrato_items", "contrato_hoteles", "contrato_pasajeros", "cuentas_por_pagar", "asientos_contables", "asiento_lineas", "aliados_b2b"];
function afirmarSinEscrituras(bd: BD) {
  for (const t of TABLAS) assert.equal(bd.filas(t).length, 0, `no debe haber filas en ${t}`);
  assert.equal(bd.llamadasRpc.length, 0);
  assert.equal((globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas.seq, undefined, "no se consume número de contrato");
}

test("borde: precio == costo (neto + asistencia de quienes pagan), con fee 3,5 % que no cuenta: se reserva", async () => {
  const bd = usarBD({ programas: [programa()], programa_salidas: [salida()], programa_categorias: [], programa_precios: [] }, RPCS);
  // 2 hab. dobles (4 pax) + 1 niño: neto 4×1.000 + 700 + asistencia 4 USD × 8 días × 5 pax = 4.860.
  const r = await reservarPrograma(entrada({ paxPorAcom: { doble: 2 }, ninos: 1, infantes: 2, precioConfirmado: 4860 }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("ventas")[0].precio_venta, 4860);
});

test("un dólar menos por persona: el precio no cubre costo + asistencia → rechazo sin contrato, CxP, asientos ni número", async () => {
  delta = -1;
  const bd = usarBD({ programas: [programa()], programa_salidas: [salida()], programa_categorias: [], programa_precios: [] }, RPCS);
  const r = await reservarPrograma(entrada({ paxPorAcom: { doble: 2 }, ninos: 1, precioConfirmado: 4860 }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(!("cambioPrecio" in r), "es un error de configuración, no un cambio de precio a aceptar");
    assert.match(r.error, /no cubre el costo del programa y la asistencia de los pasajeros cobrados/);
    assert.doesNotMatch(r.error, /\d/, "el usuario (incluido `venta`) no ve cifras de costo");
  }
  // Las cifras de costo tampoco salen en los logs (la política de logs no admite datos de negocio).
  assert.ok(!espiaLog.mock.calls.some((c) => /4\.?860/.test(String(c.arguments[0]))), "el costo no debe loguearse");
  afirmarSinEscrituras(bd);
});

test("COP en modo categoría: borde 0 cubre; −1 peso por persona no", async () => {
  const prog = programa({ moneda: "COP", modo_precio: "categoria", asistencia_medica_dia: 4500, dias: 5, noches: 4, pct_fee_tarjeta: 0.035 });
  const seed = () => ({
    programas: [prog], programa_salidas: [], programa_categorias: [{ id: 5, programa_id: 3, nombre: "Turista" }],
    programa_precios: [{ categoria_id: 5, acomodacion: "doble", neto: 1_000_000, bajo_solicitud: false }],
  });
  const costo = (1_000_000 + 4500 * 5) * 2;
  const bd1 = usarBD(seed(), RPCS);
  const ok = await reservarPrograma(entrada({ categoriaId: 5, salidaId: undefined, fechaIda: "2026-10-30", plazo: "2026-10-10", precioConfirmado: costo }));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(bd1.filas("ventas")[0].precio_venta, costo);

  delta = -1;
  const bd2 = usarBD(seed(), RPCS);
  const mal = await reservarPrograma(entrada({ categoriaId: 5, salidaId: undefined, fechaIda: "2026-10-30", plazo: "2026-10-10", precioConfirmado: costo }));
  assert.equal(mal.ok, false);
  if (!mal.ok) assert.match(mal.error, /no cubre el costo/);
  afirmarSinEscrituras(bd2);
});

test("la asistencia cuenta con las noches explícitas de la salida (no con los días del programa)", async () => {
  delta = -1;
  // noches = 3 → asistencia 4×3 = 12 por persona; el motor simulado cobra neto + 12 − 1 < costo.
  const bd = usarBD({ programas: [programa()], programa_salidas: [salida({ noches: 3 })], programa_categorias: [], programa_precios: [] }, RPCS);
  const r = await reservarPrograma(entrada({ precioConfirmado: 1 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.doesNotMatch(r.error, /\d/);
  assert.ok(!espiaLog.mock.calls.some((c) => /2\.?024/.test(String(c.arguments[0]))), "el costo (1.000 + 12) × 2 pax no debe loguearse");
  afirmarSinEscrituras(bd);
});
