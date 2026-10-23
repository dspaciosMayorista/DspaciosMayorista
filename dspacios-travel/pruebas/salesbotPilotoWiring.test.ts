// ===========================================================================
// Piloto de la Ventana de Programas - pruebas de RESTRICCIONES (wiring).
//
// Estas pruebas no importan el codigo: lo LEEN como texto y niegan que
// aparezcan cosas que esta fase prohibo. Es la unica forma de fijar una
// prohibicion sin depender de que el modulo se pueda cargar en `node --test`
// (`consultas.ts` es "use server" e importa `next/headers`).
//
// Son las que hacen que el corte de la Fase B sea una asercion de codigo y no
// una buena intencion. Si alguien mete un `.insert`, un import de CRM o una
// llamada a Meta, el build falla aqui.
//
// Patron tomado de las pruebas "wiring" que ya existen en el repo.
// ===========================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const DIR = "app/(dashboard)/dashboard/cotizaciones/ventana-programas";
const ACCIONES = `${DIR}/consultas.ts`;
const PLANTILLAS = `${DIR}/plantillas.ts`;
const TIPOS = `${DIR}/tiposVista.ts`;
const PAGINA = `${DIR}/page.tsx`;
const CLIENTE = `${DIR}/VentanaProgramasClient.tsx`;

const FUENTES = [ACCIONES, PLANTILLAS, TIPOS, PAGINA, CLIENTE].map((f) => ({
  archivo: f,
  src: readFileSync(f, "utf8"),
}));

/** Quita los comentarios de bloque y de linea para no dar falsos positivos. */
function codigo(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

const IMPORTS = FUENTES.map(({ archivo, src }) => ({ archivo, src: codigo(src) }));

// ─── 11. Sin escrituras SQL ────────────────────────────────────────────────

test("11. ninguna operacion de escritura en toda la carpeta", () => {
  for (const { archivo, src } of IMPORTS) {
    for (const op of [".insert(", ".update(", ".upsert(", ".delete(", ".truncate("]) {
      assert.ok(!src.includes(op), `${archivo} contiene una escritura: ${op}`);
    }
  }
});

test("11b. la pagina no revalida: no hay nada que revalidar", () => {
  // Una revalidacion implicaria que la pantalla muta algo.
  for (const { archivo, src } of IMPORTS) {
    assert.ok(!/revalidatePath|revalidateTag/.test(src), `${archivo} revalida`);
  }
});

// ─── 12. Sin CRM ───────────────────────────────────────────────────────────

test("12. ninguna referencia a CRM: ni imports ni tablas", () => {
  const prohibido = [
    "crm_leads",
    "crm_lead_actividades",
    "crm_contactos",
    "lib/crm",
    "createLead",
    "guardarLead",
  ];
  for (const { archivo, src } of IMPORTS) {
    for (const token of prohibido) {
      assert.ok(!src.includes(token), `${archivo} menciona ${token}`);
    }
  }
});

// ─── 13. Sin service_role ni cliente privilegiado ──────────────────────────

test("13. no hay service_role ni cliente admin", () => {
  for (const { archivo, src } of IMPORTS) {
    assert.ok(!/service_role/i.test(src), `${archivo} menciona service_role`);
    assert.ok(!/createAdminClient|supabase\/admin/.test(src), `${archivo} usa cliente admin`);
    assert.ok(!/SERVICE_ROLE/i.test(src), `${archivo} menciona SERVICE_ROLE`);
  }
});

test("13b. el cliente de lectura viene del servidor con anon y cookies", () => {
  const src = readFileSync(ACCIONES, "utf8");
  assert.ok(src.includes('@/lib/supabase/server'), "usa el cliente de servidor");
  // No se inyecta nada desde el exterior: el action arma su propio contexto.
  assert.ok(!/SalesbotLectores|crearLectoresSalesbot/.test(src), "no inyecta lectores propios");
});

// ─── 14. Sin Meta / API / canales ─────────────────────────────────────────

test("14. ninguna llamada a Meta, WhatsApp, Instagram ni webhook", () => {
  const prohibido = [
    "graph.facebook",
    "api.whatsapp",
    "instagram",
    "webhook",
    "sendMessage",
    "sendText",
    "wamid",
    "graph.instagram",
    "axios",
    "https://",
  ];
  for (const { archivo, src } of IMPORTS) {
    for (const token of prohibido) {
      assert.ok(!src.toLowerCase().includes(token.toLowerCase()), `${archivo} menciona ${token}`);
    }
  }
});

test("14b. no hay IA por API", () => {
  const prohibido = ["openai", "anthropic", "gemini", "llm", "prompt", "completion", "chat.completions"];
  for (const { archivo, src } of IMPORTS) {
    for (const token of prohibido) {
      assert.ok(!src.toLowerCase().includes(token.toLowerCase()), `${archivo} menciona ${token}`);
    }
  }
});

// ─── 15. No invoca el motor de PVP ────────────────────────────────────────

test("15. no se invoca pvpPrograma: el PVP llega ya calculado", () => {
  for (const { archivo, src } of IMPORTS) {
    assert.ok(!src.includes("pvpPrograma"), `${archivo} recalcula el PVP`);
    assert.ok(!/programaPrecio/.test(src), `${archivo} importa el motor de precio`);
  }
});

// ─── 16. Las actions validan sesion y rol por si mismas ───────────────────

test("16. cada action pasa por `exigirPiloto`", () => {
  const src = readFileSync(ACCIONES, "utf8");
  const actions = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.ok(actions.length >= 3, `solo hay ${actions.length} actions`);

  // Cada action debe abandonar si la sesion/rol no es valida.
  const cuerpos = src.split(/export async function /).slice(1);
  for (const c of cuerpos) {
    const nombre = c.slice(0, c.indexOf("("));
    assert.ok(
      /const sesion = await exigirPiloto\(\)/.test(c) && /if \(!sesion\.ok\)/.test(c),
      `${nombre} no valida sesion/rol por si misma`,
    );
  }
});

test("16b. el rol se valida contra una lista propia, no contra ROLES_INTERNOS", () => {
  // La lista vive en el modulo puro: un archivo "use server" no puede
  // exportar una constante, y el build lo rechaza.
  const src = readFileSync(TIPOS, "utf8");
  const m = src.match(/ROLES_PILOTO_VENTANA[^=]*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, "no se encontro la declaracion de ROLES_PILOTO_VENTANA");
  const bloque = m[1];

  // `control_vuelo` esta excluido a proposito: no opera comercialmente.
  assert.ok(!bloque.includes("control_vuelo"), "control_vuelo no deberia estar en el piloto");
  for (const rol of ["superadmin", "gerencia", "administracion", "operaciones", "venta"]) {
    assert.ok(bloque.includes(rol), `falta el rol ${rol}`);
  }
  // Y no se hereda de ROLES_INTERNOS: ampliar el piloto debe ser explicito.
  // Se mira el codigo sin comentarios, porque el archivo explica por que NO lo
  // usa, y esa explicacion no es una dependencia.
  assert.ok(!codigo(src).includes("ROLES_INTERNOS"), "no debe depender de ROLES_INTERNOS");

  // Y las dos capas (pagina y actions) usan la MISMA lista.
  assert.ok(readFileSync(PAGINA, "utf8").includes("ROLES_PILOTO_VENTANA"), "la pagina usa la lista");
  assert.ok(readFileSync(ACCIONES, "utf8").includes("ROLES_PILOTO_VENTANA"), "las actions usan la lista");
});

test("16c. la pagina tambien exige sesion y rol (tercera capa)", () => {
  const src = readFileSync(PAGINA, "utf8");
  assert.ok(src.includes("auth.getUser()"), "la pagina valida sesion");
  assert.ok(src.includes('from("usuarios")'), "la pagina lee el rol");
  assert.ok(/includes\(rol\)/.test(src), "la pagina comprueba el rol");
});

// ─── 17. La traza interna no sale hacia la vista ──────────────────────────

test("17. el error que vuelve a la vista no lleva `traza`", () => {
  const tipos = readFileSync(TIPOS, "utf8");
  // El tipo del error de la vista no puede tener `traza`.
  const bloque = tipos.slice(tipos.indexOf("export type ErrorVentana"), tipos.indexOf("export type ResultadoBusquedaVentana"));
  assert.ok(bloque.includes("codigo"), "el error expone codigo");
  assert.ok(!bloque.includes("traza"), "el error NO debe exponer traza");

  const acciones = readFileSync(ACCIONES, "utf8");
  const fn = acciones.slice(acciones.indexOf("function aErrorVentana"));
  assert.ok(fn.includes("codigo"), "aErrorVentana copia el codigo");
  // Y no la copia: la construye a mano, campo por campo.
  assert.ok(!/traza:\s*e\.error\.traza/.test(fn), "aErrorVentana no debe reenviar traza");
});

// ─── 18. Sin persistencia en el navegador ni en el servidor ───────────────

test("18. no hay persistencia: ni localStorage ni base de datos", () => {
  for (const { archivo, src } of IMPORTS) {
    assert.ok(!/localStorage|indexedDB/.test(src), `${archivo} persiste en el navegador`);
  }
});

// ─── 19. El cliente no pinta columnas internas ────────────────────────────

test("19. la UI no menciona columnas internas de Fase A", () => {
  const cliente = codigo(readFileSync(CLIENTE, "utf8"));
  const clienteLower = cliente.toLowerCase();
  for (const col of [
    "notas",
    "neto",
    "pct_mk",
    "pct_fee_tarjeta",
    "asistencia_medica_dia",
    "regla_comisionable",
    "tarifa_",
    "impuesto_",
  ]) {
    assert.ok(!clienteLower.includes(col), `el cliente menciona la columna interna ${col}`);
  }
});

test("19b. la UI no consume el crudo: solo el DTO seguro", () => {
  const cliente = readFileSync(CLIENTE, "utf8");
  // Importa los tipos desde tiposVista, que reexporta el DTO de lib/salesbot.
  assert.ok(cliente.includes('from "./tiposVista"'), "los tipos vienen de tiposVista");
  assert.ok(!/from "@\/lib\/programas"/.test(cliente), "el cliente no importa el modulo crudo");
  // `bajo_solicitud` es el valor crudo de BD: la UI usa `estado_precio`.
  const cod = codigo(cliente);
  assert.ok(!/bajo_solicitud/.test(cod), "el cliente no debe leer bajo_solicitud");
});

test("19c. el bloqueo del guard es estructural: sin textarea ni boton", () => {
  const cliente = codigo(readFileSync(CLIENTE, "utf8"));
  // Cuando `seguro` es false no se monta el textarea: no hay texto que copiar.
  assert.ok(
    /borrador\.seguro && borrador\.texto/.test(cliente),
    "el textarea solo existe si el borrador es seguro",
  );
  assert.ok(/copiar\(\)/.test(cliente) || /function copiar/.test(cliente), "existe copiar()");
  // Y copiar vuelve a verificar el guard: doble barrera.
  assert.ok(
    /textoEsSeguro\(borrador\.texto\)/.test(cliente),
    "copiar() revalida el guard antes de escribir en el portapapeles",
  );
});