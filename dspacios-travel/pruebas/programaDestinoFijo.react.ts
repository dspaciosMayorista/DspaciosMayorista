// Registrada en `npm run test:react`. Comando equivalente para correrla sola:
//   node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs
//     --experimental-loader ./pruebas/support/reactLoader.mjs --test pruebas/programaDestinoFijo.react.ts
// #23 / migración 213. Ejecuta las Server Actions y las páginas REALES (ficha, PDF,
// Listas fijas, lista de Programas) contra tablas en memoria que emulan el índice
// único, la FK RESTRICT y el rol del usuario.
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const { renderToStaticMarkup } = await import("react-dom/server");
const { __setClient } = await import("./support/stubs/supabaseServerStub.mjs");
const { __revalidadas, __resetRevalidadas } = await import("./support/stubs/nextCacheStub.mjs");
const { NotFoundError } = await import("./support/stubs/programasRutaStub.mjs");
const { crearDestinoFijo, crearDestinoProvisional, renombrarDestinoFijo, eliminarDestinoFijo } = await import("../app/(dashboard)/dashboard/producto/destinos/listas-actions.ts");
const { guardarCabecera, crearPrograma } = await import("../app/(dashboard)/dashboard/producto/programas/actions.ts");
const { default: FichaPage } = await import("../app/tarifario/programa/[id]/page.tsx");
const { default: DocPage } = await import("../app/tarifario/programa/[id]/doc/page.tsx");
const { default: ListasFijasPage } = await import("../app/(dashboard)/dashboard/producto/destinos/listas-fijas/page.tsx");
const { default: ProgramasPage } = await import("../app/(dashboard)/dashboard/producto/programas/page.tsx");
const { claveDestinoFijo, destinosParaFiltro } = await import("../lib/programas/destinoFijo.ts");
const { getProgramasResumen } = await import("../lib/programas.ts");

type Fila = Record<string, unknown>;
type Err = { code?: string; message: string };

function crearClienteFalso(seed: { rol?: string | null; tablas?: Record<string, Fila[]> }) {
  const tablas: Record<string, Fila[]> = JSON.parse(JSON.stringify(seed.tablas ?? {}));
  let nextId = 500;
  const registro: { op: string; tabla: string; payload?: Fila }[] = [];
  const sb = {
    tablas,
    registro,
    forzarErrorDelete: null as Err | null,
    forzar: null as { tabla: string; op: string; err: Err } | null,
    rolError: false,
    auth: {
      getUser: async () => ({ data: { user: seed.rol && seed.rol !== "anon" ? { id: "u1" } : null } }),
    },
    async rpc(nombre: string) {
      if (nombre !== "mi_rol") throw new Error(`rpc inesperada ${nombre}`);
      if (sb.rolError) return { data: null, error: { message: "boom" } };
      return { data: seed.rol && seed.rol !== "anon" ? seed.rol : null, error: null };
    },
    from(t: string) {
      if (t === "usuarios") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = { select() { return b; }, eq() { return b; }, single: async () => ({ data: seed.rol && seed.rol !== "anon" ? { rol: seed.rol } : null, error: null }) };
        return b;
      }
      const filtros: ((f: Fila) => boolean)[] = [];
      let op: "select" | "delete" | "insert" | "update" = "select";
      let payload: Fila = {};
      let head = false;
      let conteo = false;
      let ret = false;
      let cols = "";
      const ejecutar = (): { data: Fila[] | null; error: Err | null; count?: number } => {
        if (sb.forzar && sb.forzar.tabla === t && sb.forzar.op === op) return { data: null, error: sb.forzar.err };
        const filas = (tablas[t] ??= []);
        const sel = filas.filter((f) => filtros.every((p) => p(f)));
        if (op === "insert") {
          if (t === "programa_destinos_fijos" && payload.es_provisional === true && filas.some((f) => f.es_provisional === true)) {
            return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "programa_destinos_fijos_provisional_uk"' } };
          }
          if (t === "programa_destinos_fijos" && filas.some((f) => claveDestinoFijo(f.nombre) === claveDestinoFijo(payload.nombre))) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint programa_destinos_fijos_clave_uk" } };
          }
          const nueva = { id: nextId++, ...payload };
          filas.push(nueva);
          return { data: ret ? [{ ...nueva }] : null, error: null };
        }
        if (op === "update") {
          if (t === "programa_destinos_fijos" && sel.length && filas.some((f) => f.id !== sel[0].id && claveDestinoFijo(f.nombre) === claveDestinoFijo(payload.nombre))) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          for (const f of sel) Object.assign(f, payload);
          return { data: ret ? sel.map((x) => ({ ...x })) : null, error: null };
        }
        if (op === "delete") {
          if (sb.forzarErrorDelete) return { data: null, error: sb.forzarErrorDelete };
          if (t === "programa_destinos_fijos" && sel.some((d) => (tablas.programas ?? []).some((p) => p.destino_fijo_id === d.id))) {
            return { data: null, error: { code: "23503", message: "violates foreign key constraint programas_destino_fijo_fk" } };
          }
          // RLS: un rol sin permiso afecta 0 filas, sin error.
          const permitido = ["superadmin", "gerencia", "administracion", "operaciones"].includes(String(seed.rol));
          const borrar = permitido ? sel : [];
          tablas[t] = filas.filter((f) => !borrar.includes(f));
          return { data: ret ? borrar.map((x) => ({ ...x })) : null, error: null };
        }
        if (conteo && head) return { data: null, error: null, count: sel.length };
        // Embed `programa_destinos_fijos(...)` resuelto contra la tabla viva (si existe), como PostgREST.
        const conEmbed = (x: Fila): Fila => {
          const y: Fila = { ...x };
          if (t === "programas" && cols.includes("programa_destinos_fijos") && tablas.programa_destinos_fijos) {
            const d = tablas.programa_destinos_fijos.find((z) => z.id === x.destino_fijo_id);
            y.programa_destinos_fijos = d ? { id: d.id, nombre: d.nombre, es_provisional: d.es_provisional === true } : null;
          }
          return y;
        };
        return { data: sel.map(conEmbed), error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select(c?: string, o?: { count?: string; head?: boolean }) { cols = c ?? ""; if (op !== "select") ret = true; if (o?.count) conteo = true; if (o?.head) head = true; return b; },
        eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); return b; },
        in(c: string, v: unknown[]) { filtros.push((f) => v.includes(f[c])); return b; },
        not(c: string) { filtros.push((f) => f[c] !== null && f[c] !== undefined); return b; },
        order() { return b; },
        insert(x: Fila) { op = "insert"; payload = x; registro.push({ op, tabla: t, payload: x }); return b; },
        update(x: Fila) { op = "update"; payload = x; registro.push({ op, tabla: t, payload: x }); return b; },
        delete() { op = "delete"; registro.push({ op, tabla: t }); return b; },
        single: async () => { const r = ejecutar(); return { data: r.data?.[0] ?? null, error: r.error }; },
        maybeSingle: async () => { const r = ejecutar(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej); },
      };
      return b;
    },
  };
  return sb;
}

let sb: ReturnType<typeof crearClienteFalso>;
function usar(rol: string | null, tablas: Record<string, Fila[]> = {}) {
  sb = crearClienteFalso({ rol, tablas });
  __setClient(sb);
  __resetRevalidadas();
}
const LISTA = [{ id: 1, nombre: "Brasil" }, { id: 2, nombre: "Europa" }];
beforeEach(() => usar("operaciones", { programa_destinos_fijos: LISTA, programas: [] }));

// ── Lista fija: permisos, altas y edición ────────────────────────────────────
for (const rol of ["superadmin", "gerencia", "administracion", "operaciones"]) {
  test(`${rol} puede crear un destino (recortado) y se revalida el tarifario`, async () => {
    usar(rol, { programa_destinos_fijos: LISTA });
    const r = await crearDestinoFijo("  Costa   Caribe ");
    assert.equal(r.ok, true);
    assert.deepEqual(sb.tablas.programa_destinos_fijos.at(-1), { id: 500, nombre: "Costa Caribe" });
    assert.ok(__revalidadas().includes("/tarifario"));
    assert.ok(__revalidadas().includes("/dashboard/producto/programas"));
  });
}

for (const rol of ["venta", "agencia", "freelance", "cliente_final", "control_vuelo", null]) {
  test(`rol ${rol} NO puede crear, renombrar ni eliminar (ni toca la base)`, async () => {
    usar(rol, { programa_destinos_fijos: LISTA });
    for (const r of [await crearDestinoFijo("Nuevo"), await renombrarDestinoFijo(1, "Otro"), await eliminarDestinoFijo(1)]) {
      assert.equal(r.ok, false);
    }
    assert.deepEqual(sb.registro, [], "no hubo ninguna escritura");
    assert.deepEqual(sb.tablas.programa_destinos_fijos, LISTA);
  });
}

test("si no se puede verificar el rol, falla cerrado", async () => {
  usar("operaciones", { programa_destinos_fijos: LISTA });
  sb.rolError = true;
  assert.equal((await crearDestinoFijo("X")).ok, false);
  assert.deepEqual(sb.registro, []);
});

test("crear: nombre vacío o demasiado largo se rechaza antes de ir a la base", async () => {
  assert.equal((await crearDestinoFijo("   ")).ok, false);
  assert.equal((await crearDestinoFijo("x".repeat(81))).ok, false);
  assert.deepEqual(sb.registro, []);
});

test("crear: duplicado (mayúsculas, tildes, espacios) -> mensaje claro y la lista no cambia", async () => {
  usar("operaciones", { programa_destinos_fijos: [{ id: 1, nombre: "Perú" }] });
  for (const dup of ["perú", " PERU ", "Peru"]) {
    const r = await crearDestinoFijo(dup);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /Ya existe un destino/);
  }
  assert.equal(sb.tablas.programa_destinos_fijos.length, 1);
});

test("renombrar: cambia el nombre conservando el id (las asignaciones siguen)", async () => {
  usar("operaciones", { programa_destinos_fijos: LISTA, programas: [{ id: 9, destino_fijo_id: 1 }] });
  assert.deepEqual(await renombrarDestinoFijo(1, "Brasil y Argentina"), { ok: true, id: 1 });
  assert.equal(sb.tablas.programa_destinos_fijos[0].nombre, "Brasil y Argentina");
  assert.equal(sb.tablas.programas[0].destino_fijo_id, 1);
});

test("renombrar: a un nombre ya existente -> duplicado; id inexistente -> 'ya no existe'", async () => {
  const dup = await renombrarDestinoFijo(1, "europa");
  assert.equal(dup.ok, false);
  assert.match((dup as { error: string }).error, /Ya existe/);
  const nada = await renombrarDestinoFijo(99, "Algo");
  assert.deepEqual(nada, { ok: false, error: "El destino ya no existe." });
});

test("eliminar: un destino SIN programas se borra", async () => {
  assert.deepEqual(await eliminarDestinoFijo(2), { ok: true });
  assert.deepEqual(sb.tablas.programa_destinos_fijos.map((d) => d.id), [1]);
});

test("eliminar: con programas asignados NO se borra en silencio; dice cuántos y no emite DELETE", async () => {
  usar("operaciones", { programa_destinos_fijos: LISTA, programas: [{ id: 9, destino_fijo_id: 1 }, { id: 10, destino_fijo_id: 1 }, { id: 11, destino_fijo_id: 2 }] });
  const r = await eliminarDestinoFijo(1);
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /2 programas lo tienen asignado/);
  assert.equal(sb.registro.some((x) => x.op === "delete"), false);
  assert.equal(sb.tablas.programa_destinos_fijos.length, 2);
});

test("eliminar: carrera (alguien lo asigna entre el conteo y el borrado) -> la FK RESTRICT lo frena con mensaje claro", async () => {
  usar("operaciones", { programa_destinos_fijos: LISTA, programas: [] });
  sb.forzarErrorDelete = { code: "23503", message: "fk" };
  const r = await eliminarDestinoFijo(1);
  assert.deepEqual(r, { ok: false, error: "No se puede eliminar: un programa lo tiene asignado." });
  assert.equal(sb.tablas.programa_destinos_fijos.length, 2);
});

// ── Mensajes seguros: el detalle técnico queda en el log del servidor ────────
const FUGA = 'relation "public.programa_destinos_fijos" violates check constraint programa_destinos_fijos_nombre_ck SQL: INSERT INTO secreto';
const casosError: [string, string, string, () => Promise<{ ok: boolean; error?: string }>][] = [
  ["crear", "programa_destinos_fijos", "insert", () => crearDestinoFijo("Nuevo")],
  ["renombrar", "programa_destinos_fijos", "update", () => renombrarDestinoFijo(1, "Otro")],
  ["eliminar (conteo)", "programas", "select", () => eliminarDestinoFijo(1)],
  ["eliminar (borrado)", "programa_destinos_fijos", "delete", () => eliminarDestinoFijo(2)],
];
for (const [nombre, tabla, op, ejecutar] of casosError) {
  test(`${nombre}: un error crudo de la base NO llega al usuario; el detalle se registra solo en el servidor`, async () => {
    usar("operaciones", { programa_destinos_fijos: LISTA, programas: [] });
    sb.forzar = { tabla, op, err: { code: "XX000", message: FUGA } };
    const log = mock.method(console, "error", () => {});
    try {
      const r = await ejecutar();
      assert.equal(r.ok, false);
      const msg = (r as { error: string }).error;
      assert.doesNotMatch(msg, /relation|constraint|SQL|public\.|secreto|XX000/i);
      assert.match(msg, /Intenta de nuevo/);
      const registrado = log.mock.calls.map((c) => String(c.arguments[0])).join(" | ");
      assert.match(registrado, /\[producto\/destinos\/listas-fijas\]/);
      assert.ok(registrado.includes(FUGA), "el detalle técnico sí queda en el log del servidor");
      assert.ok(registrado.includes("XX000"));
    } finally { log.mock.restore(); }
  });
}

test("un 42501 de la base (RLS/privilegio) se traduce a 'sin permiso', sin mostrar el error crudo", async () => {
  usar("operaciones", { programa_destinos_fijos: LISTA });
  sb.forzar = { tabla: "programa_destinos_fijos", op: "insert", err: { code: "42501", message: 'new row violates row-level security policy for table "programa_destinos_fijos"' } };
  const log = mock.method(console, "error", () => {});
  try {
    const r = await crearDestinoFijo("Nuevo");
    assert.deepEqual(r, { ok: false, error: "No tienes permiso para administrar esta lista." });
  } finally { log.mock.restore(); }
});

test("si falla la verificación del rol el mensaje es genérico y el detalle va al log", async () => {
  usar("operaciones", { programa_destinos_fijos: LISTA });
  sb.rolError = true;
  const log = mock.method(console, "error", () => {});
  try {
    const r = await crearDestinoFijo("X");
    assert.deepEqual(r, { ok: false, error: "No se pudo verificar tu permiso. Intenta de nuevo." });
    assert.ok(log.mock.calls.length >= 1);
  } finally { log.mock.restore(); }
});

// ── Asignación en General (cabecera del programa) ───────────────────────────
const CAB = { nombre: "Programa X", proveedorId: null, subtitulo: "", dias: 5, noches: 4, moneda: "USD", salidas: "", vigenciaDesde: "", vigenciaHasta: "",
  minPax: 2, maxPax: 10, pctMk: 0.2, pctFeeTarjeta: 0, ninoEdadMax: null, ninoValorServicios: null, edadNinoMin: 2, edadNinoMax: 11, edadInfanteMax: 1,
  textoCondiciones: "", textoCancelacion: "", textoPagos: "", notas: "", highlights: "", desdePrecio: null, tipoTransporte: "ninguno" as const, portadaUrl: "",
  asistenciaMedicaDia: 0, modoPrecio: "categoria", videoUrl: "" };

const ultimaActualizacion = () => sb.registro.filter((x) => x.op === "update" && x.tabla === "programas").at(-1)?.payload as Fila;

test("guardarCabecera asigna UN destino fijo", async () => {
  usar("operaciones", { programas: [{ id: 7, destino_fijo_id: null }] });
  assert.equal((await guardarCabecera(7, { ...CAB, destinoFijoId: 2 })).ok, true);
  assert.equal(ultimaActualizacion().destino_fijo_id, 2);
});

test("guardarCabecera con null quita el destino (programa vuelve a 'falta destino')", async () => {
  usar("operaciones", { programas: [{ id: 7, destino_fijo_id: 2 }] });
  await guardarCabecera(7, { ...CAB, destinoFijoId: null });
  assert.equal(ultimaActualizacion().destino_fijo_id, null);
});

test("guardarCabecera SIN el campo (formulario viejo) NO toca el destino ya asignado", async () => {
  usar("operaciones", { programas: [{ id: 7, destino_fijo_id: 2 }] });
  await guardarCabecera(7, { ...CAB });
  assert.equal("destino_fijo_id" in ultimaActualizacion(), false);
  assert.equal(sb.tablas.programas[0].destino_fijo_id, 2);
});

test("guardarCabecera/crearPrograma rechazan un destino inválido sin escribir", async () => {
  usar("operaciones", { programas: [{ id: 7 }] });
  for (const malo of [0, -3, 1.5, NaN]) {
    assert.deepEqual(await guardarCabecera(7, { ...CAB, destinoFijoId: malo }), { ok: false, error: "Destino inválido." });
    assert.deepEqual(await crearPrograma({ ...CAB, destinoFijoId: malo }), { ok: false, error: "Destino inválido." });
  }
  assert.equal(sb.registro.length, 0);
});

test("crearPrograma sin destino queda sin destino (NO se deduce de la ruta ni se asigna solo)", async () => {
  usar("operaciones", { programas: [] });
  const r = await crearPrograma({ ...CAB });
  assert.equal(r.ok, true);
  assert.equal(sb.registro.find((x) => x.op === "insert")!.payload!.destino_fijo_id, undefined);
  assert.equal(sb.tablas.programas[0].destino_fijo_id, undefined);
});

// ── Acceso público directo a ficha y PDF ────────────────────────────────────
const BASE = { nombre: "Programa X", subtitulo: null, dias: 5, noches: 4, moneda: "USD", pct_mk: 0, pct_fee_tarjeta: 0, asistencia_medica_dia: 0, highlights: [], activo: true, proveedores: null };
const paginas = [
  ["ficha", (id: string) => FichaPage({ params: Promise.resolve({ id }) })],
  ["PDF", (id: string) => DocPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) })],
] as const;

for (const [nombre, abrir] of paginas) {
  const prog = (extra: Fila) => ({ programas: [{ id: 1, ...BASE, ...extra }], programa_destinos_fijos: LISTA });

  test(`${nombre}: público ve un programa publicado CON destino`, async () => {
    usar("anon", prog({ publicado: true, destino_fijo_id: 1, programa_destinos_fijos: LISTA[0] }));
    assert.match(renderToStaticMarkup(await abrir("1")), /Programa X/);
  });

  test(`${nombre}: público recibe 404 si está publicado pero SIN destino`, async () => {
    usar("anon", prog({ publicado: true, destino_fijo_id: null }));
    await assert.rejects(() => abrir("1"), NotFoundError);
  });

  test(`${nombre}: histórico anterior a la 213 (sin columna) también 404 para el público`, async () => {
    usar("anon", prog({ publicado: true }));
    await assert.rejects(() => abrir("1"), NotFoundError);
  });

  test(`${nombre}: borrador con destino sigue siendo 404 para el público`, async () => {
    usar("anon", prog({ publicado: false, destino_fijo_id: 1 }));
    await assert.rejects(() => abrir("1"), NotFoundError);
  });

  for (const rol of ["agencia", "freelance"]) {
    test(`${nombre}: ${rol} (B2B) tampoco abre un programa sin destino por enlace directo`, async () => {
      usar(rol, prog({ publicado: true, destino_fijo_id: null }));
      await assert.rejects(() => abrir("1"), NotFoundError);
    });
  }

  test(`${nombre}: el equipo interno SÍ puede abrir un programa sin destino (revisión)`, async () => {
    usar("operaciones", prog({ publicado: true, destino_fijo_id: null }));
    assert.match(renderToStaticMarkup(await abrir("1")), /Programa X/);
  });
}

// ── Página Listas fijas ─────────────────────────────────────────────────────
test("Listas fijas: pestaña activa, conteo de programas por destino y administración para rol de producto", async () => {
  usar("operaciones", { programa_destinos_fijos: LISTA, programas: [{ id: 1, destino_fijo_id: 1 }, { id: 2, destino_fijo_id: 1 }, { id: 3, destino_fijo_id: null }] });
  const html = renderToStaticMarkup(await ListasFijasPage());
  assert.match(html, /aria-current="page"[^>]*>Listas fijas</);
  assert.match(html, /Lista destino programas/);
  assert.match(html, /Brasil/);
  assert.match(html, /2 programas/);
  assert.match(html, /Sin programas asignados/);
  assert.match(html, /Nuevo destino/);
  assert.match(html, /Renombrar Brasil/);
});

test("Listas fijas: rol sin permiso la ve en solo lectura (sin alta, renombrar ni eliminar)", async () => {
  usar("venta", { programa_destinos_fijos: LISTA, programas: [] });
  const html = renderToStaticMarkup(await ListasFijasPage());
  assert.match(html, /Solo lectura/);
  assert.doesNotMatch(html, /Nuevo destino/);
  assert.doesNotMatch(html, /Renombrar/);
  assert.doesNotMatch(html, /Eliminar/);
});

// ── Página de Programas: aviso, conteo y distintivo ─────────────────────────
const P = (id: number, nombre: string, extra: Fila) => ({ id, nombre, subtitulo: null, dias: 5, noches: 4, moneda: "USD", publicado: true, activo: true, destino_fijo_id: null, proveedores: null, programa_destinos_fijos: null, ...extra });

test("Programas: con 2 activos sin destino muestra el aviso con N=2 y el distintivo 'No visible: falta destino'", async () => {
  usar("operaciones", { programas: [P(1, "Sin A", {}), P(2, "Sin B", {}), P(3, "Con destino", { destino_fijo_id: 1, programa_destinos_fijos: LISTA[0] }), P(4, "Inactivo sin destino", { activo: false })] });
  const html = renderToStaticMarkup(await ProgramasPage());
  assert.match(html, /role="dialog"/);
  assert.match(html, /Faltan 2 programas por asignar destino\. No serán visibles en el tarifario hasta hacerlo\./);
  assert.match(html, /Ver sin destino/);
  assert.match(html, /aria-label="Cerrar aviso"/);
  assert.equal((html.match(/No visible: falta destino/g) ?? []).length, 3, "los 2 activos + el inactivo muestran el distintivo en la lista");
  assert.match(html, /Destino: Brasil/);
});

test("Programas: N=0 no muestra ninguna ventana", async () => {
  usar("operaciones", { programas: [P(1, "Con", { destino_fijo_id: 1, programa_destinos_fijos: LISTA[0] }), P(2, "Inactivo", { activo: false, destino_fijo_id: 2, programa_destinos_fijos: LISTA[1] })] });
  const html = renderToStaticMarkup(await ProgramasPage());
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, /por asignar destino/);
});

test("Programas: sin programas activos sin destino aunque haya inactivos sin destino -> no avisa", async () => {
  usar("operaciones", { programas: [P(1, "Inactivo", { activo: false })] });
  assert.doesNotMatch(renderToStaticMarkup(await ProgramasPage()), /role="dialog"/);
});

test("Programas: el aviso NO se oculta por sesión: cada entrada a la página lo vuelve a mostrar", async () => {
  usar("operaciones", { programas: [P(1, "Sin A", {})] });
  for (let i = 0; i < 3; i++) {
    const html = renderToStaticMarkup(await ProgramasPage());
    assert.match(html, /Falta 1 programa por asignar destino/);
  }
});

test("Programas: el listado interno incluye publicados sin destino (visibles y editables en el panel)", async () => {
  usar("operaciones", { programas: [P(1, "Publicado sin destino", { publicado: true })] });
  const html = renderToStaticMarkup(await ProgramasPage());
  assert.match(html, /Publicado sin destino/);
  assert.match(html, /href="\/dashboard\/producto\/programas\/1"/);
});

// ── Destino PROVISIONAL «Por clasificar»: creación, ambos conteos y flujo provisional → real ────────
test("crearDestinoProvisional crea «Por clasificar» MARCADO como provisional (rol de producto) y revalida", async () => {
  usar("operaciones", { programa_destinos_fijos: [], programas: [] });
  const r = await crearDestinoProvisional();
  assert.equal(r.ok, true);
  assert.deepEqual(sb.tablas.programa_destinos_fijos[0], { id: 500, nombre: "Por clasificar", es_provisional: true });
  assert.ok(__revalidadas().includes("/tarifario"));
});

test("crearDestinoProvisional: solo UNO; el segundo intento se rechaza con mensaje claro", async () => {
  usar("operaciones", { programa_destinos_fijos: [], programas: [] });
  assert.equal((await crearDestinoProvisional()).ok, true);
  const log = mock.method(console, "error", () => {});
  try {
    assert.deepEqual(await crearDestinoProvisional(), { ok: false, error: "Ya existe un destino provisional." });
  } finally { log.mock.restore(); }
  assert.equal(sb.tablas.programa_destinos_fijos.length, 1);
});

test("crearDestinoProvisional: un destino REAL llamado «Por clasificar» lo bloquea (no se confunde por nombre)", async () => {
  usar("operaciones", { programa_destinos_fijos: [{ id: 1, nombre: "Por clasificar" }], programas: [] });
  const log = mock.method(console, "error", () => {});
  try {
    const r = await crearDestinoProvisional();
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /Renómbralo antes de crear el provisional/);
  } finally { log.mock.restore(); }
  assert.equal(sb.tablas.programa_destinos_fijos.length, 1);
  assert.notEqual(sb.tablas.programa_destinos_fijos[0].es_provisional, true);
});

for (const rol of ["venta", "agencia", "freelance", null]) {
  test(`crearDestinoProvisional: rol ${rol} no puede crearlo y no se escribe nada`, async () => {
    usar(rol, { programa_destinos_fijos: [], programas: [] });
    assert.equal((await crearDestinoProvisional()).ok, false);
    assert.deepEqual(sb.registro, []);
  });
}

test("crearDestinoProvisional: un error crudo de la base no llega al usuario", async () => {
  usar("operaciones", { programa_destinos_fijos: [], programas: [] });
  sb.forzar = { tabla: "programa_destinos_fijos", op: "insert", err: { code: "XX000", message: FUGA } };
  const log = mock.method(console, "error", () => {});
  try {
    const r = await crearDestinoProvisional();
    assert.equal(r.ok, false);
    assert.doesNotMatch((r as { error: string }).error, /relation|constraint|SQL|secreto|XX000/i);
    assert.ok(log.mock.calls.some((c) => String(c.arguments[0]).includes(FUGA)));
  } finally { log.mock.restore(); }
});

const PB = { subtitulo: null, dias: 5, noches: 4, moneda: "USD", pct_mk: 0, pct_fee_tarjeta: 0, asistencia_medica_dia: 0, desde_precio: 100,
  incluye_aereo: false, tipo_transporte: "ninguno", portada_url: null, activo: true, publicado: true, proveedores: null, destino_fijo_id: null };
const avisoDe = async () => {
  const html = renderToStaticMarkup(await ProgramasPage());
  return {
    html,
    sinDestino: /Faltan (\d+) programas? por asignar destino|Falta (1) programa por asignar destino/.exec(html)?.slice(1).find(Boolean) ?? null,
    porClasificar: /(\d+) programas? (?:están|está) en «Por clasificar»/.exec(html)?.[1] ?? null,
  };
};
const idsPublicos = async () => (await getProgramasResumen(sb as never, true)).programas.map((p) => p.id).sort();

test("flujo completo: sin destino → provisional → destino real, con ambos conteos y el tarifario público", async () => {
  usar("operaciones", {
    programa_destinos_fijos: [],
    programas: [{ id: 1, nombre: "P1", ...PB }, { id: 2, nombre: "P2", ...PB }, { id: 3, nombre: "P3", ...PB }, { id: 4, nombre: "P4 borrador", ...PB, publicado: false }],
  });

  // 1) Estado de partida: 4 activos sin destino (ocultos). Solo el aviso de «sin destino».
  let a = await avisoDe();
  assert.equal(a.sinDestino, "4");
  assert.equal(a.porClasificar, null);
  assert.doesNotMatch(a.html, /«Por clasificar»/);
  assert.deepEqual(await idsPublicos(), [], "sin destino: ocultos del tarifario público");

  // 2) El usuario crea el provisional y asigna allí todos los programas existentes.
  const prov = await crearDestinoProvisional();
  assert.equal(prov.ok, true);
  const idProv = (prov as { id: number }).id;
  for (const id of [1, 2, 3, 4]) assert.equal((await guardarCabecera(id, { ...CAB, destinoFijoId: idProv })).ok, true);
  a = await avisoDe();
  assert.equal(a.sinDestino, null, "ya no hay programas sin destino: no se muestra ese aviso");
  assert.equal(a.porClasificar, "4");
  assert.doesNotMatch(a.html, /Faltan \d+ programas por asignar destino/);
  assert.deepEqual(await idsPublicos(), [1, 2, 3], "con el provisional los publicados siguen VISIBLES (el borrador 4 no es público)");
  assert.deepEqual(destinosParaFiltro((await getProgramasResumen(sb as never, true)).programas), [], "el filtro público no ofrece el provisional");
  assert.match(a.html, /Por clasificar: visible, falta su destino real/);

  // 3) Crea los destinos reales y reasigna: P1 → Brasil, P2 → Europa. P3 y P4 siguen por clasificar.
  const brasil = await crearDestinoFijo("Brasil");
  const europa = await crearDestinoFijo("Europa");
  assert.equal(brasil.ok && europa.ok, true);
  await guardarCabecera(1, { ...CAB, destinoFijoId: (brasil as { id: number }).id });
  await guardarCabecera(2, { ...CAB, destinoFijoId: (europa as { id: number }).id });
  a = await avisoDe();
  assert.equal(a.sinDestino, null);
  assert.equal(a.porClasificar, "2");
  assert.deepEqual(await idsPublicos(), [1, 2, 3]);
  assert.deepEqual(destinosParaFiltro((await getProgramasResumen(sb as never, true)).programas).map((d) => d.nombre), ["Brasil", "Europa"]);

  // 4) Renombrar el provisional NO cambia que siga siendo el provisional (la marca, no el nombre).
  assert.equal((await renombrarDestinoFijo(idProv, "Pendientes")).ok, true);
  a = await avisoDe();
  assert.equal(a.porClasificar, "2");
  assert.match(a.html, /2 programas están en «Por clasificar»/);

  // 5) Un destino REAL que se llame «Por clasificar» NO cuenta como provisional.
  const falso = await crearDestinoFijo("Por clasificar");
  assert.equal(falso.ok, true);
  await guardarCabecera(3, { ...CAB, destinoFijoId: (falso as { id: number }).id });
  a = await avisoDe();
  assert.equal(a.porClasificar, "1", "solo P4 sigue en el provisional; P3 está en un destino real con ese nombre");
  assert.deepEqual(await idsPublicos(), [1, 2, 3]);
  assert.ok(destinosParaFiltro((await getProgramasResumen(sb as never, true)).programas).some((d) => d.nombre === "Por clasificar"), "un destino real con ese nombre sí se ofrece en el filtro");

  // 6) Se terminan de clasificar: ya no hay ningún aviso.
  await guardarCabecera(4, { ...CAB, destinoFijoId: (brasil as { id: number }).id });
  a = await avisoDe();
  assert.equal(a.sinDestino, null);
  assert.equal(a.porClasificar, null);
  assert.doesNotMatch(a.html, /role="dialog"/);
});

test("ambos avisos a la vez: sin destino y por clasificar se cuentan por separado en la misma ventana", async () => {
  usar("operaciones", {
    programa_destinos_fijos: [{ id: 9, nombre: "Por clasificar", es_provisional: true }],
    programas: [
      { id: 1, nombre: "A", ...PB }, { id: 2, nombre: "B", ...PB },
      { id: 3, nombre: "C", ...PB, destino_fijo_id: 9 }, { id: 4, nombre: "D", ...PB, destino_fijo_id: 9 }, { id: 5, nombre: "E", ...PB, destino_fijo_id: 9 },
      { id: 6, nombre: "inactivo prov", ...PB, activo: false, destino_fijo_id: 9 }, { id: 7, nombre: "inactivo sin", ...PB, activo: false },
    ],
  });
  const a = await avisoDe();
  assert.equal(a.sinDestino, "2");
  assert.equal(a.porClasificar, "3");
  assert.match(a.html, /Faltan 2 programas por asignar destino\. No serán visibles en el tarifario hasta hacerlo\./);
  assert.match(a.html, /3 programas están en «Por clasificar»: son visibles en el tarifario, pero falta asignarles su destino real\./);
});

test("la lista fija muestra el provisional marcado y no ofrece crear otro", async () => {
  usar("operaciones", { programa_destinos_fijos: [{ id: 9, nombre: "Por clasificar", es_provisional: true }, { id: 1, nombre: "Brasil" }], programas: [{ id: 1, destino_fijo_id: 9 }] });
  const html = renderToStaticMarkup(await ListasFijasPage());
  assert.match(html, /Provisional: sus programas son visibles pero falta su destino real/);
  assert.doesNotMatch(html, /Crear destino provisional/);
  usar("operaciones", { programa_destinos_fijos: [{ id: 1, nombre: "Brasil" }], programas: [] });
  assert.match(renderToStaticMarkup(await ListasFijasPage()), /Crear destino provisional/);
  usar("venta", { programa_destinos_fijos: [{ id: 1, nombre: "Brasil" }], programas: [] });
  assert.doesNotMatch(renderToStaticMarkup(await ListasFijasPage()), /Crear destino provisional/, "solo roles de producto");
});
