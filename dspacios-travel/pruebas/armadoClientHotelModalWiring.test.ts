import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// Hallazgo confirmado (parte cliente): `HotelModal`
// (`app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx`) trataba
// "todas seleccionadas" como un arreglo vacío incondicionalmente, y el
// resultado de `setHotelFiltros` se ignoraba (nunca se mostraba el error ni
// se evitaba cerrar el modal). Este archivo es un componente cliente de
// React ("use client") — igual que el resto del wiring de este proyecto, se
// verifica por inspección del código FUENTE real.
// ─────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

function sinComentarios(fuente: string): string {
  return fuente.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\*\*?\s*$/.test(l)).join("\n");
}

const rutaClient = "app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx";
const fuenteClient = leer(rutaClient);
const codigoClient = sinComentarios(fuenteClient);
// `cuerpoFuncion` (brace-depth-aware, ignora "(" / "<" / ">") se confunde con
// las flechas de tipo del destructuring de props de este componente
// (`onClose: () => void; onDone: () => void;`): cada "=>" contiene un ">"
// que la función interpreta como cierre de un genérico angular, dejando el
// contador en negativo y sin poder distinguirlo nunca de "profundidad 0" —
// nunca encuentra el "{" real del cuerpo. Se acota manualmente hasta el
// siguiente componente hermano del archivo (`function PickBox(`) en su lugar.
const idxInicioModal = fuenteClient.indexOf("function HotelModal({");
assert.notEqual(idxInicioModal, -1);
const idxFinModal = fuenteClient.indexOf("function PickBox(", idxInicioModal);
assert.notEqual(idxFinModal, -1);
const cuerpoModal = fuenteClient.slice(idxInicioModal, idxFinModal);

describe("HotelModal — maneja el error inicial de getTarifasHotel (segunda ronda)", () => {
  const idxEffect = cuerpoModal.indexOf("useEffect(() => {");
  const idxFinEffect = cuerpoModal.indexOf("[hotel.id]);");
  const cuerpoEffect = cuerpoModal.slice(idxEffect, idxFinEffect);

  test("si !r.ok: guarda el mensaje en loadError, termina loading, y hace return ANTES de leer r.modelo/r.categorias/r.regimenes/r.tarifas", () => {
    const idxIf = cuerpoEffect.indexOf("if (!r.ok) {");
    assert.notEqual(idxIf, -1);
    const idxSetModelo = cuerpoEffect.indexOf("setModelo(r.modelo);");
    assert.ok(idxIf < idxSetModelo, "el chequeo !r.ok debe ir antes de leer r.modelo");
    const bloqueIf = cuerpoEffect.slice(idxIf, idxSetModelo);
    assert.match(bloqueIf, /setLoadError\(r\.error\);/);
    assert.match(bloqueIf, /setLoading\(false\);/);
    assert.match(bloqueIf, /return;/);
    // Dentro del bloque !r.ok no debe aparecer NINGUNA lectura de las otras
    // propiedades — no existen en esa rama del tipo discriminado (se
    // excluyen los comentarios explicativos, que sí las mencionan por
    // nombre a propósito).
    assert.doesNotMatch(sinComentarios(bloqueIf), /r\.modelo|r\.categorias|r\.regimenes|r\.tarifas/);
  });

  test("declara loadError como estado propio, separado de `error` (el de guardar/setHotelFiltros) — no reutiliza el mismo estado", () => {
    assert.match(cuerpoModal, /const \[loadError, setLoadError\] = useState<string \| null>\(null\);/);
    assert.match(cuerpoModal, /const \[error, setError\] = useState<string \| null>\(null\);/);
  });

  test("en el camino de éxito (r.ok), limpia loadError explícitamente antes de leer r.modelo", () => {
    const idxOk = cuerpoEffect.indexOf("setLoadError(null);");
    assert.notEqual(idxOk, -1);
    const idxSetModelo = cuerpoEffect.indexOf("setModelo(r.modelo);");
    assert.ok(idxOk < idxSetModelo);
  });

  test("guardar() se niega a guardar si loadError está activo, incluso si algo más lo invocara (defensa en profundidad)", () => {
    const idxGuardar = cuerpoModal.indexOf("function guardar() {");
    const bloque = cuerpoModal.slice(idxGuardar, idxGuardar + 500);
    assert.match(bloque, /if \(loadError\) return;/);
  });

  test("el render muestra loadError con un botón para cerrar, y NUNCA renderiza PickBox/tabla/botón Guardar en esa rama", () => {
    const idxRama = cuerpoModal.indexOf(") : loadError ? (");
    assert.notEqual(idxRama, -1);
    const idxFinRama = cuerpoModal.indexOf(") : sinTarifaPublicadaUnidad ? (");
    assert.notEqual(idxFinRama, -1);
    const bloqueRama = cuerpoModal.slice(idxRama, idxFinRama);
    assert.match(bloqueRama, /\{loadError\}/);
    assert.doesNotMatch(bloqueRama, /<PickBox|onClick=\{guardar\}/);
  });

  test('la rama de loadError se evalúa ANTES que "sinTarifaPublicadaUnidad" y las demás ramas del render (fail-closed: un error de carga real nunca se disfraza de "sin tarifas publicadas")', () => {
    const idxLoading = cuerpoModal.indexOf("loading ? (");
    const idxLoadError = cuerpoModal.indexOf(") : loadError ? (");
    const idxSinTarifa = cuerpoModal.indexOf(") : sinTarifaPublicadaUnidad ? (");
    assert.ok(idxLoading < idxLoadError && idxLoadError < idxSinTarifa);
  });
});

describe("HotelModal — reconoce el modelo devuelto por getTarifasHotel", () => {
  test("guarda r.modelo en estado y separa las tarifas por rama (persona/unidad) — nunca asume persona", () => {
    assert.match(cuerpoModal, /setModelo\(r\.modelo\);/);
    assert.match(cuerpoModal, /if \(r\.modelo === "unidad"\) \{/);
  });

  test('el default de "modelo" antes de que responda getTarifasHotel es "persona" (seguro: nunca deja guardar "todas" vacío en un hotel Bernalo por una carrera de estado)', () => {
    assert.match(cuerpoModal, /useState<"persona" \| "unidad">\("persona"\)/);
  });
});

describe('HotelModal.guardar() — "todas" en unidad persiste arreglos EXPLÍCITOS, nunca el sentinela vacío', () => {
  const idxGuardar = cuerpoModal.indexOf("function guardar() {");
  const idxFinGuardar = cuerpoModal.indexOf("// Unidad sin ninguna tarifa PUBLICADA");
  const cuerpoGuardar = cuerpoModal.slice(idxGuardar, idxFinGuardar);

  test('para modelo "unidad" arma catsArr/regsArr como selCatsVigentes/selRegsVigentes SIEMPRE — nunca los reduce a [] aunque esté todo seleccionado', () => {
    assert.match(cuerpoGuardar, /modelo === "unidad" \? selCatsVigentes : selCatsVigentes\.length === cats\.length \? \[\] : selCatsVigentes;/);
    assert.match(cuerpoGuardar, /modelo === "unidad" \? selRegsVigentes : selRegsVigentes\.length === regs\.length \? \[\] : selRegsVigentes;/);
  });

  test("modelo persona conserva el sentinela histórico (arreglo vacío = todas), ahora sobre la selección ya re-filtrada", () => {
    assert.match(cuerpoGuardar, /selCatsVigentes\.length === cats\.length \? \[\] : selCatsVigentes/);
  });
});

describe("HotelModal.guardar() — no cierra el modal ni avisa éxito si setHotelFiltros devuelve error", () => {
  const idxGuardar = cuerpoModal.indexOf("function guardar() {");
  const idxFinGuardar = cuerpoModal.indexOf("// Unidad sin ninguna tarifa PUBLICADA");
  const cuerpoGuardar = cuerpoModal.slice(idxGuardar, idxFinGuardar);

  test("lee el resultado de setHotelFiltros (const r = await ...) en vez de ignorarlo", () => {
    assert.match(cuerpoGuardar, /const r = await setHotelFiltros\(paqueteId, hotel\.id, catsArr, regsArr\);/);
  });

  test("si !r.ok: setea el error y hace return ANTES de onDone()/onClose() — nunca los llama en el mismo camino", () => {
    const idxIf = cuerpoGuardar.indexOf("if (!r.ok) {");
    assert.notEqual(idxIf, -1);
    const idxOnDone = cuerpoGuardar.indexOf("onDone();");
    const idxOnClose = cuerpoGuardar.indexOf("onClose();");
    assert.ok(idxIf < idxOnDone && idxIf < idxOnClose, "el chequeo de error debe ir antes de onDone()/onClose()");
    const bloqueIf = cuerpoGuardar.slice(idxIf, idxOnDone);
    assert.match(bloqueIf, /setError\(r\.error\);/);
    assert.match(bloqueIf, /return;/);
  });

  test("el error se renderiza dentro del modal (no un alert/console aparte)", () => {
    assert.match(cuerpoModal, /\{error && \(/);
    assert.match(cuerpoModal, /\{error\}<\/p>/);
  });
});

describe("HotelModal — hotel unidad sin tarifa publicada: explica y deshabilita", () => {
  test("calcula sinTarifaPublicadaUnidad = modelo unidad Y tarifas vacías, y lo usa para mostrar el mensaje explicativo", () => {
    assert.match(cuerpoModal, /const sinTarifaPublicadaUnidad = modelo === "unidad" && tarifas\.length === 0;/);
    assert.match(cuerpoModal, /sinTarifaPublicadaUnidad \? \(/);
    assert.match(cuerpoModal, /no tiene ninguna tarifa <strong>publicada<\/strong>/);
  });

  test('el botón "Guardar" se deshabilita si es unidad y no hay categoría/alimentación seleccionada (nunca permite guardar vacío)', () => {
    const idxBoton = cuerpoModal.indexOf("onClick={guardar}");
    assert.notEqual(idxBoton, -1);
    const bloqueBoton = cuerpoModal.slice(idxBoton, idxBoton + 200);
    assert.match(bloqueBoton, /disabled=\{saving \|\| \(modelo === "unidad" && \(!selCats\.size \|\| !selRegs\.size\)\)\}/);
  });
});

describe("HotelModal — tarifa Bernalo nunca se muestra bajo columnas Doble/Triple ni se llama \"tarifa neta\"", () => {
  test('la tabla de unidad usa columnas propias (Categoría/Alimentación/Temp./Unidad de cobro/Valor base) — nunca las cabeceras "Doble"/"Triple" de la tabla persona en esa rama', () => {
    const idxTablaUnidad = cuerpoModal.indexOf('modelo === "unidad" ? (');
    const idxTablaPersona = cuerpoModal.indexOf(") : (", idxTablaUnidad);
    const bloqueUnidad = cuerpoModal.slice(idxTablaUnidad, idxTablaPersona);
    assert.match(bloqueUnidad, /Unidad de cobro/);
    assert.match(bloqueUnidad, /Valor base \(bruto\)/);
    assert.doesNotMatch(bloqueUnidad, />Doble<|>Triple</);
  });

  test('el encabezado de la tabla unidad NO dice "tarifa neta" — deja explícito que es bruto/comisionable, no per-cápita', () => {
    const idxTexto = codigoClient.indexOf("Tarifas Bernalo publicadas");
    assert.notEqual(idxTexto, -1);
    const bloque = codigoClient.slice(idxTexto, idxTexto + 200);
    assert.match(bloque, /bruto\/comisionable/);
    assert.doesNotMatch(bloque, /tarifa neta/i);
  });

  test("la tabla persona sigue intacta (Categoría/Régimen/Temp./Doble/Triple) para el modelo persona", () => {
    const idxTablaPersonaHead = codigoClient.indexOf("Tarifas netas cargadas (referencia interna)");
    assert.notEqual(idxTablaPersonaHead, -1);
    const bloque = codigoClient.slice(idxTablaPersonaHead, idxTablaPersonaHead + 700);
    assert.match(bloque, />Doble</);
    assert.match(bloque, />Triple</);
  });
});

describe("HotelModal — P2-1 (DeepSeek): reconcilia selecciones guardadas contra las opciones disponibles al cargar", () => {
  const idxEffect = cuerpoModal.indexOf("useEffect(() => {");
  const idxFinEffect = cuerpoModal.indexOf("[hotel.id]);");
  const cuerpoEffect = cuerpoModal.slice(idxEffect, idxFinEffect);

  test("descarta del Set inicial las categorías/alimentaciones guardadas que ya no estén en r.categorias/r.regimenes (.filter contra la lista fresca)", () => {
    const idxSetSelCats = cuerpoEffect.indexOf("setSelCats(new Set(");
    assert.notEqual(idxSetSelCats, -1);
    const bloque = cuerpoEffect.slice(idxSetSelCats, idxSetSelCats + 400);
    assert.match(bloque, /catsGuardadas \? catsGuardadas\.filter\(\(c\) => r\.categorias\.includes\(c\)\) : r\.categorias/);
    assert.match(bloque, /regsGuardadas \? regsGuardadas\.filter\(\(rg\) => r\.regimenes\.includes\(rg\)\) : r\.regimenes/);
  });

  test("conserva (no descarta) las selecciones guardadas que SÍ siguen vigentes: el filtro es un .includes contra la lista real, no un vaciado incondicional", () => {
    // `catsGuardadas`/`regsGuardadas` se leen de `sel?.categorias`/`sel?.regimenes`
    // (lo persistido) y solo se descarta lo que NO pasa el .includes — lo que sí
    // pasa queda intacto en el arreglo resultante.
    assert.match(cuerpoEffect, /const catsGuardadas = sel\?\.categorias;/);
    assert.match(cuerpoEffect, /const regsGuardadas = sel\?\.regimenes;/);
  });

  test('el sentinela "todas" de persona (sel.categorias === null) sigue sin filtrarse: cae directo a r.categorias completo, no a un .filter que lo vaciaría', () => {
    const idxSetSelCats = cuerpoEffect.indexOf("setSelCats(new Set(");
    const bloque = cuerpoEffect.slice(idxSetSelCats, idxSetSelCats + 200);
    assert.match(bloque, /catsGuardadas \? [\s\S]+ : r\.categorias\)\)/);
  });
});

describe("HotelModal — P2-1 (DeepSeek): re-filtra antes de guardar y bloquea unidad si la selección queda vacía", () => {
  const idxGuardar = cuerpoModal.indexOf("function guardar() {");
  const idxFinGuardar = cuerpoModal.indexOf("// Unidad sin ninguna tarifa PUBLICADA");
  const cuerpoGuardar = cuerpoModal.slice(idxGuardar, idxFinGuardar);

  test("vuelve a filtrar selCats/selRegs contra cats/regs (las opciones actuales) ANTES de construir catsArr/regsArr — defensa adicional, no confía en el Set ya reconciliado al cargar", () => {
    const idxFiltroCats = cuerpoGuardar.indexOf("const selCatsVigentes = [...selCats].filter((c) => cats.includes(c));");
    const idxFiltroRegs = cuerpoGuardar.indexOf("const selRegsVigentes = [...selRegs].filter((r) => regs.includes(r));");
    assert.notEqual(idxFiltroCats, -1);
    assert.notEqual(idxFiltroRegs, -1);
    const idxCatsArr = cuerpoGuardar.indexOf("const catsArr =");
    assert.ok(idxFiltroCats < idxCatsArr && idxFiltroRegs < idxCatsArr, "el re-filtrado debe ejecutarse antes de construir catsArr/regsArr");
  });

  test("modelo unidad: si tras re-filtrar no queda ninguna categoría o alimentación, corta con un mensaje claro y NUNCA llama a setHotelFiltros", () => {
    const idxGuard = cuerpoGuardar.indexOf('if (modelo === "unidad" && (!selCatsVigentes.length || !selRegsVigentes.length)) {');
    assert.notEqual(idxGuard, -1);
    const idxSetHotelFiltros = cuerpoGuardar.indexOf("setHotelFiltros(");
    assert.ok(idxGuard < idxSetHotelFiltros, "el bloqueo debe evaluarse antes de cualquier llamada a setHotelFiltros");
    const idxCierreGuard = cuerpoGuardar.indexOf("}", cuerpoGuardar.indexOf("return;", idxGuard)) + 1;
    const bloqueGuard = cuerpoGuardar.slice(idxGuard, idxCierreGuard);
    assert.match(bloqueGuard, /setError\(/);
    assert.match(bloqueGuard, /ya no están disponibles/);
    assert.match(bloqueGuard, /return;/);
    assert.doesNotMatch(bloqueGuard, /start\(async/, "no debe entrar a la transacción async que llama al servidor");
  });

  test("el bloqueo no cierra el modal ni descarta la configuración en silencio — usa el mismo mecanismo de error visible que el resto del modal (setError), nunca onClose()", () => {
    const idxGuard = cuerpoGuardar.indexOf('if (modelo === "unidad" && (!selCatsVigentes.length || !selRegsVigentes.length)) {');
    const idxCierreGuard = cuerpoGuardar.indexOf("}", cuerpoGuardar.indexOf("return;", idxGuard));
    const bloqueGuard = cuerpoGuardar.slice(idxGuard, idxCierreGuard + 1);
    assert.doesNotMatch(bloqueGuard, /onClose\(\)|onDone\(\)/);
  });

  test('mensaje PERSISTENTE en el render (no solo tras intentar guardar) cuando unidad se queda sin categoría/alimentación seleccionada', () => {
    const idxAviso = cuerpoModal.indexOf('modelo === "unidad" && (!selCats.size || !selRegs.size) && (');
    assert.notEqual(idxAviso, -1);
    const bloque = cuerpoModal.slice(idxAviso, idxAviso + 800);
    assert.match(bloque, /ya no están disponibles o fueron desmarcadas/);
    // Debe estar en la rama de render "normal" (con PickBox), no dentro de guardar().
    const idxGuardarFn = cuerpoModal.indexOf("function guardar() {");
    const idxReturnRender = cuerpoModal.indexOf("return (\n    <div");
    assert.ok(idxAviso > idxGuardarFn && idxAviso > idxReturnRender, "el aviso persistente debe vivir en el render, no dentro de guardar()");
  });
});

describe("HotelModal — P2-2 (DeepSeek): getTarifasHotel envuelto en try/catch", () => {
  const idxEffect = cuerpoModal.indexOf("useEffect(() => {");
  const idxFinEffect = cuerpoModal.indexOf("[hotel.id]);");
  const cuerpoEffect = cuerpoModal.slice(idxEffect, idxFinEffect);

  test("la llamada a getTarifasHotel está dentro de un try, con un catch que maneja el rechazo", () => {
    const idxTry = cuerpoEffect.indexOf("try {");
    const idxAwait = cuerpoEffect.indexOf("const r = await getTarifasHotel(hotel.id);");
    const idxCatch = cuerpoEffect.indexOf("} catch");
    assert.notEqual(idxTry, -1);
    assert.notEqual(idxAwait, -1);
    assert.notEqual(idxCatch, -1);
    assert.ok(idxTry < idxAwait && idxAwait < idxCatch, "el await de getTarifasHotel debe quedar DENTRO del try, antes del catch");
  });

  test("el catch fija el mensaje exacto pedido, termina loading, y no intenta leer ningún resultado (no hay `r` disponible en ese scope)", () => {
    const idxCatch = cuerpoEffect.indexOf("} catch");
    const bloqueCatch = cuerpoEffect.slice(idxCatch, cuerpoEffect.length);
    assert.match(
      bloqueCatch,
      /setLoadError\("No se pudieron cargar las tarifas del hotel\. Cierra esta ventana e inténtalo de nuevo\."\);/
    );
    assert.match(bloqueCatch, /setLoading\(false\);/);
    assert.doesNotMatch(bloqueCatch, /\br\.(ok|modelo|categorias|regimenes|tarifas)\b/);
  });

  test("el catch reutiliza loadError (mismo estado, mismo render) — no un estado ni una rama de UI nuevos y separados", () => {
    const idxCatch = cuerpoEffect.indexOf("} catch");
    const bloqueCatch = cuerpoEffect.slice(idxCatch, cuerpoEffect.length);
    assert.match(bloqueCatch, /setLoadError\(/);
    // La rama de render que consume loadError ya bloquea guardar/cierre — se
    // reutiliza tal cual (ver el describe de "maneja el error inicial").
    assert.match(cuerpoModal, /\) : loadError \? \(/);
  });
});

describe("Aislamiento de alcance: la validación CARTESIANA del servidor (setHotelFiltros) no se tocó en esta corrección", () => {
  // Esta corrección (P2-1/P2-2) es exclusivamente de UI/estado del cliente
  // (`HotelModal`) — no se modificó `app/(dashboard)/dashboard/paquetes/actions.ts`
  // en esta ronda. Se confirma leyéndolo (solo lectura, nunca se escribe
  // aquí) que la validación por PARES publicados sigue intacta: sigue
  // bloqueando combinaciones categoría×alimentación inexistentes, no se
  // volvió a una validación por columnas independientes.
  const fuenteActions = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
  const codigoActions = sinComentarios(fuenteActions);

  test("setHotelFiltros sigue construyendo un Set de PARES publicados (JSON.stringify([categoria, alimentacion])), no dos Sets independientes", () => {
    assert.match(codigoActions, /const paresPublicados = new Set\(/);
    assert.match(codigoActions, /JSON\.stringify\(\[f\.categoria, f\.alimentacion\]\)/);
    assert.doesNotMatch(codigoActions, /categoriasPublicadas|alimentacionesPublicadas/);
  });

  test("sigue verificando el producto cartesiano completo categorias × regimenes contra los pares publicados (doble for anidado, rechaza si falta una combinación)", () => {
    const idxDobleFor = codigoActions.indexOf("for (const c of categorias) {");
    assert.notEqual(idxDobleFor, -1);
    const bloque = codigoActions.slice(idxDobleFor, idxDobleFor + 300);
    assert.match(bloque, /for \(const r of regimenes\) \{/);
    assert.match(bloque, /if \(!paresPublicados\.has\(JSON\.stringify\(\[c, r\]\)\)\) \{/);
    assert.match(codigoActions, /No hay ninguna tarifa publicada para la combinación/);
  });
});

describe("PickBox — el selector de categorías/alimentación funciona igual visualmente para ambos modelos (mismo componente, sin ramas por modelo)", () => {
  test("HotelModal usa el MISMO <PickBox> para categorías y regímenes sin importar el modelo (no hay un PickBox alterno para unidad)", () => {
    const usos = [...cuerpoModal.matchAll(/<PickBox/g)];
    assert.equal(usos.length, 2, "debe haber exactamente 2 usos de PickBox (categorías y regímenes), compartidos por ambos modelos");
  });
});
