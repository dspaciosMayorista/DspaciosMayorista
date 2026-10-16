// Se ejecuta con el comando directo (no registrado en package.json):
//   node --experimental-test-module-mocks \
//     --experimental-loader ./pruebas/support/reactLoader.mjs \
//     --experimental-loader ./pruebas/support/programasRutaLoader.mjs \
//     --test pruebas/programaRutaAlojamiento.react.ts
// #51 / migración 212. Ejecuta las Server Actions REALES (guardarCiudades,
// importarDesdeTexto) contra una tabla en memoria, y las dos páginas REALES de
// programa (ficha y documento/PDF) renderizadas a HTML.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { renderToStaticMarkup } = await import("react-dom/server");
const { __setClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { guardarCiudades, importarDesdeTexto } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
const { default: FichaPage } = await import("../app/tarifario/programa/[id]/page.tsx");
const { default: DocPage } = await import("../app/tarifario/programa/[id]/doc/page.tsx");
const { NotFoundError } = await import("./support/stubs/programasRutaStub.mjs");

type Fila = Record<string, unknown>;

// Cliente Supabase en memoria: aplica eq/in/order de verdad y simula el CHECK
// de 200 caracteres de la migración 212.
function crearClienteFalso(seed: Record<string, Fila[]>) {
  const tablas: Record<string, Fila[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1000;
  const sb = {
    tablas,
    rpcs: [] as { nombre: string; args: Record<string, unknown> }[],
    rpcError: null as { message: string } | null,
    async rpc(nombre: string, args: Record<string, unknown>) {
      sb.rpcs.push({ nombre, args });
      return sb.rpcError ? { data: null, error: sb.rpcError } : { data: 0, error: null };
    },
    auth: { getUser: async () => ({ data: { user: null } }) },
    from(t: string) {
      const filtros: ((f: Fila) => boolean)[] = [];
      let orden: string | null = null;
      let op: "select" | "delete" | "insert" = "select";
      let aInsertar: Fila[] = [];
      const ejecutar = () => {
        const filas = (tablas[t] ??= []);
        if (op === "insert") {
          for (const f of aInsertar) {
            const a = f.alojamiento_previsto;
            if (t === "programa_ciudades" && typeof a === "string" && a.length > 200) {
              return { data: null, error: { message: "programa_ciudades_alojamiento_previsto_len" } };
            }
          }
          for (const f of aInsertar) filas.push({ id: nextId++, ...f });
          return { data: null, error: null };
        }
        if (op === "delete") {
          tablas[t] = filas.filter((f) => !filtros.every((p) => p(f)));
          return { data: null, error: null };
        }
        let r = filas.filter((f) => filtros.every((p) => p(f)));
        const col = orden;
        if (col) r = [...r].sort((a, b) => Number(a[col] ?? 0) - Number(b[col] ?? 0));
        return { data: r.map((x) => ({ ...x })), error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select() { return b; },
        eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return b; },
        in(c: string, v: unknown[]) { filtros.push((f) => v.includes(f[c])); return b; },
        order(c: string) { orden = c; return b; },
        delete() { op = "delete"; return b; },
        insert(x: Fila | Fila[]) { op = "insert"; aInsertar = Array.isArray(x) ? x : [x]; return b; },
        update() { return b; },
        maybeSingle: async () => { const r = ejecutar(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error }; },
        single: async () => { const r = ejecutar(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error }; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej); },
      };
      return b;
    },
  };
  return sb;
}

const PROGRAMA = {
  id: 7, nombre: "Perú Mágico", publicado: true, moneda: "USD", pct_mk: 0.2, asistencia_medica_dia: 0,
  dias: 6, noches: 5, pct_fee_tarjeta: 0, subtitulo: null, highlights: [], proveedores: null,
};

let sb: ReturnType<typeof crearClienteFalso>;
beforeEach(() => {
  sb = crearClienteFalso({
    programas: [PROGRAMA],
    programa_ciudades: [
      { id: 1, programa_id: 7, orden: 0, nombre: "LIMA", codigo_iata: "LIM", noches: 1, alojamiento_previsto: "Hotel Miraflores o similar" },
      { id: 2, programa_id: 7, orden: 1, nombre: "CUSCO", codigo_iata: "CUZ", noches: 2, alojamiento_previsto: "Casa Andina 4*" },
      { id: 3, programa_id: 7, orden: 2, nombre: "CUSCO", codigo_iata: "CUZ", noches: 2, alojamiento_previsto: null },
    ],
  });
  __setClient(sb);
});

// ── Guardado e importación: SOLO a través de la RPC atómica ─────────────────
// (el comportamiento real de la RPC se prueba en PostgreSQL: test_212_*.sql/.sh)
const OPC_RUTA = { itinerario: false, ruta: true, inclusiones: false, diasNoches: false };
const TEXTO = ["Perú Mágico", "6 días / 5 noches", "LIMA - CUSCO - CUSCO", ""].join("\n");

test("guardarCiudades llama UNA vez a la RPC con el texto recortado y sin tocar la tabla por su cuenta", async () => {
  const antes = JSON.stringify(sb.tablas.programa_ciudades);
  const r = await guardarCiudades(7, [
    { nombre: " LIMA ", codigoIata: "LIM", noches: 1, alojamientoPrevisto: "  Hotel Nuevo  " },
    { nombre: "CUSCO", codigoIata: "", noches: 2, alojamientoPrevisto: "   " },
    { nombre: "   ", codigoIata: "", noches: 0 },
  ]);
  assert.deepEqual(r, { ok: true });
  assert.equal(sb.rpcs.length, 1);
  assert.equal(sb.rpcs[0].nombre, "reemplazar_ruta_programa");
  assert.deepEqual(sb.rpcs[0].args, {
    p_programa_id: 7,
    p_ciudades: [
      { nombre: "LIMA", codigo_iata: "LIM", noches: 1, alojamiento_previsto: "Hotel Nuevo" },
      { nombre: "CUSCO", codigo_iata: null, noches: 2, alojamiento_previsto: null },
    ],
  });
  assert.equal(JSON.stringify(sb.tablas.programa_ciudades), antes, "la acción no debe hacer DELETE/INSERT sueltos");
});

test("guardarCiudades sin el campo OMITE la clave (la RPC conserva el alojamiento guardado)", async () => {
  await guardarCiudades(7, [{ nombre: "Cusco", codigoIata: "CUZ", noches: 2 }]);
  const c = (sb.rpcs[0].args.p_ciudades as Record<string, unknown>[])[0];
  assert.equal("alojamiento_previsto" in c, false);
});

test("guardarCiudades recorta a 200 caracteres antes de enviar", async () => {
  await guardarCiudades(7, [{ nombre: "LIMA", codigoIata: "", noches: 1, alojamientoPrevisto: "x".repeat(500) }]);
  const c = (sb.rpcs[0].args.p_ciudades as { alojamiento_previsto: string }[])[0];
  assert.equal(c.alojamiento_previsto.length, 200);
});

test("guardarCiudades propaga el error de la RPC y NO revalida", async () => {
  sb.rpcError = { message: "sin permiso para reemplazar la ruta" };
  const r = await guardarCiudades(7, [{ nombre: "LIMA", codigoIata: "", noches: 1, alojamientoPrevisto: "A" }]);
  assert.deepEqual(r, { ok: false, error: "sin permiso para reemplazar la ruta" });
});

test("importarDesdeTexto con ruta: una sola RPC, sin la clave alojamiento_previsto (se conserva en SQL)", async () => {
  const antes = JSON.stringify(sb.tablas.programa_ciudades);
  const r = await importarDesdeTexto(7, TEXTO, OPC_RUTA);
  assert.deepEqual(r, { ok: true });
  assert.equal(sb.rpcs.length, 1);
  assert.deepEqual(sb.rpcs[0].args, {
    p_programa_id: 7,
    p_ciudades: [
      { nombre: "LIMA", codigo_iata: null, noches: 0 },
      { nombre: "CUSCO", codigo_iata: null, noches: 0 },
      { nombre: "CUSCO", codigo_iata: null, noches: 0 },
    ],
  });
  assert.equal(JSON.stringify(sb.tablas.programa_ciudades), antes);
});

test("importarDesdeTexto: si la RPC falla devuelve el error y no sigue con otras secciones", async () => {
  sb.rpcError = { message: "boom" };
  const r = await importarDesdeTexto(7, TEXTO, { ...OPC_RUTA, itinerario: true });
  assert.deepEqual(r, { ok: false, error: "boom" });
  assert.equal(sb.rpcs.length, 1);
});

test("importar SIN marcar ruta no llama a la RPC", async () => {
  await importarDesdeTexto(7, TEXTO, { ...OPC_RUTA, ruta: false, diasNoches: true });
  assert.equal(sb.rpcs.length, 0);
});

// ── Vistas ──────────────────────────────────────────────────────────────────
const params = Promise.resolve({ id: "7" });
const renderFicha = async () => renderToStaticMarkup(await FichaPage({ params }));
const renderDoc = async () => renderToStaticMarkup(await DocPage({ params, searchParams: Promise.resolve({}) }));

for (const [nombre, render] of [["ficha", renderFicha], ["documento PDF", renderDoc]] as const) {
  test(`${nombre}: muestra "Alojamiento previsto" solo con las ciudades que lo tienen, con aviso de no confirmado`, async () => {
    const html = await render();
    assert.match(html, /Alojamiento previsto/);
    assert.match(html, /Hotel Miraflores o similar/);
    assert.match(html, /Casa Andina 4\*/);
    assert.match(html, /no constituye un hotel confirmado/);
    // La 2.ª CUSCO no tiene texto: solo 2 elementos de lista dentro de la sección.
    const bloque = html.slice(html.indexOf("Alojamiento previsto"));
    const items = bloque.slice(0, bloque.indexOf("no constituye")).match(/<li/g) ?? [];
    assert.equal(items.length, 2);
  });

  test(`${nombre}: programa anterior (sin ningún alojamiento) no muestra la sección`, async () => {
    for (const c of sb.tablas.programa_ciudades) c.alojamiento_previsto = null;
    const html = await render();
    assert.doesNotMatch(html, /Alojamiento previsto/);
    assert.match(html, /Perú Mágico/);
  });

  test(`${nombre}: escapa el texto libre (sin HTML inyectado)`, async () => {
    sb.tablas.programa_ciudades[0].alojamiento_previsto = "<script>alert(1)</script>";
    const html = await render();
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });
}

test("ficha: un programa no publicado sigue siendo 404 para el público (permisos intactos)", async () => {
  sb.tablas.programas[0].publicado = false;
  await assert.rejects(() => renderFicha(), NotFoundError);
});
