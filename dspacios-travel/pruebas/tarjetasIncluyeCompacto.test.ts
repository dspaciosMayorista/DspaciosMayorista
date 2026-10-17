import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta: string) => readFileSync(join(raiz, ruta), "utf8");
const buscador = leer("app/tarifario/BuscadorBooking.tsx");
const vista = leer("app/tarifario/VistaBooking.tsx");
const compartida = leer("app/tarifario/tarjetaHotelCompartida.tsx");

test("las dos tarjetas y los dos modales pliegan ubicacion", () => {
  assert.equal((buscador.match(/<UbicacionHotel [^>]* compacto \/>/g) ?? []).length, 1);
  assert.equal((vista.match(/<UbicacionHotel [^>]* compacto \/>/g) ?? []).length, 3);
  assert.match(compartida, /hidden=\{compacto && !abierto\}/);
  assert.match(compartida, /\(!compacto \|\| abierto\) && <iframe/);
});

test("los dos modales pliegan Incluye y las tarjetas usan el contexto compacto", () => {
  assert.equal((vista.match(/<SeccionesIncluye descripcion=\{descripcion(?:Opcion|Oferta)\} compacto \/>/g) ?? []).length, 2);
  assert.equal((vista.match(/<IncluyeCompacto>/g) ?? []).length, 1);
  assert.equal((buscador.match(/<IncluyeCompacto>/g) ?? []).length, 1);
  assert.match(compartida, /Incluye\/No incluye/);
  assert.match(compartida, /hidden=\{!expandido\}/);
});

test("el detalle conserva la descripcion de la oferta y no toca precio ni carrito", () => {
  assert.match(buscador, /descripcionPorPaquete\[r\.paqueteId\]/);
  assert.match(vista, /descripcionPorPaquete\[opcionSel\.paqueteId\]/);
  const bloque = compartida.slice(compartida.indexOf("function SeccionesIncluyeResumen"), compartida.indexOf("// Incluye/No incluye/Tarifas"));
  assert.doesNotMatch(bloque, /addConjunto|useCart|precioVenta|fetch\(/);
});
