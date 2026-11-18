// Guards the image-delivery wiring of the Programas and Receptivos catalogs (source-level, same pattern as the other
// *.wiring tests): every catalog photo goes through ImagenCatalogo, only the first one is prioritised, and the
// uploaders reduce the file before Storage. No request count or byte claim is made here (see the measurement doc).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (r: string) => readFileSync(new URL(`../${r}`, import.meta.url), "utf8");

test("Programas cards: ImagenCatalogo with a reserved height, first card prioritised, no raw <img>", () => {
  const s = leer("app/tarifario/TarifarioPublic.tsx");
  assert.match(s, /import \{ ImagenCatalogo \} from "@\/components\/ImagenCatalogo"/);
  assert.match(s, /<ImagenCatalogo src=\{p\.portada_url\} alt=\{p\.nombre\} prioridad=\{i === 0\}/);
  assert.doesNotMatch(s, /<img src=\{p\.portada_url\}/, "the raw eager <img> is gone");
});

test("Receptivos cards (search results, catalog, modal) use ImagenCatalogo; none is prioritised (they sit below the search form), only the modal photo the user just opened", () => {
  const b = leer("app/tarifario/BuscadorReceptivos.tsx");
  assert.match(b, /<ImagenCatalogo src=\{fotosPorServicio\[r\.servicioId\]\}/);
  assert.doesNotMatch(b, /prioridad/, "search results: all lazy (they sit below the search form)");
  const e = leer("app/tarifario/ExploraReceptivos.tsx");
  assert.match(e, /<ImagenCatalogo src=\{r\.foto\}/);
  assert.doesNotMatch(e, /prioridad/, "catalog: all lazy (measured: zero catalog photos in the first viewport)");
  const m = leer("app/tarifario/tarjetaHotelCompartida.tsx");
  assert.match(m, /<ImagenCatalogo src=\{receptivo\.foto\}[^>]*prioridad/);
  for (const f of [b, e]) assert.doesNotMatch(f, /next\/image/, "no next/image unoptimized left in the Receptivos cards");
});

test("Uploaders (Programa cover, Receptivo photo) reduce the file first; flyer/historia pieces stay untouched; immutable cache header", () => {
  const p = leer("app/(dashboard)/dashboard/producto/programas/[id]/ProgramaImagenes.tsx");
  // O2: se reduce PRIMERO (prepararSubidaImagen) y el tope FINAL se aplica al resultado; ya no hay un rechazo por tamaño ANTES de reducir.
  assert.match(p, /prepararSubidaImagen\(file, \{ maxMb: MAX_MB, reducir: campo === "portada_url"/);
  assert.doesNotMatch(p, /file\.size > MAX_MB/);
  assert.match(p, /cacheControl: "31536000"/);
  const s = leer("app/(dashboard)/dashboard/producto/servicios/ServicioFotoCell.tsx");
  assert.match(s, /prepararSubidaImagen\(file, \{ maxMb: MAX_MB, reducir: true/);
  assert.doesNotMatch(s, /file\.size > MAX_MB/);
  assert.match(s, /cacheControl: "31536000"/);
});
