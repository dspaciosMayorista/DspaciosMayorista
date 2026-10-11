// Se ejecuta con npm run test:react (loader TSX/esbuild), no con test:unit.
// LISTADO Y DOCUMENTOS TOMAN LA MISMA DECISIÓN.
// Ejecuta, contra el MISMO PostgREST en memoria (pruebas/support/memoriaSupabase.ts):
//   · el listado REAL del portal B2B: contratosDelPortalB2B + consultasPortalSupabase;
//   · los cargadores REALES de documentos por URL (service-role):
//     cargarEstadoCuenta, cargarPlanCobro, cargarRecibo y resolverComisionB2B.
// y compara, cuenta por cuenta y contrato por contrato, que el portal liste
// exactamente lo que los documentos dejan abrir. En modo normal, con la
// consulta de fichas de `aliados_b2b` fallando (error / sin conteo /
// excepción), y con más de 1.000 candidatos por nombre bajo el límite de filas.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { cargarEstadoCuenta, cargarPlanCobro, cargarRecibo } = await import("../lib/cuenta/estado.ts");
const { resolverComisionB2B } = await import("../lib/finanzas/comisionResolver.ts");
const { contratosDelPortalB2B, consultasPortalSupabase, COLUMNAS_DECISION } = await import("../lib/auth/contratosPortalB2B.ts");
const { supabaseEnMemoria } = await import("./support/memoriaSupabase.ts");
const { __setClient, __resetClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __setAdmin, __resetAdmin } = await import("./support/stubs/supabaseAdminStub.mjs");

type Fila = Record<string, unknown>;
type Opciones = Parameters<typeof supabaseEnMemoria>[1];
const NOMBRE = "Viajes Antiguos";

const USUARIOS: Fila[] = [
  { id: "u-nuevo", nombre: NOMBRE, rol: "agencia", tenant: "mayorista", activo: true, aliado_id: null, acceso_legacy_nombre: false },
  { id: "u-enlazado", nombre: NOMBRE, rol: "agencia", tenant: "mayorista", activo: true, aliado_id: 7, acceso_legacy_nombre: false },
  { id: "u-antiguo", nombre: NOMBRE, rol: "agencia", tenant: "mayorista", activo: true, aliado_id: null, acceso_legacy_nombre: true },
  { id: "u-inactivo", nombre: NOMBRE, rol: "agencia", tenant: "mayorista", activo: false, aliado_id: 7, acceso_legacy_nombre: true },
  // Mismo nombre y bandera, pero de MINORISTA.
  { id: "u-min", nombre: NOMBRE, rol: "agencia", tenant: "minorista", activo: true, aliado_id: null, acceso_legacy_nombre: true },
];
const venta = (numero: string, extra: Fila): Fila => ({
  numero_contrato: numero, cliente: `Cliente ${numero}`, destino: "SMR", fecha_salida: "2026-01-01", estado: "confirmado",
  precio_venta: 1000, moneda: "COP", tenant: "mayorista", b2b_usuario_id: null, aliado_id: null,
  agencia_nombre: NOMBRE, freelance_nombre: null, modo_compra: "comisionable", comision_b2b: 100, tipo_asesor: "agencia", ...extra,
});
const comisionManual = (id: number, numero: string, aliadoId: number | null): Fila => ({
  id, numero_contrato: numero, aliado: NOMBRE, tipo_aliado: "agencia", aliado_id: aliadoId,
  base_comision: 1000, pct_comision: 0.1, recobro_total: 0, pct_recobro_aliado: 0, aplica_retencion: false, pct_retencion: 0,
});

function tablasBase(): Record<string, Fila[]> {
  return {
    usuarios: USUARIOS,
    ventas: [
      venta("C1-ficha", { aliado_id: 7 }),                                     // enlazado por id
      venta("C2-solo-nombre", {}),                                             // sin ningún id
      venta("C3-ficha-manual", { modo_compra: null, comision_b2b: null }),     // ficha solo en comisión manual (fila VIEJA)
      venta("C7-manual-sin-ficha", { modo_compra: null, comision_b2b: null }), // comisión manual SIN ficha
      // ── Migración 193: tenant y nombres divergentes ──
      venta("C8-minorista", { tenant: "minorista" }),                                          // mismo nombre, otra agencia
      venta("C9-mayus", { agencia_nombre: "  VIAJES ANTIGUOS " }),                             // mismo nombre normalizado
      venta("C10-solo-comision", { agencia_nombre: null, modo_compra: null, comision_b2b: null }),            // ventas sin nombre; aliados_b2b.aliado = NOMBRE
      venta("C11-distintos", { agencia_nombre: "Otra Agencia", modo_compra: null, comision_b2b: null }),      // ventas otro nombre; aliados_b2b.aliado = NOMBRE
      venta("C12-freelance", { agencia_nombre: "Otra Agencia", freelance_nombre: NOMBRE, modo_compra: null, comision_b2b: null }), // ventas.freelance = NOMBRE; aliados_b2b.aliado distinto
    ],
    aliados_b2b: [
      comisionManual(1, "C3-ficha-manual", 7),
      comisionManual(2, "C3-ficha-manual", null), // la más reciente sin ficha
      comisionManual(3, "C7-manual-sin-ficha", null),
      comisionManual(10, "C10-solo-comision", null),
      comisionManual(11, "C11-distintos", null),
      { ...comisionManual(12, "C12-freelance", null), aliado: "Otro Nombre" },
    ],
    abonos: [
      { id: 11, numero_contrato: "C1-ficha", fecha_abono: "2025-12-01", valor_abono: 300, forma_pago: "t", referencia: "r", recibido_por: "x" },
      { id: 22, numero_contrato: "C2-solo-nombre", fecha_abono: "2025-12-02", valor_abono: 500, forma_pago: "t", referencia: "r", recibido_por: "x" },
      { id: 33, numero_contrato: "C3-ficha-manual", fecha_abono: "2025-12-03", valor_abono: 50, forma_pago: "t", referencia: "r", recibido_por: "x" },
      { id: 77, numero_contrato: "C7-manual-sin-ficha", fecha_abono: "2025-12-04", valor_abono: 70, forma_pago: "t", referencia: "r", recibido_por: "x" },
    ],
    cuotas: [],
    aliados: [{ id: 7, nombre: NOMBRE, tipo_documento: "NIT", nit: "900", direccion: null, telefono: null, email: null, banco: null, tipo_cuenta: null, numero_cuenta: null }],
  };
}

async function decisiones(usuarioId: string, numeros: string[], tablas: Record<string, Fila[]>, opts: Opciones = {}) {
  const sesion = supabaseEnMemoria(tablas, opts, usuarioId);
  const admin = supabaseEnMemoria(tablas, opts);
  __setClient(sesion);
  __setAdmin(admin);

  const u = tablas.usuarios.find((x) => x.id === usuarioId)!;
  const listado = await contratosDelPortalB2B(
    {
      id: usuarioId, rol: u.rol as string, tenant: u.tenant as string, activo: u.activo as boolean,
      nombre: u.nombre as string, aliadoId: u.aliado_id as number | null, accesoLegacyNombre: u.acceso_legacy_nombre as boolean,
    },
    consultasPortalSupabase(admin as never, `${COLUMNAS_DECISION}, cliente`)
  );
  const enListado = new Set(listado.contratos.map((c) => c.numero_contrato));

  const filas: { numero: string; listado: boolean; estado: boolean; plan: boolean; cobro: boolean }[] = [];
  for (const n of numeros) {
    filas.push({
      numero: n,
      listado: enListado.has(n),
      estado: (await cargarEstadoCuenta(n)) !== null,
      plan: (await cargarPlanCobro(n)) !== null,
      cobro: (await resolverComisionB2B(n)) !== null,
    });
  }
  return { filas, aviso: listado.legacyNoVerificado };
}

const BASE = [
  "C1-ficha", "C2-solo-nombre", "C3-ficha-manual", "C7-manual-sin-ficha",
  "C8-minorista", "C9-mayus", "C10-solo-comision", "C11-distintos", "C12-freelance",
];

afterEach(() => { __resetClient(); __resetAdmin(); });

test("modo normal: para cada cuenta, el listado coincide con estado de cuenta, plan y cuenta de cobro", async () => {
  const esperado: Record<string, string[]> = {
    "u-nuevo": [],                                         // homónimo sin enlace: nada
    "u-enlazado": ["C1-ficha"],                            // enlace aprobado: lo de su ficha
    // Bandera legacy: solo contratos SIN ningún id, de SU tenant, con el nombre
    // en ventas (normalizado). Nunca por el texto de la comisión manual.
    "u-antiguo": ["C2-solo-nombre", "C7-manual-sin-ficha", "C9-mayus", "C12-freelance"],
    "u-inactivo": [],
    "u-min": ["C8-minorista"],                             // misma regla, del lado Minorista
  };
  // #38 · la cuenta de cobro decide además FILA por fila: en C12 el contrato es
  // suyo (ventas.freelance_nombre), pero su única comisión sin ficha es de
  // "Otro Nombre". Abre el contrato, no esa comisión (un interno la genera).
  const sinComisionPropia: Record<string, string[]> = { "u-antiguo": ["C12-freelance"] };
  for (const [uid, abiertos] of Object.entries(esperado)) {
    const { filas } = await decisiones(uid, BASE, tablasBase());
    for (const f of filas) {
      const debe = abiertos.includes(f.numero);
      assert.equal(f.listado, debe, `${uid} listado ${f.numero}`);
      assert.equal(f.estado, debe, `${uid} estado de cuenta ${f.numero}`);
      assert.equal(f.plan, debe, `${uid} plan de cobro ${f.numero}`);
      assert.equal(f.cobro, debe && !(sinComisionPropia[uid] ?? []).includes(f.numero), `${uid} cuenta de cobro ${f.numero}`);
    }
  }
  // Recibos: siguen al estado de cuenta.
  __setClient(supabaseEnMemoria(tablasBase(), {}, "u-nuevo")); __setAdmin(supabaseEnMemoria(tablasBase()));
  for (const id of [11, 22, 33, 77]) assert.equal(await cargarRecibo(id), null, `recibo ${id} para el homónimo`);
  __setClient(supabaseEnMemoria(tablasBase(), {}, "u-antiguo")); __setAdmin(supabaseEnMemoria(tablasBase()));
  assert.ok(await cargarRecibo(22));
  assert.equal(await cargarRecibo(33), null, "C3 tiene ficha en comisión manual: el nombre no lo abre");
});

test("DIVERGENCIA CONOCIDA (vínculo por id, NO legacy): si la comisión manual MÁS RECIENTE tiene la ficha del aliado, solo la cuenta de cobro lo reconoce", async () => {
  // No abre nada a terceros ni por nombre: es el dueño real de la ficha. Pero
  // el listado y el estado de cuenta todavía no resuelven ese vínculo. Se fija
  // el comportamiento actual para que, si se unifica, esta prueba lo delate y
  // se actualice a propósito (ver la entrega).
  const t = tablasBase();
  t.aliados_b2b = [comisionManual(1, "C3-ficha-manual", null), comisionManual(2, "C3-ficha-manual", 7)];
  const { filas } = await decisiones("u-enlazado", ["C3-ficha-manual"], t);
  assert.deepEqual(filas[0], { numero: "C3-ficha-manual", listado: false, estado: false, plan: false, cobro: true });
  // Y al homónimo / al legacy no le abre nada de ese contrato en ningún lado.
  for (const uid of ["u-nuevo", "u-antiguo"]) {
    const { filas: f } = await decisiones(uid, ["C3-ficha-manual"], t);
    assert.deepEqual(f[0], { numero: "C3-ficha-manual", listado: false, estado: false, plan: false, cobro: false }, uid);
  }
});

test("#38 · legacy: la comisión histórica sin ficha a SU nombre (normalizado) se sigue cobrando", async () => {
  const t = tablasBase();
  t.aliados_b2b = t.aliados_b2b.map((r) => (r.numero_contrato === "C12-freelance" ? { ...r, aliado: `  ${NOMBRE.toUpperCase()}  ` } : r));
  const { filas } = await decisiones("u-antiguo", ["C12-freelance"], t);
  assert.deepEqual(filas[0], { numero: "C12-freelance", listado: true, estado: true, plan: true, cobro: true });
});

test("DECISIÓN 193 · nombre de ventas nulo o distinto y solo aliados_b2b.aliado coincide, sin ids: NO se abre en ningún lado", async () => {
  // Antes: la cuenta de cobro SÍ se abría (comisionResolver pasaba
  // aliados_b2b.aliado como evidencia), mientras portal y estado de cuenta no.
  // Ahora las tres vistas niegan; esos contratos se recuperan enlazando por id.
  for (const opts of [{}, { fallar: (c: { tabla: string; conteo: boolean }) => (c.tabla === "aliados_b2b" && c.conteo ? "error" as const : null) }]) {
    const { filas } = await decisiones("u-antiguo", ["C10-solo-comision", "C11-distintos"], tablasBase(), opts as Opciones);
    for (const f of filas) assert.deepEqual(f, { numero: f.numero, listado: false, estado: false, plan: false, cobro: false }, JSON.stringify(opts));
  }
  // Y si se enlaza por id (la vía correcta), el dueño de esa ficha lo recupera.
  const t = tablasBase();
  t.aliados_b2b = t.aliados_b2b.map((r) => (r.numero_contrato === "C10-solo-comision" ? { ...r, aliado_id: 7 } : r));
  const { filas: enlazado } = await decisiones("u-enlazado", ["C10-solo-comision"], t);
  assert.equal(enlazado[0].cobro, true, "con aliados_b2b.aliado_id = su ficha, la cuenta de cobro lo reconoce");
});

test("búsqueda de candidatos por nombre FALLA: el listado no muestra nada por nombre y avisa; nunca muestra algo que los documentos nieguen", async () => {
  for (const fallo of ["error", "sin_conteo", "lanzar"] as const) {
    const opts: Opciones = { fallar: (c) => (c.tabla === "ventas" && c.conteo ? fallo : null) };
    const { filas, aviso } = await decisiones("u-antiguo", BASE, tablasBase(), opts);
    assert.equal(aviso, true, fallo);
    for (const f of filas) {
      assert.equal(f.listado, false, `${fallo} listado ${f.numero}`);
      // Invariante: listado ⊆ documentos permitidos (aquí, vacío ⊆ cualquier cosa).
      if (f.listado) assert.equal(f.estado, true);
    }
    // Los documentos no dependen de esa búsqueda: deciden contrato por contrato.
    assert.equal(filas.find((f) => f.numero === "C2-solo-nombre")!.estado, true);
    assert.equal(filas.find((f) => f.numero === "C8-minorista")!.estado, false);
  }
});

for (const [caso, fallo] of [["error", "error"], ["sin conteo", "sin_conteo"], ["excepción", "lanzar"]] as const) {
  test(`fichas de aliados_b2b con ${caso}: listado y documentos NIEGAN lo que dependía del nombre, a la vez`, async () => {
    const opts: Opciones = { fallar: (c) => (c.tabla === "aliados_b2b" && c.conteo ? fallo : null) };
    const { filas, aviso } = await decisiones("u-antiguo", BASE, tablasBase(), opts);
    for (const f of filas) {
      assert.equal(f.listado, false, `listado ${f.numero}`);
      assert.equal(f.estado, false, `estado ${f.numero}`);
      assert.equal(f.plan, false, `plan ${f.numero}`);
      assert.equal(f.cobro, false, `cobro ${f.numero}`);
    }
    assert.equal(aviso, true, "el portal avisa que no pudo verificar");

    // Lo que entra por id no depende de esa verificación.
    const { filas: f2 } = await decisiones("u-enlazado", ["C1-ficha"], tablasBase(), opts);
    assert.deepEqual(f2[0], { numero: "C1-ficha", listado: true, estado: true, plan: true, cobro: true });
  });
}

test("más de 1.000 candidatos por nombre con límite de 1.000 filas: misma decisión en listado y documentos", async () => {
  const tablas = tablasBase();
  const ventas = [...tablas.ventas];
  const manual = [...tablas.aliados_b2b];
  for (let i = 0; i < 1200; i++) {
    const n = `M-${String(i).padStart(4, "0")}`;
    ventas.push(venta(n, i < 600 ? {} : { agencia_nombre: null, freelance_nombre: NOMBRE }));
    // Ficha en el último (fuera del primer millar) y en el 650.
    if (i === 1199 || i === 650) manual.push(comisionManual(1000 + i, n, 9));
  }
  const t = { ...tablas, ventas, aliados_b2b: manual };
  const muestra = ["M-0000", "M-0599", "M-0650", "M-0999", "M-1000", "M-1199"];
  const { filas, aviso } = await decisiones("u-antiguo", muestra, t, { maxFilas: 1000 });
  assert.equal(aviso, false);
  for (const f of filas) {
    const debe = f.numero !== "M-0650" && f.numero !== "M-1199";
    assert.equal(f.listado, debe, `listado ${f.numero}`);
    assert.equal(f.estado, debe, `estado ${f.numero}`);
    assert.equal(f.cobro, debe, `cobro ${f.numero}`);
  }
});
