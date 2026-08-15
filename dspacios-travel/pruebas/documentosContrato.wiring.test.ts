import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// GUARDA CONTRA LA DIVERGENCIA
//
// Los cuatro documentos que se abren por URL —cuenta de cobro, estado de
// cuenta, plan de cobro y recibo— se sirven con service-role, así que la RLS no
// los protege. Toda su autorización depende de que pasen por
// `accesoDocumentoContrato`.
//
// El agujero que se cerró no fue un descuido puntual: fue que la misma regla
// estaba ESCRITA DOS VECES, en `lib/cuenta/estado.ts` y en
// `lib/finanzas/comisionResolver.ts`, cada una con su propia lista de roles. Al
// haber dos copias, las dos se olvidaron de comparar el tenant y las dos
// siguieron resolviendo la pertenencia por nombre.
//
// Estas comprobaciones miran el CÓDIGO FUENTE, no su comportamiento: no
// demuestran que la autorización sea correcta —de eso se encarga
// `accesoDocumentoContrato.test.ts`— sino que sigue habiendo un solo sitio
// donde se decide. Si alguien vuelve a escribir una lista de roles en uno de
// los dos archivos, esto lo delata.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const RESOLVERS = ["lib/cuenta/estado.ts", "lib/finanzas/comisionResolver.ts"];

for (const archivo of RESOLVERS) {
  test(`${archivo} decide el acceso con la función compartida`, () => {
    const src = leer(archivo);
    assert.match(
      src,
      /import\s*\{[^}]*accesoDocumentoContrato[^}]*\}\s*from\s*"@\/lib\/auth\/accesoDocumentoContrato"/,
      "no importa el autorizador compartido"
    );
    assert.match(src, /accesoDocumentoContrato\(/, "no lo llama");
    assert.match(src, /if\s*\(!acceso\.permitido\)\s*return null;/, "no corta cuando deniega");
  });

  test(`${archivo} no declara su propia lista de roles`, () => {
    const src = leer(archivo);
    assert.doesNotMatch(
      src,
      /const\s+ROLES_INTERNOS\s*=/,
      "volvió a declarar ROLES_INTERNOS en local: esa duplicación fue la causa del agujero"
    );
  });

  test(`${archivo} no vuelve a resolver la pertenencia por nombre`, () => {
    const src = leer(archivo);
    // El patrón exacto que había: [agencia_nombre, freelance_nombre].includes(perfil.nombre)
    assert.doesNotMatch(
      src,
      /\[[^\]]*freelance_nombre[^\]]*\]\s*\.includes\s*\(/,
      "emparejamiento por nombre reintroducido; el respaldo legacy vive en accesoDocumentoContrato"
    );
  });

  test(`${archivo} lee el tenant, el activo y el aliado_id del perfil`, () => {
    const src = leer(archivo);
    // Sin estos tres campos la función compartida no puede comparar la
    // agencia, resolver el vínculo fuerte, ni negar a un usuario dado de
    // baja: recibiría null/undefined y denegaría de más, o —peor, con
    // `activo`— dejaría pasar a alguien que no debería.
    assert.match(src, /select\(\s*"nombre, rol, tenant, activo, aliado_id"\s*\)/, "el perfil no trae tenant/activo/aliado_id");
    assert.match(src, /activo:/, "no pasa `activo` al autorizador");
    assert.match(src, /aliadoId:/, "no pasa el aliado_id al autorizador");
  });
}

test("el plan de cobro y el recibo heredan el control del estado de cuenta", () => {
  const src = leer("lib/cuenta/estado.ts");
  // Los dos delegan en `cargarEstadoCuenta` y devuelven null si esta devuelve
  // null. Si algún día dejaran de delegar, necesitarían su propio control y
  // esta comprobación tiene que fallar para que se note.
  const plan = src.slice(src.indexOf("export async function cargarPlanCobro"));
  assert.match(plan.slice(0, 400), /await cargarEstadoCuenta\(/, "cargarPlanCobro ya no delega");
  assert.match(plan.slice(0, 400), /if\s*\(!ec\)\s*return null;/, "cargarPlanCobro no corta si deniega");

  const recibo = src.slice(src.indexOf("export async function cargarRecibo"));
  assert.match(recibo, /await cargarEstadoCuenta\(/, "cargarRecibo ya no delega");
  assert.match(recibo, /if\s*\(!estado\)\s*return null;/, "cargarRecibo no corta si deniega");
});

test("comisionResolver.ts resuelve los datos bancarios en dos fases, sin atajos", () => {
  const src = leer("lib/finanzas/comisionResolver.ts");
  assert.match(
    src,
    /import\s*\{[^}]*resolverFichaAliado[^}]*\}\s*from\s*"@\/lib\/finanzas\/fichaAliado"/,
    "no importa el resolvedor compartido de fichas"
  );
  assert.match(src, /resolverAliadoIdContrato\(/, "no calcula el aliado_id con la función compartida");
  assert.match(src, /resolverFichaAliado\(/, "no resuelve la ficha con la función de dos fases");
  assert.doesNotMatch(
    src,
    /\.ilike\(\s*"nombre"/,
    "volvió el ilike(nombre): %/_ son comodines, y puede traer una ficha que no es la del contrato"
  );
  // ESTE es el bug real que motivó la reescritura: un `.eq("nombre", …)`
  // puntual puede devolver EXACTAMENTE una fila y aun así existir otra que
  // solo difiera en mayúsculas o espacios — esa candidata queda oculta y la
  // consulta "ya encontró una" sin comprobar si hay más. La resolución por
  // nombre tiene que pasar SIEMPRE por `listarIdsYNombres` (todo el
  // catálogo, filtrado en memoria por `resolverFichaAliado`), nunca por un
  // `.eq("nombre", …)` que se conforme con el primer resultado.
  assert.doesNotMatch(
    src,
    /\.eq\(\s*"nombre"/,
    "volvió un .eq(\"nombre\", …) puntual: puede devolver una fila y ocultar un homónimo normalizado"
  );
  // No es un `doesNotMatch` genérico de `.limit(1)`: el archivo tiene uno
  // legítimo (la fila más reciente de `aliados_b2b` para el contrato, con
  // `order by id desc` — no tiene nada que ver con elegir entre homónimos).
  // Lo que no debe volver es la búsqueda de aliado ENCADENANDO
  // `.from("aliados")...limit(1)` sin pasar por `resolverFichaAliado`.
  assert.doesNotMatch(
    src,
    /from\("aliados"\)[\s\S]{0,200}\.limit\(1\)/,
    "volvió una consulta a `aliados` con limit(1): con homónimos elige una ficha arbitraria"
  );
  // El listado por id+nombre tiene que paginar: PostgREST puede truncar un
  // select() en silencio (límite de filas del proyecto), y un catálogo
  // truncado puede esconder justo la ambigüedad que se busca.
  assert.match(src, /listarTodosLosCandidatos\(/, "el listado de candidatos ya no pagina");
  assert.match(
    src,
    /\.select\(\s*"id, nombre"\s*\)\s*\.order\(\s*"id"/,
    "la consulta de id+nombre debe encadenar .order(\"id\", …): sin orden determinista el cursor no sirve"
  );
  assert.match(src, /\.gt\(\s*"id"\s*,\s*cursor\s*\)/, "no aplica el cursor (id > cursor) en la paginación");
  // ESTE es el bug real que motivó la reescritura de la paginación: `.range()`
  // pide un tamaño de página FIJO y se da por terminado en cuanto una página
  // vuelve con menos filas de las pedidas. Pero PostgREST puede tener su
  // propio límite de filas por respuesta (Settings → API → Max rows) por
  // DEBAJO de lo que se pidió — pedir 1000 con el servidor topado en 500 hace
  // que la primera página YA vuelva "incompleta" (500 < 1000) aunque queden
  // miles de filas más. Paginar por cursor (id > último visto) no tiene ese
  // problema: la única señal válida de fin es una página vacía.
  assert.doesNotMatch(
    src,
    /from\("aliados"\)[\s\S]{0,80}\.range\(/,
    "volvió la paginación por offset/.range(): se da por terminada antes de tiempo si el servidor limita las filas por debajo del tamaño de página pedido"
  );
});

test("las cuatro páginas por URL siguen colgando de esos dos resolvers", () => {
  const paginas: [string, RegExp][] = [
    ["app/portal/comision/[numero]/page.tsx", /resolverComisionB2B\(/],
    ["app/portal/comision/[numero]/estado-cuenta/page.tsx", /resolverComisionB2B\(/],
    ["app/estado-cuenta/[numero]/page.tsx", /cargarEstadoCuenta\(/],
    ["app/plan-cobro/[numero]/page.tsx", /cargarPlanCobro\(/],
    ["app/recibo/[id]/page.tsx", /cargarRecibo\(/],
  ];
  for (const [archivo, patron] of paginas) {
    assert.match(leer(archivo), patron, `${archivo} dejó de usar el resolver con control de acceso`);
  }
});
