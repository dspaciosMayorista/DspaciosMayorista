import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verificarFichasComisionManual,
  consultarFichasSupabase,
  fichaDeContrato,
  type VerificacionFichas,
} from "../lib/auth/fichaComisionManual.ts";
import { supabaseEnMemoria, type Fila, type OpcionesMemoria } from "./support/memoriaSupabase.ts";

// ───────────────────────────────────────────────────────────────────────────
// La verificación de fichas en `aliados_b2b` decide si el NOMBRE puede abrir
// un contrato (portal B2B y documentos por URL). "No hay ficha" abre el
// acceso, así que todo lo que no sea una respuesta completa y coherente tiene
// que devolver `completa: false` (= desconocido = no se abre por nombre).
// Se ejercita el ADAPTADOR REAL (`consultarFichasSupabase`) contra un
// PostgREST en memoria con límite de filas e inyección de fallos.
// ───────────────────────────────────────────────────────────────────────────

/** n contratos; los de índice en `conFicha` tienen `filasPorFicha` filas con aliado_id. */
function escenario(n: number, conFicha: (i: number) => boolean, filasPorFicha = 1) {
  const numeros = Array.from({ length: n }, (_, i) => `L-${String(i).padStart(5, "0")}`);
  const filas: Fila[] = [];
  let id = 1;
  numeros.forEach((num, i) => {
    // Una comisión SIN ficha en todos (no debe contar) …
    filas.push({ id: id++, numero_contrato: num, aliado_id: null });
    // … y con ficha solo en los marcados.
    if (conFicha(i)) for (let k = 0; k < filasPorFicha; k++) filas.push({ id: id++, numero_contrato: num, aliado_id: 7 });
  });
  return { numeros, tablas: { aliados_b2b: filas } };
}

const verificar = (numeros: string[], tablas: Record<string, Fila[]>, opts: OpcionesMemoria = {}, lp?: { lote?: number; pagina?: number }) => {
  const db = supabaseEnMemoria(tablas, opts);
  return verificarFichasComisionManual(numeros, consultarFichasSupabase(db as never), lp).then((v) => ({ v, db }));
};
const completa = (v: VerificacionFichas) => (v.completa ? v.conFicha : assert.fail(`incompleta: ${(v as { motivo: string }).motivo}`));

test("más de 1.000 candidatos con límite de 1.000 filas por respuesta: verifica TODOS, en lotes", async () => {
  const { numeros, tablas } = escenario(2500, (i) => i % 2 === 0 || i === 2499);
  const { v, db } = await verificar(numeros, tablas, { maxFilas: 1000 });
  const set = completa(v);
  assert.equal(set.size, 1251);
  assert.equal(fichaDeContrato(v, "L-02499"), true, "el último candidato también se verificó");
  assert.equal(fichaDeContrato(v, "L-00001"), false);
  assert.ok((db.llamadas.aliados_b2b ?? 0) >= 25, "se consultó por lotes, no con un .in() gigante");
});

test("un lote con más filas que el límite del servidor: pagina hasta el total contado", async () => {
  // 3 contratos con 1.500 filas con ficha cada uno, servidor recorta a 400 filas.
  const { numeros, tablas } = escenario(3, () => true, 1500);
  const { v, db } = await verificar(numeros, tablas, { maxFilas: 400 });
  assert.equal(completa(v).size, 3);
  assert.ok((db.llamadas.aliados_b2b ?? 0) >= Math.ceil(4500 / 400), "avanzó por lo recibido, no por lo pedido");
});

test("sin candidatos: completa y vacía, sin consultar", async () => {
  const { v, db } = await verificar([], {});
  assert.equal(completa(v).size, 0);
  assert.equal(db.llamadas.aliados_b2b ?? 0, 0);
});

for (const [caso, fallar] of [
  ["consulta con error en la primera página", (c: { llamada: number }) => (c.llamada === 1 ? "error" : null)],
  ["error en una página intermedia", (c: { llamada: number }) => (c.llamada === 3 ? "error" : null)],
  ["respuesta sin conteo total", () => "sin_conteo"],
  ["página vacía antes de completar (respuesta parcial)", (c: { desde: number | null }) => ((c.desde ?? 0) > 0 ? "vacia" : null)],
  ["el total cambia entre páginas", (c: { llamada: number }) => (c.llamada === 2 ? "conteo_cambia" : null)],
  ["fila de un contrato que no se preguntó", () => "fila_ajena"],
  ["excepción de red", (c: { llamada: number }) => (c.llamada === 2 ? "lanzar" : null)],
] as const) {
  test(`FAIL-CLOSED: ${caso} → incompleta (nunca "no hay ficha")`, async () => {
    // 1.200 candidatos, ninguno con ficha: la respuesta CORRECTA sería "no hay
    // ficha en ninguno" — justo la que abriría el nombre. Con cualquier fallo
    // no se puede afirmar.
    const { numeros, tablas } = escenario(1200, () => false);
    const conPaginas = { ...tablas, aliados_b2b: [...tablas.aliados_b2b, ...Array.from({ length: 900 }, (_, k) => ({ id: 100000 + k, numero_contrato: "L-00000", aliado_id: 7 }))] };
    const { v } = await verificar(numeros, conPaginas, { maxFilas: 300, fallar: fallar as OpcionesMemoria["fallar"] });
    assert.equal(v.completa, false);
    assert.equal(fichaDeContrato(v, "L-00500"), null, "desconocido, no false");
  });
}

test("CONTROL NEGATIVO: la consulta anterior (un .in() sin conteo, error ignorado) decía 'no hay ficha'", async () => {
  const { numeros, tablas } = escenario(1200, (i) => i === 1100);
  // Fallo de la consulta → el código viejo hacía `new Set(data ?? [])`.
  const db = supabaseEnMemoria(tablas, { fallar: () => "error" });
  const { data } = await (db.from("aliados_b2b").select("numero_contrato").in("numero_contrato", numeros).not("aliado_id", "is", null) as unknown as Promise<{ data: Fila[] | null }>);
  const viejo = new Set((data ?? []).map((r) => r.numero_contrato));
  assert.equal(viejo.has("L-01100"), false, "el código viejo concluía 'sin ficha' y abría el nombre");
  // Y con límite de filas, sin error: recortado en silencio.
  const db2 = supabaseEnMemoria(escenario(1200, () => true).tablas, { maxFilas: 1000 });
  const { data: d2 } = await (db2.from("aliados_b2b").select("numero_contrato").in("numero_contrato", numeros).not("aliado_id", "is", null) as unknown as Promise<{ data: Fila[] | null }>);
  assert.equal(new Set((d2 ?? []).map((r) => r.numero_contrato)).has("L-01100"), false, "recorte silencioso = 'sin ficha'");

  const { v } = await verificar(numeros, tablas, { fallar: () => "error" });
  assert.equal(fichaDeContrato(v, "L-01100"), null);
});
