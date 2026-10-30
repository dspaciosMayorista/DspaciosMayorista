import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { getProgramaDetalle, getProgramasResumen } from "../lib/programas.ts";
import {
  claveDestinoFijo,
  conteosAviso,
  contarProgramasPorClasificar,
  contarProgramasSinDestino,
  destinosParaFiltro,
  esDestinoProvisional,
  ETIQUETA_FALTA_DESTINO,
  mensajePorClasificar,
  limpiarNombreDestinoFijo,
  mensajeFaltanDestinos,
  programaVisibleEnPublico,
  tieneDestinoFijo,
  validarNombreDestinoFijo,
} from "../lib/programas/destinoFijo.ts";

// #23 / migración 213 — destino fijo de programas.

describe("reglas puras", () => {
  test("nombre: recorta, colapsa espacios, valida vacío y largo", () => {
    assert.equal(limpiarNombreDestinoFijo("  Costa   Caribe  "), "Costa Caribe");
    assert.deepEqual(validarNombreDestinoFijo("  Brasil "), { ok: true, nombre: "Brasil" });
    assert.equal(validarNombreDestinoFijo("   ").ok, false);
    assert.equal(validarNombreDestinoFijo(null).ok, false);
    assert.equal(validarNombreDestinoFijo("x".repeat(81)).ok, false);
    assert.equal(validarNombreDestinoFijo("x".repeat(80)).ok, true);
  });

  test("duplicados: misma clave sin importar mayúsculas, tildes ni espacios", () => {
    assert.equal(claveDestinoFijo("Perú"), claveDestinoFijo(" PERU "));
    assert.equal(claveDestinoFijo("Río  de Janeiro"), claveDestinoFijo("rio de janeiro"));
    assert.notEqual(claveDestinoFijo("Brasil"), claveDestinoFijo("Brasilia"));
  });

  test("tieneDestinoFijo: solo ids positivos", () => {
    assert.equal(tieneDestinoFijo({ destino_fijo_id: 3 }), true);
    for (const v of [null, undefined, 0, -1, NaN]) assert.equal(tieneDestinoFijo({ destino_fijo_id: v as number | null }), false);
  });

  test("visibilidad pública: publicado Y destino; borrador con destino y publicado sin destino NO", () => {
    assert.equal(programaVisibleEnPublico({ publicado: true, destino_fijo_id: 1 }), true);
    assert.equal(programaVisibleEnPublico({ publicado: true, destino_fijo_id: null }), false);
    assert.equal(programaVisibleEnPublico({ publicado: true }), false, "histórico sin la columna");
    assert.equal(programaVisibleEnPublico({ publicado: false, destino_fijo_id: 1 }), false);
  });

  test("conteo del aviso: solo ACTIVOS sin destino; N=0 no avisa", () => {
    const l = [
      { activo: true, destino_fijo_id: null },
      { activo: true, destino_fijo_id: null },
      { activo: false, destino_fijo_id: null },
      { activo: true, destino_fijo_id: 4 },
    ];
    assert.equal(contarProgramasSinDestino(l), 2);
    assert.equal(contarProgramasSinDestino([{ activo: true, destino_fijo_id: 1 }]), 0);
    assert.equal(contarProgramasSinDestino([]), 0);
  });

  test("mensaje del aviso", () => {
    assert.equal(mensajeFaltanDestinos(3), "Faltan 3 programas por asignar destino. No serán visibles en el tarifario hasta hacerlo.");
    assert.match(mensajeFaltanDestinos(1), /^Falta 1 programa por asignar destino\./);
    assert.equal(ETIQUETA_FALTA_DESTINO, "No visible: falta destino");
  });

  test("filtro público: destinos fijos únicos y ordenados; ignora programas sin destino", () => {
    const r = destinosParaFiltro([
      { destino: { id: 2, nombre: "Europa" } },
      { destino: null },
      { destino: { id: 1, nombre: "Brasil" } },
      { destino: { id: 2, nombre: "Europa" } },
    ]);
    assert.deepEqual(r, [{ id: 1, nombre: "Brasil" }, { id: 2, nombre: "Europa" }]);
  });
});

// ── Consultas reales de lib/programas.ts contra tablas en memoria ───────────
type Fila = Record<string, unknown>;

function clienteEnMemoria(tablas: Record<string, Fila[]>) {
  const consultas: { tabla: string; filtros: string[] }[] = [];
  const sb = {
    from(tabla: string) {
      const filtros: ((f: Fila) => boolean)[] = [];
      const desc: string[] = [];
      const b = {
        select() { return b; },
        eq(c: string, v: unknown) { filtros.push((f) => f[c] === v); desc.push(`eq:${c}`); return b; },
        in(c: string, v: unknown[]) { filtros.push((f) => v.includes(f[c])); desc.push(`in:${c}`); return b; },
        // PostgREST: .not(col, "is", null) = IS NOT NULL; una columna ausente es NULL.
        not(c: string, op: string, v: unknown) {
          assert.equal(op, "is"); assert.equal(v, null);
          filtros.push((f) => f[c] !== null && f[c] !== undefined); desc.push(`notnull:${c}`); return b;
        },
        order() { return b; },
        maybeSingle: async () => ({ data: (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)))[0] ?? null, error: null }),
        then(res: (v: { data: Fila[]; error: null }) => void) {
          consultas.push({ tabla, filtros: desc });
          res({ data: (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f))), error: null });
        },
      };
      return b;
    },
  };
  return { sb: sb as unknown as SupabaseClient<Database>, consultas };
}

const BASE = { subtitulo: null, dias: 5, noches: 4, moneda: "USD", pct_mk: 0, pct_fee_tarjeta: 0, asistencia_medica_dia: 0, desde_precio: 100, incluye_aereo: false, tipo_transporte: "ninguno", portada_url: null, activo: true };
const BRASIL = { id: 1, nombre: "Brasil" };
const EUROPA = { id: 2, nombre: "Europa" };
const PROGRAMAS: Fila[] = [
  { ...BASE, id: 1, nombre: "A Brasil clásico", publicado: true, destino_fijo_id: 1, programa_destinos_fijos: BRASIL },
  { ...BASE, id: 2, nombre: "B Sin destino publicado", publicado: true, destino_fijo_id: null, programa_destinos_fijos: null },
  { ...BASE, id: 3, nombre: "C Brasil costa", publicado: true, destino_fijo_id: 1, programa_destinos_fijos: BRASIL },
  { ...BASE, id: 4, nombre: "D Europa borrador", publicado: false, destino_fijo_id: 2, programa_destinos_fijos: EUROPA },
  { ...BASE, id: 5, nombre: "E Europa multiciudad", publicado: true, destino_fijo_id: 2, programa_destinos_fijos: EUROPA },
  // Histórico: fila anterior a la 213 (la columna ni siquiera viene).
  { ...BASE, id: 6, nombre: "F Histórico", publicado: true },
];
const CIUDADES: Fila[] = [
  { programa_id: 1, nombre: "Río de Janeiro", orden: 0 }, { programa_id: 1, nombre: "Manaus", orden: 1 },
  { programa_id: 3, nombre: "Salvador", orden: 0 },
  { programa_id: 5, nombre: "París", orden: 0 }, { programa_id: 5, nombre: "Río de Janeiro", orden: 1 }, { programa_id: 5, nombre: "Roma", orden: 2 },
  { programa_id: 2, nombre: "Lima", orden: 0 }, { programa_id: 6, nombre: "Cusco", orden: 0 },
];

describe("getProgramasResumen(): visibilidad pública por destino fijo", () => {
  test("público: solo publicados CON destino; el filtro sale de los destinos fijos y no de las ciudades del circuito", async () => {
    const { sb, consultas } = clienteEnMemoria({ programas: PROGRAMAS, programa_ciudades: CIUDADES });
    const r = await getProgramasResumen(sb, true);
    assert.equal(r.error, null);
    assert.deepEqual(r.programas.map((p) => p.id).sort(), [1, 3, 5], "sin el publicado sin destino (2) ni el histórico (6) ni el borrador (4)");
    assert.ok(consultas[0].filtros.includes("notnull:destino_fijo_id"));
    assert.deepEqual(destinosParaFiltro(r.programas), [BRASIL, EUROPA]);
    // Ninguna ciudad del circuito (ej. “Río de Janeiro”, “Roma”) aparece como destino del filtro.
    assert.ok(!destinosParaFiltro(r.programas).some((d) => ["Río de Janeiro", "Roma", "París", "Manaus"].includes(d.nombre)));
  });

  test("varios programas con el mismo destino comparten una sola entrada de filtro y se encuentran todos", async () => {
    const { sb } = clienteEnMemoria({ programas: PROGRAMAS, programa_ciudades: CIUDADES });
    const { programas } = await getProgramasResumen(sb, true);
    const brasil = programas.filter((p) => p.destino?.id === 1).map((p) => p.id).sort();
    assert.deepEqual(brasil, [1, 3]);
    assert.equal(destinosParaFiltro(programas).filter((d) => d.id === 1).length, 1);
  });

  test("circuito multicidad: un destino fijo; sus ciudades siguen como información, no como destino", async () => {
    const { sb } = clienteEnMemoria({ programas: PROGRAMAS, programa_ciudades: CIUDADES });
    const { programas } = await getProgramasResumen(sb, true);
    const europa = programas.find((p) => p.id === 5)!;
    assert.deepEqual(europa.ciudades, ["París", "Río de Janeiro", "Roma"]);
    assert.deepEqual(europa.destino, EUROPA);
    // Filtrar por “Brasil” NO devuelve el circuito europeo aunque pase por Río de Janeiro.
    assert.deepEqual(programas.filter((p) => p.destino?.id === 1).map((p) => p.id).sort(), [1, 3]);
  });

  test("interno (soloPublicados=false): ve TODO lo activo, incluidos sin destino e históricos, con destino=null", async () => {
    const { sb, consultas } = clienteEnMemoria({ programas: PROGRAMAS, programa_ciudades: CIUDADES });
    const { programas } = await getProgramasResumen(sb, false);
    assert.deepEqual(programas.map((p) => p.id).sort(), [1, 2, 3, 4, 5, 6]);
    assert.ok(!consultas[0].filtros.includes("notnull:destino_fijo_id"));
    assert.equal(programas.find((p) => p.id === 2)!.destino, null);
    assert.equal(programas.find((p) => p.id === 6)!.destino, null, "histórico sin columna");
  });

  test("no cambia precios: el 'Desde' sale igual con o sin destino", async () => {
    // El «Desde» sale de la DOBLE publicable (TASKS #92), no del desde_precio manual de la cabecera.
    const categorias: Fila[] = PROGRAMAS.map((p) => ({ id: (p.id as number) * 10, programa_id: p.id }));
    const precios: Fila[] = categorias.map((c) => ({ categoria_id: c.id, acomodacion: "doble", neto: 100, bajo_solicitud: false }));
    const { sb } = clienteEnMemoria({ programas: PROGRAMAS, programa_ciudades: CIUDADES, programa_categorias: categorias, programa_precios: precios });
    const { programas } = await getProgramasResumen(sb, false);
    assert.equal(programas.length, PROGRAMAS.length);
    for (const p of programas) assert.equal(p.desde_pvp, 100);
  });
});

describe("destino PROVISIONAL «Por clasificar»", () => {
  test("se identifica SOLO por la marca es_provisional, nunca por el nombre", () => {
    assert.equal(esDestinoProvisional({ es_provisional: true }), true);
    assert.equal(esDestinoProvisional({ es_provisional: false }), false);
    assert.equal(esDestinoProvisional(null), false);
    assert.equal(esDestinoProvisional(undefined), false);
    assert.equal(esDestinoProvisional({}), false);
    // Un destino REAL que se llame «Por clasificar» no es el provisional; y el provisional renombrado sigue siéndolo.
    assert.equal(esDestinoProvisional({ nombre: "Por clasificar", es_provisional: false } as never), false);
    assert.equal(esDestinoProvisional({ nombre: "Pendientes", es_provisional: true } as never), true);
  });

  test("los DOS conteos del aviso son independientes y no se suman", () => {
    const l = [
      { activo: true, destino_fijo_id: null },                                   // sin destino (oculto)
      { activo: true, destino_fijo_id: null },                                   // sin destino (oculto)
      { activo: true, destino_fijo_id: 9, destino_es_provisional: true },        // por clasificar (visible)
      { activo: true, destino_fijo_id: 9, destino_es_provisional: true },        // por clasificar (visible)
      { activo: true, destino_fijo_id: 9, destino_es_provisional: true },        // por clasificar (visible)
      { activo: true, destino_fijo_id: 1, destino_es_provisional: false },       // destino real
      { activo: false, destino_fijo_id: null },                                  // inactivo: no cuenta
      { activo: false, destino_fijo_id: 9, destino_es_provisional: true },       // inactivo: no cuenta
    ];
    assert.deepEqual(conteosAviso(l), { sinDestino: 2, porClasificar: 3 });
    assert.equal(contarProgramasSinDestino(l), 2);
    assert.equal(contarProgramasPorClasificar(l), 3);
  });

  test("conteos en cero: ninguno de los dos avisos", () => {
    assert.deepEqual(conteosAviso([]), { sinDestino: 0, porClasificar: 0 });
    assert.deepEqual(conteosAviso([{ activo: true, destino_fijo_id: 1, destino_es_provisional: false }]), { sinDestino: 0, porClasificar: 0 });
  });

  test("un programa SIN destino nunca cuenta como 'por clasificar' aunque traiga la marca por error", () => {
    assert.deepEqual(conteosAviso([{ activo: true, destino_fijo_id: null, destino_es_provisional: true }]), { sinDestino: 1, porClasificar: 0 });
  });

  test("mensaje de por clasificar (singular y plural)", () => {
    assert.equal(mensajePorClasificar(3), "3 programas están en «Por clasificar»: son visibles en el tarifario, pero falta asignarles su destino real.");
    assert.match(mensajePorClasificar(1), /^1 programa está en «Por clasificar»: es visible/);
  });

  test("el filtro público NO ofrece el provisional, pero sí un destino real llamado igual", () => {
    const prov = { id: 9, nombre: "Por clasificar", es_provisional: true };
    const real = { id: 10, nombre: "Por clasificar", es_provisional: false };
    assert.deepEqual(destinosParaFiltro([{ destino: prov }, { destino: { id: 1, nombre: "Brasil" } }]), [{ id: 1, nombre: "Brasil" }]);
    assert.deepEqual(destinosParaFiltro([{ destino: real }]), [{ id: 10, nombre: "Por clasificar" }]);
  });

  test("los programas en el provisional SÍ son visibles en público (tienen destino) y salen en el resumen", async () => {
    const PROV = { id: 9, nombre: "Por clasificar", es_provisional: true };
    const programas: Fila[] = [
      { ...BASE, id: 21, nombre: "P1 en provisional", publicado: true, destino_fijo_id: 9, programa_destinos_fijos: PROV },
      { ...BASE, id: 22, nombre: "P2 real", publicado: true, destino_fijo_id: 1, programa_destinos_fijos: BRASIL },
      { ...BASE, id: 23, nombre: "P3 sin destino", publicado: true, destino_fijo_id: null, programa_destinos_fijos: null },
    ];
    const { sb } = clienteEnMemoria({ programas, programa_ciudades: [] });
    const r = await getProgramasResumen(sb, true);
    assert.deepEqual(r.programas.map((p) => p.id).sort(), [21, 22]);
    assert.equal(r.programas.find((p) => p.id === 21)!.destino!.es_provisional, true);
    assert.deepEqual(destinosParaFiltro(r.programas), [BRASIL], "el filtro solo ofrece Brasil");
    assert.equal(programaVisibleEnPublico((await getProgramaDetalle(sb, 21))!.programa), true);
    assert.equal(programaVisibleEnPublico((await getProgramaDetalle(sb, 23))!.programa), false);
  });
});

describe("getProgramaDetalle(): destinoFijo", () => {
  test("con destino lo expone; histórico/sin destino -> null", async () => {
    const { sb } = clienteEnMemoria({ programas: PROGRAMAS });
    assert.deepEqual((await getProgramaDetalle(sb, 1))!.destinoFijo, BRASIL);
    assert.equal((await getProgramaDetalle(sb, 2))!.destinoFijo, null);
    assert.equal((await getProgramaDetalle(sb, 6))!.destinoFijo, null);
  });

  test("la visibilidad pública de la ficha/PDF sale de la MISMA regla pura", async () => {
    const { sb } = clienteEnMemoria({ programas: PROGRAMAS });
    const visible = async (id: number) => programaVisibleEnPublico((await getProgramaDetalle(sb, id))!.programa);
    assert.equal(await visible(1), true);
    assert.equal(await visible(2), false);
    assert.equal(await visible(4), false);
    assert.equal(await visible(6), false);
  });
});
