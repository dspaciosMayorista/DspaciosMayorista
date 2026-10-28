// Se ejecuta con el loader React (esbuild), no con test:unit.
//
// #75 — La comparativa respeta la MISMA regla de acreditación de agencia que la cotización normal (#102): las rutas REALES (imprimible interna y enlace público)
// se ejecutan con un cliente Supabase falso. Ante error técnico, tenant inválido, fila ausente de Minorista o Minorista sin RNT, la ruta falla de forma explícita y
// NO se emite una hoja con marca pero sin emisor acreditado. Con dato válido, la hoja trae el RNT/NIT de SU agencia (nunca el de Mayorista en Minorista).
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { renderToStaticMarkup } from "react-dom/server";

type ResolveHook = (specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const datos = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FRONTERAS: Record<string, string> = {
  "@/app/tarifario/checkout/actions": datos("export async function elegirOpcionComparativa() { return { ok: false, error: 'no se usa' }; } export async function solicitarOpcionComparativa() { return { ok: false, error: 'no se usa' }; } export async function resumenOpcionComparativa() { return { ok: false, error: 'no se usa' }; }"),
  "@/app/(dashboard)/dashboard/cotizaciones/manual-actions": datos("export async function resolverSolicitudComparativa() { return { ok: false, error: 'no se usa' }; }"),
  "@/app/(dashboard)/dashboard/cotizaciones/[id]/DescartarBtn": datos("export function DescartarBtn() { return null; }"),
  "@/lib/supabase/server": datos("export const createClient = async () => globalThis.__rutas75.fakeSb();"),
  "@/lib/supabase/admin": datos("export const createAdminClient = () => globalThis.__rutas75.fakeSb();"),
  "@/lib/cotizacion/comparativaServidor": datos("export async function visitantePuedeContinuar() { return false; }"),
  "next/navigation": datos("export function useRouter() { return { refresh() {}, push() {}, replace() {} }; } export function notFound() { throw new Error('NOT_FOUND'); }"),
  "next/headers": datos("export async function headers() { return new Map(); }"),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FRONTERAS[specifier]) return { url: FRONTERAS[specifier], shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Escenario = "valida" | "error" | "ausente" | "sin_rnt";
const estado: { escenario: Escenario; tenant: string; consultasAgencias: string[] } = { escenario: "valida", tenant: "minorista", consultasAgencias: [] };
const TOKEN = "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12);
const AGENCIA = (tenant: string) => ({ tenant, rnt: `RNT-${tenant.toUpperCase()}-777`, razon_social: `Razón ${tenant}`, nit: `NIT-${tenant}`, correo: `${tenant}@x.test` });
const madre = () => ({
  id: 1, codigo: "CMP-9", version: 1, estado: "abierta", modo: "comparativa", tipo: "comparativa_manual", tenant: estado.tenant, share_token: TOKEN,
  cliente: "Ana Pérez", destino: "CARTAGENA", fecha_salida: "2030-03-01", fecha_regreso: "2030-03-04", pax: 2, moneda: "COP", vigencia_hasta: "2030-02-20",
  created_at: "2030-01-01T10:00:00Z", payload: {}, creado_por_id: null, propietario_id: null, aliado_id: null,
});
const OPCIONES = ["A", "B"].map((r, i) => ({ opcion_ref: r, acomodacion_ref: "unica", orden: i, etiqueta: `Hotel ${r}`, moneda: "COP", tarifa_persona: null, total: 1_000_000 + i * 500_000, resumen_publico: {}, plantilla_hija: {} }));

function fakeSb() {
  return {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: (tabla: string) => {
      let filtro: string | null = null;
      const lista = () => ({ data: tabla === "cotizacion_opciones" ? OPCIONES : [], error: null });
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, neq: () => q, limit: () => q,
        eq: (_c: string, v: string) => { filtro = v; return q; },
        maybeSingle: async () => {
          if (tabla === "cotizaciones") return { data: madre(), error: null };
          if (tabla === "agencias") {
            estado.consultasAgencias.push(String(filtro));
            if (estado.escenario === "error") return { data: null, error: { message: "caída de red" } };
            if (estado.escenario === "ausente") return { data: null, error: null };
            const fila = AGENCIA(String(filtro));
            return { data: estado.escenario === "sin_rnt" ? { ...fila, rnt: "  " } : fila, error: null };
          }
          return { data: null, error: null };
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(lista()).then(ok, ko),
      };
      return q;
    },
  };
}
(globalThis as unknown as { __rutas75: unknown }).__rutas75 = { fakeSb };

const { PaginaImprimibleComparativa, paginaPublicaComparativa } = await import("../lib/cotizacion/comparativaDocumento.tsx");
const { EMPRESA } = await import("../lib/contrato/plantilla.ts");

const html = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const RUTAS: [string, () => Promise<unknown>][] = [
  ["imprimible interna", () => PaginaImprimibleComparativa({ madre: madre() as never, hoy: "2030-01-15" })],
  ["enlace público", async () => (await paginaPublicaComparativa(TOKEN)) ?? (() => { throw new Error("la ruta devolvió null"); })()],
];

beforeEach(() => { estado.escenario = "valida"; estado.tenant = "minorista"; estado.consultasAgencias = []; });

for (const [nombre, ruta] of RUTAS) {
  describe(`acreditación de agencia de la comparativa · ${nombre}`, () => {
    test("Minorista con dato válido: la hoja trae su RNT/NIT (nunca los de Mayorista) y lee la fila de SU tenant", async () => {
      const t = html(await ruta());
      assert.match(t, /RNT RNT-MINORISTA-777/);
      assert.match(t, /NIT-minorista/);
      assert.ok(!t.includes(EMPRESA.rnt), "no aparece el RNT de Mayorista");
      assert.deepEqual(estado.consultasAgencias, ["minorista"]);
    });

    for (const escenario of ["error", "ausente", "sin_rnt"] as const) {
      test(`Minorista · ${escenario}: falla de forma explícita; no se emite hoja con marca sin emisor acreditado`, async () => {
        estado.escenario = escenario;
        let emitida = "";
        await assert.rejects(async () => { emitida = html(await ruta()); }, (e: Error) => {
          assert.match(e.message, /RNT/);
          assert.match(e.message, /Minorista|minorista/);
          return true;
        });
        assert.equal(emitida, "", "no se produjo documento");
      });
    }

    test("tenant inválido: falla explícita y ni siquiera consulta `agencias`", async () => {
      estado.tenant = "otra";
      await assert.rejects(async () => { html(await ruta()); }, /agencia válida/);
      assert.deepEqual(estado.consultasAgencias, []);
    });

    test("Mayorista · error técnico: falla explícita (no se asume la constante)", async () => {
      estado.tenant = "mayorista"; estado.escenario = "error";
      await assert.rejects(async () => { html(await ruta()); }, /RNT/);
    });

    test("Mayorista · tabla sin sembrar (fila ausente): conserva la constante histórica de Mayorista", async () => {
      estado.tenant = "mayorista"; estado.escenario = "ausente";
      assert.match(html(await ruta()), new RegExp(`RNT ${EMPRESA.rnt}`));
    });

    test("Mayorista · dato válido: el de su agencia", async () => {
      estado.tenant = "mayorista";
      assert.match(html(await ruta()), /RNT RNT-MAYORISTA-777/);
    });
  });
}
