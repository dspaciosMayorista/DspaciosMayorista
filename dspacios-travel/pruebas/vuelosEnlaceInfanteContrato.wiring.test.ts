// Cableado del enlace "Editar en contrato" en los renglones SUBORDINADOS de
// infantes de los manifiestos de vuelo (detalle de bloqueo y listado global
// de pasajeros):
//   - La autorización ("¿puede ESTE usuario abrir ese contrato?") se decide
//     con el cliente de SESIÓN y en LOTE, delegando en el módulo compartido
//     `lib/vuelos/enlaceContrato.ts` (`contratosQuePuedeAbrir`). Nunca se
//     resuelve en la página con `.from("ventas")`, nunca con un cliente
//     admin/service-role, y nunca se antepone el prefijo "MIN-" a ciegas.
//   - El renglón enlaza solo cuando el `numero_contrato` interno real del
//     infante está en el conjunto autorizado; si no, queda sin acción (no se
//     revela la ruta de un contrato que este rol/tenant no podría abrir).
//   - El Client Component (PasajerosBuscador) NO autoriza por rol: recibe un
//     booleano ya decidido en el servidor y renderiza el enlace únicamente
//     cuando ese flag llega true.
// Se apoya en la lógica pura/IO probada en pruebas/enlaceContrato.test.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function leer(ruta: string): string {
  return readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
}

const RUTA_BLOQUEO = "app/(dashboard)/dashboard/vuelos/[id]/page.tsx";
const RUTA_PASAJEROS = "app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx";
const RUTA_BUSCADOR = "app/(dashboard)/dashboard/vuelos/pasajeros/PasajerosBuscador.tsx";
// El módulo compartido de autorización: "@/lib/vuelos/enlaceContrato" — ver
// pruebas/enlaceContrato.test.ts para su lógica pura/IO.

describe("vuelos/[id]/page.tsx — enlace 'Editar en contrato' autorizado en lote", () => {
  const src = leer(RUTA_BLOQUEO);

  test("importa la autorización del módulo compartido (no una reimplementación inline con .from('ventas'))", () => {
    assert.match(
      src,
      /import \{ contratosQuePuedeAbrir, numeroContratoEnlazable \} from "@\/lib\/vuelos\/enlaceContrato";/,
      "no importa desde lib/vuelos/enlaceContrato.ts"
    );
    assert.doesNotMatch(src, /\.from\(\s*["']ventas["']\s*\)/, "la página no debe consultar ventas directamente — la autorización vive en el módulo");
    assert.doesNotMatch(src, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/, "no debe tocar un cliente admin/service-role para decidir el enlace");
  });

  test("autoriza EN LOTE: una sola llamada a contratosQuePuedeAbrir con los números de TODOS los infantes agrupados", () => {
    assert.equal(src.split("contratosQuePuedeAbrir(").length - 1, 1, "debe haber exactamente UNA llamada en lote por página, nunca una por infante");
    assert.match(
      src,
      /const numerosContratosInfantes = \[\.\.\.infantesPorSillaId\.values\(\)\]\.flatMap\(\(infs\) =>\s*infs\.map\(\(inf\) => inf\.numeroContrato\)\s*\);/,
      "debe juntar en un solo arreglo el numeroContrato (el propio, real) de cada infante agrupado para el batch"
    );
  });

  test("el renglón subordinado enlaza con el selector puro + su propio numeroContrato, contra el conjunto autorizado", () => {
    const inicio = src.indexOf("numeroContratoEnlazable(inf.numeroContrato, contratosEnlazables)");
    assert.ok(inicio > -1, "no encuentra el selector puro en el renglón de infantes");
    const bloque = src.slice(inicio, inicio + 2600);
    assert.ok(bloque.includes("/dashboard/contratos/${editarEnContrato}"), "debe enlazar a la ficha INTERNA con el numero_contrato completo");
    assert.match(bloque, /Editar en contrato/, "debe renderizar la acción 'Editar en contrato'");
    assert.match(bloque, /No ocupa silla/, "debe conservar el distintivo 'No ocupa silla' en el mismo renglón");
  });

  test("el enlace vive en el renglón informativo del infante, que sigue sin asignar silla ni acciones de silla", () => {
    const inicio = src.indexOf("infantesPorSillaId.get(s.id)");
    assert.ok(inicio > -1, "no encuentra el renglón de infantes");
    const bloque = src.slice(inicio, inicio + 600);
    assert.doesNotMatch(bloque, /sillaId:/, "el infante sigue sin ocupar silla");
    assert.doesNotMatch(bloque, /PasajeroAcciones|SillaEstado|SillaContrato/, "el infante no gana acciones de silla con este enlace");
    assert.doesNotMatch(bloque, /<table/i, "el enlace no crea una tabla aparte");
  });

  test("no antepone el prefijo MIN- por su cuenta (el número enlazado es el numero_contrato real, ya resuelto)", () => {
    assert.doesNotMatch(src, /["'`]MIN-["'`]\s*\+/, "la página no debe fabricar el prefijo de tenant — solo enlaza el numero_contrato interno real");
  });
});

describe("vuelos/pasajeros/page.tsx — el servidor autoriza y el flag baja al cliente", () => {
  const src = leer(RUTA_PASAJEROS);

  test("importa la autorización del MISMO módulo compartido y la resuelve en lote (no .from('ventas') en la página)", () => {
    assert.match(
      src,
      /import \{ contratosQuePuedeAbrir, numeroContratoEnlazable \} from "@\/lib\/vuelos\/enlaceContrato";/,
      "no importa desde lib/vuelos/enlaceContrato.ts"
    );
    assert.equal(src.split("contratosQuePuedeAbrir(").length - 1, 1, "debe haber exactamente UNA llamada en lote por página");
    assert.doesNotMatch(src, /\.from\(\s*["']ventas["']\s*\)/, "la página no debe consultar ventas directamente");
    assert.doesNotMatch(src, /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/, "no debe tocar un cliente admin/service-role para decidir el enlace");
  });

  test("cada fila de infante lleva puedeEditarEnContrato decidido por el servidor (selector puro sobre el conjunto autorizado)", () => {
    const inicio = src.indexOf("puedeEditarEnContrato:");
    assert.ok(inicio > -1, "no encuentra el campo puedeEditarEnContrato en la construcción de filas de infantes");
    const bloque = src.slice(inicio, inicio + 250);
    assert.match(bloque, /puedeEditarEnContrato:\s*/, "la fila debe exponer el flag puedeEditarEnContrato");
    assert.match(
      bloque,
      /numeroContratoEnlazable\(inf\.numeroContrato, contratosEnlazables\)\s*!==\s*null/,
      "el flag debe derivarse del selector puro y el número propio del infante contra el conjunto autorizado"
    );
  });

  test("no antepone el prefijo MIN- por su cuenta", () => {
    assert.doesNotMatch(src, /["'`]MIN-["'`]\s*\+/, "la página no debe fabricar el prefijo de tenant");
  });
});

describe("PasajerosBuscador.tsx — el cliente renderiza SOLO lo que el servidor ya autorizó", () => {
  const src = leer(RUTA_BUSCADOR);

  test("renderiza la acción 'Editar en contrato' en el renglón subordinado, enlazando a la ficha interna con el numero_contrato completo", () => {
    assert.match(src, /Editar en contrato/, "la superficie del listado global debe mostrar la acción");
    assert.ok(src.includes("/dashboard/contratos/${inf.contrato}"), "debe enlazar a /dashboard/contratos/[numero] con el numero_contrato del infante");
  });

  test("el enlace está CONDICIONADO al flag autorizado del servidor (nunca se decide por rol en el cliente)", () => {
    const inicio = src.indexOf("No ocupa silla");
    const bloque = src.slice(inicio, inicio + 600);
    assert.match(
      bloque,
      /\{inf\.puedeEditarEnContrato && inf\.contrato && \(/,
      "el enlace debe abrirse solo cuando el servidor marcó puedeEditarEnContrato (y hay contrato)"
    );
  });

  test("el cliente NO autoriza: sin listas de roles, sin mi_rol(), sin consultar la resolución de contratos", () => {
    assert.doesNotMatch(src, /contratosQuePuedeAbrir|numeroContratoEnlazable|contratoManual|resolverManifiestoAutorizado/, "el cliente no debe replicar la autorización del servidor");
    assert.doesNotMatch(src, /\bROLES_\w*|mi_rol|puede_ver/, "el cliente no debe decidir por rol");
  });

  test("el infante sigue sin ocupar silla ni tener acciones de silla en esta superficie", () => {
    const finTbody = src.indexOf("<tbody>");
    const inicio = src.indexOf("infantesPorPadre.get(p.id)", finTbody);
    const bloque = src.slice(inicio, inicio + 1200);
    assert.match(bloque, /No ocupa silla/, "debe conservar el distintivo 'No ocupa silla'");
    assert.doesNotMatch(bloque, /sillaId\s*:/, "el infante sigue sin ocupar silla");
    assert.doesNotMatch(bloque, /PasajeroAcciones|SillaEstado|SillaContrato/, "el infante no gana acciones de silla");
  });
});
