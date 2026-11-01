// Se ejecuta con npm run test:react (loader del arnés).
//
// #65 · Cotizaciones y comparativas del portal B2B, con los cargadores REALES contra una base en memoria
// (la RLS/RPC no se ejercita aquí: la RPC se simula ya acotada a la sesión; ver límites en el informe):
//   · una cotización se clasifica UNA sola vez; con plan asistido para el aliado es «asistida» aunque
//     `creado_por` sea el correo del propio aliado;
//   · comparativas: propias → Directas, asignadas a la ficha → Asistidas, por IDs verificados;
//   · lecturas completas (más de una página con tope de filas) y fail-closed ante errores;
//   · un fallo de la RPC se avisa, nunca se presenta como «no tienes comparativas».
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { cargarCotizacionesPortal, cargarComparativasPortal } = await import("../lib/portal/b2bPortalServidor.ts");
const { default: PortalCotizaciones } = await import("../app/portal/b2b/cotizaciones/page.tsx");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
afterEach(() => { __resetClient(); __resetAdmin(); });

const UID = "u-free";
const EMAIL = "free@correo.test";
const ctx = (extra: Record<string, unknown> = {}) => ({
  estado: "ok" as const, userId: UID, email: EMAIL, nombre: "Freelance Siete", rol: "freelance" as const, tenant: "mayorista",
  aliadoId: 7, accesoLegacyNombre: false, agenciaId: null, pctPerfil: null, esTitularAgencia: false, ...extra,
});
const cot = (id: number, extra: Fila = {}): Fila => ({
  id, codigo: `COT-${id}`, modo: "simple", estado: "abierta", tenant: "mayorista", creado_por: EMAIL, payload: {}, precio_venta: 1000, moneda: "COP", ...extra,
});
const plan = (aliadoId: number) => ({ b2bAsistido: { aliado_id: aliadoId, modo_compra: "neta", total_exigible: 900 } });
const ids = (filas: Fila[]) => filas.map((f) => f.id as number).sort((a, b) => a - b);

function montar(t: Record<string, Fila[]>, optsAdmin = {}, optsCliente = {}) {
  __setAdmin(supabaseEnMemoria(t, optsAdmin));
  __setClient(supabaseEnMemoria(t, optsCliente, UID));
}

test("COT-1 asistida creada con el correo del propio aliado: va SOLO en Asistidas; las directas quedan en Directas", async () => {
  montar({
    cotizaciones: [
      cot(1, { payload: plan(7) }),                                   // plan para el aliado 7 + creado_por = su correo
      cot(2),                                                          // directa normal
      cot(3, { creado_por: "interno@dspacios.test", payload: plan(7) }), // asistida armada por personal interno
    ],
  });
  const r = await cargarCotizacionesPortal(ctx());
  assert.deepEqual(ids(r.asistidas as Fila[]), [1, 3]);
  assert.deepEqual(ids(r.directas as Fila[]), [2]);
  assert.equal(r.error, false);
});

test("COT-2 ambos tenants: lo del MISMO aliado aparece en Mayorista y en Minorista; otro aliado o creador no obtiene nada", async () => {
  const filas = [
    cot(1, { payload: plan(8), creado_por: "interno@dspacios.test" }),                        // asistida de OTRO aliado (mayorista)
    cot(2, { creado_por: "otro@correo.test" }),                                               // directa de otro creador
    cot(3, { tenant: "minorista" }),                                                          // mía, directa, en Minorista
    cot(4, { payload: plan(7), tenant: "minorista", creado_por: "i@d.test" }),                // mía, asistida, en Minorista
    cot(5, { estado: "descartada" }),
    cot(6, { modo: "comparativa" }),
    cot(7),                                                                                   // mía, directa, en Mayorista
    cot(8, { payload: plan(7), creado_por: "interno@dspacios.test" }),                        // mía, asistida, en Mayorista
    cot(9, { payload: plan(8), tenant: "minorista", creado_por: "interno@dspacios.test" }),   // de otro aliado en Minorista
    cot(10, { tenant: "minorista", creado_por: "otro@correo.test" }),                         // de otro creador en Minorista
    cot(11, { payload: plan(7), creado_por: EMAIL, tenant: "minorista" }),                    // asistida con mi propio correo, Minorista
  ];
  montar({ cotizaciones: filas });
  const yo = await cargarCotizacionesPortal(ctx());
  assert.deepEqual(ids(yo.directas as Fila[]), [3, 7]);
  assert.deepEqual(ids(yo.asistidas as Fila[]), [4, 8, 11]);
  // Una sola clasificación: ninguna cotización en las dos listas.
  assert.equal(new Set([...yo.directas, ...yo.asistidas].map((c) => c.id)).size, yo.directas.length + yo.asistidas.length);
  // El otro aliado (ficha 8, otro correo) solo obtiene lo suyo, en ambos tenants, y nada de lo mío.
  montar({ cotizaciones: filas });
  const otro = await cargarCotizacionesPortal(ctx({ userId: "u-otro", email: "otro@correo.test", aliadoId: 8, tenant: "minorista" }));
  assert.deepEqual(ids(otro.directas as Fila[]), [2, 10]);
  assert.deepEqual(ids(otro.asistidas as Fila[]), [1, 9]);
});

test("COT-3 sin ficha enlazada no se buscan asistidas (y no se afirma nada por nombre)", async () => {
  const t = { cotizaciones: [cot(1, { payload: plan(7), creado_por: "i@d.test" })] };
  const admin = supabaseEnMemoria(t);
  __setAdmin(admin);
  const r = await cargarCotizacionesPortal(ctx({ aliadoId: null }));
  assert.deepEqual(r.asistidas, []);
  assert.deepEqual(r.directas, []);
});

test("COT-4 más registros que una página con tope de filas: se leen TODOS (paginación con conteo)", async () => {
  const muchas = Array.from({ length: 2300 }, (_, i) => cot(i + 1));
  montar({ cotizaciones: muchas }, { maxFilas: 1000 });
  const r = await cargarCotizacionesPortal(ctx());
  assert.equal(r.directas.length, 2300);
  assert.equal(r.error, false);
});

test("COT-5 una lectura incompleta o con error no se presenta como vacía: error=true y nada parcial", async () => {
  for (const fallo of ["error", "sin_conteo", "conteo_cambia", "vacia", "lanzar"] as const) {
    montar({ cotizaciones: [cot(1), cot(2)] }, { fallar: (c: { tabla: string }) => (c.tabla === "cotizaciones" ? fallo : null) });
    const r = await cargarCotizacionesPortal(ctx());
    assert.equal(r.error, true, fallo);
    assert.deepEqual(r.directas, [], fallo);
  }
});

// ── Comparativas ────────────────────────────────────────────────────────────
const comp = (id: number): Fila => ({ id, codigo: `CMP-${id}`, share_token: `tok-${id}`, estado: "abierta", destino: "SMR", fecha_salida: "2099-01-10", moneda: "COP", vigencia_hasta: "2099-01-01", opciones: [], hija: null });
const meta = (id: number, propietario_id: string | null, aliado_id: number | null): Fila => ({ id, propietario_id, aliado_id });

test("CMP-1 propias → Directas; asignadas a su ficha → Asistidas (por propietario_id / aliado_id, no por nombre)", async () => {
  montar({
    "rpc:comparativas_b2b_visibles": [comp(1), comp(2), comp(3)],
    cotizaciones: [meta(1, UID, 7), meta(2, "u-interno", 7), meta(3, UID, null)],
  });
  const r = await cargarComparativasPortal(ctx());
  assert.deepEqual(ids(r.directas as unknown as Fila[]), [1, 3]);
  assert.deepEqual(ids(r.asistidas as unknown as Fila[]), [2]);
  assert.equal(r.error, false);
});

test("CMP-2 una fila que la RPC no debería dar (de otro aliado) o sin procedencia verificable NO se muestra y se avisa", async () => {
  montar({
    "rpc:comparativas_b2b_visibles": [comp(1), comp(9), comp(10)],
    cotizaciones: [meta(1, UID, 7), meta(9, "u-otro", 8) /* sin meta para 10 */],
  });
  const r = await cargarComparativasPortal(ctx());
  assert.deepEqual(ids(r.directas as unknown as Fila[]), [1]);
  assert.deepEqual(r.asistidas, []);
  assert.equal(r.error, true);
});

test("CMP-3 más comparativas que una página con tope de filas: se leen todas", async () => {
  const n = 1500;
  montar({
    "rpc:comparativas_b2b_visibles": Array.from({ length: n }, (_, i) => comp(i + 1)),
    cotizaciones: Array.from({ length: n }, (_, i) => meta(i + 1, i % 2 ? UID : "u-interno", 7)),
  }, { maxFilas: 1000 }, { maxFilas: 1000 });
  const r = await cargarComparativasPortal(ctx());
  assert.equal(r.directas.length + r.asistidas.length, n);
  assert.equal(r.error, false);
});

test("CMP-4 fallo de la RPC (o de la verificación): error=true y ninguna comparativa", async () => {
  montar({ "rpc:comparativas_b2b_visibles": [comp(1)], cotizaciones: [meta(1, UID, 7)] }, {}, { fallar: (c: { tabla: string }) => (c.tabla === "rpc:comparativas_b2b_visibles" ? "error" : null) });
  assert.deepEqual(await cargarComparativasPortal(ctx()), { directas: [], asistidas: [], error: true });
  montar({ "rpc:comparativas_b2b_visibles": [comp(1)], cotizaciones: [meta(1, UID, 7)] }, { fallar: (c: { tabla: string }) => (c.tabla === "cotizaciones" ? "error" : null) });
  assert.deepEqual(await cargarComparativasPortal(ctx()), { directas: [], asistidas: [], error: true });
});

// ── Página: el fallo se avisa con texto legible ─────────────────────────────
const texto = (n: unknown): string => {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(texto).join(" ");
  return texto((n as { props?: { children?: unknown } }).props?.children);
};

test("PÁGINA: con la RPC caída muestra el aviso y NO afirma «no tienes comparativas»", async () => {
  const t = {
    usuarios: [{ id: UID, nombre: "Freelance Siete", rol: "freelance", activo: true, tenant: "mayorista", agencia_id: null, pct_comision: null, aliado_id: 7, acceso_legacy_nombre: false }],
    cotizaciones: [cot(1)],
    "rpc:comparativas_b2b_visibles": [comp(1)],
  };
  montar(t, {}, { fallar: (c: { tabla: string }) => (c.tabla === "rpc:comparativas_b2b_visibles" ? "error" : null) });
  const arbol = await PortalCotizaciones({ searchParams: Promise.resolve({}) });
  const s = texto(arbol).replace(/\s+/g, " ");
  assert.match(s, /No pudimos cargar tus comparativas/);
  assert.doesNotMatch(s, /Aún no tienes comparativas/);
});
