// Se ejecuta con npm run test:react (loader del arnés).
//
// #38 · Comisiones B2B con el código REAL contra la BD en memoria del arnés,
// por flujo: contrato manual, contrato migrado (histórico), tarifario
// comisionable y NETO; más permisos, abonos, cuenta de cobro (resolvedor),
// la página de Comisiones y Rentabilidad.
//
// Lo que la BD en memoria NO simula (RLS, triggers, FK RESTRICT, carreras) se
// prueba contra Postgres real en supabase/scripts/test_205_comisiones_b2b.sql
// y test_205_carrera_abonos.sh. Aquí se prueba que el SERVIDOR también lo
// exige, aunque la llamada llegue directa a la Server Action.
import { usarBD, type Fila } from "./support/fechaNegocioArnes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ??= "clave-de-prueba";

const { crearContrato } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { crearComisionB2B, eliminarComisionB2B } = await import("../app/(dashboard)/dashboard/contratos/[numero]/gestion-actions.ts");
const { actualizarComisionB2B, registrarPagoComisionB2B, deshacerUltimoPagoComisionB2B } = await import("../app/(dashboard)/dashboard/comisiones/actions.ts");
const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
const { calcularRentabilidad } = await import("../lib/finanzas/rentabilidad.ts");
const { default: ComisionesPage } = await import("../app/(dashboard)/dashboard/comisiones/page.tsx");
const { calcularComisionFila } = await import("../lib/finanzas/comisionB2B.ts");

const ALIADO = { id: 7, nombre: "Agencia Prueba", nit: "900", pct_comision: 0.1, aplica_retencion: false, pct_retencion: 0 };
const yo = (rol: string, extra: Fila = {}): Fila => ({
  id: "u-arnes", nombre: "Usuario Prueba", rol, tenant: "mayorista", activo: true, aliado_id: null, acceso_legacy_nombre: false, ...extra,
});
const venta = (numero: string, extra: Fila = {}): Fila => ({
  numero_contrato: numero, tenant: "mayorista", cliente: "C", destino: "SMR", fecha_salida: "2026-11-01", fecha_venta: "2026-10-01",
  precio_venta: 1_000_000, impuesto: 200_000, moneda: "COP", modo_compra: null, comision_b2b: null, comision_estado: null,
  tipo_asesor: "freelance", freelance_nombre: "Freelance Prueba", agencia_nombre: null, b2b_usuario_id: null, aliado_id: null,
  canal: "B2B", ...extra,
});
const comision = (id: number, numero: string, extra: Fila = {}): Fila => ({
  id, numero_contrato: numero, tenant: "mayorista", aliado: "Freelance Prueba", tipo_aliado: "freelance", aliado_id: null,
  precio_venta: 1_000_000, base_comision: 800_000, base_explicita: true, comision_valor: null, pct_comision: 0.1,
  recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false,
  ...extra,
});
const totalDe = (f: Fila | undefined) => calcularComisionFila(f as never).totalPagar;
const cuenta = async (numero: string, id?: number) => {
  const r = await resolverComisionB2B(numero, id);
  return r;
};

// ═══ Flujo: contrato manual ══════════════════════════════════════════════
function contratoB2B(bncFijo: number) {
  return {
    tipoPaquete: "dinamico" as const, paqueteId: null, bloqueoId: null,
    cliente: "Cliente Prueba", clienteDocumento: "", clienteTelefono: "", clienteDireccion: "",
    destino: "CARTAGENA", fechaSalida: "2026-11-01", fechaRegreso: "2026-11-04", fechaEmision: "2026-10-01",
    asistenciaMedica: false, planNombre: "", toursTraslados: "",
    asesorNombre: "Asesor", asesorCargo: "", asesorCc: "", asesorTel: "",
    pasajeros: [],
    hoteles: [{
      nombre: "Hotel Sol", categoria: "Estándar", proveedor: "Operador Sol", ciudad: "Cartagena", alimentacion: "PC",
      acomodacion: "Doble", detalleAcomodacion: "", fechaIngreso: "2026-11-01", fechaSalida: "2026-11-04", costo: 400_000,
    }],
    vuelos: [],
    items: [{ descripcion: "Paquete Cartagena", adultos: 2, ninos: 0, tarifaAdulto: 500_000, tarifaNino: 0 }],
    tipoVenta: "agencia" as const,
    aliadoId: 7,
    bncModo: "fijo" as const,
    bncFijo,
  };
}

test("MANUAL B2B: ya NO genera comisión; nace 'Por definir' (decisión del dueño)", async () => {
  const bd = usarBD({ aliados: [ALIADO], usuarios: [yo("administracion")] });
  const r = await crearContrato(contratoB2B(200_000));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(bd.filas("aliados_b2b").length, 0, "sin comisión automática");
  assert.equal((r as { advertencias?: string[] }).advertencias, undefined, "no es un error: es el estado esperado");
  const [venta] = bd.filas("ventas");
  assert.equal(venta?.canal, "B2B");
  assert.equal(venta?.aliado_id, 7, "el vínculo con el aliado del catálogo se conserva");
  // En Comisiones aparece como "Por definir".
  const filas = filasDeComisiones(await ComisionesPage());
  const f = filas.find((x) => x.numero_contrato === venta?.numero_contrato);
  assert.equal(f?.estado, "sin_definir");
});

test("MANUAL B2B: el aliado sigue siendo obligatorio y del catálogo", async () => {
  usarBD({ aliados: [] });
  const sinCatalogo = await crearContrato(contratoB2B(200_000));
  assert.equal(sinCatalogo.ok, false);
  const bd = usarBD({ aliados: [ALIADO] });
  const sinAliado = await crearContrato({ ...contratoB2B(200_000), aliadoId: null });
  assert.equal(sinAliado.ok, false);
  assert.equal(bd.filas("ventas").length, 0);
});

// ═══ Flujo: pestaña Comisiones del contrato (alta) ═══════════════════════
// La regla real (contrato propio, tenant, NETO, aliado, base = PVP − impuesto)
// la aplica registrar_comision_b2b_manual en la base: probada en Postgres
// (test_205_comisiones_b2b.sql, MAN1–MAN17). Aquí: la acción la usa siempre,
// no manda precio del navegador, filtra roles y no se traga errores.
const alta = {
  numeroContrato: "DTM-0451", aliado: "Freelance Prueba", nit: "", tipoAliado: "freelance", aliadoId: 7,
  pctComision: 0.1, recobroTotal: 0, pctRecobroAliado: 0.5, aplicaRetencion: false, pctRetencion: 0,
};
const rpcManual = (respuesta: (args: Record<string, unknown>) => unknown) => ({ registrar_comision_b2b_manual: respuesta });

test("PESTAÑA: venta (asesor) registra por la función de la base, sin precio del navegador", async () => {
  const bd = usarBD({ usuarios: [yo("venta")] }, rpcManual(() => 501));
  const r = await crearComisionB2B({ ...alta, precioVenta: 1 } as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  const [llamada] = bd.llamadasRpc.filter((c) => c.fn === "registrar_comision_b2b_manual");
  assert.ok(llamada, "usa registrar_comision_b2b_manual");
  assert.equal(llamada.args.p_numero, "DTM-0451");
  assert.equal(llamada.args.p_aliado_id, 7);
  assert.equal(llamada.args.p_pct, 0.1);
  assert.equal("p_precio_venta" in llamada.args || "precioVenta" in llamada.args, false, "ningún precio viaja desde el navegador");
  assert.equal(bd.filas("aliados_b2b").length, 0, "la acción no inserta directo");
});

test("PESTAÑA: lo que la base rechaza (contrato ajeno, NETO, otro tenant) llega como error, no se traga", async () => {
  usarBD({ usuarios: [yo("venta")] }, rpcManual(() => { throw new Error("Solo puedes registrar la comisión de tus propios contratos."); }));
  const r = await crearComisionB2B(alta);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /tus propios contratos/);
});

test("PESTAÑA: control_vuelo, externos e inactivos no llegan a la base; % fuera de rango tampoco", async () => {
  for (const perfil of [yo("control_vuelo"), yo("agencia"), yo("freelance"), yo("administracion", { activo: false })]) {
    const bd = usarBD({ usuarios: [perfil] }, rpcManual(() => 501));
    const r = await crearComisionB2B(alta);
    assert.equal(r.ok, false, String(perfil.rol));
    assert.equal(bd.llamadasRpc.length, 0, `${perfil.rol}: sin llamada a la base`);
  }
  const bd = usarBD({ usuarios: [yo("administracion")] }, rpcManual(() => 501));
  assert.equal((await crearComisionB2B({ ...alta, pctComision: 1.5 })).ok, false);
  assert.equal((await crearComisionB2B({ ...alta, pctComision: 0, recobroTotal: 100_000, pctRecobroAliado: 0 })).ok, true, "% 0 y % de recobro 0 son legítimos");
  assert.equal(bd.llamadasRpc.at(-1)?.args.p_pct_recobro, 0, "el 0 del recobro no se cambia por 50 %");
});

// ═══ Flujo: contrato migrado (histórico, filas anteriores a la 205) ══════
test("MIGRADO: una fila legado con base 0 se sigue leyendo sobre el PVP en la cuenta de cobro", async () => {
  usarBD({
    usuarios: [yo("superadmin")],
    ventas: [venta("MIN-00-0451", { tenant: "minorista", impuesto: 0 })],
    aliados_b2b: [comision(31, "MIN-00-0451", { tenant: "minorista", base_comision: 0, base_explicita: null, pct_comision: 0.0833 })],
    aliados: [],
  });
  const r = await cuenta("MIN-00-0451");
  assert.equal(r?.tipo, "comision");
  if (r?.tipo !== "comision") return;
  assert.equal(r.detalle.totalPagar, 83_300, "el % ajustado a mano sobre el PVP: igual que antes");
  assert.equal(r.detalle.baseComisionable, 1_000_000, "muestra la base que de verdad se usó");
});

test("MIGRADO: editar una fila legado sin tocar la base (casilla vacía) no cambia su total", async () => {
  const bd = usarBD({
    usuarios: [yo("administracion", { tenant: "minorista" })],
    ventas: [venta("MIN-00-0451", { tenant: "minorista", impuesto: 0 })],
    aliados_b2b: [comision(31, "MIN-00-0451", { tenant: "minorista", base_comision: 0, base_explicita: null, pct_comision: 0.0833 })],
  });
  const r = await actualizarComisionB2B(31, { base: null, modo: "pct", pct: 0.0833, valor: null, recobroTotal: 50_000, pctRecobroAliado: 0.5 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const f = bd.filas("aliados_b2b")[0];
  assert.equal(f?.base_comision, 0);
  assert.equal(f?.base_explicita, null, "sigue siendo legado");
  assert.equal(totalDe(f), 83_300 + 25_000);
});

// ═══ "Ingresar por valor" ════════════════════════════════════════════════
test("VALOR: base 3.250.000 / valor 300.000 se guarda y se cobra al peso", async () => {
  const bd = usarBD({
    usuarios: [yo("gerencia")],
    ventas: [venta("DTM-0451", { precio_venta: 4_000_000 })],
    aliados_b2b: [comision(31, "DTM-0451", { precio_venta: 4_000_000, base_comision: 3_250_000 })],
    aliados: [],
  });
  const r = await actualizarComisionB2B(31, { base: 3_250_000, modo: "valor", pct: null, valor: 300_000, recobroTotal: 0, pctRecobroAliado: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  const f = bd.filas("aliados_b2b")[0];
  assert.equal(f?.comision_valor, 300_000);
  assert.equal(f?.pct_comision, 0.0923);
  assert.equal(totalDe(f), 300_000);
  const c = await cuenta("DTM-0451");
  assert.equal(c?.tipo === "comision" && c.detalle.totalPagar, 300_000);
});

test("VALOR: base mayor que el PVP y % vacío se rechazan en el servidor", async () => {
  usarBD({ usuarios: [yo("administracion")], ventas: [venta("DTM-0451")], aliados_b2b: [comision(31, "DTM-0451")] });
  assert.equal((await actualizarComisionB2B(31, { base: 1_000_001, modo: "pct", pct: 0.1, valor: null, recobroTotal: 0, pctRecobroAliado: null })).ok, false);
  assert.equal((await actualizarComisionB2B(31, { base: 800_000, modo: "pct", pct: null, valor: null, recobroTotal: 0, pctRecobroAliado: null })).ok, false);
});

// ═══ Abonos y permisos (servidor) ════════════════════════════════════════
const semillaAbonada = (rol: string, extra: Fila = {}) => ({
  usuarios: [yo(rol, extra)],
  ventas: [venta("DTM-0451")],
  aliados_b2b: [comision(31, "DTM-0451", { base_comision: 1_000_000, base_explicita: null })],
  comision_b2b_pagos: [{ id: 1, aliado_b2b_id: 31, fecha: "2026-09-01", valor: 50_000, tenant: "mayorista" }],
});

test("ABONOS: no se borra una comisión con abonos; el abono queda", async () => {
  const bd = usarBD(semillaAbonada("superadmin"));
  const r = await eliminarComisionB2B(31, "DTM-0451");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /abonos/);
  assert.equal(bd.filas("aliados_b2b").length, 1);
  assert.equal(bd.filas("comision_b2b_pagos").length, 1);
});

test("ABONOS: no se cambia el total de una comisión abonada; sí un cambio que lo conserva", async () => {
  const bd = usarBD(semillaAbonada("administracion"));
  const cambia = await actualizarComisionB2B(31, { base: 1_000_000, modo: "pct", pct: 0.2, valor: null, recobroTotal: 0, pctRecobroAliado: null });
  assert.equal(cambia.ok, false);
  assert.equal(bd.filas("aliados_b2b")[0]?.pct_comision, 0.1);
  const conserva = await actualizarComisionB2B(31, { base: 500_000, modo: "pct", pct: 0.2, valor: null, recobroTotal: 0, pctRecobroAliado: null });
  assert.equal(conserva.ok, true, JSON.stringify(conserva));
  assert.equal(totalDe(bd.filas("aliados_b2b")[0]), 100_000);
});

test("PERMISOS: operaciones no edita, no borra, no abona ni deshace (aunque llame la acción directo)", async () => {
  const bd = usarBD({ ...semillaAbonada("operaciones"), aliados_b2b: [comision(31, "DTM-0451"), comision(32, "DTM-0451")] });
  assert.equal((await actualizarComisionB2B(32, { base: 800_000, modo: "pct", pct: 0.5, valor: null, recobroTotal: 0, pctRecobroAliado: null })).ok, false);
  assert.equal((await eliminarComisionB2B(32, "DTM-0451")).ok, false);
  assert.equal((await registrarPagoComisionB2B(32, 1, "2026-10-01")).ok, false);
  assert.equal((await deshacerUltimoPagoComisionB2B(31)).ok, false);
  assert.equal(bd.filas("aliados_b2b").length, 2);
  assert.equal(bd.filas("comision_b2b_pagos").length, 1);
  assert.equal(bd.filas("aliados_b2b")[1]?.pct_comision, 0.1);
});

test("PERMISOS: administración solo en su agencia; gerencia en las dos", async () => {
  usarBD({ usuarios: [yo("administracion", { tenant: "minorista" })], ventas: [venta("DTM-0451")], aliados_b2b: [comision(32, "DTM-0451")] });
  assert.equal((await eliminarComisionB2B(32, "DTM-0451")).ok, false);
  const bd = usarBD({ usuarios: [yo("gerencia", { tenant: "minorista" })], ventas: [venta("DTM-0451")], aliados_b2b: [comision(32, "DTM-0451")] });
  assert.equal((await eliminarComisionB2B(32, "DTM-0451")).ok, true);
  assert.equal(bd.filas("aliados_b2b").length, 0);
});

// ═══ Asesor `venta`: corrige la comisión de SU contrato antes de abonos ═══
const esMio = (mio: boolean) => ({ soy_asesor_del_contrato: () => mio });

test("ASESOR: venta corrige SU comisión — base y valor exacto al peso", async () => {
  const bd = usarBD({ usuarios: [yo("venta")], ventas: [venta("DTM-0451")], aliados_b2b: [comision(31, "DTM-0451")] }, esMio(true));
  const r = await actualizarComisionB2B(31, { base: 500_000, modo: "valor", pct: null, valor: 37_000, recobroTotal: 0, pctRecobroAliado: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  const f = bd.filas("aliados_b2b")[0];
  assert.equal(f?.base_comision, 500_000);
  assert.equal(f?.base_explicita, true);
  assert.equal(f?.comision_valor, 37_000);
  assert.equal(totalDe(f), 37_000);
  assert.deepEqual(bd.llamadasRpc.find((c) => c.fn === "soy_asesor_del_contrato")?.args, { num: "DTM-0451" }, "propiedad decidida por la misma función de la policy");
});

test("ASESOR: venta corrige SU comisión — por %", async () => {
  const bd = usarBD({ usuarios: [yo("venta")], ventas: [venta("DTM-0451")], aliados_b2b: [comision(31, "DTM-0451")] }, esMio(true));
  const r = await actualizarComisionB2B(31, { base: 800_000, modo: "pct", pct: 0.15, valor: null, recobroTotal: 0, pctRecobroAliado: null });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(totalDe(bd.filas("aliados_b2b")[0]), 120_000);
});

test("ASESOR: NO corrige la comisión de un colega, ni de otra agencia", async () => {
  const bd = usarBD({ usuarios: [yo("venta")], ventas: [venta("DTM-0451")], aliados_b2b: [comision(31, "DTM-0451")] }, esMio(false));
  const r = await actualizarComisionB2B(31, { base: 800_000, modo: "pct", pct: 0.5, valor: null, recobroTotal: 0, pctRecobroAliado: null });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /tus propios contratos/);
  assert.equal(bd.filas("aliados_b2b")[0]?.pct_comision, 0.1);
  usarBD({ usuarios: [yo("venta", { tenant: "minorista" })], aliados_b2b: [comision(31, "DTM-0451")] }, esMio(true));
  assert.equal((await actualizarComisionB2B(31, { base: 800_000, modo: "pct", pct: 0.5, valor: null, recobroTotal: 0, pctRecobroAliado: null })).ok, false);
});

test("ASESOR: con abonos o NETO descontada ya no la corrige", async () => {
  const conAbono = usarBD({
    usuarios: [yo("venta")], ventas: [venta("DTM-0451")], aliados_b2b: [comision(31, "DTM-0451")],
    comision_b2b_pagos: [{ id: 1, aliado_b2b_id: 31, fecha: "2026-10-01", valor: 10_000, tenant: "mayorista" }],
  }, esMio(true));
  const r1 = await actualizarComisionB2B(31, { base: 800_000, modo: "pct", pct: 0.1, valor: null, recobroTotal: 5, pctRecobroAliado: null });
  assert.equal(r1.ok, false);
  assert.match((r1 as { error: string }).error, /ya tiene abonos/);
  assert.equal(conAbono.filas("aliados_b2b")[0]?.recobro_total, 0);
  usarBD({ usuarios: [yo("venta")], ventas: [ventaNeta], aliados_b2b: [comision(31, "DTM-0451", { estado: "pagada", descontada_en_precio: true })] }, esMio(true));
  const r2 = await actualizarComisionB2B(31, { base: 800_000, modo: "pct", pct: 0.2, valor: null, recobroTotal: 0, pctRecobroAliado: null });
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /descontó del precio/);
});

test("ASESOR: ni en su contrato borra la comisión ni gestiona abonos", async () => {
  const bd = usarBD({
    usuarios: [yo("venta")], ventas: [venta("DTM-0451")], aliados_b2b: [comision(31, "DTM-0451")],
    comision_b2b_pagos: [{ id: 1, aliado_b2b_id: 31, fecha: "2026-10-01", valor: 10_000, tenant: "mayorista" }],
  }, esMio(true));
  assert.equal((await eliminarComisionB2B(31, "DTM-0451")).ok, false, "borrar");
  assert.equal((await registrarPagoComisionB2B(31, 1, "2026-10-02")).ok, false, "abonar");
  assert.equal((await deshacerUltimoPagoComisionB2B(31)).ok, false, "deshacer abono");
  assert.equal(bd.filas("aliados_b2b").length, 1);
  assert.equal(bd.filas("comision_b2b_pagos").length, 1);
});

// ═══ Flujo: tarifario comisionable ═══════════════════════════════════════
test("COMISIONABLE: la cuenta de cobro lee la fila de aliados_b2b (con retención), igual que Comisiones", async () => {
  usarBD({
    usuarios: [yo("superadmin")],
    ventas: [venta("DTM-0451", { modo_compra: "comisionable", comision_b2b: 80_000, comision_estado: "pendiente" })],
    aliados_b2b: [comision(31, "DTM-0451", { aplica_retencion: true, pct_retencion: 0.11 })],
    aliados: [],
  });
  const r = await cuenta("DTM-0451");
  assert.equal(r?.tipo === "comision" && r.detalle.totalPagar, 71_200, "antes: 80.000 (ventas.comision_b2b, sin retención)");
});

test("COMISIONABLE: editar la comisión en Comisiones se refleja en la cuenta de cobro", async () => {
  usarBD({
    usuarios: [yo("superadmin")],
    ventas: [venta("DTM-0451", { modo_compra: "comisionable", comision_b2b: 80_000, comision_estado: "pendiente" })],
    aliados_b2b: [comision(31, "DTM-0451")],
    aliados: [],
  });
  assert.equal((await actualizarComisionB2B(31, { base: 500_000, modo: "pct", pct: 0.1, valor: null, recobroTotal: 0, pctRecobroAliado: null })).ok, true);
  const r = await cuenta("DTM-0451");
  assert.equal(r?.tipo === "comision" && r.detalle.totalPagar, 50_000, "antes seguía diciendo 80.000");
});

test("COMISIONABLE sin fila (reservó la propia agencia): sigue la vía de ventas.comision_b2b", async () => {
  usarBD({
    usuarios: [yo("superadmin")],
    ventas: [venta("DTM-0451", { modo_compra: "comisionable", comision_b2b: 80_000, comision_estado: "pendiente" })],
    aliados: [],
  });
  const r = await cuenta("DTM-0451");
  assert.equal(r?.tipo === "comision" && r.detalle.totalPagar, 80_000);
});

// ═══ Flujo: NETO ═════════════════════════════════════════════════════════
const ventaNeta = venta("DTM-0451", { precio_venta: 920_000, modo_compra: "neta", comision_b2b: 80_000, comision_estado: "descontada", b2b_usuario_id: "u-arnes" });

test("NETO: la cuenta de cobro y el estado de cuenta no se abren por URL (ni con ?id)", async () => {
  for (const marca of [{ descontada_en_precio: true, estado: "pagada" }, { descontada_en_precio: false, estado: "pagada" }]) {
    usarBD({ usuarios: [yo("freelance")], ventas: [ventaNeta], aliados_b2b: [comision(31, "DTM-0451", marca)], aliados: [] });
    assert.equal(await cuenta("DTM-0451"), null, `marca ${JSON.stringify(marca)}`);
    assert.equal(await cuenta("DTM-0451", 31), null);
  }
  usarBD({ usuarios: [yo("superadmin")], ventas: [ventaNeta], aliados_b2b: [comision(31, "DTM-0451", { descontada_en_precio: true, estado: "pagada" })], aliados: [] });
  assert.equal(await cuenta("DTM-0451"), null, "tampoco para un interno");
});

test("NETO: no admite abonos (sin pago ficticio)", async () => {
  const bd = usarBD({ usuarios: [yo("administracion")], ventas: [ventaNeta], aliados_b2b: [comision(31, "DTM-0451", { estado: "pagada" })] });
  const r = await registrarPagoComisionB2B(31, 80_000, "2026-10-01");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /descontó del precio/);
  assert.equal(bd.filas("comision_b2b_pagos").length, 0, "no se registró ningún pago");
  // La pestaña tampoco: la base lo rechaza (MAN7 en test_205_comisiones_b2b.sql).
  assert.equal(bd.filas("aliados_b2b").length, 1);
});

test("NETO: no se elimina suelta, ni sin abonos (marca nueva y firma legado), aunque se llame la acción directo", async () => {
  for (const fila of [
    comision(31, "DTM-0451", { estado: "pagada", descontada_en_precio: true }),   // marca nueva
    comision(31, "DTM-0451", { estado: "pagada", descontada_en_precio: false }),  // firma legado de reservar
  ]) {
    const bd = usarBD({ usuarios: [yo("superadmin")], ventas: [ventaNeta], aliados_b2b: [fila] });
    const r = await eliminarComisionB2B(31, "DTM-0451");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /descontó del precio/);
    assert.equal(bd.filas("aliados_b2b").length, 1, "la NETO sigue ahí (la base también lo impide: N8–N10)");
  }
  // Una comisión NO descontada sin abonos se sigue eliminando.
  const bd = usarBD({ usuarios: [yo("administracion")], ventas: [venta("DTM-0452", { modo_compra: "comisionable", comision_estado: "pendiente" })],
    aliados_b2b: [comision(32, "DTM-0452")] });
  assert.equal((await eliminarComisionB2B(32, "DTM-0452")).ok, true);
  assert.equal(bd.filas("aliados_b2b").length, 0);
});

test("NETO: Comisiones la muestra 'descontada' (no pendiente) y la NETO sin fila no queda 'por definir'", async () => {
  usarBD({
    usuarios: [yo("administracion")],
    ventas: [ventaNeta, venta("DTM-0452", { precio_venta: 920_000, modo_compra: "neta", comision_b2b: 80_000, comision_estado: "descontada" })],
    aliados_b2b: [comision(31, "DTM-0451", { estado: "pagada", descontada_en_precio: true })],
    comision_b2b_pagos: [],
  });
  const filas = filasDeComisiones(await ComisionesPage());
  const f31 = filas.find((f) => f.id === 31);
  assert.equal(f31?.estado, "descontada");
  assert.equal(f31?.descontada, true);
  const sinFila = filas.find((f) => f.numero_contrato === "DTM-0452");
  assert.equal(sinFila?.estado, "descontada");
  assert.equal(sinFila?.totalPagar, 80_000);
});

test("NETO anterior a la 131: su abono sintético se sigue mostrando como pagada (no se reinterpreta)", async () => {
  usarBD({
    usuarios: [yo("administracion")],
    ventas: [ventaNeta],
    aliados_b2b: [comision(31, "DTM-0451", { estado: "pagada" })],
    comision_b2b_pagos: [{ id: 1, aliado_b2b_id: 31, fecha: "2026-01-01", valor: 80_000, tenant: "mayorista" }],
  });
  const f = filasDeComisiones(await ComisionesPage()).find((x) => x.id === 31);
  assert.equal(f?.estado, "pagada");
  assert.equal(f?.pagos.length, 1);
});

// ═══ Rentabilidad ════════════════════════════════════════════════════════
test("RENTABILIDAD: NETO no resta la comisión otra vez; comisionable sí; varias comisiones se suman", async () => {
  usarBD({
    usuarios: [yo("administracion")],
    ventas: [
      { ...ventaNeta, costo_hotel: 600_000 },
      venta("DTM-0452", { modo_compra: "comisionable", comision_b2b: 80_000, comision_estado: "pendiente", costo_hotel: 600_000 }),
    ],
    aliados_b2b: [
      comision(31, "DTM-0451", { estado: "pagada", descontada_en_precio: true }),
      comision(32, "DTM-0452"),
      comision(33, "DTM-0452", { base_comision: 0 }),
      comision(34, "DTM-0452", { base_comision: 100_000 }),
    ],
  });
  const { filas } = await calcularRentabilidad();
  const neta = filas.find((f) => f.numero_contrato === "DTM-0451")!;
  const com = filas.find((f) => f.numero_contrato === "DTM-0452")!;
  assert.equal(neta.comB2B, 0);
  assert.equal(neta.utilBruta - neta.comB2B, 320_000);
  assert.equal(com.comB2B, 80_000 + 0 + 10_000, "todas las filas del contrato; la base 0 explícita vale 0");
});

// ═══ Varias comisiones en un contrato ════════════════════════════════════
// `comprador`: el usuario es quien compró desde el portal (b2b_usuario_id).
const semillaVarias = (perfil: Fila, comprador: boolean) => ({
  usuarios: [perfil],
  ventas: [venta("DTM-0451", { b2b_usuario_id: comprador ? "u-arnes" : null, aliado_id: 7 })],
  aliados_b2b: [
    comision(31, "DTM-0451", { aliado: "Aliado Siete", aliado_id: 7 }),
    comision(32, "DTM-0451", { aliado: "Aliado Nueve", aliado_id: 9, base_comision: 500_000 }),
  ],
  aliados: [{ id: 7, nombre: "Aliado Siete" }, { id: 9, nombre: "Aliado Nueve" }],
});

test("VARIAS: un interno debe elegir; no se muestra en silencio solo la más reciente", async () => {
  usarBD(semillaVarias(yo("administracion"), false));
  const r = await cuenta("DTM-0451");
  assert.equal(r?.tipo, "elegir");
  assert.deepEqual(r?.tipo === "elegir" && r.opciones.map((o) => [o.id, o.totalPagar]), [[31, 80_000], [32, 50_000]]);
  const r31 = await cuenta("DTM-0451", 31);
  assert.equal(r31?.tipo === "comision" && r31.aliadoB2bId, 31);
});

test("VARIAS: el aliado solo cobra la suya; la de otro aliado no se abre ni por id", async () => {
  usarBD(semillaVarias(yo("freelance", { aliado_id: 7 }), true));
  const r = await cuenta("DTM-0451");
  assert.equal(r?.tipo === "comision" && r.aliadoB2bId, 31);
  assert.equal(await cuenta("DTM-0451", 32), null);
});

// Fila SIN ficha (aliado_id null) en un contrato que el aliado sí puede abrir:
// abrir el contrato no da sus filas, y el TEXTO libre del beneficiario
// (aliados_b2b.aliado) no prueba nada — un homónimo escribe igual. Lo que sí
// prueba la pertenencia es el DOCUMENTO (aliados_b2b.nit) igual al de su ficha.
const semillaSinFicha = (perfil: Fila, ventaExtra: Fila, filasExtra: Fila[]) => ({
  usuarios: [perfil],
  ventas: [venta("DTM-0460", ventaExtra)],
  aliados_b2b: filasExtra,
  aliados: [{ id: 7, nombre: "Aliado Siete", nit: "900111222-3" }] as Fila[],
});

test("SIN FICHA (homónimo): abierto por id, la fila con SU nombre pero otro documento NO se ofrece; la de su documento sí", async () => {
  usarBD(semillaSinFicha(yo("freelance", { aliado_id: 7 }), { b2b_usuario_id: "u-arnes", aliado_id: 7, freelance_nombre: "Aliado Siete" }, [
    comision(47, "DTM-0460", { aliado: "Aliado Siete", nit: "800999000" }),  // homónimo: mismo texto, otro documento
    comision(48, "DTM-0460", { aliado: "A. Siete", nit: "900.111.222-3" }), // texto distinto, SU documento
    comision(49, "DTM-0460", { aliado: "Aliado Siete", nit: null }),          // solo texto: no prueba nada
  ]));
  const r = await cuenta("DTM-0460");
  assert.equal(r?.tipo === "comision" && r.aliadoB2bId, 48, "solo la de su documento, sin pedir elegir");
  assert.equal(await cuenta("DTM-0460", 47), null, "la del homónimo no se abre ni por id");
  assert.equal(await cuenta("DTM-0460", 49), null, "sin documento, el nombre escrito no basta");
});

test("SIN FICHA: entrada por ventas.aliado_id → tampoco el nombre de ventas; solo el documento", async () => {
  usarBD(semillaSinFicha(yo("freelance", { aliado_id: 7 }), { aliado_id: 7, freelance_nombre: "Freelance Prueba" }, [
    comision(43, "DTM-0460", { aliado: "Freelance Prueba", nit: null }),
    comision(44, "DTM-0460", { aliado: "Otra Persona", nit: "900111222" }), // NIT sin dígito de verificación: el mismo
  ]));
  const r = await cuenta("DTM-0460");
  assert.equal(r?.tipo === "comision" && r.aliadoB2bId, 44);
  assert.equal(await cuenta("DTM-0460", 43), null);
});

test("SIN FICHA: sin documento en su ficha, ninguna fila sin ficha es suya (falla cerrado)", async () => {
  const t = semillaSinFicha(yo("freelance", { aliado_id: 7 }), { b2b_usuario_id: "u-arnes", aliado_id: 7 }, [
    comision(48, "DTM-0460", { aliado: "Aliado Siete", nit: "900111222-3" }),
  ]);
  t.aliados = [{ id: 7, nombre: "Aliado Siete", nit: null } as Fila];
  usarBD(t);
  assert.equal(await cuenta("DTM-0460"), null);
});

test("SIN FICHA: si el acceso vino solo de la ficha de OTRA comisión, el nombre de ventas no le pertenece", async () => {
  // El contrato es de la agencia del nombre de ventas; el usuario (ficha 7) solo
  // está enlazado como beneficiario de la fila 46 (la más reciente, que es la
  // que decide el acceso por comisión manual). La fila 45, con el nombre de la
  // agencia de ventas, no es suya.
  usarBD(semillaSinFicha(yo("freelance", { aliado_id: 7 }),
    { aliado_id: null, tipo_asesor: "agencia", agencia_nombre: "Agencia Dueña", freelance_nombre: null, canal: "B2B" }, [
      comision(45, "DTM-0460", { aliado: "Agencia Dueña" }),
      comision(46, "DTM-0460", { aliado: "Aliado Siete", aliado_id: 7 }),
    ]));
  const r = await cuenta("DTM-0460");
  assert.equal(r?.tipo === "comision" && r.aliadoB2bId, 46);
  assert.equal(await cuenta("DTM-0460", 45), null);
});

test("SIN FICHA: un interno sí la ve y la genera en nombre del beneficiario", async () => {
  usarBD(semillaSinFicha(yo("administracion"), { b2b_usuario_id: "otro", aliado_id: 7 }, [
    comision(41, "DTM-0460", { aliado: "Aliado Siete" }),
    comision(42, "DTM-0460", { aliado: "Referido Externo" }),
  ]));
  const r = await cuenta("DTM-0460", 42);
  assert.equal(r?.tipo === "comision" && r.aliadoB2bId, 42);
});

// Las filas que la página de Comisiones le entrega a <ComisionesList>.
type FilaVista = { id: number; numero_contrato: string; estado: string; descontada?: boolean; totalPagar: number | null; pagos: unknown[] };
function filasDeComisiones(el: unknown): FilaVista[] {
  const buscar = (n: unknown): FilaVista[] | null => {
    if (!n || typeof n !== "object") return null;
    const props = (n as { props?: { rows?: FilaVista[]; children?: unknown } }).props;
    if (props?.rows) return props.rows;
    const hijos = props?.children;
    for (const h of Array.isArray(hijos) ? hijos : [hijos]) {
      const r = buscar(h);
      if (r) return r;
    }
    return null;
  };
  const r = buscar(el);
  assert.ok(r, "no se encontró <ComisionesList rows>");
  return r;
}
