import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { recalcularNetosPorTarifa, validarReglaComisionable, parseNumOrNull } from "../lib/calc/programaPrecio.ts";
import { salidaTieneContenido, tieneTarifaNegativa, type SalidaContenido } from "../lib/programas/salidasGuardado.ts";

// ───────────────────────────────────────────────────────────────────────────
// § "El proveedor da tarifa comisionable" (Salidas y precios, migración 151)
//
// `recalcularNetosPorTarifa` es lo que dispara el recálculo en pantalla
// cuando cambia la REGLA (modo/valor/% comisión) en vez de una tarifa
// puntual — antes de esto, cambiar la regla no volvía a calcular los netos
// ya escritos, así que quedaban con la regla vieja hasta que alguien
// retipeara cada tarifa a mano.
// ───────────────────────────────────────────────────────────────────────────

const REGLA = { modo: "pct" as const, valor: 3, pctComision: 10 };

test("recalcula cada acomodación con su propia tarifa, sin mezclar valores", () => {
  const r = recalcularNetosPorTarifa(
    { sencilla: 120, doble: 110, triple: 100, multiple: 90 },
    REGLA
  );
  // base = tarifa*(1-3%); comision = base*10%; neto = tarifa - comision.
  // sencilla: base=116.4, com=11.64, neto=108.36
  assert.equal(r.sencilla, 108.36);
  // doble: base=106.7, com=10.67, neto=99.33
  assert.equal(r.doble, 99.33);
  // triple: base=97, com=9.7, neto=90.3
  assert.equal(r.triple, 90.3);
  // multiple: base=87.3, com=8.73, neto=81.27
  assert.equal(r.multiple, 81.27);
  // Las cuatro difieren entre sí: si alguna quedara igual a otra por un cruce
  // de valores, esta comprobación fallaría (con estos números de entrada las
  // cuatro tarifas producen cuatro netos distintos).
  const vals = [r.sencilla, r.doble, r.triple, r.multiple];
  assert.equal(new Set(vals).size, 4, "dos acomodaciones comparten neto: posible mezcla de valores");
});

test("una acomodación sin tarifa del proveedor no se toca (queda null, no 0)", () => {
  const r = recalcularNetosPorTarifa(
    { sencilla: 120, doble: null, triple: null, multiple: null },
    REGLA
  );
  assert.equal(r.sencilla, 108.36);
  assert.equal(r.doble, null);
  assert.equal(r.triple, null);
  assert.equal(r.multiple, null);
});

test("tarifa inválida (vacía, cero, negativa) no produce neto", () => {
  const r = recalcularNetosPorTarifa(
    { sencilla: 0, doble: -5, triple: NaN, multiple: null },
    REGLA
  );
  assert.equal(r.sencilla, null);
  assert.equal(r.doble, null);
  assert.equal(r.triple, null);
  assert.equal(r.multiple, null);
});

test("modo 'ninguno' no resta nada de la base; modo 'impuesto' resta un monto fijo", () => {
  const ninguno = recalcularNetosPorTarifa(
    { sencilla: 100, doble: null, triple: null, multiple: null },
    { modo: "ninguno", valor: 999, pctComision: 10 }
  );
  // base = tarifa (999 se ignora en modo 'ninguno'); com = 100*10% = 10; neto = 90.
  assert.equal(ninguno.sencilla, 90);

  const impuesto = recalcularNetosPorTarifa(
    { sencilla: 100, doble: null, triple: null, multiple: null },
    { modo: "impuesto", valor: 20, pctComision: 10 }
  );
  // base = 100-20 = 80; com = 80*10% = 8; neto = 92.
  assert.equal(impuesto.sencilla, 92);
});

// ───────────────────────────────────────────────────────────────────────────
// `salidaTieneContenido` — el filtro de `guardarSalidas` original solo miraba
// etiqueta/fechaDesde/netoDoble: una fila con SOLO, por ejemplo, `noches` o
// `tarifaSencilla` se descartaba en silencio al guardar. Cada campo se prueba
// SOLO (todos los demás vacíos/null/false) para que quede claro que CADA UNO
// por sí solo basta para conservar la fila.
// ───────────────────────────────────────────────────────────────────────────

const SALIDA_VACIA: SalidaContenido = {
  etiqueta: "", fechaDesde: "", fechaHasta: "", noches: null, columna: "",
  netoSencilla: null, netoDoble: null, netoTriple: null, netoMultiple: null, netoNino: null,
  bajoSolicitud: false,
  tarifaSencilla: null, tarifaDoble: null, tarifaTriple: null, tarifaMultiple: null,
};

test("una salida totalmente vacía se descarta", () => {
  assert.equal(salidaTieneContenido(SALIDA_VACIA), false);
});

test("espacios en blanco NO cuentan como contenido (etiqueta/fechas/columna)", () => {
  assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, etiqueta: "   " }), false);
  assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, fechaDesde: "  " }), false);
  assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, fechaHasta: "  " }), false);
  assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, columna: "  " }), false);
});

const CAMPOS_TEXTO: (keyof SalidaContenido)[] = ["etiqueta", "fechaDesde", "fechaHasta", "columna"];
for (const campo of CAMPOS_TEXTO) {
  test(`campo de texto '${campo}' solo, basta para conservar la fila`, () => {
    assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, [campo]: "x" }), true);
  });
}

// Cero es un valor que el usuario escribió a propósito (ej. niño gratis) —
// distinto de null (nunca se tocó). Debe contar como contenido.
const CAMPOS_NUMERICOS: (keyof SalidaContenido)[] = [
  "noches", "netoSencilla", "netoDoble", "netoTriple", "netoMultiple", "netoNino",
  "tarifaSencilla", "tarifaDoble", "tarifaTriple", "tarifaMultiple",
];
for (const campo of CAMPOS_NUMERICOS) {
  test(`campo numérico '${campo}' en 0 (no null) basta para conservar la fila`, () => {
    assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, [campo]: 0 }), true);
  });
  test(`campo numérico '${campo}' con un valor normal basta para conservar la fila`, () => {
    assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, [campo]: 42 }), true);
  });
}

// El caso explícito que pedía la auditoría: SOLO tarifaSencilla, sin
// etiqueta, sin fecha, sin netoDoble — el filtro viejo la habría descartado.
test("tarifaSencilla sola, sin etiqueta/fecha/netoDoble, conserva la fila", () => {
  const s: SalidaContenido = { ...SALIDA_VACIA, tarifaSencilla: 250 };
  assert.equal(s.etiqueta, "");
  assert.equal(s.fechaDesde, "");
  assert.equal(s.netoDoble, null);
  assert.equal(salidaTieneContenido(s), true);
});

test("bajoSolicitud=true solo, basta para conservar la fila; false solo no alcanza", () => {
  assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, bajoSolicitud: true }), true);
  assert.equal(salidaTieneContenido({ ...SALIDA_VACIA, bajoSolicitud: false }), false);
});

test("guardar TODAS las salidas no elimina las que no usan netoDoble", () => {
  // Un lote donde CADA fila tiene un único campo distinto poblado, y NINGUNA
  // usa netoDoble — el filtro viejo (etiqueta || fechaDesde || netoDoble)
  // las habría descartado todas.
  const lote: SalidaContenido[] = [
    { ...SALIDA_VACIA, fechaHasta: "2026-05-01" },
    { ...SALIDA_VACIA, noches: 3 },
    { ...SALIDA_VACIA, columna: "Zuruma" },
    { ...SALIDA_VACIA, bajoSolicitud: true },
    { ...SALIDA_VACIA, netoSencilla: 100 },
    { ...SALIDA_VACIA, netoTriple: 90 },
    { ...SALIDA_VACIA, netoMultiple: 80 },
    { ...SALIDA_VACIA, netoNino: 0 },
    { ...SALIDA_VACIA, tarifaSencilla: 120 },
    { ...SALIDA_VACIA, tarifaDoble: 110 },
    { ...SALIDA_VACIA, tarifaTriple: 100 },
    { ...SALIDA_VACIA, tarifaMultiple: 90 },
  ];
  assert.ok(lote.every((s) => s.netoDoble == null), "el lote de prueba no debe usar netoDoble en ninguna fila");
  const conservadas = lote.filter(salidaTieneContenido);
  assert.equal(conservadas.length, lote.length, "se descartó al menos una fila válida sin netoDoble");
});

// ───────────────────────────────────────────────────────────────────────────
// `tieneTarifaNegativa` — última barrera del lado app antes del CHECK de BD
// (programa_salidas_tarifas_no_negativas_check).
// ───────────────────────────────────────────────────────────────────────────

test("tieneTarifaNegativa detecta una tarifa negativa en cualquier acomodación", () => {
  const base = { tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null };
  assert.equal(tieneTarifaNegativa([{ ...base, tarifa_sencilla: -1 }]), true);
  assert.equal(tieneTarifaNegativa([{ ...base, tarifa_doble: -1 }]), true);
  assert.equal(tieneTarifaNegativa([{ ...base, tarifa_triple: -1 }]), true);
  assert.equal(tieneTarifaNegativa([{ ...base, tarifa_multiple: -1 }]), true);
});

test("tieneTarifaNegativa no marca null ni cero como negativos", () => {
  const base = { tarifa_sencilla: null, tarifa_doble: null, tarifa_triple: null, tarifa_multiple: null };
  assert.equal(tieneTarifaNegativa([base]), false);
  assert.equal(tieneTarifaNegativa([{ ...base, tarifa_sencilla: 0 }]), false);
  assert.equal(tieneTarifaNegativa([{ ...base, tarifa_sencilla: 120, tarifa_doble: 110 }]), false);
});

// ───────────────────────────────────────────────────────────────────────────
// `validarReglaComisionable` — evita la inconsistencia "0 en pantalla / null
// guardado". Con la regla APAGADA no hay restricciones (los valores solo se
// conservan). Con la regla PRENDIDA, pctComision siempre y valor según modo.
// ───────────────────────────────────────────────────────────────────────────

test("regla inactiva: siempre ok, sin importar qué basura traigan los campos", () => {
  assert.equal(validarReglaComisionable({ activa: false, modo: "pct", valor: null, pctComision: null, modalidadMk: "historica" }).ok, true);
  assert.equal(validarReglaComisionable({ activa: false, modo: "pct", valor: -50, pctComision: 500, modalidadMk: "historica" }).ok, true);
  assert.equal(validarReglaComisionable({ activa: false, modo: "impuesto", valor: -1, pctComision: -1, modalidadMk: "historica" }).ok, true);
});

test("borrar temporalmente la comisión (pctComision null) con la regla activa: inválido", () => {
  const r = validarReglaComisionable({ activa: true, modo: "pct", valor: 3, pctComision: null, modalidadMk: "historica" });
  assert.equal(r.ok, false);
});

test("borrar temporalmente el valor (modo pct) con la regla activa: inválido", () => {
  const r = validarReglaComisionable({ activa: true, modo: "pct", valor: null, pctComision: 10, modalidadMk: "historica" });
  assert.equal(r.ok, false);
});

test("borrar temporalmente el valor (modo impuesto) con la regla activa: inválido", () => {
  const r = validarReglaComisionable({ activa: true, modo: "impuesto", valor: null, pctComision: 10, modalidadMk: "historica" });
  assert.equal(r.ok, false);
});

test("porcentaje de comisión negativo: inválido", () => {
  const r = validarReglaComisionable({ activa: true, modo: "pct", valor: 3, pctComision: -1, modalidadMk: "historica" });
  assert.equal(r.ok, false);
});

test("porcentaje de comisión mayor a 100: inválido", () => {
  const r = validarReglaComisionable({ activa: true, modo: "pct", valor: 3, pctComision: 101, modalidadMk: "historica" });
  assert.equal(r.ok, false);
});

test("modo 'pct': valor negativo o mayor a 100 es inválido", () => {
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: -1, pctComision: 10, modalidadMk: "historica" }).ok, false);
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: 101, pctComision: 10, modalidadMk: "historica" }).ok, false);
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: 0, pctComision: 10, modalidadMk: "historica" }).ok, true);
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: 100, pctComision: 10, modalidadMk: "historica" }).ok, true);
});

test("modo 'impuesto' negativo: inválido; sin tope superior (es un monto, no un %)", () => {
  const r = validarReglaComisionable({ activa: true, modo: "impuesto", valor: -100, pctComision: 10, modalidadMk: "historica" });
  assert.equal(r.ok, false);
  assert.equal(validarReglaComisionable({ activa: true, modo: "impuesto", valor: 500000, pctComision: 10, modalidadMk: "historica" }).ok, true);
});

test("modo 'ninguno': el valor no se valida (puede traer cualquier resto de otro modo)", () => {
  assert.equal(validarReglaComisionable({ activa: true, modo: "ninguno", valor: null, pctComision: 10, modalidadMk: "historica" }).ok, true);
  assert.equal(validarReglaComisionable({ activa: true, modo: "ninguno", valor: -999, pctComision: 10, modalidadMk: "historica" }).ok, true);
  assert.equal(validarReglaComisionable({ activa: true, modo: "ninguno", valor: 500000, pctComision: 10, modalidadMk: "historica" }).ok, true);
  // pctComision SIGUE siendo obligatorio incluso en modo 'ninguno'.
  assert.equal(validarReglaComisionable({ activa: true, modo: "ninguno", valor: 5, pctComision: null, modalidadMk: "historica" }).ok, false);
});

test("NaN/Infinity nunca pasan, ni en valor ni en pctComision", () => {
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: NaN, pctComision: 10, modalidadMk: "historica" }).ok, false);
  assert.equal(validarReglaComisionable({ activa: true, modo: "pct", valor: 3, pctComision: NaN, modalidadMk: "historica" }).ok, false);
  assert.equal(validarReglaComisionable({ activa: true, modo: "impuesto", valor: Infinity, pctComision: 10, modalidadMk: "historica" }).ok, false);
});

test("parseNumOrNull: vacío/espacios/no-numérico → null, nunca 0", () => {
  assert.equal(parseNumOrNull(""), null);
  assert.equal(parseNumOrNull("   "), null);
  assert.equal(parseNumOrNull("abc"), null);
  assert.equal(parseNumOrNull("0"), 0);
  assert.equal(parseNumOrNull("3.5"), 3.5);
  assert.equal(parseNumOrNull("-2"), -2);
});

// "Desactivar, guardar, recargar y volver a activar sin perder información":
// el round-trip completo es un flujo de UI (React) que este repo no prueba a
// nivel de componente. Lo que SÍ se puede probar sin una UI es la mitad de
// BD/servidor del contrato: la regla inactiva no impone restricciones (arriba)
// y — por wiring — ni el servidor ni el cliente ponen en null/0 el valor o el
// % de comisión SOLO porque `activa` sea false; ver la guarda de wiring más
// abajo para `guardarSalidas` y `reglaPayload`.

// ───────────────────────────────────────────────────────────────────────────
// GUARDA DE WIRING — sin mirar el código fuente no hay forma de comprobar
// desde un test unitario que `guardarSalidas` sea ATÓMICO (eso exige una BD
// real; ver supabase/scripts/pruebas y la verificación local documentada en
// el mensaje del PR). Esto solo comprueba que la acción sigue pasando por el
// RPC atómico y no volvió al patrón DELETE + INSERT suelto que motivó la
// migración 151.
// ───────────────────────────────────────────────────────────────────────────
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const actionsSrc = readFileSync(
  join(raiz, "app/(dashboard)/dashboard/producto/programas/actions.ts"),
  "utf8"
);
const guardarSalidasSrc = actionsSrc.slice(actionsSrc.indexOf("export async function guardarSalidas"));

test("guardarSalidas guarda por el RPC atómico, no por delete+insert suelto", () => {
  assert.match(
    guardarSalidasSrc,
    /\.rpc\(\s*"guardar_programa_salidas"/,
    "guardarSalidas dejó de llamar al RPC atómico"
  );
  assert.doesNotMatch(
    guardarSalidasSrc.slice(0, guardarSalidasSrc.indexOf(".rpc(")),
    /\.from\(\s*"programa_salidas"\s*\)\s*\.delete\(/,
    "volvió un DELETE suelto antes del RPC: reabre la ventana sin atomicidad que corrigió la 151"
  );
});

test("guardarSalidas manda tanto la regla como las tarifas del proveedor al RPC", () => {
  assert.match(guardarSalidasSrc, /p_regla:\s*\{/, "no arma p_regla para el RPC");
  assert.match(guardarSalidasSrc, /activa:\s*!!regla\.activa/, "no manda si la regla está activa");
  assert.match(guardarSalidasSrc, /tarifa_sencilla:\s*num\(s\.tarifaSencilla\)/, "no manda tarifa_sencilla al RPC");
  assert.match(guardarSalidasSrc, /tarifa_doble:\s*num\(s\.tarifaDoble\)/, "no manda tarifa_doble al RPC");
  assert.match(guardarSalidasSrc, /tarifa_triple:\s*num\(s\.tarifaTriple\)/, "no manda tarifa_triple al RPC");
  assert.match(guardarSalidasSrc, /tarifa_multiple:\s*num\(s\.tarifaMultiple\)/, "no manda tarifa_multiple al RPC");
});

test("guardarSalidas filtra con salidaTieneContenido, no con el OR viejo de 3 campos", () => {
  assert.match(guardarSalidasSrc, /\.filter\(salidaTieneContenido\)/, "dejó de usar el predicado completo");
  assert.doesNotMatch(
    guardarSalidasSrc,
    /\.filter\(\s*\(s\)\s*=>\s*s\.etiqueta\.trim\(\)\s*\|\|\s*s\.fechaDesde\s*\|\|\s*s\.netoDoble/,
    "volvió el filtro viejo (etiqueta || fechaDesde || netoDoble): descarta filas válidas en silencio"
  );
});

test("guardarSalidas repite la validación de la regla en el servidor (no depende solo del navegador)", () => {
  const antesDelRpc = guardarSalidasSrc.slice(0, guardarSalidasSrc.indexOf(".rpc("));
  assert.match(antesDelRpc, /validarReglaComisionable\(/, "no valida la regla antes de llamar al RPC");
  assert.match(antesDelRpc, /if\s*\(!validacion\.ok\)\s*return\s*\{\s*ok:\s*false/, "no corta el guardado si la regla es inválida");
});

test("guardarSalidas rechaza tarifas negativas antes de llegar al RPC", () => {
  const antesDelRpc = guardarSalidasSrc.slice(0, guardarSalidasSrc.indexOf(".rpc("));
  assert.match(antesDelRpc, /tieneTarifaNegativa\(filas\)/, "no comprueba tarifas negativas del lado app");
});

// ── ProgramaEditor: la regla se conserva byte a byte al desactivar ─────────
const editorSrc = readFileSync(
  join(raiz, "app/(dashboard)/dashboard/producto/programas/[id]/ProgramaEditor.tsx"),
  "utf8"
);

test("reglaPayload usa parseNumOrNull, nunca Number(x)||0 (0 silencioso)", () => {
  const bloque = editorSrc.slice(editorSrc.indexOf("const reglaPayload"), editorSrc.indexOf("const reglaInvalidaError"));
  assert.match(bloque, /valor:\s*parseNumOrNull\(cValor\)/, "valor no usa parseNumOrNull");
  assert.match(bloque, /pctComision:\s*parseNumOrNull\(cComision\)/, "pctComision no usa parseNumOrNull");
  assert.doesNotMatch(bloque, /Number\(cValor\)\s*\|\|\s*0/, "volvió el 0 silencioso en valor");
  assert.doesNotMatch(bloque, /Number\(cComision\)\s*\|\|\s*0/, "volvió el 0 silencioso en pctComision");
});

test("reglaPayload NO condiciona valor/pctComision a reglaOn: desactivar debe conservarlos tal cual", () => {
  const bloque = editorSrc.slice(editorSrc.indexOf("const reglaPayload"), editorSrc.indexOf("const reglaInvalidaError"));
  assert.doesNotMatch(
    bloque,
    /reglaOn\s*\?/,
    "reglaPayload no debe ramificar por reglaOn — apagar el check no debe vaciar valor/pctComision"
  );
});

test("SaveBar de Salidas no llama a guardarSalidas si la regla activa es inválida", () => {
  const inicioSalidasEditor = editorSrc.indexOf("function SalidasEditor");
  const finSalidasEditor = editorSrc.indexOf("// ── Incluye / No incluye", inicioSalidasEditor);
  const bloque = editorSrc.slice(inicioSalidasEditor, finSalidasEditor);
  assert.match(bloque, /<SaveBar[\s\S]*?reglaInvalidaError[\s\S]*?\/>/, "el botón Guardar de Salidas ya no revisa reglaInvalidaError antes de guardar");
});

test("cModo/cValor/cComision/reglaOn se inicializan desde el programa cargado, no siempre desde el default", () => {
  assert.match(editorSrc, /useState\(programa\.regla_comisionable\)/, "reglaOn no arranca desde el valor guardado");
  assert.match(
    editorSrc,
    /programa\.regla_comisionable_valor\s*!=\s*null\s*\?\s*String\(programa\.regla_comisionable_valor\)/,
    "cValor no restaura el valor guardado al recargar"
  );
  assert.match(
    editorSrc,
    /programa\.regla_comisionable_pct_comision\s*!=\s*null\s*\?\s*String\(programa\.regla_comisionable_pct_comision\)/,
    "cComision no restaura el % de comisión guardado al recargar"
  );
});

// ── Desactivar con un borrador inválido a medio escribir ───────────────────
// Caso reportado: configuración guardada válida (3% / comisión 10%), el
// usuario escribe temporalmente comisión "150", desactiva el check e intenta
// guardar. La Server Action deja pasar la regla por estar inactiva, pero el
// CHECK incondicional de `pct_comision`/`valor` en BD sigue vigente sin
// importar `activa` — y con el check apagado los controles quedan ocultos,
// así que el usuario no podía corregirlo. La corrección: `setReglaOn` (el
// wrapper alrededor del `useState` crudo) descarta el borrador y vuelve a la
// última configuración YA GUARDADA antes de apagar el check.

const setReglaOnSrc = editorSrc.slice(
  editorSrc.indexOf("const setReglaOn = (v: boolean) => {"),
  editorSrc.indexOf("};", editorSrc.indexOf("const setReglaOn = (v: boolean) => {"))
);

test("al desactivar, setReglaOn restaura cModo/cValor/cComision desde el programa guardado (no los deja tal cual)", () => {
  assert.match(setReglaOnSrc, /if\s*\(\s*!v\s*\)\s*\{/, "no distingue el caso de apagar el check (v === false)");
  assert.match(setReglaOnSrc, /setCModo\(\s*\(programa\.regla_comisionable_modo/, "no restaura cModo desde el programa guardado al desactivar");
  assert.match(setReglaOnSrc, /setCValor\(\s*programa\.regla_comisionable_valor/, "no restaura cValor desde el programa guardado al desactivar");
  assert.match(setReglaOnSrc, /setCComision\(\s*programa\.regla_comisionable_pct_comision/, "no restaura cComision desde el programa guardado al desactivar");
});

test("el borrador se pierde SIEMPRE al desactivar, sea inválido o válido (mismo criterio, sin ramas extra)", () => {
  // Solo debe haber una condición (`if (!v)`) antes de las tres restauraciones
  // — si alguien agrega un chequeo de "solo si es inválido", el round-trip
  // normal (desactivar sin haber tocado nada) dejaría de ser un no-op idéntico.
  const condiciones = setReglaOnSrc.match(/\bif\s*\(/g) ?? [];
  assert.equal(condiciones.length, 1, "setReglaOn no debe tener más de una condición: el reset es incondicional al desactivar");
});

test("round-trip normal: los fallback de setReglaOn al desactivar son los MISMOS que los del useState inicial (\"pct\"/\"3\"/\"10\")", () => {
  // Si desactivar/reactivar sin editar nada debe verse idéntico a nunca haber
  // tocado el formulario, los defaults usados al restaurar tienen que
  // coincidir carácter por carácter con los defaults del montaje inicial —
  // de lo contrario, un programa con `regla_comisionable_valor` en null que
  // se desactiva y reactiva sin editar terminaría con un valor distinto al
  // que tenía antes de tocar el check.
  const initCModo = editorSrc.match(/useState<ModoBaseComisionable>\(\s*\(programa\.regla_comisionable_modo as ModoBaseComisionable\)\s*\|\|\s*"pct"\s*\);/);
  const resetCModo = setReglaOnSrc.match(/setCModo\(\s*\(programa\.regla_comisionable_modo as ModoBaseComisionable\)\s*\|\|\s*"pct"\s*\);/);
  assert.ok(initCModo, "no se encontró el useState inicial de cModo con fallback \"pct\"");
  assert.ok(resetCModo, "el reset de cModo al desactivar no usa el mismo fallback \"pct\" que el useState inicial");

  const initCValor = editorSrc.match(/programa\.regla_comisionable_valor\s*!=\s*null\s*\?\s*String\(programa\.regla_comisionable_valor\)\s*:\s*"3"/g) ?? [];
  const initCComision = editorSrc.match(/programa\.regla_comisionable_pct_comision\s*!=\s*null\s*\?\s*String\(programa\.regla_comisionable_pct_comision\)\s*:\s*"10"/g) ?? [];
  // Cada expresión debe aparecer DOS veces: una en el useState inicial, otra
  // en el reset de setReglaOn — byte a byte, no solo "algo parecido".
  assert.equal(initCValor.length, 2, "el fallback \"3\" de cValor no se repite igual en el useState inicial y en el reset de setReglaOn");
  assert.equal(initCComision.length, 2, "el fallback \"10\" de cComision no se repite igual en el useState inicial y en el reset de setReglaOn");
});
