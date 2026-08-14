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

  test(`${archivo} lee el tenant y el aliado_id del perfil`, () => {
    const src = leer(archivo);
    // Sin estos dos campos la función compartida no puede comparar la agencia
    // ni resolver el vínculo fuerte: recibiría null y denegaría de más.
    assert.match(src, /select\(\s*"nombre, rol, tenant, aliado_id"\s*\)/, "el perfil no trae tenant/aliado_id");
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
