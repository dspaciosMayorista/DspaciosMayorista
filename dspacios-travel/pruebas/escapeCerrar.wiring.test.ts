// Guarda: toda ventana PROPIA con fondo (`fixed inset-0`) cierra con Escape por el mecanismo compartido `useEscapeCerrar`.
// Los diálogos de `components/ui/dialog.tsx` (base-ui) ya lo hacen por su cuenta. Si se agrega una ventana nueva hecha a mano,
// esta prueba falla hasta que use el hook (o se justifique aquí la excepción).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");
// Excepciones con motivo: el propio diálogo compartido y el menú móvil (Escape propio con trampa de foco y retorno del foco).
const EXCEPCIONES = new Map([
  ["components/ui/dialog.tsx", "diálogo compartido (base-ui): Escape nativo"],
  ["app/(dashboard)/MobileNav.tsx", "menú de navegación con Escape y trampa de foco propios"],
]);

function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : archivos(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

test("cada ventana propia con fondo `fixed inset-0` usa useEscapeCerrar", () => {
  const faltan = [...archivos(path.join(RAIZ, "app")), ...archivos(path.join(RAIZ, "components"))]
    .map((p) => [path.relative(RAIZ, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")] as const)
    .filter(([rel, src]) => /fixed inset-0/.test(src) && !EXCEPCIONES.has(rel) && !/useEscapeCerrar\(/.test(src))
    .map(([rel]) => rel);
  assert.deepEqual(faltan, [], `ventanas sin Escape compartido: ${faltan.join(", ")}`);
});
