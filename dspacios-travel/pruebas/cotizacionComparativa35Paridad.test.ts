// #35 — PARIDAD de la hija manual con la cotización dinámica de hoy.
//
// La hija de una comparativa manual debe ser INDISTINGUIBLE de una cotización
// dinámica común con los mismos servicios (es lo que el RPC 198 convierte, en PVP).
// Esta prueba ejecuta de verdad `crearCotizacionManual` (app/…/manual-actions.ts)
// con Supabase simulado, y compara lo que le ENTREGA a la RPC
// `crear_cotizacion_manual` (#39, migración 216: `p_cabecera` + `p_servicios`)
// contra la plantilla que `construirComparativaManual` guarda para cada opción.
// Desde #39 la cotización común ya no se inserta desde TypeScript: la guarda esa
// RPC. Por eso el último bloque lee el SQL de la 216 y comprueba cómo convierte
// los argumentos en la fila (qué columnas copia de la cabecera y cuáles, como
// `modulo`, estampa el servidor). Si alguien cambia la fórmula de una u otra,
// esta prueba falla.
import { test, describe, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// "next/cache" no tiene mapa de exports resoluble por el ESM de Node: se sirve como módulo mínimo SOLO
// en esta prueba (mismo patrón que pruebas/conversionIncluidosEjecucion.test.ts).
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: `data:text/javascript,${encodeURIComponent("export function revalidatePath() {} export function revalidateTag() {}")}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// La creación exige la llave de servicio configurada (la RPC solo la ejecuta service_role).
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "clave-de-prueba";

type Fila = Record<string, unknown>;
// Escrituras directas (deben quedar en cero: la creación va entera por la RPC) y llamadas a RPC.
const inserts: { tabla: string; filas: Fila[] }[] = [];
const rpcs: { fn: string; args: Fila }[] = [];

function cliente() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "asesor@dspacios.test" } }, error: null }) },
    // #42 (219): la creación manual registra después al titular; el doble responde como la fachada.
    rpc: async (fn: string, args: Fila) => {
      rpcs.push({ fn, args });
      return { data: fn === "registrar_personas_cotizacion" ? { cotizacion_id: 501, nuevos: 1, reintentos: 0, omitidos: 0 } : 501, error: null };
    },
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        insert: (f: Fila | Fila[]) => { inserts.push({ tabla, filas: Array.isArray(f) ? f : [f] }); return b; },
        select: () => b,
        single: async () => ({ data: { id: 501 }, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return b;
    },
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

const { crearCotizacionManual } = await import("../app/(dashboard)/dashboard/cotizaciones/manual-actions.ts");
const { construirComparativaManual } = await import("../lib/cotizacion/comparativa.ts");
import type { EntradaComparativaManual } from "../lib/cotizacion/comparativa.ts";

// Claves que la acción entrega en `p_cabecera`: solo datos de la cotización. Lo que
// decide el servidor (tenant, tipo, modulo, estado, autor) NO viaja en la cabecera.
const CLAVES_CABECERA = [
  "asesor", "cliente", "cliente_documento", "destino", "detalle", "fecha_regreso", "fecha_salida",
  "hotel", "moneda", "pax", "payload", "plan_nombre", "precio_venta", "vigencia_hasta",
];
const COLUMNAS_SERVICIO = ["costo_neto", "modo", "nombre_servicio", "orden", "pct_markup", "plataforma", "proveedor", "ta", "tipo_servicio", "valor"];

const HOY = "2026-10-15";
function base(sobre: Partial<EntradaComparativaManual> = {}): EntradaComparativaManual {
  return {
    cliente: { nombres: "Ana", apellidos: "Pérez", tipoDoc: "CC", numeroDoc: "123456", telefono: "3001112233", email: "a@x.test", nacimiento: "1990-01-01" },
    destino: "Cartagena", fechaIda: "2030-11-10", fechaRegreso: "2030-11-14", pax: 2, ninos: 0, tarifaNino: 0,
    recobro: 0, recobroAliado: 0, moneda: "COP", tipoAsesor: "interno", asesorInterno: "Asesor Uno", agenciaNombre: "",
    freelanceNombre: "", plazo: "Inmediato", vigenciaHasta: "2030-11-05", observaciones: "Obs", incluye: "", noIncluye: "",
    servicios: [
      { tipo: "aereo", plataforma: "Despegar", nombre: "Aéreo BOG-CTG", proveedor: "Avianca", costoNeto: 800000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel A", proveedor: "Hoteles A", costoNeto: 400000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "A" },
      { tipo: "traslado", plataforma: "Directo", nombre: "Traslados", proveedor: "TransCo", costoNeto: 80000, modo: "mk", pctMarkup: 20, ta: 0 },
      { tipo: "hotel", plataforma: "Booking", nombre: "Hotel B", proveedor: "Hoteles B", costoNeto: 560000, modo: "mk", pctMarkup: 20, ta: 0, opcionRef: "B" },
      { tipo: "asistencia", plataforma: "Directo", nombre: "Asistencia", proveedor: "Assist", costoNeto: 50000, modo: "mk", pctMarkup: 25, ta: 0 },
    ],
    ...sobre,
  };
}

// La cotización dinámica COMÚN equivalente a la opción `ref`: mismos datos, solo sus servicios, sin etiquetas de opción.
// Devuelve lo que la acción entrega a la RPC `crear_cotizacion_manual` (la cabecera y las filas de servicio).
async function dinamicaComun(entrada: EntradaComparativaManual, ref: "A" | "B") {
  inserts.length = 0;
  rpcs.length = 0;
  const { aliadoId: _a, tenant: _t, ...resto } = entrada;
  void _a; void _t;
  const servicios = entrada.servicios.filter((s) => !s.opcionRef || s.opcionRef === ref).map(({ opcionRef: _o, ...s }) => { void _o; return s; });
  const r = await crearCotizacionManual({ ...resto, servicios });
  assert.ok(r.ok, "la cotización dinámica de referencia debe crearse");
  assert.equal(r.ok && r.id, 501, "devuelve el id que crea la RPC");
  assert.equal(r.ok && "avisoPersonas" in r, false, "con el registro de personas en orden no hay aviso");

  // #39: una sola llamada a la RPC definer y ninguna escritura directa desde TypeScript.
  // #42: después, y solo después, el registro del titular (no es financiero).
  assert.equal(inserts.length, 0, "crearCotizacionManual no debe insertar directo en ninguna tabla");
  assert.deepEqual(rpcs.map((x) => x.fn), ["crear_cotizacion_manual", "registrar_personas_cotizacion"],
    "la creación va por UNA llamada a crear_cotizacion_manual, seguida del registro del titular");
  const alta = rpcs[1].args as { p_cotizacion_id: number; p_usuario_id: string; p_participantes: { rol: string; numero_doc: string | null }[] };
  assert.deepEqual(Object.keys(alta).sort(), ["p_cotizacion_id", "p_participantes", "p_usuario_id"], "argumentos del registro");
  assert.equal(alta.p_cotizacion_id, 501, "registra la cotización recién creada");
  assert.equal(alta.p_usuario_id, "u-1", "con el mismo autor de la sesión");
  assert.deepEqual(alta.p_participantes.map((p) => [p.rol, p.numero_doc]), [["titular", entrada.cliente.numeroDoc]],
    "solo el titular: las cantidades de pax/niños nunca crean personas");
  const args = rpcs[0].args;
  assert.deepEqual(Object.keys(args).sort(), ["p_cabecera", "p_servicios", "p_tenant", "p_usuario_id"], "argumentos de la RPC");
  assert.equal(args.p_usuario_id, "u-1", "el autor es el usuario de la sesión, no un dato del formulario");
  assert.equal(args.p_tenant, "mayorista", "la agencia sale del contexto validado");

  const cot = args.p_cabecera as Fila;
  const servs = args.p_servicios as Fila[];
  assert.deepEqual(Object.keys(cot).sort(), CLAVES_CABECERA, "la cabecera trae solo datos de la cotización (tenant, tipo, modulo, estado y autor los estampa la RPC)");
  assert.ok(Array.isArray(servs) && servs.length > 0, "p_servicios trae las filas de servicio");
  servs.forEach((s, i) => {
    assert.deepEqual(Object.keys(s).sort(), COLUMNAS_SERVICIO, `servicio ${i}: columnas (sin cotizacion_id, que lo pone la RPC)`);
    // La RPC numera por posición (`with ordinality`): el `orden` del JSON coincide con esa posición.
    assert.equal(s.orden, i, `servicio ${i}: orden = posición en p_servicios`);
  });

  // El mismo cuadre que la RPC exige antes de guardar: Σ valor + recobro + niños × tarifa = precio (±0,5).
  const pay = cot.payload as { recobro?: number; ninos?: number; tarifaNino?: number };
  const esperado = servs.reduce((a, s) => a + Number(s.valor), 0)
    + Math.max(Number(pay.recobro ?? 0), 0)
    + Math.max(Math.floor(Number(pay.ninos ?? 0)), 0) * Math.max(Number(pay.tarifaNino ?? 0), 0);
  assert.equal(typeof cot.precio_venta, "number", "la RPC exige precio_venta numérico");
  assert.ok(Math.abs(esperado - Number(cot.precio_venta)) <= 0.5, `la RPC rechazaría el total (${cot.precio_venta} vs ${esperado})`);
  return { cot, servs };
}

beforeEach(() => { inserts.length = 0; rpcs.length = 0; });

describe("paridad: la plantilla de cada opción = la cotización dinámica común equivalente", () => {
  for (const [nombre, sobre] of [
    ["interno sin recobro", {}],
    ["interno con recobro oculto", { recobro: 100000 }],
    ["con niños y recobro", { recobro: 100000, ninos: 2, tarifaNino: 250000 }],
    ["B2B agencia con recobro al aliado", { tipoAsesor: "agencia" as const, agenciaNombre: "Agencia Uno", recobro: 100000, recobroAliado: 60000 }],
    ["B2B freelance", { tipoAsesor: "freelance" as const, freelanceNombre: "Free Uno", recobro: 50000, recobroAliado: 20000 }],
    ["USD", { moneda: "USD" }],
  ] as const) {
    test(nombre, async () => {
      const entrada = base(sobre);
      const r = construirComparativaManual(entrada, { hoy: HOY, creadoPorEmail: "asesor@dspacios.test" });
      assert.ok(r.ok, r.ok ? "" : r.error);
      for (const op of r.datos.opciones) {
        const ref = op.opcion_ref as "A" | "B";
        const { cot, servs } = await dinamicaComun(entrada, ref);
        const pl = op.plantilla_hija as Record<string, unknown>;

        assert.equal(op.total, cot.precio_venta, `${ref}: total = precio_venta de la cotización común`);
        assert.deepEqual(pl.payload, cot.payload, `${ref}: payload idéntico`);
        assert.deepEqual(pl.detalle, cot.detalle, `${ref}: detalle idéntico`);
        for (const [col, esperado] of [
          ["cliente", cot.cliente], ["cliente_documento", cot.cliente_documento], ["destino", cot.destino], ["hotel", cot.hotel],
          ["plan_nombre", cot.plan_nombre], ["pax", cot.pax], ["fecha_salida", cot.fecha_salida], ["fecha_regreso", cot.fecha_regreso],
        ] as const) {
          assert.deepEqual(pl[col], esperado, `${ref}: columna ${col}`);
        }
        assert.equal(op.moneda, cot.moneda);
        // `modulo` sigue siendo parte de la fila guardada ('manual'), pero ya no viaja
        // en la cabecera: lo estampa la RPC. Ver el bloque del SQL de la 216 más abajo.
        assert.equal("modulo" in cot, false, `${ref}: modulo no lo elige la acción`);

        // Filas de servicios: las de la opción (comunes + su hotel), con los mismos valores y la misma
        // numeración consecutiva que produce la cotización común (la RPC renumera al copiar).
        type FilaServicio = { orden: number; tipo_servicio: string; plataforma: string | null; nombre_servicio: string | null; proveedor: string | null;
          costo_neto: number; modo: string; pct_markup: number; ta: number; valor: number };
        const propias: FilaServicio[] = r.datos.servicios.filter((s) => s.opcion_ref === null || s.opcion_ref === ref)
          .map((s, i): FilaServicio => ({ orden: i, tipo_servicio: s.tipo_servicio, plataforma: s.plataforma, nombre_servicio: s.nombre_servicio, proveedor: s.proveedor,
            costo_neto: s.costo_neto, modo: s.modo, pct_markup: s.pct_markup, ta: s.ta, valor: s.valor }));
        assert.deepEqual(propias, servs, `${ref}: filas de servicios (valor, costo, markup, proveedor)`);
        assert.equal(propias.reduce((a, s) => a + Number(s.valor), 0) + Number(((cot.detalle as { recobro: { total: number } }).recobro.total)) + Number((cot.payload as { ninos?: number }).ninos ?? 0) * Number((cot.payload as { tarifaNino?: number }).tarifaNino ?? 0),
          op.total, `${ref}: Σ servicios + recobro + niños = total de la opción`);
      }
    });
  }

  test("el común (aéreo, traslado, asistencia) se cuenta UNA vez en cada opción", async () => {
    const r = construirComparativaManual(base(), { hoy: HOY });
    assert.ok(r.ok);
    const [a, b] = r.datos.opciones;
    // aéreo 1.000.000 + traslado 100.000 + asistencia 66.667 (50.000/0,75) = 1.166.667 de lo común
    const comunes = r.datos.servicios.filter((s) => s.opcion_ref === null).reduce((x, s) => x + s.valor, 0);
    assert.equal(a.total, comunes + 500_000);
    assert.equal(b.total, comunes + 700_000);
    assert.notEqual(a.total + b.total, comunes * 2 + 1_200_000 - 1, "no se suma un hotel con el otro");
  });
});

describe("la madre manual no se parece a una cotización cobrable", () => {
  test("la cabecera de la madre no trae precio_venta (NULL en la base) ni items cobrables", () => {
    const r = construirComparativaManual(base(), { hoy: HOY });
    assert.ok(r.ok);
    assert.equal("precio_venta" in r.datos.cabecera, false);
    assert.equal(r.datos.cabecera.tipo, "comparativa_manual");
    assert.deepEqual(Object.keys((r.datos.cabecera.detalle as Record<string, unknown>)).sort(), ["comparativa", "venta"]);
  });
  test("construirComparativaManual no ejecuta nada de dinero: no hay inserts ni RPC", () => {
    inserts.length = 0;
    rpcs.length = 0;
    construirComparativaManual(base(), { hoy: HOY });
    assert.equal(inserts.length, 0);
    assert.equal(rpcs.length, 0);
  });
});

// ── Cómo guarda la RPC lo que recibe (SQL de la migración 216) ──────────────
// La paridad de arriba compara los ARGUMENTOS de la RPC. Para que eso equivalga a
// comparar la FILA guardada, la RPC tiene que copiar cada dato de la cabecera a su
// columna homónima sin reinterpretarlo, y estampar ella sola lo que no viene del
// formulario (incluido `modulo = 'manual'`).
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRACION_216 = "supabase/migrations/20260601000216_cotizacion_manual_edicion_frontera.sql";

function cuerpoRpc(nombre: string): string {
  const src = readFileSync(join(raiz, MIGRACION_216), "utf8").replace(/\r\n/g, "\n");
  const ddl = `create or replace function public.${nombre}(`;
  const inicio = src.indexOf(ddl);
  assert.ok(inicio > -1, `no se encontró "${ddl}" en la 216`);
  const abre = src.indexOf("$$", inicio);
  const cierra = src.indexOf("$$", abre + 2);
  assert.ok(abre > -1 && cierra > abre, `no se pudo delimitar el cuerpo de ${nombre}`);
  // Sin comentarios de línea: el cuerpo de esta RPC no tiene `--` dentro de literales.
  return src.slice(abre + 2, cierra).replace(/--[^\n]*/g, "");
}

// Separa una lista SQL por las comas de primer nivel (fuera de paréntesis y de literales '...').
function partir(lista: string): string[] {
  const partes: string[] = [];
  let prof = 0;
  let enLiteral = false;
  let actual = "";
  for (const ch of lista) {
    if (enLiteral) { actual += ch; if (ch === "'") enLiteral = false; continue; }
    if (ch === "'") { enLiteral = true; actual += ch; continue; }
    if (ch === "(") prof++;
    if (ch === ")") prof--;
    if (ch === "," && prof === 0) { partes.push(actual.trim().replace(/\s+/g, " ")); actual = ""; continue; }
    actual += ch;
  }
  if (actual.trim()) partes.push(actual.trim().replace(/\s+/g, " "));
  return partes;
}

describe("la RPC crear_cotizacion_manual (216) guarda la cabecera y los servicios sin reinterpretarlos", () => {
  const cuerpo = cuerpoRpc("crear_cotizacion_manual");

  test("cotizaciones: cada dato de la cabecera va a su columna; tenant, tipo, modulo, estado y autor los estampa el servidor", () => {
    const m = /insert into public\.cotizaciones \(([\s\S]*?)\) values \(([\s\S]*?)\) returning id into v_id;/.exec(cuerpo);
    assert.ok(m, "no se encontró el insert de cotizaciones en crear_cotizacion_manual");
    const columnas = partir(m[1]);
    const valores = partir(m[2]);
    assert.equal(columnas.length, valores.length, "el insert de cotizaciones tiene tantas columnas como valores");
    const fila = Object.fromEntries(columnas.map((c, i) => [c, valores[i]]));

    // Lo que la cabecera no puede elegir.
    assert.deepEqual(
      { tenant: fila.tenant, tipo: fila.tipo, modulo: fila.modulo, estado: fila.estado, creado_por: fila.creado_por, creado_por_id: fila.creado_por_id },
      { tenant: "v_tenant", tipo: "'manual'", modulo: "'manual'", estado: "'abierta'", creado_por: "u.email", creado_por_id: "u.id" },
      "la RPC estampa tenant validado, tipo/modulo 'manual', estado 'abierta' y el autor estable"
    );

    // payload, detalle, precio y vigencia: tal cual de la cabecera.
    assert.equal(fila.payload, "v_pay");
    assert.match(cuerpo, /v_pay jsonb := p_cabecera->'payload';/, "payload sale de p_cabecera->'payload'");
    assert.equal(fila.detalle, "v_det");
    assert.match(cuerpo, /v_det jsonb := p_cabecera->'detalle';/, "detalle sale de p_cabecera->'detalle'");
    assert.equal(fila.precio_venta, "v_precio");
    assert.match(cuerpo, /v_precio := \(p_cabecera->>'precio_venta'\)::numeric;/, "precio_venta sale de la cabecera");
    assert.equal(fila.vigencia_hasta, "v_vig");
    assert.match(cuerpo, /v_vig := nullif\(p_cabecera->>'vigencia_hasta', ''\)::date;/, "vigencia_hasta sale de la cabecera");

    // Las columnas de paridad leen SU MISMA clave de la cabecera, y solo esa.
    for (const col of ["cliente", "cliente_documento", "destino", "hotel", "plan_nombre", "pax", "moneda", "fecha_salida", "fecha_regreso", "asesor"]) {
      assert.ok(fila[col], `el insert no escribe la columna ${col}`);
      const claves = [...fila[col].matchAll(/p_cabecera->>'(\w+)'/g)].map((x) => x[1]);
      assert.deepEqual(claves, [col], `columna ${col}: lee p_cabecera->>'${col}' y nada más`);
    }

    // Ninguna clave de la cabecera se descarta, y ninguna columna queda sin origen.
    const usadas = new Set([...cuerpo.matchAll(/p_cabecera->>?'(\w+)'/g)].map((x) => x[1]));
    for (const k of CLAVES_CABECERA) assert.ok(usadas.has(k), `la RPC no usa la clave ${k} de la cabecera`);
    assert.deepEqual([...columnas].sort(), [...CLAVES_CABECERA, "creado_por", "creado_por_id", "estado", "modulo", "tenant", "tipo"].sort(),
      "columnas del insert = claves de la cabecera + las que estampa el servidor");
  });

  test("cotizacion_servicios: el orden es la posición y cada columna sale de su misma clave", () => {
    const m = /insert into public\.cotizacion_servicios \(([\s\S]*?)\)\s*select ([\s\S]*?)\s+from jsonb_array_elements\(p_servicios\) with ordinality as o\(e, n\);/.exec(cuerpo);
    assert.ok(m, "no se encontró el insert de cotizacion_servicios en crear_cotizacion_manual");
    const columnas = partir(m[1]);
    const valores = partir(m[2]);
    assert.equal(columnas.length, valores.length, "el insert de servicios tiene tantas columnas como valores");
    assert.deepEqual([...columnas].sort(), ["cotizacion_id", ...COLUMNAS_SERVICIO].sort(), "columnas = las de la fila + cotizacion_id");
    const fila = Object.fromEntries(columnas.map((c, i) => [c, valores[i]]));
    assert.equal(fila.cotizacion_id, "v_id", "cada servicio cuelga de la cotización recién creada");
    assert.equal(fila.orden, "(o.n - 1)::integer", "orden = posición en p_servicios (empieza en 0)");
    for (const col of COLUMNAS_SERVICIO.filter((c) => c !== "orden")) {
      const claves = [...fila[col].matchAll(/o\.e->>'(\w+)'/g)].map((x) => x[1]);
      assert.deepEqual(claves, [col], `servicio.${col}: lee o.e->>'${col}' y nada más`);
    }
  });
});
