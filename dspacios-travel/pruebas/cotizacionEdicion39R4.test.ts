// #39 · R4 (Gate 2) — `convertirCotizacion` (reservar/actions.ts) rechaza una cotización
// MANUAL antes de crear nada. Es la única excepción de escritura que #39 tiene en ese archivo:
// la guarda `tipo === 'manual'` dentro de `convertirCotizacion`. Una manual se convierte solo
// por su puerta (`convertirCotizacionManualAContrato` → wrapper de la 216).
//
// El riesgo que cierra: el payload de una manual guarda TODO lo que recibió la Server Action,
// así que alguien puede plantarle campos de tarifario (`paqueteId`, `hotelId`, `habitaciones`…).
// Sin la guarda, ese payload entraba al motor de reserva; con la 217 activa, el contrato nacía y
// el UPDATE que enlaza la cotización lo rechazaba la frontera sin que nadie lo viera.
//
// Ejecuta la acción REAL con Supabase simulado y registra CADA acceso a tablas. El caso de
// control (el mismo payload en una cotización de tarifario) demuestra que sin la guarda ese
// payload sí llegaría al motor: lo que lo detiene es la guarda, no la forma del payload.
// No cubre el UPDATE sin comprobar de las conversiones NO manuales (riesgo previo, aparte).
import { test } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { mock } from "node:test";

type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
const MINIMOS: Record<string, string> = {
  "server-only": "export {}",
  "next/cache": "export function revalidatePath() {} export function revalidateTag() {}",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const src = MINIMOS[specifier];
    if (src != null) return { url: `data:text/javascript,${encodeURIComponent(src)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service";

type Fila = Record<string, unknown>;
const PASAJERO = { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1", nacimiento: "1990-01-01" };

// Payload de una manual (`CotizacionManualInput`) con un pedido de tarifario PLANTADO encima
// (las claves de `ReservaInput`: paquete, hotel, categoría, régimen, habitaciones, pasajeros).
const PAYLOAD_PLANTADO: Fila = {
  cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "1", telefono: "3", email: "a@x.test", nacimiento: "1990-01-01" },
  destino: "Cartagena", fechaIda: "2099-11-10", fechaRegreso: "2099-11-14", pax: 2, moneda: "COP", tipoAsesor: "interno",
  asesorInterno: "Asesor", agenciaNombre: "", agenciaAsesor: "", freelanceNombre: "", plazo: "Inmediato", vigenciaHasta: "", observaciones: "",
  servicios: [{ tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "HA", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0 }],
  paqueteId: 5, bloqueoId: null, modulo: "porcion_terrestre", hotelId: 9, categoria: "Estándar", regimen: "PC",
  habitaciones: { doble: 1 }, ninos: 0, ninos2: 0, infantes: 0, pasajeros: [PASAJERO, { ...PASAJERO, nombres: "Luis", numeroDoc: "2" }],
};

let COT: Fila = {};
const accesos: { tabla: string; op: string }[] = [];
const rpcs: string[] = [];

function cliente() {
  const from = (tabla: string) => {
    let op = "select";
    const b: Record<string, unknown> = {};
    const resolver = () => {
      accesos.push({ tabla, op });
      if (op !== "select") return { data: [], error: null };
      return { data: tabla === "cotizaciones" ? [COT] : [], error: null };
    };
    Object.assign(b, {
      select: () => b, order: () => b, limit: () => b, eq: () => b, in: () => b, neq: () => b, gte: () => b, lte: () => b,
      lt: () => b, gt: () => b, is: () => b, or: () => b, not: () => b, filter: () => b, match: () => b, contains: () => b, range: () => b,
      insert: () => { op = "insert"; return b; },
      update: () => { op = "update"; return b; },
      upsert: () => { op = "upsert"; return b; },
      delete: () => { op = "delete"; return b; },
      maybeSingle: async () => { const r = resolver(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      single: async () => { const r = resolver(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
    });
    return b;
  };
  return {
    from,
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "a@x.test" } }, error: null }) },
    rpc: async (fn: string) => { rpcs.push(fn); return { data: null, error: { message: `rpc no simulado: ${fn}` } }; },
  };
}
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => cliente() } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => cliente() } });
mock.module("@/lib/cotizacion/acceso", {
  namedExports: {
    contextoCotizacion: async () => ({ ok: true, superadmin: false, tenant: "mayorista" }),
    autorizaTenant: () => true,
  },
});
mock.module("next/headers", { namedExports: { headers: async () => new Map([["host", "localhost"]]), cookies: async () => ({ get: () => undefined }) } });
// La numeración (no resoluble fuera del bundler por su import sin extensión) se simula y se VIGILA:
// llegar a pedir un número ya sería avanzar demasiado.
const numeros: string[] = [];
const avance = (n: string) => async () => { numeros.push(n); throw new Error(`no debía llegar a ${n}`); };
mock.module("@/lib/contrato/numeracion", {
  namedExports: { siguienteNumeroContrato: async () => { numeros.push("numero"); return { ok: true, numero: "DTM-9999" }; } },
});
mock.module("@/lib/contrato/contexto", { namedExports: { contextoCrearContrato: avance("contextoCrearContrato") } });
mock.module("@/lib/reservar/financieroContrato", {
  namedExports: { registrarFinancieroContrato: avance("registrarFinancieroContrato"), revertirContratoIncompleto: avance("revertirContratoIncompleto") },
});
mock.module("@/lib/contabilidad/asientos", { namedExports: { postearAsientoCxP: avance("postearAsientoCxP"), eliminarAsientoCxP: avance("eliminarAsientoCxP") } });
mock.module("@/lib/reservar/asegurarCuentasPorPagar", { namedExports: { asegurarCuentasPorPagar: avance("asegurarCuentasPorPagar") } });
mock.module("@/lib/contrato/congelarCondicionesContrato", {
  namedExports: {
    componenteHotelReal: avance("componenteHotelReal"), componentePaqueteReal: avance("componentePaqueteReal"),
    trmReferenciaAproximada: avance("trmReferenciaAproximada"), congelarCondicionesContratoBestEffort: avance("congelarCondicionesContratoBestEffort"),
  },
});
mock.module("@/lib/reservar/computoReservaBernalo", { namedExports: { computarReservaBernalo: avance("computarReservaBernalo") } });

const { convertirCotizacion } = await import("../app/(dashboard)/dashboard/reservar/actions.ts");

const RECHAZO_MANUAL = /cotización dinámica: se convierte en contrato desde su propia ficha/;

async function convertir(cot: Fila, pasajeros?: unknown[]) {
  COT = cot;
  accesos.length = 0;
  rpcs.length = 0;
  numeros.length = 0;
  let resultado: { ok?: boolean; error?: string; numero?: string } | undefined;
  let lanzo: unknown = null;
  try {
    resultado = (await convertirCotizacion(Number(cot.id), pasajeros as never)) as typeof resultado;
  } catch (e) {
    lanzo = e;
  }
  const motivo = lanzo ? String((lanzo as Error).message ?? lanzo) : String(resultado?.error ?? "");
  return { resultado, lanzo, motivo };
}

// Una manual rechazada no hace NADA más que leer su propia fila: ni el motor, ni sillas, ni
// venta, ni contrato, ni CxP, ni el UPDATE que la marcaría convertida, ni una RPC, ni un número.
function assertSinEfectos() {
  assert.deepEqual(accesos, [{ tabla: "cotizaciones", op: "select" }], "solo la lectura de la propia cotización");
  assert.deepEqual(rpcs, [], "ninguna RPC");
  assert.deepEqual(numeros, [], "ni siquiera pide un número de contrato");
}

const MANUAL: Fila = { id: 77, tipo: "manual", modo: "simple", estado: "abierta", numero_contrato: null, tenant: "mayorista", payload: PAYLOAD_PLANTADO };

test("R4 manual con payload de tarifario plantado y pasajeros por argumento: rechazada antes del motor, sin efectos", async () => {
  const { resultado, lanzo, motivo } = await convertir(MANUAL, [PASAJERO]);
  assert.equal(lanzo, null, `no debe lanzar: ${motivo}`);
  assert.equal(resultado?.ok, false, `debe fallar: ${JSON.stringify(resultado)}`);
  assert.match(motivo, RECHAZO_MANUAL);
  assertSinEfectos();
});

test("R4 manual con los pasajeros dentro del payload (sin argumento): mismo rechazo, sin efectos", async () => {
  const { resultado, motivo } = await convertir(MANUAL);
  assert.equal(resultado?.ok, false);
  assert.match(motivo, RECHAZO_MANUAL, "el rechazo es la guarda, no la falta de pasajeros");
  assertSinEfectos();
});

test("R4 manual ya convertida: también se rechaza (no se responde por esta vía con el número)", async () => {
  const { resultado, motivo } = await convertir({ ...MANUAL, estado: "convertida", numero_contrato: "DTM-0001" }, [PASAJERO]);
  assert.equal(resultado?.ok, false);
  assert.match(motivo, RECHAZO_MANUAL);
  assertSinEfectos();
});

test("R4 control: el MISMO payload en una cotización de tarifario sí pasa la guarda y entra al motor", async () => {
  const { motivo } = await convertir({ ...MANUAL, id: 78, tipo: "tarifario" }, [PASAJERO]);
  assert.doesNotMatch(motivo, RECHAZO_MANUAL, "la guarda solo aplica a manuales");
  const tablas = new Set(accesos.map((a) => a.tabla));
  tablas.delete("cotizaciones");
  assert.ok(tablas.size > 0, `el motor de reserva debió leer sus tablas (accesos: ${JSON.stringify(accesos)})`);
});
