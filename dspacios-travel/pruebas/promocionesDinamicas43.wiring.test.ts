// Guardas de la vista de promociones dinámicas («Tarifas generadas»): consumo y permisos.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const leer = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
const PAGINA = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/page.tsx");
const LIB = leer("lib/hoteles/promocionesDinamicas.ts");
const CAJA = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/PromocionesDinamicasBox.tsx");
const CLIENTE = leer("app/(dashboard)/dashboard/producto/hoteles/[id]/HotelDetalleClient.tsx");

test("consumo: el rol suma exactamente UNA solicitud, en paralelo dentro del Promise.all de la ficha, y el cálculo no consulta", () => {
  const lote = PAGINA.slice(PAGINA.indexOf("await Promise.all(["), PAGINA.indexOf("]);", PAGINA.indexOf("await Promise.all([")));
  assert.match(lote, /sb\.rpc\("mi_rol"\)/);
  assert.equal((PAGINA.match(/sb\.rpc\("mi_rol"\)/g) ?? []).length, 1, "una sola lectura del rol");
  assert.doesNotMatch(LIB, /\.from\(|\.rpc\(|createClient|fetch\(/, "la función es pura: sin lecturas ni escrituras");
  assert.doesNotMatch(CAJA, /\.from\(|\.rpc\(|use server|actions/, "la caja es de solo lectura");
});

test("permisos: los netos se calculan solo para los roles que ven costos; venta no está", () => {
  assert.match(PAGINA, /ROLES_VEN_NETOS as readonly string\[\]\)\.includes\(String\(miRol \?\? ""\)\)\s*\?\s*promocionesDinamicasHotel\(/);
  assert.match(LIB, /ROLES_VEN_NETOS = \["superadmin", "gerencia", "administracion", "operaciones"\] as const/);
});

test("el cliente solo importa el TIPO (el motor de cálculo no viaja al navegador)", () => {
  assert.match(CLIENTE, /import type \{ PromoDinamica \} from "@\/lib\/hoteles\/promocionesDinamicas"/);
  assert.doesNotMatch(CAJA, /^import \{[^}]*\} from "@\/lib\/hoteles\/promocionesDinamicas"/m, "la caja importa solo el tipo");
  assert.doesNotMatch(CLIENTE, /^import \{[^}]*\} from "@\/lib\/hoteles\/promocionesDinamicas"/m);
});
