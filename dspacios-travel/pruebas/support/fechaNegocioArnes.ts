// Arnés de las pruebas de "fecha de negocio" con reloj fijo (pruebas/
// fechaNegocio*.react.ts). Se ejecuta con el loader de test:react.
//
// Importarlo PRIMERO (import estático) y cargar después, con `await import`,
// lo que se prueba. Hace tres cosas:
//   1. Registra un hook de resolución propio, que corre antes que los mapeos
//      de reactLoader.mjs: las fronteras (Supabase, next/*, tenant) se sirven
//      como módulos mínimos que leen `globalThis.__arnesFechas`, y lo que se
//      prueba se carga REAL (Server Actions, `lib/contabilidad/asientos.ts`,
//      `asegurarCuentasPorPagar`), aunque reactLoader lo cambie por un stub
//      para otras pruebas. No toca reactLoader.mjs ni sus stubs.
//   2. Monta jsdom (para los componentes de cliente).
//   3. Expone una BD en memoria genérica (filtra por eq/in/lt/…, ordena,
//      limita) que guarda exactamente lo que la app insertaría, y el reloj fijo.
import * as nodeModule from "node:module";
import { mock } from "node:test";
import { JSDOM } from "jsdom";

type ResolveHook = (
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (specifier: string, context: unknown) => unknown,
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

const RAIZ = new URL("../../", import.meta.url);
const real = (rel: string) => new URL(rel, RAIZ).href;
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;

const MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
  "next/navigation": [
    "export function notFound() { throw new Error('notFound'); }",
    "export function redirect(u) { throw new Error('redirect ' + u); }",
    "export function useRouter() { return { refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }; }",
    "export function usePathname() { return '/'; }",
    "export function useSearchParams() { return new URLSearchParams(); }",
  ].join("\n"),
  "next/headers": "export async function cookies() { return { get() {}, getAll() { return []; }, set() {} }; } export async function headers() { return new Headers(); }",
  "@/lib/supabase/server": "export async function createClient() { return globalThis.__arnesFechas.sb; }",
  "@/lib/supabase/admin": "export function createAdminClient() { return globalThis.__arnesFechas.sb; }",
  // Contexto de creación de contrato (sesión + rol + tenant) y numeración: las
  // pruebas de reserva/contrato no prueban autorización ni la secuencia.
  "@/lib/contrato/contexto":
    "export async function contextoCrearContrato() { return { ok: true, tenant: 'mayorista', rol: 'superadmin', sb: globalThis.__arnesFechas.sb }; }",
  "@/lib/contrato/numeracion": [
    "export async function siguienteNumeroContrato() {",
    "  const a = globalThis.__arnesFechas; a.seq = (a.seq ?? 450) + 1;",
    "  return { ok: true, numero: 'DTM-' + String(a.seq).padStart(4, '0') };",
    "}",
  ].join("\n"),
  "@/lib/tenant.server": [
    "export async function getTenant() { return 'mayorista'; }",
    "export async function tenantContext() { return { tenant: 'mayorista', home: 'mayorista', puedeCambiar: false }; }",
    "export async function agenciaDe() { return null; }",
  ].join("\n"),
};
const REALES: Record<string, string> = {
  "@/lib/contabilidad/asientos": real("lib/contabilidad/asientos.ts"),
  "@/lib/reservar/asegurarCuentasPorPagar": real("lib/reservar/asegurarCuentasPorPagar.ts"),
  // react-day-picker no aporta nada aquí: un <input> controlado (stub ya existente).
  "@/components/ui/DateInput": new URL("./stubs/dateInputStub.mjs", import.meta.url).href,
};
// Server Actions relativas que reactLoader sustituye por stubs según el padre.
const ACCIONES_RELATIVAS: Array<[string, string, string]> = [
  ["./actions", "/dashboard/pagos/PagosList.tsx", "app/(dashboard)/dashboard/pagos/actions.ts"],
];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (MINIMOS[specifier] != null) return { url: datos(MINIMOS[specifier]), shortCircuit: true };
    if (REALES[specifier]) return { url: REALES[specifier], shortCircuit: true };
    for (const [esp, padre, destino] of ACCIONES_RELATIVAS) {
      if (specifier === esp && context.parentURL?.endsWith(padre)) return { url: real(destino), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// ── jsdom ──────────────────────────────────────────────────────────────────
export const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

// ── Reloj fijo ─────────────────────────────────────────────────────────────
// 30-sep-2026 en Bogotá (UTC−5): 18:30 = 23:30Z; 19:30 = 00:30Z del 1-oct.
export const ANTES_DEL_CORTE = "2026-09-30T23:30:00.000Z";
export const DESPUES_DEL_CORTE = "2026-10-01T00:30:00.000Z";
export const DIA_BOGOTA = "2026-09-30";
export const MOMENTOS: Array<[string, string]> = [
  ["18:30 Bogotá (antes de las 7 p. m.)", ANTES_DEL_CORTE],
  ["19:30 Bogotá (después de las 7 p. m.)", DESPUES_DEL_CORTE],
];
export function reloj(instante: string) {
  mock.timers.enable({ apis: ["Date"], now: new Date(instante) });
}
export function soltarReloj() {
  mock.timers.reset();
}

// ── BD en memoria genérica ─────────────────────────────────────────────────
export type Fila = Record<string, unknown>;
// Cuentas PUC que usan los posteos automáticos (lib/contabilidad/asientos.ts).
const PUC = [
  "110505", "111005", "111010", "130505", "280505", "280510", "281510", "413505", "240802",
  "220505", "220510", "220515", "220520", "220595", "613505", "613510", "613515", "613520", "613595",
  "236540", "236570",
];

export type ManejadorRpc = (args: Record<string, unknown>) => unknown;

export function crearBD(semilla: Record<string, Fila[]> = {}, rpcs: Record<string, ManejadorRpc> = {}) {
  const tablas = new Map<string, Fila[]>();
  const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const sec = new Map<string, number>();
  const filas = (t: string) => {
    if (!tablas.has(t)) tablas.set(t, []);
    return tablas.get(t)!;
  };
  const nuevoId = (t: string) => {
    const n = Math.max(sec.get(t) ?? 0, ...filas(t).map((f) => Number(f.id) || 0)) + 1;
    sec.set(t, n);
    return n;
  };
  filas("puc_cuentas").push(...PUC.map((codigo, i) => ({ id: i + 1, tenant: "mayorista", codigo })));
  for (const [t, fs] of Object.entries(semilla)) filas(t).push(...fs.map((f) => ({ ...f })));

  function from(tabla: string) {
    type Filtro = (f: Fila) => boolean;
    const q = {
      op: "select" as "select" | "insert" | "update" | "upsert" | "delete",
      payload: null as unknown, conflicto: "id", filtros: [] as Filtro[],
      orden: [] as Array<[string, boolean]>, limite: Infinity,
    };
    const ejecutar = (unico: boolean) => {
      const coinciden = () => filas(tabla).filter((f) => q.filtros.every((fn) => fn(f)));
      let data: Fila[] = [];
      if (q.op === "insert") {
        const lista = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Fila[];
        data = lista.map((f) => ({ id: f.id ?? nuevoId(tabla), created_at: new Date().toISOString(), ...f }));
        filas(tabla).push(...data);
      } else if (q.op === "upsert") {
        const lista = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Fila[];
        const claves = q.conflicto.split(",").map((s) => s.trim());
        data = lista.map((f) => {
          const ex = filas(tabla).find((x) => claves.every((k) => x[k] === f[k]));
          if (ex) return Object.assign(ex, f);
          const fila = { id: f.id ?? nuevoId(tabla), ...f };
          filas(tabla).push(fila);
          return fila;
        });
      } else if (q.op === "update") {
        data = coinciden();
        for (const f of data) Object.assign(f, q.payload as Fila);
      } else if (q.op === "delete") {
        const borrar = new Set(coinciden());
        tablas.set(tabla, filas(tabla).filter((f) => !borrar.has(f)));
        // Como PostgREST con .select(): devuelve las filas borradas.
        data = [...borrar];
      } else {
        data = [...coinciden()];
        for (const [col, asc] of [...q.orden].reverse()) {
          data.sort((a, b) => {
            const x = a[col] as never, y = b[col] as never;
            return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
          });
        }
        data = data.slice(0, q.limite);
      }
      if (!unico) return { data, error: null };
      return { data: data[0] ?? null, error: null };
    };
    const b = {
      select: () => b,
      insert: (p: unknown) => { q.op = "insert"; q.payload = p; return b; },
      update: (p: unknown) => { q.op = "update"; q.payload = p; return b; },
      upsert: (p: unknown, o?: { onConflict?: string }) => { q.op = "upsert"; q.payload = p; q.conflicto = o?.onConflict ?? "id"; return b; },
      delete: () => { q.op = "delete"; return b; },
      eq: (k: string, v: unknown) => { q.filtros.push((f) => f[k] === v); return b; },
      neq: (k: string, v: unknown) => { q.filtros.push((f) => f[k] !== v); return b; },
      in: (k: string, v: unknown[]) => { q.filtros.push((f) => v.includes(f[k])); return b; },
      is: (k: string, v: unknown) => { q.filtros.push((f) => (f[k] ?? null) === v); return b; },
      // Las formas que usa la app: .not(col, "in", '("a","b")') y .not(col, "is", null).
      not: (k: string, op: string, v: string | null) => {
        if (op === "is") { q.filtros.push((f) => (f[k] ?? null) !== v); return b; }
        if (op !== "in" || v == null) throw new Error(`arnés: .not(${k}, ${op}) no simulado`);
        const lista = v.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
        q.filtros.push((f) => !lista.includes(String(f[k])));
        return b;
      },
      lt: (k: string, v: never) => { q.filtros.push((f) => (f[k] as never) < v); return b; },
      lte: (k: string, v: never) => { q.filtros.push((f) => (f[k] as never) <= v); return b; },
      gt: (k: string, v: never) => { q.filtros.push((f) => (f[k] as never) > v); return b; },
      gte: (k: string, v: never) => { q.filtros.push((f) => (f[k] as never) >= v); return b; },
      order: (k: string, o?: { ascending?: boolean }) => { q.orden.push([k, o?.ascending !== false]); return b; },
      limit: (n: number) => { q.limite = n; return b; },
      maybeSingle: async () => ejecutar(true),
      single: async () => ejecutar(true),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(ejecutar(false)).then(res, rej),
    };
    return b;
  }
  const sb = {
    from,
    auth: { getUser: async () => ({ data: { user: { id: "u-arnes", email: "arnes@dspacios.test" } }, error: null }) },
    // Cada llamada queda registrada (nombre + argumentos) para que la prueba
    // vea exactamente qué recibió la base; sin manejador, falla en claro.
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      llamadasRpc.push({ fn, args });
      const manejador = rpcs[fn] ?? porDefecto[fn];
      if (!manejador) throw new Error(`rpc no simulado en el arnés: ${fn}`);
      // Un manejador puede simular el rechazo de una RPC (SQLSTATE F44xx de la 208)
      // devolviendo { __error: { code, message } }, como lo entrega PostgREST.
      const r = await manejador(args);
      if (r && typeof r === "object" && "__error" in r) return { data: null, error: (r as { __error: unknown }).__error };
      return { data: r, error: null };
    },
  };

  // RPC de sistema que la app llama al crear contratos (#30 B: el contrato
  // manual escribe costos y CxP por `registrar_financiero_contrato`, migraciones
  // 171/172, igual que reservar). Solo su EFECTO en memoria, para que las pruebas
  // de fecha/comisión que crean contratos sigan probando lo suyo; la transacción,
  // la idempotencia y los permisos reales se prueban en Postgres
  // (pruebas/contratoManualNeto206.pg.ts, CXP-1..4). Una prueba que pase su
  // propio manejador lo reemplaza.
  const MARCA_CXP_AUTOMATICA = "Generado automáticamente desde el tarifario";
  const porDefecto: Record<string, ManejadorRpc> = {
    registrar_financiero_contrato: (args) => {
      const numero = String(args.p_numero_contrato);
      const v = filas("ventas").find((f) => f.numero_contrato === numero && f.tenant === args.p_tenant);
      if (!v) throw new Error(`registrar_financiero_contrato: el contrato ${numero} no existe en la agencia ${String(args.p_tenant)}`);
      const pagadas = new Set([...filas("cxp_pagos"), ...filas("retenciones_cxp")].map((p) => p.cuenta_por_pagar_id));
      const eliminadas = filas("cuentas_por_pagar")
        .filter((c) => c.numero_contrato === numero && String(c.observaciones ?? "").startsWith(MARCA_CXP_AUTOMATICA) && !pagadas.has(c.id))
        .map((c) => c.id);
      tablas.set("cuentas_por_pagar", filas("cuentas_por_pagar").filter((c) => !eliminadas.includes(c.id)));
      Object.assign(v, args.p_costos as Fila, { financiero_estado: "completo" });
      const creadas = ((args.p_cxp as Fila[] | undefined) ?? []).map((c) => {
        const fila: Fila = { id: nuevoId("cuentas_por_pagar"), numero_contrato: numero, tenant: args.p_tenant, moneda: "COP", ...c };
        filas("cuentas_por_pagar").push(fila);
        return { id: fila.id, tipo_proveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio, servicio_id: c.servicio_id ?? null, valor_total: c.valor_total };
      });
      tablas.set("contrato_financiero_pendiente", filas("contrato_financiero_pendiente").filter((p) => p.numero_contrato !== numero));
      return { creadas, eliminadas };
    },
    revertir_contrato_incompleto: (args) => {
      const numero = String(args.p_numero_contrato);
      for (const t of ["ventas", "contrato_items", "contrato_hoteles", "contrato_vuelos", "contrato_pasajeros", "contrato_servicios",
        "aliados_b2b", "cuentas_por_pagar", "contrato_financiero_pendiente"]) {
        tablas.set(t, filas(t).filter((f) => f.numero_contrato !== numero));
      }
      return null;
    },
  };
  return { sb, filas, tablas, llamadasRpc };
}

export function usarBD(semilla: Record<string, Fila[]> = {}, rpcs: Record<string, ManejadorRpc> = {}) {
  const bd = crearBD(semilla, rpcs);
  (globalThis as unknown as { __arnesFechas: { sb: unknown } }).__arnesFechas = { sb: bd.sb };
  return bd;
}

/** Asientos de un origen, en orden de creación. */
export function asientos(bd: ReturnType<typeof crearBD>, origen: string) {
  return bd.filas("asientos_contables").filter((a) => a.origen === origen);
}

// ── React ──────────────────────────────────────────────────────────────────
export async function montar(elemento: unknown) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const contenedor = document.createElement("div");
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  await React.act(async () => raiz.render(elemento as never));
  return {
    contenedor,
    async desmontar() {
      await React.act(async () => raiz.unmount());
      contenedor.remove();
    },
  };
}
export async function escribir(el: HTMLInputElement, valor: string) {
  const React = await import("react");
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
export async function clic(el: Element | null | undefined, que = "elemento") {
  if (!el) throw new Error(`no se encontró ${que}`);
  const React = await import("react");
  await React.act(async () => { (el as HTMLElement).click(); });
}
export async function enviar(form: HTMLFormElement | null) {
  if (!form) throw new Error("no se encontró el formulario");
  const React = await import("react");
  await React.act(async () => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
}
/** Deja correr las transiciones/awaits de una Server Action hasta que `listo()` o se agote. */
export async function esperar(listo: () => boolean, vueltas = 40) {
  const React = await import("react");
  for (let i = 0; i < vueltas && !listo(); i++) {
    await React.act(async () => { await new Promise((r) => setImmediate(r)); });
  }
}
export function botonConTexto(raiz: Element, texto: string | RegExp) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    typeof texto === "string" ? b.textContent?.trim() === texto : texto.test(b.textContent ?? ""));
}
