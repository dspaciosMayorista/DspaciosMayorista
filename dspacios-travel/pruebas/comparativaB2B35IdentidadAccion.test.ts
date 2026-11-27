// #35 (bloque Portal B2B) — la acción `crearComparativaManual` es la frontera del servidor:
// una comparativa B2B NUEVA exige un aliado verificable del catálogo (por id). Se ejecuta la
// acción real con Supabase simulado y se comprueba lo que llega (o no) a la RPC.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {} export function revalidateTag() {}")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";

type Fila = Record<string, unknown>;
const inserts: { tabla: string; filas: Fila[] }[] = [];
const rpcs: { fn: string; args: Fila }[] = [];
// Catálogo simulado: solo existe el aliado 7 (nombre oficial distinto del texto que escribe el asesor).
const ALIADOS: Record<number, { id: number; nombre: string }> = { 7: { id: 7, nombre: "Viajes Sol SAS" } };

function cliente() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "asesor@dspacios.test" } }, error: null }) },
    rpc: async (fn: string, args: Fila) => {
      rpcs.push({ fn, args });
      return { data: fn === "registrar_personas_cotizacion" ? { cotizacion_id: 901, nuevos: 1, reintentos: 0, omitidos: 0 } : 901, error: null };
    },
    from: (tabla: string) => {
      let idFiltro: number | null = null;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        insert: (f: Fila | Fila[]) => { inserts.push({ tabla, filas: Array.isArray(f) ? f : [f] }); return b; },
        select: () => b,
        eq: (_c: string, v: number) => { idFiltro = v; return b; },
        maybeSingle: async () => ({ data: tabla === "aliados" && idFiltro != null ? ALIADOS[idFiltro] ?? null : null, error: null }),
        single: async () => ({ data: { id: 901 }, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return b;
    },
  };
}

mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
// F6 (B95-13/14/15/20): la validación del catálogo manual (destino, hoteles, compra y acomodación) tiene su propia prueba (validacionManual95f6.test.ts y el recorrido real contra Postgres,
// supabase/scripts/test_f6_95_formularios.sh). Aquí NO se prueba esa regla: se la deja pasar para probar lo que este archivo prueba (aliado, RPC, vigencia, paridad…).
mock.module("@/lib/catalogo/prepararManual", { namedExports: { prepararServiciosManual: async (_c: unknown, i: { servicios: unknown[]; destinoId?: unknown }) => ({ ok: true, destino: "Cartagena", destinoId: undefined, servicios: i.servicios }) } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: {
    contextoCotizacion: async () => ({ ok: true, superadmin: false, interno: true, tenant: "mayorista" }),
    autorizaTenant: () => true,
  },
});

const { crearComparativaManual } = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
import type { EntradaComparativaManual } from "../lib/cotizacion/comparativa.ts";

function entrada(sobre: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual {
  return {
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123456", telefono: "3001112233", email: "a@x.test", nacimiento: "1990-01-01" },
    destino: "Cartagena", fechaIda: "2030-11-10", fechaRegreso: "2030-11-14", pax: 2, ninos: 0, tarifaNino: 0,
    recobro: 0, recobroAliado: 0, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor Uno", agenciaNombre: "",
    freelanceNombre: "", plazo: "", vigenciaHasta: "2030-11-05", observaciones: "", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo", proveedor: "Avianca", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "HA", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "A" },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel B", proveedor: "HB", costoNeto: 560000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "B" },
    ],
    ...sobre,
  };
}
const llamadas = (fn: string) => rpcs.filter((r) => r.fn === fn);

beforeEach(() => { inserts.length = 0; rpcs.length = 0; });

describe("#35: la acción crearComparativaManual exige aliado verificable en comparativas B2B nuevas", () => {
  for (const [nombre, sobre] of [
    ["agencia con solo el nombre escrito", { tipoAsesor: "agencia" as const, agenciaNombre: "Viajes Sol SAS" }],
    ["freelance con solo el nombre escrito", { tipoAsesor: "freelance" as const, freelanceNombre: "Laura Gómez" }],
    ["agencia con aliadoId nulo explícito", { tipoAsesor: "agencia" as const, agenciaNombre: "Viajes Sol SAS", aliadoId: null }],
  ] as const) {
    test(`rechaza ${nombre}: nada llega a la RPC ni a ninguna tabla`, async () => {
      const r = await crearComparativaManual(entrada(sobre));
      assert.equal(r.ok, false);
      assert.match(!r.ok ? r.error : "", /aliado del catálogo/);
      assert.equal(rpcs.length, 0, "ninguna RPC (no se consume consecutivo ni se crea fila)");
      assert.equal(inserts.length, 0, "ninguna escritura directa");
    });
  }

  test("un aliadoId que no existe en el catálogo se rechaza antes de la RPC", async () => {
    const r = await crearComparativaManual(entrada({ tipoAsesor: "agencia", agenciaNombre: "X", aliadoId: 999 }));
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /no existe/);
    assert.equal(rpcs.length, 0);
  });

  test("con aliado del catálogo: llega p_aliado_id y el nombre oficial pisa el texto libre", async () => {
    const r = await crearComparativaManual(entrada({ tipoAsesor: "agencia", agenciaNombre: "Nombre falso escrito a mano", aliadoId: 7 }));
    assert.equal(r.ok, true);
    const crea = llamadas("crear_cotizacion_comparativa");
    assert.equal(crea.length, 1);
    assert.equal(crea[0].args.p_aliado_id, 7);
    const cab = JSON.stringify(crea[0].args.p_cabecera);
    assert.match(cab, /Viajes Sol SAS/, "el nombre sale del catálogo");
    assert.doesNotMatch(cab, /Nombre falso/, "el texto libre no sobrevive");
  });

  test("la venta interna (B2C) sigue sin aliado y se crea", async () => {
    const r = await crearComparativaManual(entrada());
    assert.equal(r.ok, true);
    assert.equal(llamadas("crear_cotizacion_comparativa")[0].args.p_aliado_id, null);
  });
});
