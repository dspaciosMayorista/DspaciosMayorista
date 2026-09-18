import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// Hallazgo 2 (identidad autoritativa del hotel) + hallazgo 3 (cobertura de
// los 10 puntos reales de escritura).
//
// `app/(dashboard)/dashboard/producto/hoteles/actions.ts` es el ÚNICO archivo
// del repo que escribe `tarifa_hotel`/`hotel_temporadas` (confirmado por
// búsqueda global). Antes del fix, `actualizarTarifa`/`eliminarTarifa`/
// `actualizarTemporada`/`eliminarTemporada` recibían un `hotelId` del
// LLAMADOR y lo usaban tal cual para revalidar/regenerar — si ese id no
// coincidía con el hotel real de la fila (ej. origen del clic desincronizado
// de la página actual), el paquete regenerado no era el correcto y el
// realmente afectado quedaba desactualizado en silencio.
//
// Ejecución real (con Supabase inyectado) no es viable aquí por la misma
// razón documentada en regenerarTarifariosDeHotel.test.ts (`next/cache` no
// resuelve bajo `node --test` plano) — mismo patrón de wiring que ese
// archivo y que documentosContrato.wiring.test.ts.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVO = "app/(dashboard)/dashboard/producto/hoteles/actions.ts";
const src = readFileSync(join(raiz, ARCHIVO), "utf8");

function cuerpoDeFuncion(nombre: string): string {
  const firma = new RegExp(`export async function ${nombre}\\(`);
  const m = firma.exec(src);
  assert.ok(m, `no se encontró "export async function ${nombre}("`);
  const inicio = m!.index;
  const siguiente = src.indexOf("\nexport async function ", inicio + 1);
  return siguiente >= 0 ? src.slice(inicio, siguiente) : src.slice(inicio);
}

describe("hallazgo 2 — update/delete derivan hotel_id de la FILA afectada, nunca del parámetro", () => {
  for (const nombre of ["actualizarTarifa", "eliminarTarifa", "actualizarTemporada", "eliminarTemporada"]) {
    test(`${nombre}: consulta/mutación autoritativa trae "hotel_id" en el select`, () => {
      const cuerpo = cuerpoDeFuncion(nombre);
      assert.match(
        cuerpo,
        /\.select\("hotel_id"\)\s*\n?\s*\.maybeSingle\(\)/,
        `${nombre} no pide "hotel_id" de vuelta de la mutación — sin esto no hay forma de saber el hotel REAL afectado`
      );
    });

    test(`${nombre}: falla explícito si la fila no existe (0 filas afectadas) — nunca regenera un hotel inventado`, () => {
      const cuerpo = cuerpoDeFuncion(nombre);
      assert.match(
        cuerpo,
        /if\s*\(!\w+\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*"No se encontró/,
        `${nombre} no corta cuando la fila afectada no existe`
      );
    });

    test(`${nombre}: usa "hotelId" derivado de la fila (no el parámetro) para revalidar y regenerar`, () => {
      const cuerpo = cuerpoDeFuncion(nombre);
      assert.match(
        cuerpo,
        /const hotelId = \w+\.hotel_id;/,
        `${nombre} no deriva "hotelId" desde la fila devuelta por la mutación`
      );
      assert.match(cuerpo, /revalidatePath\(`\/dashboard\/producto\/hoteles\/\$\{hotelId\}`\)/, `${nombre} no revalida con el hotelId derivado`);
      assert.match(cuerpo, /regenerarTarifariosDeHotel\(hotelId\)/, `${nombre} no regenera con el hotelId derivado`);
    });
  }

  for (const nombre of ["actualizarTarifa", "eliminarTarifa"]) {
    test(`${nombre}: el parámetro histórico recibido queda marcado sin usar (nunca se lee como autoridad)`, () => {
      const cuerpo = cuerpoDeFuncion(nombre);
      assert.match(cuerpo, /_hotelIdSolicitado: number/, `${nombre} debería conservar el parámetro (compat de firma con la UI) mientras no se toque la UI`);
      assert.match(cuerpo, /void _hotelIdSolicitado;/, `${nombre} no marca el parámetro como deliberadamente sin usar`);
      // Nunca debe usarse el parámetro para revalidar/regenerar — solo el
      // texto exacto `hotelId)` (derivado) puede aparecer en esas llamadas.
      assert.doesNotMatch(cuerpo, /regenerarTarifariosDeHotel\(_hotelIdSolicitado\)/, `${nombre} regenera con el parámetro suministrado, no con el de la fila`);
    });
  }

  test("eliminarTemporada: el parámetro histórico recibido queda marcado sin usar", () => {
    const cuerpo = cuerpoDeFuncion("eliminarTemporada");
    assert.match(cuerpo, /_hotelIdSolicitado: number/);
    assert.match(cuerpo, /void _hotelIdSolicitado;/);
    assert.doesNotMatch(cuerpo, /regenerarTarifariosDeHotel\(_hotelIdSolicitado\)/);
  });
});

describe("corrección puntual — actualizarTemporada: lectura previa autoritativa (nombre + hotel_id)", () => {
  test("la lectura previa selecciona nombre y hotel_id juntos (no solo nombre)", () => {
    const cuerpo = cuerpoDeFuncion("actualizarTemporada");
    assert.match(
      cuerpo,
      /\.select\("nombre,\s*hotel_id"\)/,
      "actualizarTemporada no lee hotel_id en la consulta previa — sin esto no hay identidad autoritativa antes del update"
    );
  });

  test("la lectura previa captura y comprueba explícitamente su propio error, y retorna antes del update", () => {
    const cuerpo = cuerpoDeFuncion("actualizarTemporada");
    assert.match(
      cuerpo,
      /const\s*\{\s*data:\s*actual\s*,\s*error:\s*eActual\s*\}\s*=\s*await\s+sb\s*\n?\s*\.from\("hotel_temporadas"\)\s*\n?\s*\.select\("nombre,\s*hotel_id"\)/,
      "no destructura error de la lectura previa (eActual) — un fallo técnico en esa consulta quedaría indistinguible de 'sin datos'"
    );
    const idxLectura = cuerpo.indexOf(".select(\"nombre, hotel_id\")");
    const idxUpdate = cuerpo.indexOf(".update(payloadTemporada(");
    assert.ok(idxLectura >= 0 && idxUpdate > idxLectura, "no se pudo ubicar el orden lectura → update");
    const entreLecturaYUpdate = cuerpo.slice(idxLectura, idxUpdate);
    assert.match(entreLecturaYUpdate, /if\s*\(eActual\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*eActual\.message\s*\};/, "no corta con el error de la lectura previa antes del update");
    assert.match(entreLecturaYUpdate, /if\s*\(!actual\)\s*return\s*\{\s*ok:\s*false,\s*error:\s*"No se encontró/, "no corta cuando la fila no existe en la lectura previa, antes del update");
  });

  test("usa el hotel_id de la lectura previa para acotar el propio update", () => {
    const cuerpo = cuerpoDeFuncion("actualizarTemporada");
    assert.match(
      cuerpo,
      /\.eq\("id",\s*id\)\s*\n?\s*\.eq\("hotel_id",\s*hotelId\)/,
      "el update no está acotado también por hotel_id (derivado de la lectura previa) — sin esto, si la fila cambiara de hotel entre la lectura y el update, el update igual la afectaría"
    );
  });

  test("confirma explícitamente que la fila actualizada sigue perteneciendo al mismo hotel que la lectura previa", () => {
    const cuerpo = cuerpoDeFuncion("actualizarTemporada");
    assert.match(
      cuerpo,
      /if\s*\(actualizada\.hotel_id\s*!==\s*hotelId\)\s*\{/,
      "no compara el hotel_id devuelto por el update contra el de la lectura previa"
    );
  });
});

describe("hallazgo 3 — cobertura: los 10 puntos reales que escriben tarifa_hotel/hotel_temporadas regeneran", () => {
  const PUNTOS_DE_ESCRITURA = [
    "crearTarifa",
    "actualizarTarifa",
    "eliminarTarifa",
    "crearTemporada",
    "actualizarTemporada",
    "eliminarTemporada",
    "copiarTemporadasDesdeHotel",
    "cargarTarifasMasivo",
    "cargarTemporadasMasivo",
    "generarTarifasCalculadora",
  ];

  for (const nombre of PUNTOS_DE_ESCRITURA) {
    test(`${nombre} llama a regenerarTarifariosDeHotel`, () => {
      const cuerpo = cuerpoDeFuncion(nombre);
      assert.match(cuerpo, /regenerarTarifariosDeHotel\(/, `${nombre} no llama a regenerarTarifariosDeHotel — un cambio real de tarifa/temporada quedaría sin regenerar los paquetes que lo usan`);
    });
  }

  test("no hay un onceavo punto de escritura sin cubrir (guarda contra divergencia futura)", () => {
    // Cuenta cuántas funciones exportadas del archivo insertan/actualizan/eliminan
    // sobre tarifa_hotel/hotel_temporadas — si aparece una nueva, esta prueba la
    // detecta y obliga a añadirla a PUNTOS_DE_ESCRITURA (o a excluirla a propósito).
    const nombresExportados = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    const escribenTablasDeInteres = nombresExportados.filter((nombre) => {
      const cuerpo = cuerpoDeFuncion(nombre);
      const escribeDirecto = /\.from\("tarifa_hotel"\)|\.from\("hotel_temporadas"\)/.test(cuerpo) &&
        /\.(insert|update|upsert|delete)\(/.test(cuerpo);
      // `generarTarifasCalculadora` escribe por RPC transaccional
      // (`reemplazar_tarifas_hotel_calculadora`, migración 179) en vez de
      // `.from(...).insert/delete(...)` directo — mismo destino (tarifa_hotel),
      // otra forma de llegar. Se detecta aparte para que la guarda no dependa
      // de un patrón sintáctico que esa función no usa.
      const escribePorRpc = /\.rpc\("reemplazar_tarifas_hotel_calculadora"/.test(cuerpo);
      return escribeDirecto || escribePorRpc;
    });
    assert.deepEqual(
      [...escribenTablasDeInteres].sort(),
      [...PUNTOS_DE_ESCRITURA].sort(),
      `los puntos de escritura reales (${escribenTablasDeInteres.join(", ")}) no coinciden con los 10 cubiertos — revisa si apareció uno nuevo sin regenerar`
    );
  });
});
