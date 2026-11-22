// Renders REAL portal pages (quotations: assisted and own views; clients list inside the real portal shell) from an in-memory database with synthetic rows.
// NOT a test, NOT part of any suite. Run: node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs pruebas/support/visual_b2b_portal_render.ts <outDir>
// Limits: no login/Auth/PostgREST (in-memory boundary); images and fonts depend on the standalone page.
import fs from "node:fs";
import path from "node:path";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((context.parentURL ?? "").endsWith("/portal/b2b/cotizaciones/actions.ts")) {
      if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {}")}`, shortCircuit: true };
      if (specifier === "@/lib/supabase/admin") return { url: pathToFileURL(path.join(process.cwd(), "pruebas", "support", "stubs", "supabaseAdminStub.mjs")).href, shortCircuit: true };
    }
    if ((context.parentURL ?? "").endsWith("/clientes/ClientesAliado.tsx")) {
      if (specifier === "next/navigation") return { url: `data:text/javascript,${encodeURIComponent("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; }")}`, shortCircuit: true };
      if (specifier === "./actions") return { url: `data:text/javascript,${encodeURIComponent("export async function guardarCliente() { return { ok: true }; }")}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const { default: PortalCotizaciones } = await import("../../app/portal/b2b/cotizaciones/page.tsx");
const { supabaseEnMemoria } = await import("./memoriaSupabase.ts");
const { __setClient } = await import("./stubs/supabaseServerStub.mjs");
const { __setAdmin } = await import("./stubs/supabaseAdminStub.mjs");
const { PortalShell, Titulo } = await import("../../components/portal/PortalShell.tsx");
const { TablaCotizaciones } = await import("../../components/portal/TablaCotizaciones.tsx");
const { ClientesAliado } = await import("../../app/portal/b2b/clientes/ClientesAliado.tsx");

type Fila = Record<string, unknown>;
const UA = "u-a", EA = "laura@correo.test";
const usuario: Fila = { id: UA, email: EA, nombre: "Laura Gómez", rol: "freelance", activo: true, tenant: "mayorista", agencia_id: null, pct_comision: null, aliado_id: 7, acceso_legacy_nombre: false };
const base = (id: number, extra: Fila): Fila => ({
  id, codigo: `COT-${id}`, modo: "simple", estado: "abierta", numero_contrato: null, tenant: "mayorista", creado_por: EA, tipo: "tarifario", vigencia_hasta: "2027-06-30", fecha_salida: "2027-02-10", fecha_regreso: "2027-02-14",
  destino: "CARTAGENA", cliente: "Ana Gómez", precio_venta: 1_800_000, moneda: "COP", pax: 2, created_at: "2026-11-10T10:00:00Z", payload: {}, share_token: `tok-${id}`, ...extra,
});
const asistida = (id: number, numero: string, extra: Fila = {}): Fila => base(id, { estado: "convertida", numero_contrato: numero, creado_por: "interno@dspacios.test", payload: { b2bAsistido: { aliado_id: 7, modo_compra: "neta", total_exigible: 4_520_000 } }, b2b_modo: "neta", b2b_total: "4520000", precio_venta: 5_000_000, destino: "SAN ANDRÉS", cliente: "Cliente Uno", ...extra });
const venta = (n: string, extra: Fila = {}): Fila => ({ numero_contrato: n, precio_venta: 4_700_000, moneda: "COP", estado: "confirmado", aliado_id: 7, b2b_usuario_id: null, tenant: "mayorista", ...extra });

async function pagina(vista: string, t: Record<string, Fila[]>) {
  const admin = supabaseEnMemoria(t, {});
  __setAdmin({ from: (x: string) => admin.from(x), rpc: admin.rpc });
  __setClient(supabaseEnMemoria(t, {}, UA));
  return renderToStaticMarkup(await PortalCotizaciones({ searchParams: Promise.resolve({ vista }) }) as never).replace(/<!-- -->/g, "");
}
const asistidas = await pagina("asistidas", {
  usuarios: [usuario],
  cotizaciones: [asistida(1, "00-0451"), asistida(2, "00-0453", { moneda: "USD", precio_venta: 2500, b2b_total: "2260", destino: "CANCÚN", payload: { b2bAsistido: { aliado_id: 7, modo_compra: "neta", total_exigible: 2260 } } })],
  ventas: [venta("00-0451"), venta("00-0453", { precio_venta: 2260, moneda: "USD" })],
  "rpc:comparativas_b2b_visibles": [],
});
const directas = await pagina("directas", {
  usuarios: [usuario],
  cotizaciones: [base(11, {}), base(12, { destino: "SANTA MARTA", cliente: "Pedro Ruiz", precio_venta: 2_450_000 })],
  ventas: [],
  cotizacion_solicitudes_contrato: [{ id: 1, cotizacion_id: 12, estado: "solicitada", notificados: 2, creado_en: "2026-11-18T15:00:00Z", solicitante_id: UA, aliado_id: 7, huella: "x" }],
  "rpc:comparativas_b2b_visibles": [],
});
const items = [
  { clave: "maria perez", nombre: "María Pérez", guardado: { id: 1, tipo_documento: "CC", documento: "1010", email: "maria.perez.larga.direccion@cliente-ejemplo.test", telefono: "3001112222", notas: "Prefiere WhatsApp; viaja con su madre y necesita habitación accesible.", actualizado_en: "2026-11-02T10:00:00.000Z" },
    contratos: [{ numero_contrato: "00-0001", destino: "CARTAGENA", fecha_salida: "2026-12-10", estado: "confirmado" }, { numero_contrato: "00-0002", destino: "SANTA MARTA", fecha_salida: "2027-01-05", estado: "pendiente" }], cotizaciones: [] },
  { clave: "ana rios", nombre: "Ana Ríos", guardado: null, contratos: [], cotizaciones: [{ id: 1, codigo: "COT-1", destino: "CARTAGENA", fecha_salida: "2026-12-15", estado: "enviada" }] },
];
const clientes = renderToStaticMarkup(h("div", { className: "mx-auto max-w-5xl p-4" }, h("h1", { className: "mb-3 text-xl font-semibold text-gray-900" }, "Mis clientes"), h(ClientesAliado, { items, puedeEditar: true } as never)));
const fila = (id: number, extra: Record<string, unknown>) => ({ id, codigo: `COT-${id}`, modo: 'simple', cliente: 'Ana Gómez', destino: 'CARTAGENA', hotel: null, pax: 2, precio_venta: 1800000, moneda: 'COP', fecha_salida: '2027-02-10', vigencia_hasta: '2027-06-30', estado: 'abierta', share_token: 'tok', numero_contrato: null, created_at: '2026-11-10T10:00:00Z', ...extra });
const contratos = new Map([['00-0451', { numero: '00-0451', valor: 4700000, moneda: 'COP', anulado: false, vista: 'asistidas' }]]) as never;
const tabla = renderToStaticMarkup(h('div', { className: 'mx-auto max-w-6xl p-4' }, h(TablaCotizaciones, { hoy: '2026-11-20', vacio: 'vacío', contratos,
  solicitudes: { 12: { cotizacion_id: 12, notificados: 2, creado_en: '2026-11-18T15:00:00Z' }, 14: { cotizacion_id: 14, notificados: 0, creado_en: '2026-11-19T15:00:00Z' } },
  filas: [fila(11, {}), fila(12, { destino: 'SANTA MARTA', cliente: 'Pedro Ruiz' }), fila(14, { destino: 'CANCÚN', cliente: 'Eva Mora', moneda: 'USD', precio_venta: 2500 }), fila(13, { vigencia_hasta: '2026-10-30', destino: 'MEDELLÍN' }), fila(15, { estado: 'convertida', numero_contrato: '00-0451', destino: 'SAN ANDRÉS', precio_venta: 4520000 })] } as never)));
for (const [k, v] of Object.entries({ "portal-cotizaciones-asistidas": asistidas, "portal-cotizaciones-directas": directas, "portal-clientes": clientes, "portal-tabla-cotizaciones": tabla })) fs.writeFileSync(path.join(out, `${k}.body.html`), v.replace(/<link rel="preload"[^>]*\/>/g, ""));
console.log("portal vistas escritas");
