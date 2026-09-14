import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  seleccionarTarifaAlojamientoPublicada,
  type CriterioResolucionTarifa,
  type ResultadoResolucionTarifa,
} from "../lib/calc/resolverTarifaAlojamiento.ts";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3B Bernalo — resolución inequívoca de la tarifa publicada aplicable
// (`lib/calc/resolverTarifaAlojamiento.ts`, puro) + la frontera server-side
// que lo alimenta (`lib/reservar/resolverTarifaAlojamientoBernalo.ts`, no
// ejecutable aquí porque toca Supabase/Next — se verifica por inspección de
// su código fuente, mismo criterio que el resto de wiring tests del repo).
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuenteBoundary = readFileSync(join(raiz, "lib/reservar/resolverTarifaAlojamientoBernalo.ts"), "utf8");
const fuenteResolver = readFileSync(join(raiz, "lib/calc/resolverTarifaAlojamiento.ts"), "utf8");

// Los comentarios de ambos archivos SÍ nombran "hotel_temporadas"/
// "createAdminClient" para explicar qué queda fuera de alcance — eso no
// cuenta como usarlos. Las comprobaciones de "no importa/no usa X" se hacen
// solo sobre el código real (sin líneas `//`).
function sinComentarios(fuente: string): string {
  return fuente
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
    .join("\n");
}
const codigoResolver = sinComentarios(fuenteResolver);
const codigoBoundary = sinComentarios(fuenteBoundary);

function esperarOk(r: ResultadoResolucionTarifa): asserts r is Extract<ResultadoResolucionTarifa, { ok: true }> {
  assert.equal(r.ok, true, `se esperaba éxito, se obtuvo bloqueo: ${!r.ok ? `${r.codigo} — ${r.mensaje}` : ""}`);
}

function esperarBloqueada(r: ResultadoResolucionTarifa, codigo: string) {
  assert.equal(r.ok, false, "se esperaba un bloqueo, se obtuvo éxito");
  if (!r.ok) assert.equal(r.codigo, codigo);
}

// Payload mínimo VÁLIDO de una tarifa "habitacion" — reusado por todas las
// filas de este archivo salvo cuando el test necesita uno incoherente.
function payloadValido(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1",
    unidadCobro: "habitacion",
    valores: { adulto: 300_000 },
    capacidad: { minPax: 2, maxPax: 2, paxIncluidos: 2 },
    suplementos: [],
    reglaMenores: { reglas: [] },
    comisionPct: 20,
    temporada: "ALTA",
    categoria: "estandar",
    alimentacion: "PC",
    fuente: null,
    versionTarifario: "v1",
    ...over,
  };
}

// Fila cruda de `hotel_tarifas_unidad`, coherente por construcción con
// `payloadValido()` — las columnas espejo SIEMPRE reflejan el payload,
// como exige `adaptarTarifaAlojamientoPersistida`.
function filaValida(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const payload = (over.payload as Record<string, unknown> | undefined) ?? payloadValido();
  return {
    id: 1,
    hotel_id: 10,
    tarifa_id: payload.id,
    version_tarifario: payload.versionTarifario,
    temporada: payload.temporada,
    categoria: payload.categoria,
    alimentacion: payload.alimentacion,
    estado: "publicada",
    fuente_documento: null,
    fuente_pagina: null,
    comision_pct: payload.comisionPct,
    payload,
    ...over,
  };
}

const CRITERIO_BASE: CriterioResolucionTarifa = { hotelId: 10, temporada: "ALTA", categoria: "estandar", alimentacion: "PC" };

describe("seleccionarTarifaAlojamientoPublicada — una publicada exacta se resuelve", () => {
  test("una sola fila publicada, coincidencia exacta: éxito con identidad/versión/clasificación/tarifa completos", () => {
    const fila = filaValida();
    const r = seleccionarTarifaAlojamientoPublicada([fila], CRITERIO_BASE);
    esperarOk(r);
    assert.equal(r.id, 1);
    assert.equal(r.hotelId, 10);
    assert.equal(r.estado, "publicada");
    assert.deepEqual(r.clasificacion, { temporada: "ALTA", categoria: "estandar", alimentacion: "PC" });
    assert.equal(r.tarifa.id, "t1");
    assert.equal(r.tarifa.versionTarifario, "v1");
    assert.equal(r.tarifa.unidadCobro, "habitacion");
    assert.equal(r.tarifa.comisionPct, 20);
  });
});

describe("seleccionarTarifaAlojamientoPublicada — borrador/inactiva no participan", () => {
  test("una fila borrador y otra inactiva, ninguna publicada: cero coincidencias", () => {
    const borrador = filaValida({ estado: "borrador", id: 1 });
    const inactiva = filaValida({ estado: "inactiva", id: 2 });
    const r = seleccionarTarifaAlojamientoPublicada([borrador, inactiva], CRITERIO_BASE);
    esperarBloqueada(r, "tarifa_no_encontrada");
  });

  test("borrador + publicada coexistiendo: solo la publicada participa, resuelve sin ambigüedad", () => {
    const borrador = filaValida({ estado: "borrador", id: 1 });
    const publicada = filaValida({ estado: "publicada", id: 2 });
    const r = seleccionarTarifaAlojamientoPublicada([borrador, publicada], CRITERIO_BASE);
    esperarOk(r);
    assert.equal(r.id, 2);
  });
});

describe("seleccionarTarifaAlojamientoPublicada — cero coincidencias bloquea", () => {
  test("ninguna fila coincide con la clasificación pedida: tarifa_no_encontrada", () => {
    const otraCategoria = filaValida({ categoria: "junior", payload: payloadValido({ categoria: "junior" }) });
    const r = seleccionarTarifaAlojamientoPublicada([otraCategoria], CRITERIO_BASE);
    esperarBloqueada(r, "tarifa_no_encontrada");
  });

  test("colección vacía: tarifa_no_encontrada", () => {
    const r = seleccionarTarifaAlojamientoPublicada([], CRITERIO_BASE);
    esperarBloqueada(r, "tarifa_no_encontrada");
  });
});

describe("seleccionarTarifaAlojamientoPublicada — dos versiones publicadas para la misma clasificación bloquean por ambigüedad", () => {
  test("dos filas publicadas, misma clasificación, distinta versión: tarifa_ambigua con ambas identidades", () => {
    const v1 = filaValida({ id: 1, payload: payloadValido({ id: "t1", versionTarifario: "v1" }), version_tarifario: "v1", tarifa_id: "t1" });
    const v2 = filaValida({ id: 2, payload: payloadValido({ id: "t2", versionTarifario: "v2" }), version_tarifario: "v2", tarifa_id: "t2" });
    const r = seleccionarTarifaAlojamientoPublicada([v1, v2], CRITERIO_BASE);
    esperarBloqueada(r, "tarifa_ambigua");
    if (!r.ok) {
      const candidatas = r.contexto.candidatas as { id: unknown; tarifaId: unknown; versionTarifario: unknown }[];
      assert.equal(candidatas.length, 2);
      assert.deepEqual(candidatas.map((c) => c.versionTarifario).sort(), ["v1", "v2"]);
      assert.deepEqual(candidatas.map((c) => c.tarifaId).sort(), ["t1", "t2"]);
    }
  });
});

describe("seleccionarTarifaAlojamientoPublicada — null no funciona como wildcard", () => {
  test("fila con temporada null NO coincide con un criterio que pide una temporada nombrada", () => {
    const filaSinTemporada = filaValida({ temporada: null, payload: payloadValido({ temporada: null }) });
    const r = seleccionarTarifaAlojamientoPublicada([filaSinTemporada], CRITERIO_BASE);
    esperarBloqueada(r, "tarifa_no_encontrada");
  });

  test("criterio con temporada null NO coincide con una fila que sí tiene temporada nombrada", () => {
    const filaConTemporada = filaValida(); // temporada: "ALTA"
    const criterioSinTemporada: CriterioResolucionTarifa = { ...CRITERIO_BASE, temporada: null };
    const r = seleccionarTarifaAlojamientoPublicada([filaConTemporada], criterioSinTemporada);
    esperarBloqueada(r, "tarifa_no_encontrada");
  });

  test("ambos null: SÍ coinciden (ausencia con ausencia, no comodín con valor)", () => {
    const filaSinTemporada = filaValida({ temporada: null, payload: payloadValido({ temporada: null }) });
    const criterioSinTemporada: CriterioResolucionTarifa = { ...CRITERIO_BASE, temporada: null };
    const r = seleccionarTarifaAlojamientoPublicada([filaSinTemporada], criterioSinTemporada);
    esperarOk(r);
  });
});

describe("seleccionarTarifaAlojamientoPublicada — fila candidata incoherente bloquea aunque exista otra coherente", () => {
  test("la ÚNICA candidata para esta clasificación es incoherente (columna espejo no cuadra con el payload): bloquea sin usar otra fila", () => {
    // `categoria` de la columna dice "estandar" pero el payload dice "junior"
    // — el adaptador la rechaza (`payload_incoherente_con_columnas`).
    const incoherente = filaValida({ categoria: "estandar", payload: payloadValido({ categoria: "junior" }) });
    // Otra fila, de una clasificación DISTINTA, perfectamente coherente —
    // no debe usarse como "reemplazo" de la incoherente.
    const otraCoherente = filaValida({
      id: 99,
      categoria: "junior",
      payload: payloadValido({ id: "t-otra", categoria: "junior", versionTarifario: "v-otra" }),
      tarifa_id: "t-otra",
      version_tarifario: "v-otra",
    });
    const r = seleccionarTarifaAlojamientoPublicada([incoherente, otraCoherente], CRITERIO_BASE);
    esperarBloqueada(r, "tarifa_invalida");
    if (!r.ok) {
      assert.ok(r.rechazo);
      assert.equal(r.rechazo!.codigo, "payload_incoherente_con_columnas");
    }
  });
});

describe("seleccionarTarifaAlojamientoPublicada — no selecciona por orden/id/fecha", () => {
  test("con dos candidatas ambiguas, el orden en que llegan en el arreglo no cambia el resultado (sigue bloqueando)", () => {
    const a = filaValida({ id: 1, payload: payloadValido({ id: "t1" }), tarifa_id: "t1" });
    const b = filaValida({ id: 2, payload: payloadValido({ id: "t2", versionTarifario: "v2" }), tarifa_id: "t2", version_tarifario: "v2" });
    const r1 = seleccionarTarifaAlojamientoPublicada([a, b], CRITERIO_BASE);
    const r2 = seleccionarTarifaAlojamientoPublicada([b, a], CRITERIO_BASE);
    esperarBloqueada(r1, "tarifa_ambigua");
    esperarBloqueada(r2, "tarifa_ambigua");
  });

  test("una fila con id/fecha de creación más reciente NO gana sobre una más antigua — ambas siguen siendo ambiguas", () => {
    const vieja = filaValida({ id: 1, created_at: "2020-01-01", payload: payloadValido({ id: "t1" }), tarifa_id: "t1" });
    const nueva = filaValida({
      id: 500,
      created_at: "2026-01-01",
      payload: payloadValido({ id: "t2", versionTarifario: "v2" }),
      tarifa_id: "t2",
      version_tarifario: "v2",
    });
    const r = seleccionarTarifaAlojamientoPublicada([vieja, nueva], CRITERIO_BASE);
    // Si el resolver "ayudara" eligiendo la de id/fecha mayor, esto sería
    // ok:true con id 500 — en cambio debe seguir bloqueando.
    esperarBloqueada(r, "tarifa_ambigua");
  });

  test("el código fuente del resolver no ordena/compara por id ni por fecha para desempatar", () => {
    assert.doesNotMatch(fuenteResolver, /\.sort\(/);
    assert.doesNotMatch(fuenteResolver, /created_at/);
    assert.doesNotMatch(fuenteResolver, /new Date\(/);
  });
});

describe("seleccionarTarifaAlojamientoPublicada — usa el adaptador real", () => {
  test("importa y llama a adaptarTarifaAlojamientoPersistida (no reimplementa la validación)", () => {
    assert.match(fuenteResolver, /import\s*\{[\s\S]*adaptarTarifaAlojamientoPersistida[\s\S]*\}\s*from\s*"\.\/tarifaAlojamientoPersistida\.ts"/);
    assert.match(fuenteResolver, /adaptarTarifaAlojamientoPersistida\(candidatas\[0\]\)/);
  });

  test("un payload realmente inválido para el motor (ej. reglas de edad solapadas) se rechaza vía el adaptador real, con su código real", () => {
    const conReglasAmbiguas = filaValida({
      payload: payloadValido({
        unidadCobro: "persona",
        capacidad: { minPax: 1, maxPax: null, paxIncluidos: 0 },
        valores: { adulto: 100_000, nino: 50_000 },
        reglaMenores: {
          reglas: [
            { categoria: "nino", edadMinAnios: 0, edadMaxAnios: 10 },
            { categoria: "infante", edadMinAnios: 0, edadMaxAnios: 3 },
          ],
        },
      }),
    });
    const r = seleccionarTarifaAlojamientoPublicada([conReglasAmbiguas], CRITERIO_BASE);
    esperarBloqueada(r, "tarifa_invalida");
    if (!r.ok) assert.equal(r.rechazo?.codigo, "reglas_edad_ambiguas");
  });
});

describe("resolverTarifaAlojamiento.ts — la temporada llega ya resuelta, no duplica el calendario", () => {
  test("el módulo no importa ni referencia hotel_temporadas / lógica de vigencia de fechas", () => {
    assert.doesNotMatch(codigoResolver, /hotel_temporadas/);
    assert.doesNotMatch(codigoResolver, /temporadaVigente/i);
    assert.doesNotMatch(codigoResolver, /fecha_inicio|fecha_fin/);
  });

  test("`temporada` en el criterio es un string|null plano, recibido por parámetro — nunca calculado aquí", () => {
    assert.match(fuenteResolver, /temporada:\s*string\s*\|\s*null/);
  });
});

describe("resolverTarifaAlojamientoBernalo.ts — cliente de sesión, sin admin", () => {
  test("usa el tipo del cliente de sesión (@/lib/supabase/server) y nunca importa createAdminClient", () => {
    assert.match(fuenteBoundary, /from "@\/lib\/supabase\/server"/);
    assert.doesNotMatch(codigoBoundary, /createAdminClient/);
    assert.doesNotMatch(codigoBoundary, /service_role/i);
  });

  test("consulta solo las columnas necesarias de hotel_tarifas_unidad, filtrando por hotel_id y estado publicada", () => {
    assert.match(fuenteBoundary, /\.from\("hotel_tarifas_unidad"\)/);
    assert.match(fuenteBoundary, /\.eq\("hotel_id", criterio\.hotelId\)/);
    assert.match(fuenteBoundary, /\.eq\("estado", "publicada"\)/);
    assert.doesNotMatch(fuenteBoundary, /select\("\*"\)/);
  });

  test("delega la decisión al resolver puro (no reimplementa ambigüedad/coincidencia aquí)", () => {
    assert.match(fuenteBoundary, /seleccionarTarifaAlojamientoPublicada\(data \?\? \[\], criterio\)/);
  });
});
