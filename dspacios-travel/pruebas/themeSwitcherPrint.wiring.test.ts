import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../components/ThemeSwitcher.tsx", import.meta.url),
  "utf8"
);

test("la barra de estilos permanece fija en pantalla y no aparece al imprimir", () => {
  assert.match(
    src,
    /className="[^"]*\bfixed\b[^"]*\bprint:hidden\b[^"]*"/,
    "el contenedor global debe conservar position fixed y ocultarse en impresión/PDF"
  );
});
