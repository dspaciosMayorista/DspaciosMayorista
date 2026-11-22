// Se ejecuta con npm run test:react (el loader resuelve los imports sin extensión de lib/avisos).
// #78 — el aviso interno «solicitud_contrato» en la campana: enlace a la COTIZACIÓN (no a un contrato) tanto en la lista reciente como en lo recién reclamado para notificar,
// el reclamo hace UNA consulta extra solo si hay solicitudes reclamadas, y los avisos de soportes de pago siguen apuntando al contrato como antes.
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Fila = { id: number; tipo: string; numero_contrato: string; creado_en: string; leido_en: string | null; cotizacion_id: number | null };
let rol = "administracion";
let recientes: Fila[] = [];
let reclamados: Omit<Fila, "leido_en" | "cotizacion_id">[] = [];
const consultas: string[] = [];

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u-staff" } } }) } }) } });
mock.module("@/lib/supabase/admin", {
  namedExports: {
    createAdminClient: () => ({
      rpc: async (fn: string) => { consultas.push("rpc:" + fn); return { data: reclamados, error: null }; },
      from: (t: string) => {
        if (t === "usuarios") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { rol, activo: true } }) }) }) };
        const api: Record<string, unknown> = {
          select: (cols: string, opts?: { head?: boolean }) => { consultas.push("avisos.select:" + cols); (api as { _head?: boolean })._head = !!opts?.head; return api; },
          eq: () => api, is: () => api, in: (_c: string, ids: number[]) => ({ eq: async () => ({ data: recientes.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, cotizacion_id: r.cotizacion_id })) }) }),
          order: () => api, limit: async () => ({ data: recientes }),
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ count: recientes.length }).then(ok),
        };
        return api;
      },
    }),
  },
});

const { sondearAvisos } = await import("../lib/avisos/actions.ts");
const solicitud = (id: number, cot: number | null): Fila => ({ id, tipo: "solicitud_contrato", numero_contrato: "C-0042", creado_en: "2026-11-20T10:00:00Z", leido_en: null, cotizacion_id: cot });

beforeEach(() => { rol = "administracion"; recientes = []; reclamados = []; consultas.length = 0; });

test("la lista reciente enlaza a la cotización del aviso; el soporte de pago sigue enlazando al contrato", async () => {
  recientes = [solicitud(5, 42), { id: 4, tipo: "soporte_pago_nuevo", numero_contrato: "00-0451", creado_en: "2026-11-20T09:00:00Z", leido_en: null, cotizacion_id: null }];
  const r = await sondearAvisos(false);
  const porId = Object.fromEntries(r.recientes.map((a) => [a.id, a]));
  assert.equal(porId[5].href, "/dashboard/cotizaciones/42");
  assert.equal(porId[5].tipo, "solicitud_contrato");
  assert.equal(porId[4].href, "/dashboard/contratos/00-0451");
});

test("lo reclamado para notificar también enlaza a la cotización (la RPC de reclamo no trae cotizacion_id: 1 consulta extra solo si hay solicitudes)", async () => {
  recientes = [solicitud(5, 42)];
  reclamados = [{ id: 5, tipo: "solicitud_contrato", numero_contrato: "C-0042", creado_en: "2026-11-20T10:00:00Z" }];
  const r = await sondearAvisos(true);
  assert.equal(r.nuevos[0].href, "/dashboard/cotizaciones/42");
  assert.equal(consultas.filter((c) => c.startsWith("avisos.select:id, cotizacion_id")).length, 1);

  consultas.length = 0;
  reclamados = [{ id: 4, tipo: "soporte_pago_nuevo", numero_contrato: "00-0451", creado_en: "2026-11-20T09:00:00Z" }];
  recientes = [];
  const r2 = await sondearAvisos(true);
  assert.equal(r2.nuevos[0].href, "/dashboard/contratos/00-0451");
  assert.equal(consultas.filter((c) => c.startsWith("avisos.select:id, cotizacion_id")).length, 0, "sin solicitudes reclamadas no hay consulta extra");
});

test("un aviso de solicitud sin cotizacion_id (dato incompleto) cae al listado de cotizaciones", async () => {
  recientes = [solicitud(6, null)];
  const r = await sondearAvisos(false);
  assert.equal(r.recientes[0].href, "/dashboard/cotizaciones", "cae al listado, nunca a un contrato inexistente");
});
