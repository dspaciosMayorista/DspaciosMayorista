import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  construirDuplicado,
  construirFilaCandidata,
  construirTarifaDesdeFormulario,
  generarTarifaId,
  puedeEditarPayload,
  puedeEliminar,
  puedeInactivar,
  puedePublicar,
  type EntradaFormularioTarifaUnidad,
  type EstadoTarifaUnidad,
} from "../lib/calc/tarifaAlojamientoEditor.ts";
import type { TarifaAlojamiento } from "../lib/calc/unidadAlojamiento.ts";

// ─────────────────────────────────────────────────────────────────────────
// Editor de dominio de `hotel_tarifas_unidad` (fase 2 Bernalo — Server
// Actions + formulario). Todos los datos son fixtures sintéticos.
// ─────────────────────────────────────────────────────────────────────────

const HOTEL_ID = 42;

function entradaBase(overrides: Partial<EntradaFormularioTarifaUnidad> = {}): EntradaFormularioTarifaUnidad {
  return {
    versionTarifario: "bernalo-2026",
    temporada: "ALTA",
    comisionPct: 20,
    categoria: "Estándar",
    alimentacion: "PAM",
    unidadCobro: "pareja",
    valorBase: 550_000,
    nino: null,
    infante: null,
    periodicidadInfante: null,
    capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
    suplementos: { adultoAdicional: null, personaSola: null, menorAdicionalNino: null, menorAdicionalInfante: null },
    reglasEdad: [],
    fuenteDocumento: null,
    fuentePagina: null,
    ...overrides,
  };
}

// ── generarTarifaId ─────────────────────────────────────────────────────
describe("generarTarifaId", () => {
  test("genera ids distintos en cada llamada", () => {
    const a = generarTarifaId();
    const b = generarTarifaId();
    assert.notEqual(a, b);
  });

  test("es un string no vacío con prefijo estable", () => {
    const id = generarTarifaId();
    assert.equal(typeof id, "string");
    assert.match(id, /^bernalo-/);
  });
});

// ── construcción y validación del payload ───────────────────────────────
describe("construirTarifaDesdeFormulario — construcción y validación", () => {
  test("construye un TarifaAlojamiento válido para una tarifa de pareja", () => {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase());
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.tarifa.id, "t-1");
    assert.equal(r.tarifa.unidadCobro, "pareja");
    assert.equal(r.tarifa.valores.adulto, 550_000);
    assert.equal(r.tarifa.versionTarifario, "bernalo-2026");
    assert.equal(r.tarifa.temporada, "ALTA");
  });

  test("rechaza versión vacía sin llegar siquiera al motor", () => {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase({ versionTarifario: "  " }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /versión/i);
  });

  test("el motor es la autoridad: un valor base negativo se rechaza con el código del motor", () => {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase({ valorBase: -100 }));
    assert.equal(r.ok, false);
  });

  test("temporada/categoría/alimentación vacías no se incluyen como null forzado (se omiten)", () => {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase({ temporada: null, categoria: null, alimentacion: null }));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal("temporada" in r.tarifa, false);
    assert.equal("categoria" in r.tarifa, false);
    assert.equal("alimentacion" in r.tarifa, false);
  });

  test("fuente solo se arma si hay documento; página se ignora sin documento", () => {
    const sinDoc = construirTarifaDesdeFormulario("t-1", entradaBase({ fuenteDocumento: null, fuentePagina: 12 }));
    assert.equal(sinDoc.ok, true);
    if (sinDoc.ok) assert.equal("fuente" in sinDoc.tarifa, false);

    const conDoc = construirTarifaDesdeFormulario("t-1", entradaBase({ fuenteDocumento: "PDF Bernalo", fuentePagina: 12 }));
    assert.equal(conDoc.ok, true);
    if (conDoc.ok) assert.deepEqual(conDoc.tarifa.fuente, { documento: "PDF Bernalo", pagina: 12 });
  });

  test("fail-closed: un rechazo nunca trae `tarifa` en el resultado", () => {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase({ versionTarifario: "" }));
    assert.equal("tarifa" in r, false);
  });
});

// ── compatibilidad por unidad de cobro ──────────────────────────────────
describe("construirTarifaDesdeFormulario — compatibilidad por unidad de cobro", () => {
  test("persona: nunca arma suplementos, aunque el formulario los traiga cargados", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({
        unidadCobro: "persona",
        capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
        suplementos: { adultoAdicional: 10_000, personaSola: 5_000, menorAdicionalNino: 3_000, menorAdicionalInfante: 1_000 },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.tarifa.suplementos, []);
  });

  test("pareja: arma los cuatro tipos de suplemento cuando vienen cargados", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({
        unidadCobro: "pareja",
        suplementos: { adultoAdicional: 80_000, personaSola: 400_000, menorAdicionalNino: 40_000, menorAdicionalInfante: 20_000 },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(
      r.tarifa.suplementos.map((s) => s.tipo).sort(),
      ["adulto_adicional", "menor_adicional", "menor_adicional", "persona_sola"].sort()
    );
  });

  test("habitación: persona_sola se ignora aunque el formulario la traiga (no es compatible)", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({
        unidadCobro: "habitacion",
        capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 2 },
        suplementos: { adultoAdicional: 50_000, personaSola: 300_000, menorAdicionalNino: null, menorAdicionalInfante: null },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.tarifa.suplementos.some((s) => s.tipo === "persona_sola"), false);
    assert.equal(r.tarifa.suplementos.some((s) => s.tipo === "adulto_adicional"), true);
  });

  test("apartamento: mismo criterio que habitación (sin persona_sola)", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({
        unidadCobro: "apartamento",
        capacidad: { minPax: 1, maxPax: 6, paxIncluidos: 6 },
        suplementos: { adultoAdicional: null, personaSola: 999_999, menorAdicionalNino: 30_000, menorAdicionalInfante: null },
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.tarifa.suplementos.some((s) => s.tipo === "persona_sola"), false);
    assert.equal(r.tarifa.suplementos.some((s) => s.tipo === "menor_adicional"), true);
  });

  test("capacidad estructural: persona fuerza paxIncluidos=0 y pareja fuerza paxIncluidos=2, sin importar lo capturado", () => {
    const persona = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ unidadCobro: "persona", capacidad: { minPax: 1, maxPax: null, paxIncluidos: 99 } })
    );
    assert.equal(persona.ok, true);
    if (persona.ok) assert.equal(persona.tarifa.capacidad.paxIncluidos, 0);

    const pareja = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ unidadCobro: "pareja", capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 99 } })
    );
    assert.equal(pareja.ok, true);
    if (pareja.ok) assert.equal(pareja.tarifa.capacidad.paxIncluidos, 2);
  });

  test("habitación conserva el paxIncluidos capturado (no es un valor estructural fijo)", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ unidadCobro: "habitacion", capacidad: { minPax: 1, maxPax: 4, paxIncluidos: 3 } })
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.tarifa.capacidad.paxIncluidos, 3);
  });

  test("valores.nino/infante solo se arman para persona, nunca para pareja/habitación/apartamento", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ unidadCobro: "pareja", nino: 70_000, infante: 30_000, periodicidadInfante: "por_noche" })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal("nino" in r.tarifa.valores, false);
    assert.equal("infante" in r.tarifa.valores, false);
  });
});

// ── reglas de menores y periodicidad ─────────────────────────────────────
describe("construirTarifaDesdeFormulario — reglas de menores y periodicidad", () => {
  test("infante configurado sin periodicidad → el motor rechaza (no se asume una interpretación)", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ unidadCobro: "persona", capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 }, infante: 30_000, periodicidadInfante: null })
    );
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /periodicidadInfante/);
  });

  test("control positivo: infante con periodicidad explícita adapta y la conserva", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({
        unidadCobro: "persona",
        capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
        nino: 70_000,
        infante: 30_000,
        periodicidadInfante: "por_noche",
        reglasEdad: [
          { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
          { categoria: "nino", edadMinAnios: 4, edadMaxAnios: 10 },
          { categoria: "adulto", edadMinAnios: 11, edadMaxAnios: 17 },
        ],
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.tarifa.valores, { adulto: 550_000, nino: 70_000, infante: 30_000, periodicidadInfante: "por_noche" });
    assert.equal(r.tarifa.reglaMenores.reglas.length, 3);
  });

  test("regla de edad invertida (mín > máx) la rechaza el motor", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ reglasEdad: [{ categoria: "nino", edadMinAnios: 10, edadMaxAnios: 4 }] })
    );
    assert.equal(r.ok, false);
  });

  test("reglas de edad que se superponen las rechaza `construirFilaCandidata` (vía el adaptador)", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({
        unidadCobro: "persona",
        capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
        nino: 70_000,
        reglasEdad: [
          { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
          { categoria: "nino", edadMinAnios: 3, edadMaxAnios: 10 },
        ],
      })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const candidata = construirFilaCandidata(HOTEL_ID, r.tarifa, "borrador");
    assert.equal(candidata.ok, false);
    if (candidata.ok) return;
    assert.match(candidata.error, /superpon/);
  });

  test("sin reglas de menores (hotel de pareja) construye igual", () => {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase({ reglasEdad: [] }));
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.tarifa.reglaMenores.reglas, []);
  });
});

// ── campos numéricos obligatorios: NaN nunca se convierte en 0/1 comercial ──
// `construirTarifaDesdeFormulario` no sabe de dónde vienen los números — el
// que podía "disfrazar vacío de cero" era `TarifasUnidadEditor.tsx`
// (`Number(f.valorBase) || 0`, etc.). Un `.tsx` con JSX no se puede importar
// en `node --test` (el strip-types de Node no transforma JSX), así que la
// cobertura de ese archivo es en dos capas: (1) por texto fuente, en el
// describe de cableado más abajo, que verifica que el componente use
// `numRequerido` y NO el patrón `Number(...) || 0/1`; (2) aquí, el extremo
// que SÍ es puramente funcional: si a este motor le llega `NaN` (lo que
// produce `numRequerido` con un campo vacío), nunca debe colarse como si
// fuera un valor comercial válido.
describe("construirTarifaDesdeFormulario — NaN nunca pasa como valor comercial", () => {
  test("valorBase en NaN (campo obligatorio vacío) se rechaza", () => {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase({ valorBase: NaN }));
    assert.equal(r.ok, false);
  });

  test("capacidad.minPax en NaN se rechaza", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ unidadCobro: "habitacion", capacidad: { minPax: NaN, maxPax: 4, paxIncluidos: 2 } })
    );
    assert.equal(r.ok, false);
  });

  test("capacidad.paxIncluidos en NaN se rechaza (habitación/apartamento: campo real, no estructural)", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ unidadCobro: "habitacion", capacidad: { minPax: 1, maxPax: 4, paxIncluidos: NaN } })
    );
    assert.equal(r.ok, false);
  });

  test("una regla de edad con edadMinAnios/edadMaxAnios en NaN se rechaza", () => {
    const r = construirTarifaDesdeFormulario(
      "t-1",
      entradaBase({ reglasEdad: [{ categoria: "nino", edadMinAnios: NaN, edadMaxAnios: 10 }] })
    );
    assert.equal(r.ok, false);
  });
});

// ── construirFilaCandidata: coherencia payload↔columnas y ausencia de fechas ──
describe("construirFilaCandidata", () => {
  function tarifaValida(): TarifaAlojamiento {
    const r = construirTarifaDesdeFormulario("t-1", entradaBase());
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("fixture inválido");
    return r.tarifa;
  }

  test("arma una fila coherente y aceptada por el adaptador", () => {
    const r = construirFilaCandidata(HOTEL_ID, tarifaValida(), "borrador");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.fila.hotel_id, HOTEL_ID);
    assert.equal(r.fila.tarifa_id, "t-1");
    assert.equal(r.fila.version_tarifario, "bernalo-2026");
    assert.equal(r.fila.estado, "borrador");
    assert.deepEqual(r.fila.payload, tarifaValida());
  });

  test("la fila candidata no tiene columnas de fecha (no existen en hotel_tarifas_unidad)", () => {
    const r = construirFilaCandidata(HOTEL_ID, tarifaValida(), "publicada");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal("fecha_desde" in r.fila, false);
    assert.equal("fecha_hasta" in r.fila, false);
  });

  test("las columnas espejo (temporada/categoría/alimentación) coinciden con el payload", () => {
    const r = construirFilaCandidata(HOTEL_ID, tarifaValida(), "borrador");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.fila.temporada, r.fila.payload.temporada);
    assert.equal(r.fila.categoria, r.fila.payload.categoria);
    assert.equal(r.fila.alimentacion, r.fila.payload.alimentacion);
  });

  test("fail-closed: si el adaptador rechaza, no se devuelve ninguna `fila`", () => {
    const tarifaSolapada: TarifaAlojamiento = {
      id: "t-solapada",
      unidadCobro: "persona",
      comisionPct: 0,
      valores: { adulto: 100_000 },
      capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
      suplementos: [],
      reglaMenores: {
        reglas: [
          { categoria: "nino", edadMinAnios: 0, edadMaxAnios: 10 },
          { categoria: "infante", edadMinAnios: 5, edadMaxAnios: 6 },
        ],
      },
      versionTarifario: "bernalo-2026",
    };
    const r = construirFilaCandidata(HOTEL_ID, tarifaSolapada, "borrador");
    assert.equal(r.ok, false);
    assert.equal("fila" in r, false);
  });
});

// ── identidad estable al duplicar versión ────────────────────────────────
describe("construirDuplicado — identidad estable", () => {
  function origen(): TarifaAlojamiento {
    return {
      id: "t-estable",
      unidadCobro: "pareja",
      comisionPct: 15,
      valores: { adulto: 500_000 },
      capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
      suplementos: [],
      reglaMenores: { reglas: [] },
      versionTarifario: "v1",
    };
  }

  test("conserva `id` (tarifa_id) tal cual", () => {
    const r = construirDuplicado(origen(), "v2");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.tarifa.id, "t-estable");
    assert.equal(r.tarifa.versionTarifario, "v2");
  });

  test("conserva comisionPct al duplicar como nueva versión", () => {
    const r = construirDuplicado(origen(), "v2");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.tarifa.comisionPct, 15);
  });

  test("no muta el objeto origen", () => {
    const o = origen();
    construirDuplicado(o, "v2");
    assert.equal(o.versionTarifario, "v1");
  });

  test("rechaza una versión igual a la que se está duplicando", () => {
    const r = construirDuplicado(origen(), "v1");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /distinta/);
  });

  test("rechaza una versión vacía", () => {
    const r = construirDuplicado(origen(), "   ");
    assert.equal(r.ok, false);
  });

  test("el resto de la tarifa se clona textual (mismo valor base, capacidad, etc.)", () => {
    const r = construirDuplicado(origen(), "v2");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.tarifa.valores.adulto, 500_000);
    assert.deepEqual(r.tarifa.capacidad, { minPax: 2, maxPax: 2, paxIncluidos: 2 });
  });

  test("dos duplicados de la MISMA tarifa producen filas con igual tarifa_id y versiones distintas", () => {
    const a = construirFilaCandidata(HOTEL_ID, origen(), "publicada");
    assert.equal(a.ok, true);
    const dupA = construirDuplicado(origen(), "v2");
    assert.equal(dupA.ok, true);
    if (!dupA.ok || !a.ok) return;
    const filaDup = construirFilaCandidata(HOTEL_ID, dupA.tarifa, "borrador");
    assert.equal(filaDup.ok, true);
    if (!filaDup.ok) return;
    assert.equal(filaDup.fila.tarifa_id, a.fila.tarifa_id);
    assert.notEqual(filaDup.fila.version_tarifario, a.fila.version_tarifario);
  });
});

// ── imposibilidad de editar/eliminar una publicada ───────────────────────
describe("máquina de estados — publicada solo pasa a inactiva", () => {
  const estados: EstadoTarifaUnidad[] = ["borrador", "publicada", "inactiva"];

  test("solo un borrador se puede editar", () => {
    assert.deepEqual(
      estados.filter((e) => puedeEditarPayload(e)),
      ["borrador"]
    );
  });

  test("solo un borrador se puede eliminar", () => {
    assert.deepEqual(
      estados.filter((e) => puedeEliminar(e)),
      ["borrador"]
    );
  });

  test("solo un borrador se puede publicar", () => {
    assert.deepEqual(
      estados.filter((e) => puedePublicar(e)),
      ["borrador"]
    );
  });

  test("SOLO una publicada se puede inactivar (ni borrador ni inactiva)", () => {
    assert.deepEqual(
      estados.filter((e) => puedeInactivar(e)),
      ["publicada"]
    );
    assert.equal(puedeInactivar("publicada"), true);
    assert.equal(puedeInactivar("borrador"), false);
    assert.equal(puedeInactivar("inactiva"), false);
  });

  test("una publicada nunca puede editarse ni eliminarse", () => {
    assert.equal(puedeEditarPayload("publicada"), false);
    assert.equal(puedeEliminar("publicada"), false);
  });

  test("una inactiva nunca puede editarse, eliminarse, publicarse ni volver a inactivarse", () => {
    assert.equal(puedeEditarPayload("inactiva"), false);
    assert.equal(puedeEliminar("inactiva"), false);
    assert.equal(puedePublicar("inactiva"), false);
    assert.equal(puedeInactivar("inactiva"), false);
  });

  test("borrador: editar/eliminar/publicar; publicada: solo inactivar; inactiva: ninguna transición (solo duplicar, fuera de esta máquina)", () => {
    assert.deepEqual(
      { editar: puedeEditarPayload("borrador"), eliminar: puedeEliminar("borrador"), publicar: puedePublicar("borrador"), inactivar: puedeInactivar("borrador") },
      { editar: true, eliminar: true, publicar: true, inactivar: false }
    );
    assert.deepEqual(
      { editar: puedeEditarPayload("publicada"), eliminar: puedeEliminar("publicada"), publicar: puedePublicar("publicada"), inactivar: puedeInactivar("publicada") },
      { editar: false, eliminar: false, publicar: false, inactivar: true }
    );
    assert.deepEqual(
      { editar: puedeEditarPayload("inactiva"), eliminar: puedeEliminar("inactiva"), publicar: puedePublicar("inactiva"), inactivar: puedeInactivar("inactiva") },
      { editar: false, eliminar: false, publicar: false, inactivar: false }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cableado: sin fechas propias, sin integración comercial, y ahora también
// la máquina de estados y la validación de clasificación contra el catálogo
// del hotel. Se verifica leyendo el CÓDIGO FUENTE (mismo criterio que
// `pruebas/tarifaAlojamientoPersistida.test.ts` y
// `pruebas/documentosContrato.wiring.test.ts`) para lo que no se puede
// ejecutar en `node --test` sin infraestructura real:
//   · Las Server Actions llaman `next/headers` (`cookies()`) al crear el
//     cliente de Supabase — no corren fuera de una request de Next.
//   · `TarifasUnidadEditor.tsx` tiene JSX: el strip-types de Node no lo
//     transforma, así que un `.tsx` con JSX no se puede `import`ar aquí.
// Por eso estas pruebas afirman el CABLEADO (qué se llama, en qué orden, con
// qué filtros) en vez de ejecutar la acción real contra una base.
// ─────────────────────────────────────────────────────────────────────────
describe("cableado — sin fechas propias y sin integración comercial", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

  const sinComentarios = (fuente: string) =>
    fuente
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((linea) => !/^\s*(\/\/|--)/.test(linea))
      .join("\n");

  const ARCHIVOS = {
    editor: "lib/calc/tarifaAlojamientoEditor.ts",
    acciones: "app/(dashboard)/dashboard/producto/hoteles/[id]/tarifasUnidadActions.ts",
    componente: "app/(dashboard)/dashboard/producto/hoteles/[id]/TarifasUnidadEditor.tsx",
    pagina: "app/(dashboard)/dashboard/producto/hoteles/[id]/page.tsx",
  };

  const fuentes = Object.fromEntries(
    Object.entries(ARCHIVOS).map(([k, rel]) => [k, sinComentarios(leer(rel))])
  ) as Record<keyof typeof ARCHIVOS, string>;

  // Extrae el cuerpo de una función con nombre `export async function NOMBRE`
  // (o `async function NOMBRE` para los helpers no exportados), desde su
  // declaración hasta el primer `\n}\n` que la cierra a nivel de columna 0.
  function cuerpoDeFuncion(fuente: string, nombre: string): string {
    const marcador = fuente.includes(`export async function ${nombre}`)
      ? `export async function ${nombre}`
      : `async function ${nombre}(`;
    const inicio = fuente.indexOf(marcador);
    assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
    const resto = fuente.slice(inicio);
    const fin = resto.indexOf("\n}\n");
    assert.notEqual(fin, -1, `no se encontró el cierre de ${nombre}`);
    return resto.slice(0, fin + 3);
  }

  test("el editor de dominio no consulta Supabase ni hace I/O de red", () => {
    assert.doesNotMatch(fuentes.editor, /supabase/i);
    assert.doesNotMatch(fuentes.editor, /createClient|service_role|createAdminClient/i);
    assert.doesNotMatch(fuentes.editor, /\bfetch\s*\(/);
  });

  test("las Server Actions usan el cliente de SESIÓN, nunca un cliente admin", () => {
    assert.match(fuentes.acciones, /from "@\/lib\/supabase\/server"/);
    assert.doesNotMatch(fuentes.acciones, /createAdminClient/i);
    assert.doesNotMatch(fuentes.acciones, /service_role/i);
  });

  test("ningún archivo de esta fase importa reservar, tarifario, cotizaciones, contratos, costos ni CxP", () => {
    const prohibidos = ["reservar", "tarifario", "cotizacion", "contrato", "costos", "cuentas_por_pagar", "cxp"];
    for (const fuente of Object.values(fuentes)) {
      for (const modulo of prohibidos) {
        // Límite de palabra: evita falsos positivos con archivos propios de
        // esta fase cuyo nombre CONTIENE la palabra por coincidencia léxica
        // (ej. "ModeloTarifarioEditor" — es el selector de modelo tarifario
        // del hotel, no una importación del módulo público `tarifario`).
        assert.doesNotMatch(fuente, new RegExp(`from ["'][^"']*\\b${modulo}\\b`, "i"));
      }
    }
  });

  test("las Server Actions nunca leen ni escriben tarifa_hotel, ventas, contrato_* ni cuentas_por_pagar", () => {
    const tablasProhibidas = ["tarifa_hotel", "ventas", "contrato_", "cuentas_por_pagar"];
    for (const tabla of tablasProhibidas) {
      assert.doesNotMatch(fuentes.acciones, new RegExp(`from\\("${tabla}`, "i"));
    }
  });

  test("ningún archivo de producción de esta fase menciona fecha_desde/fecha_hasta (esas columnas no existen en hotel_tarifas_unidad)", () => {
    for (const [nombre, fuente] of Object.entries(fuentes)) {
      assert.doesNotMatch(fuente, /fecha_desde|fecha_hasta|fechaDesde|fechaHasta/i, `${nombre} todavía menciona fecha_desde/fecha_hasta`);
    }
  });

  test("el formulario del componente no tiene ningún input de tipo fecha", () => {
    assert.doesNotMatch(fuentes.componente, /type=["']date["']/);
  });

  test("la temporada se toma de una lista (hotel_temporadas ya cargadas), nunca se crea ni edita desde aquí", () => {
    for (const fuente of Object.values(fuentes)) {
      assert.doesNotMatch(fuente, /from\("hotel_temporadas["']?\s*\)\s*\.\s*(insert|update|delete|upsert)/i);
    }
  });

  test("updated_at se fija explícitamente en cada escritura de edición/estado", () => {
    for (const nombre of ["actualizarTarifaUnidadBorrador", "publicarTarifaUnidad", "inactivarTarifaUnidad"]) {
      assert.match(cuerpoDeFuncion(fuentes.acciones, nombre), /updated_at:\s*new Date\(\)\.toISOString\(\)/);
    }
  });

  // ── Máquina de estados en las Server Actions ──────────────────────────
  test("actualizar/eliminar/publicar filtran exactamente .eq(\"estado\", \"borrador\") antes de escribir", () => {
    for (const nombre of ["actualizarTarifaUnidadBorrador", "eliminarTarifaUnidadBorrador", "publicarTarifaUnidad"]) {
      assert.match(cuerpoDeFuncion(fuentes.acciones, nombre), /\.eq\("estado", "borrador"\)/, `${nombre} debe filtrar por estado "borrador"`);
    }
  });

  test('inactivar filtra exactamente .eq("estado", "publicada") y NUNCA usa .neq(...)', () => {
    const cuerpo = cuerpoDeFuncion(fuentes.acciones, "inactivarTarifaUnidad");
    assert.match(cuerpo, /\.eq\("estado", "publicada"\)/);
    assert.doesNotMatch(cuerpo, /\.neq\(/);
  });

  // ── Validación de clasificación contra el catálogo del hotel ──────────
  test("crear/actualizar/publicar llaman a validarClasificacionHotel y cortan ANTES de insertar/actualizar si falla", () => {
    for (const nombre of ["crearTarifaUnidadBorrador", "actualizarTarifaUnidadBorrador", "publicarTarifaUnidad"]) {
      const cuerpo = cuerpoDeFuncion(fuentes.acciones, nombre);
      const idxValidacion = cuerpo.indexOf("validarClasificacionHotel(");
      assert.notEqual(idxValidacion, -1, `${nombre} no llama a validarClasificacionHotel`);
      const idxCorte = cuerpo.indexOf("if (!clasificacion.ok) return clasificacion;");
      assert.notEqual(idxCorte, -1, `${nombre} no corta con fail-closed si la clasificación no es válida`);
      assert.ok(idxCorte > idxValidacion, `${nombre}: el corte debe ir después de llamar a validarClasificacionHotel`);
      const idxEscritura = Math.max(cuerpo.indexOf(".insert("), cuerpo.indexOf(".update("));
      assert.ok(idxEscritura === -1 || idxCorte < idxEscritura, `${nombre}: la validación debe resolverse antes de insert/update`);
    }
  });

  test("publicar valida la clasificación de la tarifa YA GUARDADA (el catálogo del hotel pudo cambiar desde el borrador)", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.acciones, "publicarTarifaUnidad");
    assert.match(cuerpo, /validarClasificacionHotel\(sb, hotelId, clasificacionDeTarifa\(actual\.adaptada\.tarifa\)\)/);
  });

  test("eliminar y duplicar NO validan clasificación (fuera del alcance pedido: solo crear/actualizar/publicar)", () => {
    for (const nombre of ["eliminarTarifaUnidadBorrador", "duplicarTarifaUnidadVersion"]) {
      assert.doesNotMatch(cuerpoDeFuncion(fuentes.acciones, nombre), /validarClasificacionHotel\(/);
    }
  });

  test("la clasificación se valida contra las tablas del hotel correctas, filtradas por hotel_id (no por otro hotel)", () => {
    assert.match(fuentes.acciones, /from\("hotel_temporadas"\)[\s\S]*?\.eq\("hotel_id", hotelId\)/);
    assert.match(fuentes.acciones, /from\("hotel_categorias"\)[\s\S]*?\.eq\("hotel_id", hotelId\)/);
    assert.match(fuentes.acciones, /from\("hotel_regimenes"\)[\s\S]*?\.eq\("hotel_id", hotelId\)/);
    assert.match(fuentes.acciones, /from\("categorias_habitacion"\)/);
    assert.match(fuentes.acciones, /from\("planes_alimentacion"\)/);
  });

  test("un error de Supabase o una fila ausente en la validación de clasificación SIEMPRE produce un mensaje, nunca 'seguir de largo'", () => {
    for (const nombre of ["verificarTemporada", "verificarCategoria", "verificarAlimentacion"]) {
      const cuerpo = cuerpoDeFuncion(fuentes.acciones, nombre);
      // Debe haber al menos un `if (error...)` seguido de un `return` con texto,
      // y al menos un `if (!dato)`/`if (!catalogo/enlace)` también con `return`.
      assert.match(cuerpo, /if\s*\(error/);
      assert.match(cuerpo, /return\s*["'`]No se pudo validar/);
      assert.match(cuerpo, /return\s*`/); // el mensaje de "no existe"/"no está asignada"
    }
  });

  test("las tres consultas de clasificación (temporada/categoría/alimentación) solo usan el `sb` recibido — nunca crean otro cliente", () => {
    for (const nombre of ["verificarTemporada", "verificarCategoria", "verificarAlimentacion"]) {
      const cuerpo = cuerpoDeFuncion(fuentes.acciones, nombre);
      assert.doesNotMatch(cuerpo, /createClient\(\)/);
      assert.doesNotMatch(cuerpo, /createAdminClient/i);
      // "sb" seguido de ".from(...)" — puede haber salto de línea/indentación
      // entre medio (estilo de encadenado que ya usa este archivo).
      assert.match(cuerpo, /\bsb[\s\r\n]*\.\s*from\(/);
    }
  });

  test("validarClasificacionHotel no crea ningún cliente propio — solo reenvía el `sb` recibido a las tres consultas", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.acciones, "validarClasificacionHotel");
    assert.doesNotMatch(cuerpo, /createClient\(\)/);
    assert.doesNotMatch(cuerpo, /createAdminClient/i);
    assert.match(cuerpo, /verificarTemporada\(sb,/);
    assert.match(cuerpo, /verificarCategoria\(sb,/);
    assert.match(cuerpo, /verificarAlimentacion\(sb,/);
  });

  test("verificarTemporada usa una consulta de existencia con limit(1), no maybeSingle — hotel_temporadas puede tener varias filas con el mismo nombre", () => {
    const cuerpo = cuerpoDeFuncion(fuentes.acciones, "verificarTemporada");
    assert.match(cuerpo, /\.eq\("hotel_id", hotelId\)/);
    assert.match(cuerpo, /\.eq\("nombre", nombre\)/);
    assert.match(cuerpo, /\.limit\(1\)/);
    assert.doesNotMatch(cuerpo, /\.maybeSingle\(\)/);
    // La comprobación de "existe al menos una fila" debe mirar el arreglo
    // completo (longitud), no asumir 0 o 1 resultado.
    assert.match(cuerpo, /data\.length\s*===\s*0/);
  });

  test("temporadasNombres en page.tsx queda deduplicado con Set antes de llegar al selector del editor", () => {
    assert.match(fuentes.pagina, /const temporadasNombres = Array\.from\(\s*new Set\(/);
  });

  // ── Identidad global (fix 5): unique (tarifa_id, version_tarifario) ──
  // Se lee el archivo SIN pasar por `sinComentarios`: lo que se verifica es
  // justamente el texto del comentario (la unique real vive en la migración
  // 173, este archivo solo la describe para quien lo lea).
  test("los comentarios de identidad ya NO describen una unique con hotel_id (la migración 173 es global)", () => {
    const fuenteCruda = leer(ARCHIVOS.editor);
    assert.doesNotMatch(fuenteCruda, /unique\s*\(\s*hotel_id,\s*tarifa_id,\s*version_tarifario\s*\)/i);
    assert.match(fuenteCruda, /tarifa_id,\s*version_tarifario/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sin defaults numéricos silenciosos en `TarifasUnidadEditor.tsx`
// (`aEntradaFormulario`). No se puede `import`ar el `.tsx` en `node --test`
// (JSX), así que se verifica por texto fuente que usa `numRequerido` (nunca
// `Number(...) || 0/1`), y se comprueba el COMPORTAMIENTO de esa misma
// implementación reconstruida aquí — atada a la fuente real por la
// aserción de texto exacto de arriba, no una copia que pueda divergir sin
// que la prueba se entere.
// ─────────────────────────────────────────────────────────────────────────
describe("TarifasUnidadEditor.tsx — sin defaults numéricos silenciosos", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fuenteComponente = readFileSync(
    join(raiz, "app/(dashboard)/dashboard/producto/hoteles/[id]/TarifasUnidadEditor.tsx"),
    "utf8"
  );

  test("numRequerido está definido exactamente con la semántica vacío→NaN (nunca vacío→0)", () => {
    assert.match(
      fuenteComponente,
      /const numRequerido = \(s: string\): number => \(s\.trim\(\) === "" \? NaN : Number\(s\)\);/
    );
  });

  test("ningún campo obligatorio usa `Number(...) || 0` / `|| 1` como respaldo silencioso", () => {
    for (const patron of [
      /Number\(f\.valorBase\)\s*\|\|\s*0/,
      /Number\(f\.minPax\)\s*\|\|\s*1/,
      /Number\(f\.paxIncluidos\)\s*\|\|\s*0/,
      /Number\(r\.edadMinAnios\)\s*\|\|\s*0/,
      /Number\(r\.edadMaxAnios\)\s*\|\|\s*0/,
    ]) {
      assert.doesNotMatch(fuenteComponente, patron);
    }
  });

  test("los seis campos obligatorios (incluida la comisión, ronda 8) pasan por numRequerido", () => {
    for (const patron of [
      /valorBase:\s*numRequerido\(f\.valorBase\)/,
      /comisionPct:\s*numRequerido\(f\.comisionPct\)/,
      /minPax:\s*numRequerido\(f\.minPax\)/,
      /paxIncluidos:\s*numRequerido\(f\.paxIncluidos\)/,
      /edadMinAnios:\s*numRequerido\(r\.edadMinAnios\)/,
      /edadMaxAnios:\s*numRequerido\(r\.edadMaxAnios\)/,
    ]) {
      assert.match(fuenteComponente, patron);
    }
  });

  test("comportamiento: un campo vacío da NaN, nunca 0/1; un '0' explícito sigue siendo 0", () => {
    // Réplica EXACTA de la implementación cuya presencia en el archivo real
    // ya se verificó por texto arriba — no es una copia que pueda divergir
    // en silencio, porque la prueba de texto fallaría primero si cambiara.
    const numRequerido = (s: string): number => (s.trim() === "" ? NaN : Number(s));
    assert.ok(Number.isNaN(numRequerido("")));
    assert.ok(Number.isNaN(numRequerido("   ")));
    assert.ok(Number.isNaN(numRequerido("abc")));
    assert.equal(numRequerido("0"), 0);
    assert.equal(numRequerido("5"), 5);
    assert.equal(numRequerido("-3"), -3);
  });

  test("el desplazamiento al editar usa scrollIntoView sobre un ref, no window.scrollTo({ top: 0 })", () => {
    assert.doesNotMatch(fuenteComponente, /window\.scrollTo\(\{\s*top:\s*0/);
    assert.match(fuenteComponente, /formRef\.current\?\.scrollIntoView\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Comisión Bernalo (ronda 8) — cableado del formulario/tabla/detalle/
// simulador. El componente NUNCA calcula la comisión: solo la captura (form),
// la muestra (tabla/detalle) o la reenvía al motor real (simulador).
// ─────────────────────────────────────────────────────────────────────────
describe("TarifasUnidadEditor.tsx — comisión (ronda 8): captura, conserva, muestra, nunca la calcula", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fuenteComponente = readFileSync(
    join(raiz, "app/(dashboard)/dashboard/producto/hoteles/[id]/TarifasUnidadEditor.tsx"),
    "utf8"
  );

  // Copia local (el `cuerpoDeFuncion` del describe de arriba solo reconoce
  // `(export )?async function NOMBRE` — `SimuladorCalculo` no es async ni se
  // exporta). Mismo criterio tolerante a CRLF que el resto del archivo.
  function cuerpoDeFuncion(fuente: string, nombre: string): string {
    const patrones = [
      new RegExp(`export\\s+async\\s+function\\s+${nombre}\\s*\\(`),
      new RegExp(`async\\s+function\\s+${nombre}\\s*\\(`),
      new RegExp(`export\\s+function\\s+${nombre}\\s*\\(`),
      new RegExp(`function\\s+${nombre}\\s*\\(`),
    ];
    let inicio = -1;
    for (const p of patrones) {
      const m = fuente.match(p);
      if (m && m.index != null) { inicio = m.index; break; }
    }
    assert.notEqual(inicio, -1, `no se encontró la función ${nombre}`);
    const cierreMatch = fuente.slice(inicio).match(/\r?\n\}\r?\n/);
    assert.notEqual(cierreMatch, null, `no se encontró el cierre de ${nombre}`);
    return fuente.slice(inicio, inicio + (cierreMatch!.index ?? 0));
  }

  test("aFormState precarga comisionPct al editar (String(t.comisionPct)) — la edición conserva la comisión existente", () => {
    assert.match(fuenteComponente, /comisionPct:\s*String\(t\.comisionPct\)/);
  });

  test("aEntradaFormulario reenvía comisionPct vía numRequerido — vacío nunca se convierte en 0", () => {
    assert.match(fuenteComponente, /comisionPct:\s*numRequerido\(f\.comisionPct\)/);
  });

  test("guardar() rechaza un campo de comisión vacío ANTES de construir la entrada, con mensaje explícito", () => {
    const posGuardia = fuenteComponente.search(/if \(!form\.comisionPct\.trim\(\)\)/);
    const posInput = fuenteComponente.search(/const input = aEntradaFormulario\(form\)/);
    assert.notEqual(posGuardia, -1);
    assert.ok(posGuardia < posInput, "la guardia de comisión vacía debe correr antes de construir la entrada");
  });

  test("hay un campo 'Comisión (%)' junto a la temporada en el formulario", () => {
    const posTemporada = fuenteComponente.search(/Temporada <span/);
    const posComision = fuenteComponente.search(/Comisión \(%\)/);
    assert.notEqual(posTemporada, -1);
    assert.notEqual(posComision, -1);
    // A pocos caracteres de distancia: son campos consecutivos del mismo bloque.
    assert.ok(Math.abs(posComision - posTemporada) < 700, "el campo de comisión debe estar junto al de temporada");
  });

  test("la tabla principal y el detalle muestran la comisión de cada tarifa", () => {
    assert.match(fuenteComponente, /<th className="px-3 py-2 text-right">Comisión<\/th>/);
    assert.match(fuenteComponente, /\{f\.tarifa\.comisionPct\}%/);
    assert.match(fuenteComponente, /\{t\.comisionPct\}%/);
  });

  test("el simulador muestra Total bruto, Comisión aplicada (% y valor) y Total neto a pagar — todos leídos de `resultado`, nunca recalculados", () => {
    const cuerpo = cuerpoDeFuncion(fuenteComponente, "SimuladorCalculo");
    assert.match(cuerpo, /Total bruto:\s*\{fmt\(resultado\.totalBruto\)\}/);
    assert.match(cuerpo, /Comisión aplicada:\s*\{resultado\.comisionPct\}%.*\{fmt\(resultado\.valorComision\)\}/);
    assert.match(cuerpo, /Total neto a pagar:\s*\{fmt\(resultado\.totalNeto\)\}/);
  });

  test("el simulador NO contiene una fórmula paralela de comisión — ningún `* (1 -`/Math.round propio sobre comisionPct fuera de la llamada al motor", () => {
    const cuerpo = cuerpoDeFuncion(fuenteComponente, "SimuladorCalculo");
    // La única mención a "1 -" o a un cálculo de comisión debe vivir DENTRO
    // del motor (unidadAlojamiento.ts), nunca en este componente: aquí no
    // debe existir ninguna expresión que multiplique/reste manualmente
    // comisionPct contra un total.
    assert.doesNotMatch(cuerpo, /1\s*-\s*.*comisionPct/);
    assert.doesNotMatch(cuerpo, /comisionPct\s*\/\s*100/);
    assert.doesNotMatch(cuerpo, /totalBruto\s*-\s*totalNeto/);
    assert.doesNotMatch(cuerpo, /Math\.round\(/);
  });

  // Nota: la ausencia de fórmula paralela también aplica a la fila de
  // detalle/tabla — ninguna de las dos hace aritmética con comisionPct,
  // solo lo muestran (`{f.tarifa.comisionPct}%`/`{t.comisionPct}%`), porque
  // esos valores vienen de la tarifa GUARDADA, no de un cálculo con noches.
  test("comisionPct nunca se multiplica ni se divide en este archivo — el único cálculo es dentro del motor real", () => {
    assert.doesNotMatch(fuenteComponente, /comisionPct\s*\*/);
    assert.doesNotMatch(fuenteComponente, /comisionPct\s*\//);
  });
});
