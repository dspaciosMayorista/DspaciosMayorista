import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tonoModalidad, tonoEstadoEmision, tonoEstadoPago, labelEstadoEmision, labelEstadoPago } from "../lib/vuelos/control.ts";

// ─────────────────────────────────────────────────────────────────────────
// § Colores semánticos de Control Vuelos (modalidad/emisión/pago)
//
// Antes, ControlVuelosTabla/ControlBadges dejaban que EstadoBadge INFIRIERA
// el tono del texto — "Por confirmar" contiene "confirm" y el inferidor
// genérico (pensado para "confirmado"/"pagado"/etc.) lo leía como verde
// (`ok`), igual que Emitido/Pagado: visualmente "no se sabe" se confundía
// con "ya está resuelto".
//
// `tonoModalidad`/`tonoEstadoEmision`/`tonoEstadoPago` (lib/vuelos/control.ts)
// son funciones PURAS — se prueban con una importación real, no por
// inspección de código fuente (a diferencia de los componentes .tsx con JSX,
// que sí requieren ese patrón en este repo, ver vuelosVistaTabs.test.ts).
// ─────────────────────────────────────────────────────────────────────────

// ── Modalidad: serie/null/inválido → neutral; grupo → warn (migración 155:
// "individual" se renombró a "serie" — un valor "individual" que llegara
// hoy ya no es el caso conocido, cae como cualquier inválido: neutral) ─────

test("tonoModalidad('serie') = neutral", () => {
  assert.equal(tonoModalidad("serie"), "neutral");
});
test("tonoModalidad('grupo') = warn", () => {
  assert.equal(tonoModalidad("grupo"), "warn");
});
test("tonoModalidad(null) [Sin definir] = neutral", () => {
  assert.equal(tonoModalidad(null), "neutral");
});
test("tonoModalidad(valor inválido, incluido el 'individual' pre-155) = neutral", () => {
  assert.equal(tonoModalidad("cualquier-cosa"), "neutral");
  assert.equal(tonoModalidad("individual"), "neutral");
});

// ── Estado de emisión: pendiente → warn; emitido → ok; resto → orange ──────

test("tonoEstadoEmision('pendiente') = warn", () => {
  assert.equal(tonoEstadoEmision("pendiente"), "warn");
});
test("tonoEstadoEmision('emitido') = ok", () => {
  assert.equal(tonoEstadoEmision("emitido"), "ok");
});
test("tonoEstadoEmision(null) [Por confirmar] = orange", () => {
  assert.equal(tonoEstadoEmision(null), "orange");
});
test("tonoEstadoEmision(valor inválido) = orange", () => {
  assert.equal(tonoEstadoEmision("valor-raro"), "orange");
});

// ── Estado de pago: pendiente → warn; pagado → ok; resto → orange ──────────

test("tonoEstadoPago('pendiente') = warn", () => {
  assert.equal(tonoEstadoPago("pendiente"), "warn");
});
test("tonoEstadoPago('pagado') = ok", () => {
  assert.equal(tonoEstadoPago("pagado"), "ok");
});
test("tonoEstadoPago(null) [Por confirmar] = orange", () => {
  assert.equal(tonoEstadoPago(null), "orange");
});
test("tonoEstadoPago(valor inválido) = orange", () => {
  assert.equal(tonoEstadoPago("valor-raro"), "orange");
});

// ── "Por confirmar" NUNCA puede terminar en tono verde (ok) ────────────────

test("'Por confirmar' (null, inválido, string vacío) nunca es tono ok — ni en emisión ni en pago", () => {
  for (const v of [null, "invalido", "", "PENDIENTE", "Emitido"]) {
    // Los valores en mayúscula/con espacios tampoco coinciden con los
    // literales exactos 'pendiente'/'emitido'/'pagado' — deben caer también
    // en "Por confirmar"/orange, nunca colarse como si fueran válidos.
    assert.equal(labelEstadoEmision(v), "Por confirmar", `labelEstadoEmision(${JSON.stringify(v)})`);
    assert.notEqual(tonoEstadoEmision(v), "ok", `tonoEstadoEmision(${JSON.stringify(v)}) no debe ser ok`);
    assert.equal(labelEstadoPago(v), "Por confirmar", `labelEstadoPago(${JSON.stringify(v)})`);
    assert.notEqual(tonoEstadoPago(v), "ok", `tonoEstadoPago(${JSON.stringify(v)}) no debe ser ok`);
  }
});

// ── EstadoBadge: tono naranja explícito, sin tocar la inferencia global ────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p: string) => readFileSync(join(raiz, p), "utf8");

const estadoBadgeSrc = leer("components/EstadoBadge.tsx");
const controlTablaSrc = leer("app/(dashboard)/dashboard/vuelos/ControlVuelosTabla.tsx");
const controlBadgesSrc = leer("components/vuelos/ControlBadges.tsx");

test("EstadoBadge: se agregó un tono 'orange' explícito con las clases pedidas", () => {
  assert.match(estadoBadgeSrc, /orange: "border-orange-200 bg-orange-50 text-orange-700"/, "faltan las clases exactas del tono naranja");
});

test("EstadoBadge: inferir() NO cambió — nunca devuelve 'orange' por inferencia de texto (no se tocó la interpretación global)", () => {
  const inferirBody = estadoBadgeSrc.slice(estadoBadgeSrc.indexOf("function inferir"), estadoBadgeSrc.indexOf("export function EstadoBadge"));
  assert.doesNotMatch(inferirBody, /orange/, "inferir() no debe devolver 'orange' — ese tono solo llega por prop explícita");
  // Las tres reglas de texto de inferir() siguen intactas, byte a byte.
  assert.match(inferirBody, /\/\(confirm\|pagad\|disponible\|activ\|aprob\|emitid\|vigente\)\//, "regla 'ok' de inferir() cambió");
  assert.match(inferirBody, /\/\(pend\|plazo\|proceso\|borrador\|revisar\|entrante\)\//, "regla 'warn' de inferir() cambió");
  assert.match(inferirBody, /\/\(cancel\|vencid\|critic\|rechaz\|anul\|devuelt\|no_vend\|no vend\)\//, "regla 'crit' de inferir() cambió");
});

// ── ControlVuelosTabla y ControlBadges usan los MISMOS helpers ─────────────

test("ControlVuelosTabla pasa el tono EXPLÍCITO desde los helpers centralizados (no un tono fijo, no inferencia)", () => {
  // PR A: la fusión con Empaquetados agrega la modalidad "sistema" — la
  // celda de Modalidad pasa por tonoModalidadControl (superset de
  // tonoModalidad que además sabe pintar "sistema"), no por tonoModalidad
  // a secas (ese ni siquiera acepta "sistema" en su tipo).
  assert.match(controlTablaSrc, /tono=\{tonoModalidadControl\(b\.modalidad\)\}/, "Modalidad no usa tonoModalidadControl");
  assert.match(controlTablaSrc, /tono=\{tonoEstadoEmision\(b\.estado_emision\)\}/, "Emisión no usa tonoEstadoEmision");
  assert.match(controlTablaSrc, /tono=\{tonoEstadoPago\(b\.estado_pago\)\}/, "Pago no usa tonoEstadoPago");
  assert.doesNotMatch(controlTablaSrc, /tono="neutral"/, "quedó un tono=\"neutral\" fijo en vez del helper");
});

test("ControlBadges pasa el tono EXPLÍCITO desde los MISMOS helpers centralizados que ControlVuelosTabla", () => {
  assert.match(controlBadgesSrc, /tono=\{tonoModalidad\(modalidad\)\}/, "Modalidad no usa tonoModalidad");
  assert.match(controlBadgesSrc, /tono=\{tonoEstadoEmision\(estadoEmision\)\}/, "Emisión no usa tonoEstadoEmision");
  assert.match(controlBadgesSrc, /tono=\{tonoEstadoPago\(estadoPago\)\}/, "Pago no usa tonoEstadoPago");
  assert.doesNotMatch(controlBadgesSrc, /tono="neutral"/, "quedó un tono=\"neutral\" fijo en vez del helper");
});

test("ControlVuelosTabla y ControlBadges importan tonoModalidad/tonoEstadoEmision/tonoEstadoPago del MISMO módulo compartido", () => {
  for (const [nombre, src] of [["ControlVuelosTabla", controlTablaSrc], ["ControlBadges", controlBadgesSrc]] as const) {
    const finImport = src.indexOf(";", src.indexOf("@/lib/vuelos/control"));
    const importe = src.slice(0, finImport + 1);
    assert.match(importe, /tonoModalidad/, `${nombre} no importa tonoModalidad`);
    assert.match(importe, /tonoEstadoEmision/, `${nombre} no importa tonoEstadoEmision`);
    assert.match(importe, /tonoEstadoPago/, `${nombre} no importa tonoEstadoPago`);
    assert.match(src, /from "@\/lib\/vuelos\/control"/, `${nombre} no importa desde @/lib/vuelos/control`);
  }
});

// ── No se tocaron textos, estados almacenados, filtros ni formularios ─────

test("labelModalidad/labelEstadoEmision/labelEstadoPago (los TEXTOS) no cambiaron", () => {
  // Revisión de PR #268 (defecto 1): labelModalidad ya no llama
  // esModalidadEmision directo — pasa por normalizarModalidadLegible (lee
  // 'individual' como 'serie' durante la ventana de transición 155→157) —
  // pero el TEXTO que produce para cada valor conocido (serie→"Serie",
  // grupo→"Grupo", cualquier otra cosa→SIN_DEFINIR) sigue siendo el mismo.
  const src = readFileSync(join(raiz, "lib/vuelos/control.ts"), "utf8");
  assert.match(
    src,
    /export function labelModalidad\(v: string \| null\): string \{\s*const m = normalizarModalidadLegible\(v\);\s*return m \? MODALIDAD_LABEL\[m\] : SIN_DEFINIR;/
  );
});

test("ControlVuelosTabla: los filtros de emisión/pago no se tocaron (siguen usando matchControl/SIN_DEFINIR_VAL); el de modalidad ahora contempla 'sistema'", () => {
  // PR A: el filtro de Modalidad ya no puede ser un simple matchControl —
  // "sistema" (empaquetados) nunca es null, así que "Sin definir" solo debe
  // seguir aplicando a bloqueos sin modalidad_emision cargada.
  assert.match(
    controlTablaSrc,
    /fModalidad === SIN_DEFINIR_VAL \? b\.modalidad == null : b\.modalidad === fModalidad/,
    "el filtro de modalidad no distingue 'sin definir' (null) del resto"
  );
  assert.match(controlTablaSrc, /matchControl\(b\.estado_emision, fEmision\)/);
  assert.match(controlTablaSrc, /matchControl\(b\.estado_pago, fPago\)/);
});
