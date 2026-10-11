// Se ejecuta con npm run test:react (loader del arnés + jsdom).
//
// #38 · Pestaña Comisiones del contrato, renderizada de verdad, por rol:
//   · venta en SU contrato manual B2B sin comisión: ve "Por definir" y la
//     registra (aliado del contrato, sin campos de aliado/retención); la
//     Server Action REAL llama a registrar_comision_b2b_manual.
//   · venta en el contrato de un colega: ve, pero no registra.
//   · venta con la comisión ya registrada: la ve, sin borrar ni registrar otra.
//   · control_vuelo: no ve la pestaña.
// La regla en sí (contrato propio, tenant, NETO, una sola vez) la aplica la
// base: supabase/scripts/test_205_comisiones_b2b.sql (MAN1–MAN17, R10a–R10e).
import { botonConTexto, clic, esperar, escribir, montar, usarBD } from "./support/fechaNegocioArnes.ts";
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";

const React = await import("react");
const { GestionTabs } = await import("../app/(dashboard)/dashboard/contratos/[numero]/GestionTabs.tsx");
const { permisosComisionContrato } = await import("../lib/finanzas/comisionB2B.ts");
const h = React.createElement;

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => { await desmontar?.(); desmontar = undefined; });
after(async () => { (await import("./support/fechaNegocioArnes.ts")).dom.window.close(); });

const ALIADO = { id: 9205, nombre: "Agencia Uno", nit: "901", tipo: "agencia", pct_comision: 0.1, aplica_retencion: true, pct_retencion: 0.11 };
const COMISION = {
  id: 77, numero_contrato: "DTM-0451", aliado: "Agencia Uno", aliado_id: 9205, precio_venta: 1_000_000, base_comision: 800_000,
  base_explicita: true, comision_valor: null, pct_comision: 0.1, recobro_total: 0, pct_recobro_aliado: 0,
  aplica_retencion: false, pct_retencion: 0, estado: "pendiente", descontada_en_precio: false,
};

function props(rol: string, esAsesorDelContrato: boolean, comisiones: unknown[] = []) {
  return {
    numero: "DTM-0451", precioVenta: 1_000_000, impuesto: 200_000, clienteNombre: "C", clienteDocumento: "",
    asesorNombre: "Asesor", asesorPct: 0, verFinanzas: ["superadmin", "gerencia", "administracion", "operaciones"].includes(rol),
    costos: { costo_hotel: 0, costo_aereo: 0, costo_receptivo: 0, costo_asistencia: 0, otros_costos: 0 },
    abonos: [], cuotas: [], totalPagado: 0, cuentasPorPagar: [], comisionesB2B: comisiones, facturas: [], formasPago: [],
    moneda: "COP", aliadosCatalogo: [ALIADO], puedeEditar: esAsesorDelContrato,
    permisosComision: permisosComisionContrato(rol, esAsesorDelContrato),
    contratoB2B: true, aliadoContratoId: 9205,
  };
}
const nav = (raiz: Element) => [...raiz.querySelectorAll("nav button")].map((b) => b.textContent?.trim());

test("venta en SU contrato manual B2B: ve 'Por definir' y registra la comisión del aliado del contrato", async () => {
  const bd = usarBD({ usuarios: [{ id: "u-arnes", rol: "venta", activo: true, tenant: "mayorista" }] }, {
    registrar_comision_b2b_manual: () => 501,
  });
  const m = await montar(h(GestionTabs, props("venta", true) as never));
  desmontar = m.desmontar;
  assert.deepEqual(nav(m.contenedor), ["Cartera", "Comisiones"], "venta: Cartera y Comisiones, sin costos/proveedores/facturación");
  await clic(botonConTexto(m.contenedor, "Comisiones"), "pestaña Comisiones");
  assert.match(m.contenedor.textContent ?? "", /Comisión B2B: Por definir/);
  assert.match(m.contenedor.textContent ?? "", /Registrar la comisión de tu contrato/);
  assert.equal(m.contenedor.querySelector('input[placeholder="Aliado"]'), null, "no elige ni escribe otro aliado");
  assert.equal(m.contenedor.querySelector('input[type="checkbox"]'), null, "la retención sale del catálogo");
  await escribir(m.contenedor.querySelector<HTMLInputElement>('input[aria-label="% comisión"]')!, "10");
  await clic(botonConTexto(m.contenedor, "Registrar comisión"), "Registrar comisión");
  await esperar(() => bd.llamadasRpc.some((c) => c.fn === "registrar_comision_b2b_manual"));
  const [llamada] = bd.llamadasRpc.filter((c) => c.fn === "registrar_comision_b2b_manual");
  assert.equal(llamada.args.p_numero, "DTM-0451");
  assert.equal(llamada.args.p_aliado_id, 9205);
  assert.equal(llamada.args.p_aliado, "Agencia Uno");
  assert.equal(llamada.args.p_pct, 0.1);
  assert.equal(llamada.args.p_aplica_retencion, false, "venta no fija retención (la base usa la del catálogo)");
});

test("venta en el contrato de un COLEGA: ve la pestaña y 'Por definir', pero no puede registrar", async () => {
  usarBD();
  const m = await montar(h(GestionTabs, props("venta", false) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Comisiones"), "pestaña Comisiones");
  assert.match(m.contenedor.textContent ?? "", /Por definir/);
  assert.equal(botonConTexto(m.contenedor, /Registrar comisión|Agregar/), undefined);
});

test("venta con SU comisión registrada: la corrige desde la pestaña (base y valor exacto), sin borrar ni registrar otra", async () => {
  const bd = usarBD({
    usuarios: [{ id: "u-arnes", rol: "venta", activo: true, tenant: "mayorista" }],
    aliados_b2b: [{ ...COMISION, tenant: "mayorista" }],
  }, { soy_asesor_del_contrato: () => true });
  const m = await montar(h(GestionTabs, props("venta", true, [COMISION]) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Comisiones"), "pestaña Comisiones");
  const texto = m.contenedor.textContent ?? "";
  assert.match(texto, /Agencia Uno/);
  assert.match(texto, /Puedes corregir tu comisión/);
  assert.doesNotMatch(texto, /Por definir/);
  assert.equal(botonConTexto(m.contenedor, "Eliminar"), undefined, "venta no borra");
  assert.equal(botonConTexto(m.contenedor, /Registrar comisión|Agregar/), undefined, "no registra una segunda");

  await clic(botonConTexto(m.contenedor, "Editar"), "Editar");
  await clic(botonConTexto(m.contenedor, "Ingresar por valor"), "Ingresar por valor");
  await escribir(m.contenedor.querySelector<HTMLInputElement>('input[aria-label="Base comisionable"]')!, "500000");
  await escribir(m.contenedor.querySelector<HTMLInputElement>('input[aria-label="Comisión (valor)"]')!, "37000");
  await clic(botonConTexto(m.contenedor, "Guardar cambios"), "Guardar cambios");
  await esperar(() => bd.filas("aliados_b2b")[0]?.comision_valor === 37_000);
  const f = bd.filas("aliados_b2b")[0];
  assert.equal(f?.base_comision, 500_000);
  assert.equal(f?.comision_valor, 37_000, "el valor escrito, al peso");
  assert.equal(f?.base_explicita, true);
});

test("venta en el contrato de un COLEGA con comisión: la ve, pero no la edita", async () => {
  usarBD();
  const m = await montar(h(GestionTabs, props("venta", false, [COMISION]) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Comisiones"), "pestaña Comisiones");
  assert.match(m.contenedor.textContent ?? "", /Agencia Uno/);
  assert.equal(botonConTexto(m.contenedor, "Editar"), undefined);
  assert.equal(botonConTexto(m.contenedor, "Eliminar"), undefined);
});

test("administración ve, agrega y borra; control_vuelo no ve la pestaña", async () => {
  usarBD();
  const adm = await montar(h(GestionTabs, props("administracion", false, [COMISION]) as never));
  await clic(botonConTexto(adm.contenedor, "Comisiones"), "pestaña Comisiones");
  assert.ok(botonConTexto(adm.contenedor, "Agregar"), "agrega");
  assert.ok(botonConTexto(adm.contenedor, "Eliminar"), "borra");
  await adm.desmontar();

  const cv = await montar(h(GestionTabs, props("control_vuelo", false, [COMISION]) as never));
  desmontar = cv.desmontar;
  assert.deepEqual(nav(cv.contenedor), ["Cartera"], "control_vuelo: sin pestaña Comisiones");
  assert.doesNotMatch(cv.contenedor.textContent ?? "", /Agencia Uno/);
});

test("administración: una NETO descontada no ofrece Eliminar ni Editar (se va solo con el contrato)", async () => {
  usarBD();
  const neta = { ...COMISION, estado: "pagada", descontada_en_precio: true };
  const m = await montar(h(GestionTabs, props("administracion", false, [neta]) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Comisiones"), "pestaña Comisiones");
  assert.match(m.contenedor.textContent ?? "", /descontada en el precio/);
  assert.equal(botonConTexto(m.contenedor, "Eliminar"), undefined, "sin Eliminar");
  assert.equal(botonConTexto(m.contenedor, "Editar"), undefined, "sin Editar");
});

test("administración: con un aliado del catálogo el tipo es el suyo y no se cambia; sin catálogo se elige", async () => {
  usarBD();
  const { dom } = await import("./support/fechaNegocioArnes.ts");
  const elegir = async (sel: HTMLSelectElement, valor: string) => {
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(sel, valor);
      sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  };
  const m = await montar(h(GestionTabs, props("administracion", false) as never));
  desmontar = m.desmontar;
  await clic(botonConTexto(m.contenedor, "Comisiones"), "pestaña Comisiones");
  const selects = () => [...m.contenedor.querySelectorAll("select")];
  const catalogo = selects().find((s) => /Nuevo aliado/.test(s.textContent ?? ""))!;
  const tipo = () => selects().find((s) => /persona jurídica/.test(s.textContent ?? ""))!;
  assert.equal(tipo().disabled, false, "sin aliado del catálogo el tipo se elige");
  await elegir(catalogo, "9205");
  assert.equal(tipo().value, "agencia", "toma el tipo del catálogo");
  assert.equal(tipo().disabled, true, "y no se puede cambiar a freelance (cuenta de cobro)");
  await elegir(catalogo, "");
  assert.equal(tipo().disabled, false, "al volver a 'Nuevo aliado' se libera");
});
