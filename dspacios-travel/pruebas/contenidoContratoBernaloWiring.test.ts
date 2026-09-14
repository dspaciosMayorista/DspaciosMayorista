import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Cierre 3F-4B — el editor manual de contenido de un contrato
// (`app/(dashboard)/dashboard/contratos/[numero]/`) no conocía
// `modo_precio`/`valor_total` (migración 176): una línea Bernalo se veía en
// $0 y, al guardar, `guardarItemsContrato` la reemplazaba por completo
// (reemplazarFilas borra TODO lo viejo), perdiendo su `valor_total` real.
// `sincronizarPrecioVenta` tenía el mismo defecto: invitaba a poner
// `ventas.precio_venta` en $0 en un contrato Bernalo.
//
// No ejecutable bajo `node --test` (Supabase/Next real) — se verifica el
// código FUENTE, mismo criterio que el resto de wiring tests del repo.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}

const rutaActions = "app/(dashboard)/dashboard/contratos/[numero]/contenido-actions.ts";
const fuenteActions = leer(rutaActions);
const codigoActions = sinComentarios(fuenteActions);

// ── Prueba obligatoria (b): editor guardando una línea total ──────────────
describe("contenido-actions.ts — hallazgo confirmado (b): guardarItemsContrato rechaza el guardado si hay una línea modo_precio='total'", () => {
  test("consulta modo_precio de las filas EXISTENTES ANTES de reemplazar la tabla", () => {
    const cuerpo = fuenteActions.slice(
      fuenteActions.indexOf("export async function guardarItemsContrato"),
      fuenteActions.indexOf("// ── Hoteles")
    );
    const idxSelect = cuerpo.indexOf(".select(\"modo_precio\")");
    const idxReemplazar = cuerpo.indexOf("reemplazarFilas(guard.sb, \"contrato_items\"");
    assert.notEqual(idxSelect, -1, "no consulta modo_precio de las filas existentes");
    assert.notEqual(idxReemplazar, -1);
    assert.ok(idxSelect < idxReemplazar, "debe consultar modo_precio ANTES de reemplazar la tabla completa");
  });

  test('rechaza el guardado completo (return ok:false) si alguna fila existente tiene modo_precio === "total" — nunca reemplaza la tabla en ese caso', () => {
    const cuerpo = fuenteActions.slice(
      fuenteActions.indexOf("export async function guardarItemsContrato"),
      fuenteActions.indexOf("// ── Hoteles")
    );
    const idxGuard = cuerpo.indexOf('some((it) => it.modo_precio === "total")');
    assert.notEqual(idxGuard, -1);
    const idxReemplazar = cuerpo.indexOf("reemplazarFilas(guard.sb, \"contrato_items\"");
    assert.ok(idxGuard < idxReemplazar, "el guard debe evaluarse antes del reemplazo de la tabla");
    const bloqueGuard = cuerpo.slice(idxGuard, idxGuard + 300);
    assert.match(bloqueGuard, /return \{\s*\n?\s*ok: false,/);
  });
});

// ── Prueba obligatoria (c): sincronizarPrecioVenta en contrato Bernalo ────
describe("contenido-actions.ts — hallazgo confirmado (c): sincronizarPrecioVenta usa totalVisibleContratoItems (nunca invita a $0 en un contrato Bernalo)", () => {
  test("importa totalVisibleContratoItems del helper compartido", () => {
    assert.match(codigoActions, /import \{ totalVisibleContratoItems \} from "@\/lib\/contrato\/valorContratoItem";/);
  });

  test("sincronizarPrecioVenta consulta modo_precio/valor_total y usa el helper — ya no suma solo adultos/ninos/tarifa_adulto/tarifa_nino a mano", () => {
    const cuerpo = fuenteActions.slice(fuenteActions.indexOf("export async function sincronizarPrecioVenta"), fuenteActions.length);
    assert.match(cuerpo, /\.select\("modo_precio, valor_total, adultos, ninos, tarifa_adulto, tarifa_nino"\)/);
    assert.match(cuerpo, /totalVisibleContratoItems\(/);
    assert.doesNotMatch(sinComentarios(cuerpo), /\(it\.adultos \?\? 0\) \* \(it\.tarifa_adulto \?\? 0\)/, "ya no debe quedar la suma manual vieja, que ignoraba valor_total");
  });
});

// ── Editor UI: no debe permitir editar/perder una línea Bernalo en silencio ──
describe("ContenidoContratoEditor.tsx — usa el helper y bloquea el guardado con líneas Bernalo presentes", () => {
  const fuenteEditor = leer("app/(dashboard)/dashboard/contratos/[numero]/ContenidoContratoEditor.tsx");
  const codigoEditor = sinComentarios(fuenteEditor);

  test("importa y usa totalVisibleContratoItems para el total mostrado — ya no suma adultos*tarifaAdulto+ninos*tarifaNino a mano", () => {
    assert.match(codigoEditor, /import \{ totalVisibleContratoItems, valorVisibleContratoItem \} from "@\/lib\/contrato\/valorContratoItem";/);
    assert.match(codigoEditor, /totalVisibleContratoItems\(/);
    assert.doesNotMatch(codigoEditor, /const totalItems = fItems\.reduce\(\(s, it\) => s \+ it\.adultos \* it\.tarifaAdulto \+ it\.ninos \* it\.tarifaNino, 0\);/);
  });

  test('detecta líneas modoPrecio === "total" (hayLineaTotal) y deshabilita "Guardar ítems" cuando existen', () => {
    assert.match(codigoEditor, /const hayLineaTotal = fItems\.some\(\(it\) => it\.modoPrecio === "total"\);/);
    const idxBoton = codigoEditor.indexOf('onClick={() => correr(() => guardarItemsContrato(numero, fItems)');
    const bloqueBoton = codigoEditor.slice(Math.max(0, idxBoton - 200), idxBoton);
    assert.match(bloqueBoton, /disabled=\{pending \|\| hayLineaTotal\}/);
  });

  test("una línea total se renderiza SOLO LECTURA con su valor real (valorVisibleContratoItem) — nunca inputs de adultos/ninos/tarifa editables", () => {
    // La rama condicional del render (`it.modoPrecio === "total" ? (...) :
    // (...)`) es la SEGUNDA aparición del patrón — la primera es la
    // declaración de `hayLineaTotal` más arriba.
    const idxPrimera = codigoEditor.indexOf('it.modoPrecio === "total"');
    const idx = codigoEditor.indexOf('it.modoPrecio === "total"', idxPrimera + 1);
    assert.notEqual(idx, -1);
    const bloque = codigoEditor.slice(idx, idx + 600);
    assert.match(bloque, /valorVisibleContratoItem\(/);
    assert.doesNotMatch(bloque, /onChange=\{\(e\) => setFItems/, "una línea total no debe tener inputs editables en esta rama");
  });
});
