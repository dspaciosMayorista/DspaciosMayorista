// PR #409 — «Copiar datos del cliente/titular» solo puede aplicarse a UN pasajero por reserva.
// Antes: ReservaForm y ProgramaReservaForm copiaban sin límite (en el de programas, a todos los pasajeros), dejando
// varios pasajeros con el mismo documento del titular. Estas pruebas se escribieron antes del arreglo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicarCopiaTitular, copiaVigente, deshacerCopiaTitular, puedeCopiarTitular } from "../lib/personas/copiaTitular.ts";

type P = { nombres: string; apellidos: string; tipoDoc: string; numeroDoc: string };
const vacio = (): P => ({ nombres: "", apellidos: "", tipoDoc: "CC", numeroDoc: "" });
const CLI = { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "123" };

test("copiar en un pasajero lo marca y deshabilita a los demás; deshacer restaura lo que había y vuelve a habilitar", () => {
  const pax: P[] = [vacio(), { ...vacio(), nombres: "Luis" }, vacio()];
  const r = aplicarCopiaTitular(pax, 1, CLI, null);
  assert.ok(r);
  assert.deepEqual(r.pax[1], { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "123" });
  assert.equal(puedeCopiarTitular(r.copia, 1), true, "el marcado puede deshacer");
  assert.equal(puedeCopiarTitular(r.copia, 0), false);
  assert.equal(puedeCopiarTitular(r.copia, 2), false);
  // Un segundo intento sobre otro pasajero no hace nada.
  assert.equal(aplicarCopiaTitular(r.pax, 0, CLI, r.copia), null);
  const u = deshacerCopiaTitular(r.pax, r.copia);
  assert.equal(u.copia, null);
  assert.deepEqual(u.pax[1], { ...vacio(), nombres: "Luis" }, "se restauran los datos previos");
  assert.equal(puedeCopiarTitular(u.copia, 0), true);
  assert.ok(aplicarCopiaTitular(u.pax, 0, CLI, u.copia), "tras deshacer se puede copiar en otro");
});

test("si el pasajero marcado desaparece de la lista, la marca deja de bloquear a los demás", () => {
  const r = aplicarCopiaTitular([vacio(), vacio(), vacio()], 2, CLI, null)!;
  assert.equal(copiaVigente(r.copia, 3), r.copia);
  assert.equal(copiaVigente(r.copia, 2), null);
  assert.equal(puedeCopiarTitular(copiaVigente(r.copia, 2), 0), true);
});

test("documento no admitido como pasajero: se copian los nombres y el documento queda por capturar (regla vigente)", () => {
  const r = aplicarCopiaTitular([vacio()], 0, { ...CLI, tipoDoc: "NIT", numeroDoc: "900" }, null)!;
  assert.deepEqual(r.pax[0], { nombres: "Ana", apellidos: "Ruiz", tipoDoc: "CC", numeroDoc: "" });
});

test("las dos superficies del botón usan el mismo componente y ya no copian directo", () => {
  const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  for (const f of ["app/(dashboard)/dashboard/reservar/nuevo/ReservaForm.tsx", "app/(dashboard)/dashboard/reservar/programa/[id]/ProgramaReservaForm.tsx"]) {
    const src = leer(f);
    assert.match(src, /BotonCopiarTitular/, f);
    assert.match(src, /aplicarCopiaTitular/, f);
    assert.doesNotMatch(src, /\.\.\.documentoPasajeroDesdeCliente\(/, `${f}: la copia directa debe pasar por aplicarCopiaTitular`);
  }
});
