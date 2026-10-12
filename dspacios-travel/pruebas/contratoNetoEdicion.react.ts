// Se ejecuta con npm run test:react (loader del arnés).
//
// #30 · Un contrato B2B vendido en NETO no cambia de importes ni de modalidad
// después de emitido. Su `precio_venta` es el total exigible (PVP − comisión ya
// descontada, congelada en aliados_b2b por la 205): moverlo lo descuadraría de
// esa comisión. Se ejecutan las acciones REALES contra una base en memoria que
// registra cada escritura, y se comprueba que en NETO se rechazan sin escribir
// nada, y que fuera de NETO siguen funcionando igual que antes.
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";

type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/navigation": "export function notFound() { throw new Error('notFound'); }",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// ── BD en memoria ──────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
const NETO: Fila = {
  numero_contrato: "DTM-0900", tenant: "mayorista", tipo_asesor: "agencia", estado: "pendiente", pax: 2,
  paquete_armado_id: 5, fecha_salida: "2026-12-01", fecha_regreso: "2026-12-05",
  precio_venta: 1_840_000, impuesto: 400_000, modo_compra: "neta", comision_b2b: 160_000, comision_estado: "descontada",
};
const PVP: Fila = {
  numero_contrato: "DTM-0901", tenant: "mayorista", tipo_asesor: "agencia", estado: "activo", pax: 2,
  paquete_armado_id: null, precio_venta: 2_000_000, impuesto: 400_000, modo_compra: null, comision_b2b: null, comision_estado: null,
};
const NETO_MIN: Fila = { ...NETO, numero_contrato: "MIN-00-0451", tenant: "minorista" };

const db = { ventas: [] as Fila[], escrituras: [] as { tabla: string; op: string; payload: unknown }[] };
beforeEach(() => {
  db.ventas = [NETO, PVP, NETO_MIN].map((v) => ({ ...v }));
  db.escrituras = [];
});

function from(tabla: string) {
  const q = { op: "select", payload: null as unknown, eq: {} as Record<string, unknown>, in: null as unknown[] | null };
  const filtrar = (filas: Fila[]) => filas.filter((f) =>
    Object.entries(q.eq).every(([k, v]) => f[k] === v) && (q.in == null || q.in.includes(f.numero_contrato)));
  const run = (single: boolean) => {
    if (q.op !== "select") {
      db.escrituras.push({ tabla, op: q.op, payload: q.payload });
      return { data: null, error: null };
    }
    switch (tabla) {
      case "ventas":
      case "ventas_basica": {
        const filas = filtrar(db.ventas);
        return { data: single ? filas[0] ?? null : filas, error: null };
      }
      case "usuarios":
        return { data: { rol: "superadmin", activo: true }, error: null };
      case "contrato_items":
        return { data: [{ modo_precio: "por_persona", valor_total: null, adultos: 2, ninos: 0, tarifa_adulto: 1_000_000, tarifa_nino: 0 }], error: null };
      default:
        throw new Error(`tabla no simulada: ${tabla}`);
    }
  };
  const b = {
    select: () => b,
    insert: (p: unknown) => { q.op = "insert"; q.payload = p; return b; },
    update: (p: unknown) => { q.op = "update"; q.payload = p; return b; },
    upsert: (p: unknown) => { q.op = "upsert"; q.payload = p; return b; },
    delete: () => { q.op = "delete"; return b; },
    eq: (k: string, v: unknown) => { q.eq[k] = v; return b; },
    in: (_k: string, v: unknown[]) => { q.in = v; return b; },
    order: () => b,
    limit: () => b,
    maybeSingle: async () => run(true),
    single: async () => run(true),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
  };
  return b;
}
const sb = { from, auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "admin@dspacios.test" } }, error: null }) } };

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sb } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => sb } });
mock.module("@/lib/tenant.server", { namedExports: { getTenant: async () => "minorista", agenciaDe: async () => null } });
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/asegurarCuentasPorPagar", { namedExports: { asegurarCuentasPorPagar: async () => {} } });

const { actualizarVenta, actualizarServiciosContrato } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { sincronizarPrecioVenta } = await import("../app/(dashboard)/dashboard/contratos/[numero]/contenido-actions.ts");
const { importarHistorico } = await import("../app/(dashboard)/dashboard/contratos/importar/actions.ts");

const edicion = (v: Fila, cambios: Record<string, string> = {}) => ({
  cliente: "Cliente Prueba", clienteDocumento: "", clienteTelefono: "", clienteEmail: "", clienteDireccion: "",
  destino: "SMR", fechaSalida: "2026-12-01", fechaRegreso: "2026-12-05", plazo: "",
  tipoAsesor: String(v.tipo_asesor), agenciaNombre: "Agencia Aliada", agenciaAsesor: "", freelanceNombre: "",
  asesorNombre: "Asesora", planNombre: "", observaciones: "",
  precioVenta: String(v.precio_venta), pax: String(v.pax), ...cambios,
});
const escriturasVentas = () => db.escrituras.filter((e) => e.tabla === "ventas");

test("NETO: editar la cabecera sin tocar precio ni tipo se guarda (y conserva el total exigible)", async () => {
  const r = await actualizarVenta("DTM-0900", edicion(NETO, { cliente: "Cliente Corregido" }));
  assert.deepEqual(r, { ok: true });
  const [e] = escriturasVentas();
  assert.equal((e.payload as Fila).precio_venta, 1_840_000);
  assert.equal((e.payload as Fila).cliente, "Cliente Corregido");
});

test("NETO: subir el precio al PVP (o cualquier otro valor) se rechaza sin escribir", async () => {
  for (const precio of ["2000000", "1800000", "0"]) {
    const r = await actualizarVenta("DTM-0900", edicion(NETO, { precioVenta: precio }));
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /NETO: el precio de venta es el total exigible/);
  }
  assert.equal(escriturasVentas().length, 0);
});

test("NETO: pasar a venta interna (o cambiar de agencia a freelance) se rechaza sin escribir", async () => {
  for (const tipo of ["interno", "freelance"]) {
    const r = await actualizarVenta("DTM-0900", edicion(NETO, { tipoAsesor: tipo }));
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /tipo de venta/);
  }
  assert.equal(escriturasVentas().length, 0);
});

test("PVP: precio y tipo de venta se siguen editando como antes", async () => {
  const r = await actualizarVenta("DTM-0901", edicion(PVP, { precioVenta: "2100000", tipoAsesor: "freelance" }));
  assert.deepEqual(r, { ok: true });
  const [e] = escriturasVentas();
  assert.equal((e.payload as Fila).precio_venta, 2_100_000);
  assert.equal((e.payload as Fila).tipo_asesor, "freelance");
});

test("contrato inexistente o sin acceso: no escribe", async () => {
  const r = await actualizarVenta("DTM-9999", edicion(PVP));
  assert.deepEqual(r, { ok: false, error: "El contrato no existe o no tienes acceso." });
  assert.equal(escriturasVentas().length, 0);
});

test("NETO pendiente: cambiar servicios se rechaza antes de tocar ítems o precio", async () => {
  const r = await actualizarServiciosContrato("DTM-0900", [1, 2]);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /NETO: los servicios no se cambian/);
  assert.equal(db.escrituras.length, 0);
});

test("NETO: igualar el precio a la suma de ítems (a PVP) se rechaza sin escribir", async () => {
  const r = await sincronizarPrecioVenta("DTM-0900");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Contrato NETO/);
  assert.equal(escriturasVentas().length, 0);
});

test("PVP: igualar el precio a la suma de ítems sigue funcionando", async () => {
  const r = await sincronizarPrecioVenta("DTM-0901");
  assert.deepEqual(r, { ok: true });
  assert.equal((escriturasVentas()[0].payload as Fila).precio_venta, 2_000_000);
});

// Hojas mínimas del importador (columnas separadas por tabulador): Relación de
// utilidades (n.º en la columna 1, precio en la 4) y Resumen de pagos (n.º en
// la 0, precio en la 5).
const relacion = (num: string) => ["1", num, "01/09/2026", "01/12/2026", "$2.000.000", "", "", "", "", "", "", "", "", "", ""].join("\t");
const resumen = (num: string) => [num, "", "Titular Prueba", "1000", "01/09/2026", "$2.000.000"].join("\t");

test("importador minorista: un contrato NETO existente bloquea la reimportación completa, sin escribir nada", async () => {
  const r = await importarHistorico([relacion("00-0451"), relacion("00-0452")].join("\n"), [resumen("00-0451"), resumen("00-0452")].join("\n"));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /NETO no se reimportan \(.*\): MIN-00-0451$/);
  assert.equal(db.escrituras.length, 0, "ni ventas, ni abonos, ni cuentas por pagar");
});
