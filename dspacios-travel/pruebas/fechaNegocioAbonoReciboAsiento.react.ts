// Se ejecuta con npm run test:react (loader TSX/esbuild + jsdom), no con test:unit.
//
// Límite de día en Bogotá (UTC−5) para abono → recibo de caja → asiento.
// Bogotá a las 19:00 ya es medianoche UTC: cualquier "hoy" calculado con
// `toISOString().slice(0, 10)` salta al día siguiente desde las 7 p. m.
//
// Reloj fijo (mock.timers sobre Date) en dos instantes del MISMO día civil en
// Bogotá, 30-sep-2026:
//   18:30 Bogotá = 2026-09-30T23:30:00Z (antes del corte)
//   19:30 Bogotá = 2026-10-01T00:30:00Z (después del corte)
//
// Se ejecuta el código REAL de punta a punta: el `AbonoForm` montado en jsdom,
// la Server Action `registrarAbono`/`actualizarAbono`, `lib/contabilidad/
// asientos.ts` (posteo y reversión) y la página `app/recibo/[id]`. Solo se
// simulan las fronteras: Supabase (una BD en memoria que guarda lo que se
// insertaría), next/cache, el tenant de la cookie y el encabezado del documento.
import { test, mock, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { JSDOM } from "jsdom";

// `registerHooks` existe en Node ≥ 22.15 (el repo corre 24), pero @types/node
// del proyecto es v20 y no lo declara.
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

// "server-only" (no instalado fuera del bundler de Next), "next/cache" y
// "next/navigation" (sin mapa de exports resoluble por el ESM de Node) y el
// encabezado del documento (componente async que lee la agencia con cookies)
// se sirven como módulos mínimos solo en esta prueba. `DateInput` (arrastra
// react-day-picker) va al stub de <input> controlado que ya usa la batería.
const MODULOS_MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/navigation": "export function notFound() { throw new Error('notFound'); }",
  "@/components/contrato/DocHeader": "export const DocHeader = () => null; export const PRINT_DOC_STYLE = '';",
};
const STUB_DATE_INPUT = new URL("./support/stubs/dateInputStub.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MODULOS_MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    if (specifier === "@/components/ui/DateInput") return { url: STUB_DATE_INPUT, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

// ── BD en memoria ──────────────────────────────────────────────────────────
type Fila = Record<string, unknown>;
const PUC = ["110505", "111005", "111010", "130505", "280505", "280510", "281510", "413505"];
const db = {
  venta: { estado: "pendiente", precio_venta: 3_000_000, tipo_paquete: "dinamico", moneda: "COP", tenant: "mayorista", financiero_estado: null } as Fila,
  abonos: [] as Fila[],
  facturacion: [] as Fila[],
  asientos: [] as Fila[],
  lineas: [] as Fila[],
  seq: 0,
};
function resetDb() {
  db.abonos = []; db.facturacion = []; db.asientos = []; db.lineas = []; db.seq = 0;
}

function from(tabla: string) {
  const q: { op: string; payload: unknown; eq: Record<string, unknown>; in: unknown[] } = { op: "select", payload: null, eq: {}, in: [] };
  const run = (single: boolean): { data: unknown; error: null } => {
    const ok = (data: unknown) => ({ data, error: null });
    switch (tabla) {
      case "ventas":
        return ok(q.op === "select" ? db.venta : null);
      case "config_cobros":
        return ok(null);
      case "sillas":
        return ok(null);
      case "contrato_facturacion":
        if (q.op === "upsert") { db.facturacion.push(q.payload as Fila); return ok(null); }
        if (q.op === "delete") { db.facturacion = []; return ok(null); }
        return ok(db.facturacion[0] ?? null);
      case "abonos":
        if (q.op === "insert") {
          const fila = { id: 7, ...(q.payload as Fila) };
          db.abonos.push(fila);
          return ok({ id: fila.id });
        }
        if (q.op === "update") {
          const i = db.abonos.findIndex((a) => a.id === q.eq.id);
          db.abonos[i] = { ...db.abonos[i], ...(q.payload as Fila) };
          return ok(null);
        }
        return ok(db.abonos);
      case "puc_cuentas":
        if (single) return ok({ id: PUC.indexOf(String(q.eq.codigo)) + 1 });
        return ok(PUC.filter((c) => q.in.includes(c)).map((codigo) => ({ id: PUC.indexOf(codigo) + 1, codigo })));
      case "asientos_contables": {
        if (q.op === "insert") {
          const fila = { id: ++db.seq, ...(q.payload as Fila) };
          db.asientos.push(fila);
          return ok({ id: fila.id });
        }
        if (q.op === "delete") {
          db.asientos = db.asientos.filter((a) =>
            q.eq.id != null ? a.id !== q.eq.id : !(a.origen === q.eq.origen && a.referencia === q.eq.referencia));
          return ok(null);
        }
        if ("origen" in q.eq) {
          const act = [...db.asientos].reverse().find((a) => a.origen === q.eq.origen && a.referencia === q.eq.referencia);
          return ok(act ? { id: act.id, descripcion: act.descripcion } : null);
        }
        return ok({ numero: db.asientos.length });
      }
      case "asiento_lineas":
        if (q.op === "insert") {
          for (const l of q.payload as Fila[]) db.lineas.push(l);
          return ok(null);
        }
        if ("asiento_id" in q.eq) return ok(db.lineas.filter((l) => l.asiento_id === q.eq.asiento_id));
        return ok(db.lineas.filter((l) => l.cuenta_id === q.eq.cuenta_id && l.tercero === q.eq.tercero));
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
const sb = { from, auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "caja@dspacios.test" } }, error: null }) } };

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => sb } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => sb } });
mock.module("@/lib/tenant.server", { namedExports: { getTenant: async () => "mayorista", agenciaDe: async () => null } });
mock.module("@/lib/contrato/numeracion", { namedExports: { siguienteNumeroContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: async () => { throw new Error("no se usa"); } } });
mock.module("@/lib/reservar/asegurarCuentasPorPagar", { namedExports: { asegurarCuentasPorPagar: async () => {} } });
// El recibo lee el abono con su propio control de acceso (documentos por URL);
// aquí devuelve el abono tal como quedó guardado en la BD en memoria.
mock.module("@/lib/cuenta/estado", {
  namedExports: {
    numeroRecibo: (id: number) => `RC-${String(id).padStart(6, "0")}`,
    cargarRecibo: async (id: number) => {
      const a = db.abonos.find((x) => x.id === id);
      if (!a) return null;
      return {
        estado: { numero_contrato: "00-0451", cliente: "Cliente Prueba", destino: "SAN ANDRÉS", moneda: "COP", tenant: "mayorista", precio_venta: 3_000_000, pagado: Number(a.valor_abono), esInterno: true },
        abono: { id: a.id, fecha_abono: a.fecha_abono, valor_abono: a.valor_abono, forma_pago: a.forma_pago, referencia: a.referencia, recibido_por: null, saldoTras: 3_000_000 - Number(a.valor_abono) },
      };
    },
  },
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AbonoForm } = await import("../app/(dashboard)/dashboard/contratos/[numero]/AbonoForm.tsx");
const { registrarAbono, actualizarAbono } = await import("../app/(dashboard)/dashboard/contratos/actions.ts");
const { guardarFacturacion, quitarFacturacion } = await import("../app/(dashboard)/dashboard/contabilidad/facturacion/actions.ts");
const { default: ReciboCajaPage } = await import("../app/recibo/[id]/page.tsx");
const { act, createElement: h } = React;

const ANTES_DEL_CORTE = "2026-09-30T23:30:00.000Z"; // 18:30 Bogotá
const DESPUES_DEL_CORTE = "2026-10-01T00:30:00.000Z"; // 19:30 Bogotá
const DIA_BOGOTA = "2026-09-30";

const TZ_ORIGINAL = process.env.TZ;
function reloj(instante: string) {
  mock.timers.enable({ apis: ["Date"], now: new Date(instante) });
}

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeEach(() => resetDb());
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  mock.timers.reset();
  process.env.TZ = TZ_ORIGINAL;
});
after(() => dom.window.close());

async function montarFormulario() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(h(AbonoForm, { numeroContrato: "00-0451", formasPago: ["Transferencia", "Efectivo"] })));
}
const inputFecha = () => container.querySelector<HTMLInputElement>('input[aria-label="Fecha del abono"]')!;
const inputValor = () => container.querySelector<HTMLInputElement>('input[type="number"]')!;
async function escribir(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function enviar() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  // La action corre dentro de startTransition: se dejan drenar sus awaits.
  for (let i = 0; i < 20 && db.abonos.length === 0; i++) {
    await act(async () => { await new Promise((r) => setImmediate(r)); });
  }
}
async function fechaEnRecibo(id: number): Promise<string> {
  const html = renderToStaticMarkup(await ReciboCajaPage({ params: Promise.resolve({ id: String(id) }) }));
  const m = /Fecha: ([^<]+)</.exec(html);
  assert.ok(m, "el recibo no muestra la línea de fecha");
  return m[1];
}
const asientoDe = (origen: string) => db.asientos.filter((a) => a.origen === origen);

for (const [momento, instante] of [["18:30 (antes de las 7 p. m.)", ANTES_DEL_CORTE], ["19:30 (después de las 7 p. m.)", DESPUES_DEL_CORTE]] as const) {
  test(`abono por formulario a las ${momento} Bogotá: formulario, abono, asiento y recibo dicen 30-sep`, async () => {
    reloj(instante);
    await montarFormulario();
    assert.equal(inputFecha().value, DIA_BOGOTA, "fecha por defecto del formulario");

    await escribir(inputValor(), "500000");
    await enviar();

    assert.equal(db.abonos.length, 1, "se registró el abono");
    assert.equal(db.abonos[0].fecha_abono, DIA_BOGOTA, "fecha guardada en abonos.fecha_abono");
    const [asiento] = asientoDe("abono");
    assert.ok(asiento, "se posteó el asiento del abono");
    assert.equal(asiento.fecha, DIA_BOGOTA, "fecha del asiento = fecha del abono");
    assert.equal(asiento.referencia, "abono:7");

    // El recibo se muestra igual sin importar la zona del servidor que lo renderiza.
    for (const tz of ["UTC", "America/Bogota", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      assert.equal(await fechaEnRecibo(7), "30 de septiembre de 2026", `recibo renderizado con TZ=${tz}`);
    }
    // Tras registrar, el formulario se reinicia al día de negocio, no al de UTC.
    assert.equal(inputFecha().value, DIA_BOGOTA, "fecha del formulario tras reiniciar");
  });
}

test("fecha elegida a mano a las 19:30 Bogotá se respeta tal cual en abono, asiento y recibo", async () => {
  reloj(DESPUES_DEL_CORTE);
  await montarFormulario();
  await escribir(inputFecha(), "2026-09-15");
  await escribir(inputValor(), "250000");
  await enviar();

  assert.equal(db.abonos[0].fecha_abono, "2026-09-15");
  assert.equal(asientoDe("abono")[0].fecha, "2026-09-15");
  process.env.TZ = "UTC";
  assert.equal(await fechaEnRecibo(7), "15 de septiembre de 2026");
});

test("la Server Action sin fecha (llamada directa) usa el día de Bogotá después de las 7 p. m.", async () => {
  reloj(DESPUES_DEL_CORTE);
  const r = await registrarAbono("00-0451", 100_000, "Transferencia", "REF-1");
  assert.deepEqual(r, { ok: true });
  assert.equal(db.abonos[0].fecha_abono, DIA_BOGOTA);
  assert.equal(asientoDe("abono")[0].fecha, DIA_BOGOTA);
});

test("actualizarAbono: fecha vacía → día de Bogotá; fecha manual → intacta; el asiento se reemplaza con la misma", async () => {
  reloj(DESPUES_DEL_CORTE);
  await registrarAbono("00-0451", 100_000, "Transferencia", "", undefined, "2026-09-01");
  assert.equal(asientoDe("abono")[0].fecha, "2026-09-01");

  await actualizarAbono(7, "00-0451", { valor: 120_000, fecha: "", formaPago: "Efectivo", referencia: "" });
  assert.equal(db.abonos[0].fecha_abono, DIA_BOGOTA);
  assert.equal(asientoDe("abono").length, 1, "reemplazo, no duplicado");
  assert.equal(asientoDe("abono")[0].fecha, DIA_BOGOTA);

  await actualizarAbono(7, "00-0451", { valor: 120_000, fecha: "2026-08-31", formaPago: "Efectivo", referencia: "" });
  assert.equal(db.abonos[0].fecha_abono, "2026-08-31");
  assert.equal(asientoDe("abono")[0].fecha, "2026-08-31");
});

test("facturación a las 19:30 Bogotá: asiento y reversión con fecha de Bogotá; updated_at sigue siendo timestamp UTC", async () => {
  reloj(DESPUES_DEL_CORTE);
  const r = await guardarFacturacion({ numeroContrato: "00-0451", pvp: 3_000_000, irt: 2_000_000, ingresoExento: 0 });
  assert.deepEqual(r, { ok: true });
  assert.equal(db.facturacion[0].updated_at, DESPUES_DEL_CORTE, "el timestamp NO se convierte a fecha de negocio");
  assert.equal(asientoDe("facturacion")[0].fecha, DIA_BOGOTA, "asiento de facturación");

  await quitarFacturacion("00-0451");
  const [reversion] = asientoDe("facturacion_reversion");
  assert.ok(reversion, "se generó la reversión");
  assert.equal(reversion.fecha, DIA_BOGOTA, "reversión sin asiento nuevo: fecha de Bogotá");
});
