// Se ejecuta con npm run test:react:rev2 (loader del arnés + jsdom).
// NETA-05/06 — los costos en USD se ven en USD con su TRM de costos PROVISIONAL (o «pendiente»), nunca como pesos ni sumados con COP,
// y hay un lugar autorizado para corregir esa TRM mientras el contrato siga pendiente. Los importes esperados se calcularon a mano:
//   aéreo USD 200 × TRM 3.900 = COP 780.000 · × TRM 4.100 = COP 820.000 · hotel COP 420.000 (no se mezcla con los dólares).
import { botonConTexto, clic, esperar, escribir, montar, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { ObligacionesPrevistasPanel } = await import("../components/contrato/ObligacionesPrevistasPanel.tsx");
const { GestionTabs } = await import("../app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx");
const { __setImpl } = await import("./support/stubs/trmCostoActionsStub.mjs");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; __setImpl(null); });
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });
const txt = (c: Element) => (c.textContent ?? "").replace(/\s+/g, " ");
const IDENT = "uid-dummy" as never;

const AEREO_USD = { clave: "cxp:1:aereo", servicio: "Tiquetes aéreos", proveedor: "Aerolinea Neta SAS", tipo_proveedor: "aereo", valor_total: 200, moneda: "USD", trm_costo: 3900, valor_cop_costo: 780000 };
const HOTEL_COP = { clave: "cxp:2:hotel", servicio: "Hotel", proveedor: "Hotel Neta", tipo_proveedor: "hotel", valor_total: 420000, moneda: "COP" };

test("previstas en USD: importe en dólares + equivalente PROVISIONAL a la TRM de costos; totales por moneda, sin sumar USD con COP", async () => {
  usarBD();
  const m = await montar(h(ObligacionesPrevistasPanel, { filas: [AEREO_USD, HOTEL_COP] }));
  desmontar = m.desmontar;
  const t = txt(m.contenedor);
  assert.match(t, /USD \$200\.00/, "el aéreo se ve en dólares");
  assert.match(t, /≈ \$ 780\.000 a TRM de costos \$3\.900 \(provisional\)/);
  assert.match(t, /Total previsto en USD/);
  assert.match(t, /Total previsto en COP/);
  assert.match(t, /\$ 420\.000/);
  assert.doesNotMatch(t, /620\.000|1\.200\.000|\$ 200\b/, "no hay una cifra mezclada ni los 200 dólares como pesos");
  assert.match(txt(m.contenedor.querySelector('[data-testid="total-equivalente"]')!), /≈ \$ 780\.000 \(provisional\)/);
  assert.match(txt(m.contenedor.querySelector('[data-testid="nota-trm-costos"]')!), /distinta de la TRM del pago real/);
});

test("previstas en USD sin TRM de costos: dice «TRM de costos pendiente» y marca el equivalente total como incompleto (nunca lo infiere)", async () => {
  usarBD();
  const sinTrm = { ...AEREO_USD, trm_costo: null, valor_cop_costo: null };
  const m = await montar(h(ObligacionesPrevistasPanel, { filas: [sinTrm], numero: "DTM-1", identidad: IDENT, puedeEditarTrm: true }));
  desmontar = m.desmontar;
  const t = txt(m.contenedor);
  assert.match(t, /TRM de costos pendiente/);
  assert.match(t, /Equivalente en pesos incompleto: 1 obligación\(es\) sin TRM de costos/);
  assert.equal(m.contenedor.querySelector('[data-testid^="trm-editor"]'), null, "sin TRM no hay editor: no se agrega una TRM a una obligación sin par (histórica)");
});

test("corregir la TRM: el editor llama a la acción con la TRM nueva y la que se veía (compara-y-cambia) y muestra el resultado", async () => {
  usarBD();
  const llamadas: unknown[][] = [];
  __setImpl(async (...a: unknown[]) => { llamadas.push(a); return { ok: true, cambiadas: 1, trmNueva: 4100 }; });
  const m = await montar(h(ObligacionesPrevistasPanel, { filas: [AEREO_USD, HOTEL_COP], numero: "DTM-1", identidad: IDENT, puedeEditarTrm: true }));
  desmontar = m.desmontar;
  assert.match(txt(m.contenedor), /TRM de costos actual: \$3\.900/);
  await clic(botonConTexto(m.contenedor, "Corregir la TRM de costos de este contrato"), "abrir editor");
  await escribir(m.contenedor.querySelector<HTMLInputElement>('input[aria-label="Nueva TRM de costos"]')!, "4100");
  await escribir(m.contenedor.querySelector<HTMLInputElement>('input[aria-label="Motivo de la corrección"]')!, "TRM acordada con la aerolínea");
  await clic(botonConTexto(m.contenedor, "Guardar TRM"), "guardar");
  await esperar(() => llamadas.length > 0);
  assert.deepEqual(llamadas[0], ["DTM-1", IDENT, null, "4100", 3900, "TRM acordada con la aerolínea"]);
  await esperar(() => /TRM de costos actualizada a \$4\.100/.test(txt(m.contenedor)));
});

test("un rechazo del servidor (otra edición, contrato ya confirmado, rol) se muestra y no se da por guardado", async () => {
  usarBD();
  __setImpl(async () => ({ ok: false, error: "La TRM de costos cambió mientras la editabas. Recarga la página y revisa el valor actual antes de corregirla." }));
  const m = await montar(h(ObligacionesPrevistasPanel, { filas: [AEREO_USD], numero: "DTM-1", identidad: IDENT, puedeEditarTrm: true }));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Corregir la TRM de costos de este contrato"), "abrir");
  await clic(botonConTexto(m.contenedor, "Guardar TRM"), "guardar");
  await esperar(() => /cambió mientras la editabas/.test(txt(m.contenedor)));
  assert.doesNotMatch(txt(m.contenedor), /actualizada a/);
});

test("sin permiso de edición no hay editor y se dice quién puede corregirla", async () => {
  usarBD();
  const m = await montar(h(ObligacionesPrevistasPanel, { filas: [AEREO_USD], numero: "DTM-1", identidad: IDENT, puedeEditarTrm: false }));
  desmontar = m.desmontar;
  assert.equal(m.contenedor.querySelector('[data-testid^="trm-editor"]'), null);
  assert.match(txt(m.contenedor), /solo administración, gerencia, operaciones o superadmin/);
});

const propsGestion = (extra: Record<string, unknown>) => ({
  numero: "DTM-0451", identidad: IDENT, precioVenta: 450, impuesto: 0, clienteNombre: "C", clienteDocumento: "", asesorNombre: "Asesor", asesorPct: 0, verFinanzas: true,
  costos: { costo_hotel: 0, costo_aereo: 200, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0 },
  abonos: [], cuotas: [], totalPagado: 0, cuentasPorPagar: [], comisionesB2B: [], facturas: [], formasPago: [], moneda: "USD", puedeEditar: true,
  permisosComision: { ver: false }, ...extra,
});

test("pestaña Costos de un contrato en USD: el costo aéreo se rotula en USD (no en pesos) y explica la TRM de costos provisional", async () => {
  usarBD();
  const m = await montar(h(GestionTabs, propsGestion({ trmCostos: { trm: 3900, fase: "provisional" } }) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Costos"), "pestaña Costos");
  const t = txt(m.contenedor);
  assert.match(t, /Los costos de este contrato están en USD/);
  assert.match(t, /TRM de costos \$3\.900 \(provisional\)/);
  assert.match(t, /USD \$200\.00/);
  assert.doesNotMatch(t, /\$ 200\b/, "los 200 dólares no se rotulan como pesos");
});

test("pestaña Costos en USD sin obligaciones con TRM: «TRM de costos pendiente»; en un contrato en COP no aparece ningún aviso de dólares", async () => {
  usarBD();
  let m = await montar(h(GestionTabs, propsGestion({ trmCostos: null }) as never));
  await clic(botonConTexto(m.contenedor, "Costos"), "pestaña Costos");
  assert.match(txt(m.contenedor), /TRM de costos pendiente/);
  await m.desmontar();
  m = await montar(h(GestionTabs, propsGestion({ moneda: "COP", costos: { costo_hotel: 420000, costo_aereo: 0, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0 } }) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Costos"), "pestaña Costos");
  assert.equal(m.contenedor.querySelector('[data-testid="costos-en-usd"]'), null);
  assert.match(txt(m.contenedor), /\$ 420\.000/);
});

test("pestaña Proveedores (contrato confirmado): CxP en USD con su equivalente CONGELADO, totales por moneda y sin editor de TRM", async () => {
  usarBD();
  const base = { proveedor: "Aerolinea Neta SAS", servicio: "Tiquetes", base_gravable: null, iva_proveedor: null, fecha_vencimiento: null, aplica_retencion: false, pct_retencion: 0, pagos: [], retenido: 0 };
  const cxp = [
    { ...base, id: 1, valor_total: 200, moneda: "USD", valor_cop_costo: 780000, trm_costo: 3900 },
    { ...base, id: 2, proveedor: "Hotel Neta", servicio: "Hotel", valor_total: 420000, moneda: "COP" },
    { ...base, id: 3, proveedor: "Historico", servicio: "Traslado", valor_total: 50, moneda: "USD" },
  ];
  const m = await montar(h(GestionTabs, propsGestion({ cuentasPorPagar: cxp, trmCostos: { trm: 3900, fase: "congelada" } }) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Proveedores"), "pestaña Proveedores");
  const filas = [...m.contenedor.querySelectorAll("tbody tr")].map((r) => txt(r));
  assert.ok(filas.some((f) => /Aerolinea Neta SAS/.test(f) && /USD \$200\.00/.test(f) && /≈ \$ 780\.000 a TRM de costos \$3\.900 \(congelada\)/.test(f)), "aéreo en USD con equivalente congelado");
  assert.ok(filas.some((f) => /Hotel Neta/.test(f) && /\$ 420\.000/.test(f) && !/≈/.test(f)), "la de COP no lleva equivalente");
  assert.ok(filas.some((f) => /Historico/.test(f) && /sin equivalente en pesos registrado/.test(f)), "la USD histórica sin par lo dice (no inventa TRM)");
  const total = txt(m.contenedor.querySelector('[data-testid="total-por-pagar"]')!);
  assert.match(total, /COP: \$ 420\.000/);
  assert.match(total, /USD: USD \$250\.00/);
  assert.doesNotMatch(total, /420\.250|420\.200/, "USD y COP no se suman");
  assert.equal(m.contenedor.querySelector('[data-testid^="trm-editor"]'), null, "tras confirmar la TRM está congelada: aquí no hay editor");
});

// 349 — un servicio USD agregado desde el editor de servicios que nació sin TRM de costos se puede fijar (TRM inicial: trmEsperada null); una prevista sin par de otra ruta o en COP NO ofrece editor.
const SERVICIO_NUEVO_SIN_TRM = { clave: "cxp:ed:abc", servicio: "Tour USD 349", proveedor: "Operador", tipo_proveedor: "receptivo", valor_total: 100, moneda: "USD", trm_costo: null, valor_cop_costo: null };
test("349 servicio USD agregado sin TRM: «TRM de costos pendiente» + «Fijar TRM de costos»; guarda con trmEsperada null; la histórica sin par y la de COP no ofrecen editor", async () => {
  usarBD();
  const llamadas: unknown[][] = [];
  __setImpl(async (...a: unknown[]) => { llamadas.push(a); return { ok: true, cambiadas: 1, trmNueva: 3950 }; });
  const COP_NUEVA = { ...SERVICIO_NUEVO_SIN_TRM, clave: "cxp:ed:cop", moneda: "COP", valor_total: 120000 };
  const m = await montar(h(ObligacionesPrevistasPanel, { filas: [{ ...AEREO_USD, trm_costo: null, valor_cop_costo: null }, SERVICIO_NUEVO_SIN_TRM, COP_NUEVA], numero: "DTM-1", identidad: IDENT, puedeEditarTrm: true }));
  desmontar = m.desmontar;
  assert.equal(m.contenedor.querySelectorAll('[data-testid="trm-editor-fila"]').length, 1, "solo el servicio agregado en USD sin TRM tiene editor");
  assert.match(txt(m.contenedor), /Tour USD 349OperadorUSD \$100\.00TRM de costos pendienteFijar TRM de costos/);
  await clic(botonConTexto(m.contenedor, "Fijar TRM de costos"), "abrir");
  assert.equal(m.contenedor.querySelector<HTMLInputElement>('input[aria-label="Nueva TRM de costos"]')!.value, "", "sin valor previo que sugerir");
  await escribir(m.contenedor.querySelector<HTMLInputElement>('input[aria-label="Nueva TRM de costos"]')!, "3950");
  await clic(botonConTexto(m.contenedor, "Guardar TRM"), "guardar");
  await esperar(() => llamadas.length > 0);
  assert.deepEqual(llamadas[0], ["DTM-1", IDENT, "cxp:ed:abc", "3950", null, ""]);
  await esperar(() => /TRM de costos fijada en \$3\.950/.test(txt(m.contenedor)));
});
test("349 sin permiso de TRM (venta): una obligación sin TRM no muestra editor", async () => {
  usarBD();
  const m = await montar(h(ObligacionesPrevistasPanel, { filas: [SERVICIO_NUEVO_SIN_TRM], numero: "DTM-1", identidad: IDENT, puedeEditarTrm: false }));
  desmontar = m.desmontar;
  assert.equal(m.contenedor.querySelector('[data-testid^="trm-editor"]'), null);
});
