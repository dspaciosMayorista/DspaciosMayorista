import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA LA DIVERGENCIA — pendiente CHD/INF en inventario de vuelos.
//
// Antes de este cambio existían TRES criterios distintos y no sincronizados
// para decidir "es infante"/"consume silla" en los puntos donde se crean o
// editan pasajeros de un contrato:
//   1. Posicional/por conteo (ReservaForm.tsx/ProgramaReservaForm.tsx):
//      `esInfante: idx >= cortePax` — nunca mira la fecha de nacimiento.
//   2. Manual (NuevoContratoForm.tsx): checkbox "Es infante" tal cual lo
//      manda el cliente.
//   3. Por edad real (editar-contrato-actions.ts, ya existía): la única
//      correcta, pero nunca se propagó a los flujos de creación.
// Y dos motores de conteo de "pax que ocupan silla" totalmente
// independientes: `lib/reservar/computo.ts` (paxConSilla) y
// `contratos/actions.ts` (holders.length || pax) — cada uno con su propio
// `!esInfante` inline.
//
// `lib/reservar/pasajeros.ts` es ahora la fuente de verdad única. Estas
// comprobaciones miran el CÓDIGO FUENTE de cada punto de creación/edición de
// pasajeros: no demuestran que el cálculo sea correcto (de eso se encargan
// las pruebas de comportamiento en reservarPasajeros.test.ts), sino que
// todos siguen decidiendo por el mismo sitio y que el criterio viejo
// (checkbox/flag del cliente sin recalcular, o un `!esInfante`/`!p.esInfante`
// inline reintroducido) no vuelve a colarse silenciosamente.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const ARCHIVOS_ESCRITURA = [
  "app/(dashboard)/dashboard/reservar/actions.ts",
  "app/(dashboard)/dashboard/contratos/actions.ts",
  "app/(dashboard)/dashboard/contratos/[numero]/editar-contrato-actions.ts",
];

for (const archivo of ARCHIVOS_ESCRITURA) {
  test(`${archivo} importa la fuente de verdad compartida de pasajeros/sillas`, () => {
    const src = leer(archivo);
    assert.match(
      src,
      /import\s*\{[^}]*esInfantePorEdad[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajeros["']/,
      "no importa esInfantePorEdad desde lib/reservar/pasajeros"
    );
    assert.match(
      src,
      /import\s*\{[^}]*pasajeroConsumeSilla[^}]*\}\s*from\s*["']@\/lib\/reservar\/pasajeros["']/,
      "no importa pasajeroConsumeSilla desde lib/reservar/pasajeros"
    );
  });

  test(`${archivo} recalcula es_infante con esInfantePorEdad antes de insertar`, () => {
    const src = leer(archivo);
    assert.match(src, /esInfantePorEdad\(/, "no llama esInfantePorEdad");
    assert.match(src, /es_infante:\s*esInfante/, "el insert de contrato_pasajeros no usa el resultado recalculado");
  });

  test(`${archivo} decide sillas con pasajeroConsumeSilla, no con !esInfante/!p.esInfante inline`, () => {
    const src = leer(archivo);
    assert.match(src, /pasajeroConsumeSilla\(/, "no llama pasajeroConsumeSilla para filtrar holders");
    // El defecto original exacto: filtrar holders con la negación directa del
    // flag del cliente en vez de con el resultado recalculado server-side.
    assert.doesNotMatch(
      src,
      /filter\(\s*\(?p\)?\s*=>\s*!p\.esInfante\s*\)/,
      "volvió el filtro `!p.esInfante` sin pasar por pasajeroConsumeSilla"
    );
  });
}

test("reservar/actions.ts no vuelve a confiar en el esInfante posicional del cliente para holders", () => {
  const src = leer("app/(dashboard)/dashboard/reservar/actions.ts");
  // El patrón viejo (input.pasajeros.filter((p) => !p.esInfante)) filtraba
  // directo sobre el flag que manda el formulario, sin recalcular por edad.
  assert.doesNotMatch(
    src,
    /input\.pasajeros\.filter\(\s*\(?p\)?\s*=>\s*!p\.esInfante\s*\)/,
    "reintrodujo el filtro de holders sobre el flag del cliente sin recalcular"
  );
});

test("editar-contrato-actions.ts valida el vínculo INF→responsable server-side y reconcilia sillas por RPC", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/editar-contrato-actions.ts");
  // Vínculo: rechaza responsable inexistente / infante / distinto contrato /
  // auto-referencia — server-side, no solo en el <select> del formulario.
  assert.match(src, /responsableIndex/, "no maneja responsableIndex en absoluto");
  assert.match(src, /respEsInfante/, "no valida que el responsable no sea, a su vez, infante");
  assert.match(
    src,
    /p\.responsableIndex\s*===\s*idxOriginal/,
    "no rechaza que un infante se vincule a sí mismo"
  );
  // Persistencia durable: se escribe responsable_id, no solo estado de formulario.
  assert.match(src, /responsable_id:\s*idResponsable/, "no persiste responsable_id en contrato_pasajeros");
  // Reconciliación de sillas vía el RPC atómico de la migración 167 — nunca
  // un update directo a `sillas` desde esta acción (eso rompería el candado
  // de concurrencia y el chequeo de rol que sí tiene el RPC).
  assert.match(
    src,
    /sb\.rpc\(\s*["']ajustar_sillas_por_pasajeros["']/,
    "no reconcilia sillas vía el RPC ajustar_sillas_por_pasajeros"
  );
  assert.doesNotMatch(
    src,
    /from\(\s*["']sillas["']\s*\)\s*\.update\(/,
    "escribe `sillas` directo desde la acción en vez de pasar por el RPC atómico"
  );
});

test("EditarAsesorPasajeros.tsx reindexa responsableIndex al quitar una fila (nunca deja un vínculo apuntando a la persona equivocada)", () => {
  const src = leer("app/(dashboard)/dashboard/contratos/[numero]/EditarAsesorPasajeros.tsx");
  assert.match(src, /const\s+quitarFila\s*=/, "no existe el handler quitarFila");
  assert.match(
    src,
    /r\.responsableIndex\s*===\s*i\s*\)\s*return\s*\{\s*\.\.\.r,\s*responsableIndex:\s*null\s*\}/,
    "no limpia el vínculo de quien apuntaba exactamente a la fila quitada"
  );
  assert.match(
    src,
    /r\.responsableIndex\s*>\s*i\s*\)\s*return\s*\{\s*\.\.\.r,\s*responsableIndex:\s*r\.responsableIndex\s*-\s*1\s*\}/,
    "no reindexa los vínculos posteriores a la fila quitada"
  );
});

test("lib/reservar/pasajeros.ts es la única fuente de la constante de edad de infante (EDAD_INFANTE_MAX_VUELO)", () => {
  const src = leer("lib/reservar/pasajeros.ts");
  assert.match(src, /export const EDAD_INFANTE_MAX_VUELO\s*=\s*2/, "cambió el umbral sin que el resto del código lo sepa");
});

// ───────────────────────────────────────────────────────────────────────────
// "Los INF deben seguir apareciendo en todos los listados y documentos."
// Los dos manifiestos/listados de vuelo (búsqueda global de pasajeros, y el
// detalle de un record) se leen exclusivamente de `sillas` — por diseño, un
// infante nunca tiene fila propia ahí. Sin un paso adicional quedarían
// invisibles en estos dos listados aunque sí aparezcan en el documento del
// contrato. Estas pruebas verifican que ese paso adicional sigue existiendo.
// ───────────────────────────────────────────────────────────────────────────
test("vuelos/pasajeros/page.tsx trae infantes de contrato_pasajeros y los agrega al listado (no solo sillas)", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx");
  assert.match(src, /from\(\s*["']contrato_pasajeros["']\s*\)/, "no consulta contrato_pasajeros en absoluto");
  assert.match(src, /\.eq\(\s*["']es_infante["']\s*,\s*true\s*\)/, "no filtra por es_infante=true");
  assert.match(src, /\[\.\.\.filasSillas,\s*\.\.\.filasInfantes\]/, "no combina las filas de sillas con las de infantes");
});

test("PasajerosBuscador.tsx admite filas sin silla (infante) sin romper la clave de fila", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/pasajeros/PasajerosBuscador.tsx");
  assert.match(src, /sillaId:\s*number\s*\|\s*null/, "sillaId debe aceptar null: una fila de infante no tiene silla real");
  assert.match(src, /key=\{p\.id\}/, "la fila debe usar el id sintético, no sillaId — colisiona si un infante tiene sillaId null duplicado");
});

test("vuelos/[id]/page.tsx (detalle de un record) también trae los infantes de los contratos del bloqueo", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  assert.match(src, /from\(\s*["']contrato_pasajeros["']\s*\)/, "no consulta contrato_pasajeros en absoluto");
  assert.match(src, /\.eq\(\s*["']es_infante["']\s*,\s*true\s*\)/, "no filtra por es_infante=true");
  assert.match(src, /infantesBloqueo/, "no expone los infantes del bloqueo a la vista");
});

test("vuelos/[id]/page.tsx NO inyecta infantes dentro de la tabla de sillas (evita exponer acciones de silla sobre una fila que no tiene silla real)", () => {
  const src = leer("app/(dashboard)/dashboard/vuelos/[id]/page.tsx");
  // La tabla de sillas sigue mapeando exclusivamente `(sillas ?? [])`, nunca
  // una lista combinada con infantes — PasajeroAcciones/SillaEstado/
  // SillaContrato operan sobre un sillaId real.
  assert.match(src, /\{\(sillas \?\? \[\]\)\.map\(\(s\) => \(/, "la tabla de sillas ya no mapea directo sobre `sillas`");
});

