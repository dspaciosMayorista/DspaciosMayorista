// Se ejecuta con npm run test:react (loader del arnés).
// #102 (auditoría Preview #403) — RNT de la cotización: las rutas REALES (imprimible interna y enlace público) se ejecutan con un cliente Supabase falso y se renderiza
// el documento. Se distinguen tres casos al leer `agencias`: error técnico, fila ausente y dato válido. Para Minorista, ni un error ni una fila ausente (o sin RNT)
// pueden terminar imprimiendo el RNT de Mayorista: la ruta falla de forma explícita.
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import nodeModule from "node:module";

// next/navigation y next/link como módulos mínimos (el arnés no los resuelve sin extensión).
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MINIMOS: Record<string, string> = {
  "next/navigation": 'export function notFound() { throw new Error("NOT_FOUND"); }',
  "next/link": "export default function Link(p) { return p.children ?? null; }",
  "@/lib/cotizacion/comparativaDocumento": "export const PaginaImprimibleComparativa = () => null; export const paginaPublicaComparativa = async () => null;",
  "@/lib/supabase/server": "export const createClient = async () => globalThis.__rutas102.fakeSb();",
  "@/lib/supabase/admin": "export const createAdminClient = () => globalThis.__rutas102.fakeSb();",
  "@/lib/cotizacion/acceso": "export const contextoCotizacion = async () => globalThis.__rutas102.contexto(); export const autorizaTenant = (ctx, t) => globalThis.__rutas102.autoriza(ctx, t);",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Escenario = "valida" | "error" | "ausente" | "sin_rnt";
const estado: { escenario: Escenario; tenant: "mayorista" | "minorista"; consultasAgencias: string[]; filasListado: Record<string, unknown>[] } = { escenario: "valida", tenant: "minorista", consultasAgencias: [], filasListado: [] };

const AGENCIA = (tenant: string) => ({ tenant, rnt: `RNT-${tenant.toUpperCase()}-777`, razon_social: `Razón ${tenant}`, nit: `NIT-${tenant}`, correo: `${tenant}@x.test`, banco: `Banco ${tenant}`, tipo_cuenta: "Ahorros", numero_cuenta: `CTA-${tenant}` });
const detalle = (tenant: string) => ({
  venta: { numero_contrato: "", cliente: "Ana Pérez", cliente_documento: "123", cliente_telefono: "300", cliente_direccion: null, estado: "pendiente", fecha_emision: "2030-02-01", fecha_salida: "2030-03-01", pax: 2, plan_nombre: "Plan", moneda: "COP", tenant },
  pasajeros: [], hoteles: [], vuelos: [], items: [],
});

function fakeSb() {
  return {
    from: (tabla: string) => {
      let filtro: string | null = null;
      const lista = {
        eq: () => lista,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: tabla === "cotizaciones" ? estado.filasListado : [], error: null }).then(ok, ko),
      };
      const q = {
        select: () => q,
        order: () => lista,
        eq: (_c: string, v: string) => { filtro = v; return q; },
        maybeSingle: async () => {
          if (tabla === "cotizaciones") return { data: { codigo: "COT-9", detalle: detalle(estado.tenant), vigencia_hasta: "2030-02-20", tipo: "carrito", payload: {}, created_at: "2030-01-01", tenant: estado.tenant, modo: null }, error: null };
          if (tabla === "agencias") {
            estado.consultasAgencias.push(String(filtro));
            if (estado.escenario === "error") return { data: null, error: { message: "caída de red" } };
            if (estado.escenario === "ausente") return { data: null, error: null };
            const fila = AGENCIA(String(filtro));
            return { data: estado.escenario === "sin_rnt" ? { ...fila, rnt: "  " } : fila, error: null };
          }
          return { data: null, error: null };
        },
      };
      return q;
    },
  };
}

const { autorizaTenant } = await import("../lib/cotizacion/accesoPuro.ts");
(globalThis as unknown as { __rutas102: unknown }).__rutas102 = {
  fakeSb,
  contexto: async () => ({ ok: true, superadmin: false, tenant: estado.tenant }),
  autoriza: autorizaTenant,
};

const interna = (await import("../app/cotizacion/[id]/page.tsx")).default as (a: { params: Promise<{ id: string }> }) => Promise<unknown>;
const publica = (await import("../app/cot/[token]/page.tsx")).default as (a: { params: Promise<{ token: string }> }) => Promise<unknown>;
const { EMPRESA } = await import("../lib/contrato/plantilla.ts");
const { formatMoneda } = await import("../lib/utils.ts");
const listado = (await import("../app/(dashboard)/dashboard/cotizaciones/page.tsx")).default as () => Promise<unknown>;

const html = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const RUTAS: [string, () => Promise<unknown>][] = [
  ["imprimible interna", () => interna({ params: Promise.resolve({ id: "1" }) })],
  ["enlace público", () => publica({ params: Promise.resolve({ token: "tok" }) })],
];

beforeEach(() => { estado.filasListado = []; estado.escenario = "valida"; estado.tenant = "minorista"; estado.consultasAgencias = []; });

for (const [nombre, ruta] of RUTAS) {
  describe(`RNT de la cotización de Minorista · ${nombre}`, () => {
    test("dato válido: imprime el RNT, el NIT y la cuenta de Minorista (nunca los de Mayorista)", async () => {
      const t = html(await ruta());
      assert.match(t, /RNT RNT-MINORISTA-777/);
      assert.match(t, /Banco minorista — Ahorros CTA-minorista/);
      assert.ok(!t.includes(EMPRESA.rnt), "no aparece el RNT de Mayorista");
      assert.deepEqual(estado.consultasAgencias, ["minorista"], "lee la fila del tenant de la cotización");
    });

    for (const escenario of ["error", "ausente", "sin_rnt"] as const) {
      test(`${escenario}: falla de forma explícita y no se genera documento con el RNT de Mayorista`, async () => {
        estado.escenario = escenario;
        await assert.rejects(async () => { const el = await ruta(); html(el); }, (e: Error) => {
          assert.match(e.message, /RNT/);
          assert.match(e.message, /Minorista|minorista/);
          return true;
        });
      });
    }
  });

  describe(`RNT de la cotización de Mayorista · ${nombre}`, () => {
    test("dato válido: el de su agencia", async () => {
      estado.tenant = "mayorista";
      assert.match(html(await ruta()), /RNT RNT-MAYORISTA-777/);
    });
    test("error técnico: falla de forma explícita (no se asume la constante)", async () => {
      estado.tenant = "mayorista"; estado.escenario = "error";
      await assert.rejects(async () => { html(await ruta()); }, /RNT/);
    });
    test("fila ausente (tabla sin sembrar): conserva el comportamiento histórico, la constante propia de Mayorista", async () => {
      estado.tenant = "mayorista"; estado.escenario = "ausente";
      assert.ok(html(await ruta()).includes(`RNT ${EMPRESA.rnt}`));
    });
  });
}

describe("listado de cotizaciones (página real)", () => {
  const fila = (id: number, extra: Record<string, unknown>) => ({ id, codigo: `COT-${id}`, tipo: "carrito", modo: null, moneda: "COP", cliente: "Cliente", destino: "CARTAGENA", hotel: null, fecha_salida: "2030-03-01", precio_venta: 1_300_000, estado: "abierta", numero_contrato: null, vigencia_hasta: null, created_at: "2030-01-01", b2b_modo: null, b2b_total: null, ...extra });
  const fmt = (n: number) => formatMoneda(n, "COP").replace(/ /g, " ");
  const filaTexto = async (id: number) => {
    const t = html(await listado());
    const i = t.indexOf(`COT-${id}`);
    const j = t.indexOf(`COT-${id + 1}`, i);
    return t.slice(i, j < 0 ? undefined : j);
  };

  test("NETO válido: etiqueta NETO + total exigible; PVP con comisión: etiqueta PVP + PVP; NETO sin total válido: «Revisar importe» sin PVP; histórica: precio sin etiqueta", async () => {
    estado.filasListado = [
      fila(1, { b2b_modo: "neta", b2b_total: "1190000" }),
      fila(2, { b2b_modo: "comisionable", b2b_total: "1300000" }),
      fila(3, { b2b_modo: "neta", b2b_total: null }),
      fila(4, { b2b_modo: "neta", b2b_total: "abc" }),
      fila(5, { b2b_modo: null, b2b_total: null, precio_venta: 800_000 }),
    ];
    const neto = await filaTexto(1);
    assert.match(neto, /NETO/); assert.ok(neto.includes(fmt(1_190_000))); assert.ok(!neto.includes(fmt(1_300_000)));
    const pvp = await filaTexto(2);
    assert.match(pvp, /PVP/); assert.ok(pvp.includes(fmt(1_300_000)));
    for (const id of [3, 4]) {
      const t = await filaTexto(id);
      assert.match(t, /Revisar importe/, String(id));
      assert.ok(!t.includes(fmt(1_300_000)), "no muestra el PVP: " + id);
      assert.doesNotMatch(t, /NETO|PVP/);
    }
    const historica = await filaTexto(5);
    assert.ok(historica.includes(fmt(800_000)));
    assert.doesNotMatch(historica, /NETO|PVP|Revisar/);
  });
});
