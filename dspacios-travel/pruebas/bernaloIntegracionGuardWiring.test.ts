import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Fase 3 Bernalo — guardia fail-closed (ver el informe entregado con esta
// tarea para el análisis completo de por qué el alcance quedó acotado a
// esto). Un hotel con `hoteles.modelo_tarifario = 'unidad'` administra su
// tarifa en `hotel_tarifas_unidad` (fase 2), NO en `tarifa_hotel`. Antes de
// este cambio, NADA en Reservar ni en el armado de paquetes comprobaba
// `modelo_tarifario`: un hotel migrado a Bernalo seguía silenciosamente
// costeado por `tarifa_hotel`/`tarifario_resultado` — vacío (precio $0
// invisible) o, peor, con datos VIEJOS de antes de la migración si el hotel
// usó el editor por persona primero.
//
// `computo.ts`/`paquetes/actions.ts` requieren Supabase real (`"use server"`,
// `next/headers`) — igual que el resto del wiring de este proyecto (ver
// `pruebas/serviciosPaqueteWiring.test.ts`), se verifica por inspección del
// código FUENTE real: que el chequeo ocurre ANTES de tocar cualquier tabla
// de tarifa, no solo que existe en alguna parte del archivo.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// Extrae el cuerpo de una función balanceando llaves reales (ignora las que
// aparecen dentro de paréntesis/genéricos de la firma) — mismo criterio que
// `pruebas/serviciosPaqueteWiring.test.ts`.
function cuerpoFuncion(fuenteCompleta: string, firmaOAncla: string): string {
  const idx = fuenteCompleta.indexOf(firmaOAncla);
  assert.ok(idx > -1, `no se encontró "${firmaOAncla}" en el archivo`);
  let profundidadParen = 0;
  let profundidadAngulo = 0;
  let idxLlaveInicial = -1;
  for (let i = idx; i < fuenteCompleta.length; i++) {
    const ch = fuenteCompleta[i];
    if (ch === "(") profundidadParen++;
    else if (ch === ")") profundidadParen--;
    else if (ch === "<") profundidadAngulo++;
    else if (ch === ">") profundidadAngulo--;
    else if (ch === "{" && profundidadParen === 0 && profundidadAngulo === 0) { idxLlaveInicial = i; break; }
  }
  assert.ok(idxLlaveInicial > -1, `no se encontró el "{" real del cuerpo tras "${firmaOAncla}"`);
  let profundidad = 0;
  for (let i = idxLlaveInicial; i < fuenteCompleta.length; i++) {
    if (fuenteCompleta[i] === "{") profundidad++;
    else if (fuenteCompleta[i] === "}") {
      profundidad--;
      if (profundidad === 0) return fuenteCompleta.slice(idx, i + 1);
    }
  }
  throw new Error(`no se encontró el cierre del cuerpo de "${firmaOAncla}"`);
}

const computo = leer("lib/reservar/computo.ts");
const paqueteActions = leer("app/(dashboard)/dashboard/paquetes/actions.ts");

describe("computo.ts (computarReserva) — guardia modelo_tarifario ANTES de leer tarifa_hotel/tarifario_resultado", () => {
  const cuerpo = cuerpoFuncion(computo, "export async function computarReserva(");

  test("consulta hoteles.modelo_tarifario con el cliente recibido (sesión), no un cliente propio", () => {
    assert.match(cuerpo, /\.from\("hoteles"\)\s*\.select\("modelo_tarifario"\)/);
    assert.doesNotMatch(cuerpo, /createAdminClient\(\)[\s\S]{0,80}modelo_tarifario/);
  });

  test("un error de Supabase al validar el modelo falla cerrado (nunca sigue de largo)", () => {
    assert.match(cuerpo, /if \(modeloError\) return \{ ok: false,/);
  });

  test("modelo_tarifario === 'unidad' bloquea con un mensaje explícito, antes de calcular ningún precio", () => {
    assert.match(cuerpo, /modeloRow\?\.modelo_tarifario === "unidad"/);
    assert.match(cuerpo, /hotel_tarifas_unidad/);
    assert.match(cuerpo, /todavía no está integrada en Reservar/);
  });

  test("la guardia corre ANTES de usarFechas/liquidarHotelPaquete y ANTES de leer tarifario_resultado para el hotel", () => {
    const posGuardia = cuerpo.indexOf('modeloRow?.modelo_tarifario === "unidad"');
    const posUsarFechas = cuerpo.indexOf("const usarFechas =");
    const posLiquidar = cuerpo.indexOf("liquidarHotelPaquete(");
    const posTarifarioResultado = cuerpo.indexOf('.from("tarifario_resultado")\r\n      .select("acomodacion, precio_pvp');
    assert.notEqual(posGuardia, -1);
    assert.notEqual(posUsarFechas, -1);
    assert.notEqual(posLiquidar, -1);
    assert.notEqual(posTarifarioResultado, -1);
    assert.ok(posGuardia < posUsarFechas, "la guardia debe resolverse antes de decidir la rama usarFechas");
    assert.ok(posGuardia < posLiquidar, "la guardia debe resolverse antes de liquidarHotelPaquete (tarifa_hotel en vivo)");
    assert.ok(posGuardia < posTarifarioResultado, "la guardia debe resolverse antes de leer el PVP de tarifario_resultado");
  });

  test("la guardia NO corre para módulo 'servicios' (sin hotel, no hay modelo_tarifario que validar)", () => {
    const posGuardia = cuerpo.indexOf('modeloRow?.modelo_tarifario === "unidad"');
    const bloque = cuerpo.slice(cuerpo.indexOf("const esServicios = input.modulo"), posGuardia + 200);
    assert.match(bloque, /if \(!esServicios\) \{/);
  });
});

describe("paquetes/actions.ts (generarTarifario) — hoteles 'unidad' se EXCLUYEN, nunca leen tarifa_hotel", () => {
  const cuerpo = cuerpoFuncion(paqueteActions, "export async function generarTarifario(paqueteId: number): Promise<Result> {");

  test("selecciona modelo_tarifario del hotel junto con nombre/moneda", () => {
    assert.match(cuerpo, /hoteles\(nombre, moneda, modelo_tarifario\)/);
  });

  test("hotelIds (usado para consultar hotel_temporadas/tarifa_hotel) EXCLUYE los hoteles con modelo_tarifario === 'unidad'", () => {
    const posExcluidos = cuerpo.indexOf("const hotelesBernaloExcluidos = hoteles");
    const posHotelIds = cuerpo.indexOf("const hotelIds = hoteles");
    const posTarifaHotel = cuerpo.indexOf('.from("tarifa_hotel").select("*").in("hotel_id", hotelIds)');
    assert.notEqual(posExcluidos, -1);
    assert.notEqual(posHotelIds, -1);
    assert.notEqual(posTarifaHotel, -1);
    assert.ok(posExcluidos < posHotelIds, "los excluidos deben calcularse antes de construir hotelIds");
    assert.ok(posHotelIds < posTarifaHotel, "hotelIds (ya filtrado) debe existir antes de consultar tarifa_hotel");
    // La condición de exclusión es explícita: modelo_tarifario === 'unidad'
    // (nunca al revés — un hotel sin el campo, o en 'persona', debe seguir
    // en hotelIds).
    assert.match(cuerpo, /modelo_tarifario === "unidad"/);
    const finFiltro = posHotelIds + cuerpo.slice(posHotelIds).indexOf(".map((h) => h.hotel_id)");
    const filtroHotelIds = cuerpo.slice(posHotelIds, cuerpo.indexOf(";", finFiltro));
    assert.match(filtroHotelIds, /!== "unidad"/);
  });

  test("el resultado final avisa (no falla en silencio) cuántos hoteles quedaron sin tarifas por ser modelo Bernalo", () => {
    assert.match(cuerpo, /hotelesBernaloExcluidos\.length/);
    assert.match(cuerpo, /aviso:/);
    assert.match(cuerpo, /modelo tarifario Bernalo por unidad/);
  });

  test("tarifa_hotel/hotel_temporadas nunca se consultan directamente con hotelIds sin filtrar (no queda un segundo camino sin la exclusión)", () => {
    // Todo `.in("hotel_id", hotelIds)` de este archivo debe usar la variable
    // YA filtrada `hotelIds` (no una lista cruda de `hoteles.map(...)` suelta
    // en otra parte del cuerpo de la función).
    const usosHotelIdsCrudos = [...cuerpo.matchAll(/hoteles\.map\(\(h\) => h\.hotel_id\)/g)];
    // Debe existir EXACTAMENTE uno: el que arma `hotelesBernaloExcluidos`
    // aparte no usa este patrón (usa .filter().map()) — así que el único
    // `.map((h) => h.hotel_id)` sin filtro previo es el de `hotelIds` mismo,
    // que YA está detrás de un `.filter(...)` en la misma expresión.
    for (const m of usosHotelIdsCrudos) {
      const inicioLinea = cuerpo.lastIndexOf("\n", m.index) + 1;
      const linea = cuerpo.slice(inicioLinea, cuerpo.indexOf("\n", m.index));
      assert.match(linea, /\.filter\(/, `un .map((h) => h.hotel_id) sin .filter() previo dejaría pasar hoteles Bernalo: "${linea.trim()}"`);
    }
  });
});

describe("ArmadoClient.tsx — el aviso de hoteles Bernalo excluidos se muestra al generar el tarifario", () => {
  const armadoClient = leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
  test("el mensaje de éxito incluye r.aviso cuando viene presente", () => {
    assert.match(armadoClient, /r\.aviso \? ` \$\{r\.aviso\}` : ""/);
  });
});
