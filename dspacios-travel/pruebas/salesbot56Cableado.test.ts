import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LECTURA_MODULO, moduloDeRuta } from "../lib/constants.ts";

// #56 — cableado estático de la consulta interna de programas: solo lectura,
// sin service_role, sin chat ni totales, ruta y menú protegidos por los roles
// aprobados. No reemplaza a las pruebas de comportamiento.

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const lectura = leer("../lib/salesbot/lectura.ts");
const pagina = leer("../app/(dashboard)/dashboard/salesbot/page.tsx");
const layout = leer("../app/(dashboard)/layout.tsx");
const salesbot = readdirSync(new URL("../lib/salesbot/", import.meta.url)).filter((f) => f.endsWith(".ts")).map((f) => leer(`../lib/salesbot/${f}`));
const todo = [...salesbot, pagina];

/** Código sin comentarios de línea ni de bloque (los comentarios pueden nombrar lo que el código NO usa). */
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("solo lectura y sin privilegios", () => {
  test("la lectura es de servidor", () => {
    assert.match(lectura, /^import "server-only";/);
  });

  test("ni lib/salesbot ni la página escriben ni llaman RPC", () => {
    for (const src of todo.map(sinComentarios)) {
      assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/);
      assert.doesNotMatch(src, /\.rpc\(/);
    }
  });

  test("no usan service_role ni el cliente administrador", () => {
    for (const src of todo.map(sinComentarios)) {
      assert.doesNotMatch(src, /createAdminClient|service_role|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  test("no tocan reservar, CRM ni personas", () => {
    for (const src of todo.map(sinComentarios)) {
      assert.doesNotMatch(src, /reservar\/actions|crm_leads|crm_contactos|lib\/personas/);
    }
  });
});

describe("sin chat, totales ni comisión calculada", () => {
  test("la página es de servidor y no es un chat", () => {
    const src = sinComentarios(pagina);
    assert.doesNotMatch(src, /"use client"/);
    assert.doesNotMatch(src, /textarea|chat|mensaje del bot/i);
  });

  test("ni la página ni el módulo calculan base, comisión o total", () => {
    // contrato.ts se excluye: ahí esos nombres están en la LISTA NEGRA de claves.
    const sinContrato = [pagina, ...readdirSync(new URL("../lib/salesbot/", import.meta.url)).filter((f) => f.endsWith(".ts") && f !== "contrato.ts").map((f) => leer(`../lib/salesbot/${f}`))];
    for (const src of sinContrato.map(sinComentarios)) {
      assert.doesNotMatch(src, /base_comisionable|comision_estimada|precioTotal|\btotal_pvp\b/);
    }
  });

  test("sin emojis en la interfaz", () => {
    assert.doesNotMatch(pagina, /\p{Extended_Pictographic}/u);
  });
});

describe("ruta y menú protegidos", () => {
  test("el módulo salesbot admite exactamente los roles aprobados", () => {
    assert.deepEqual([...LECTURA_MODULO.salesbot].sort(), ["administracion", "gerencia", "operaciones", "superadmin", "venta"]);
    assert.equal(LECTURA_MODULO.salesbot.includes("control_vuelo" as never), false);
  });

  test("proxy.ts ve la ruta y sus subrutas como el módulo salesbot", () => {
    assert.equal(moduloDeRuta("/dashboard/salesbot"), "salesbot");
    assert.equal(moduloDeRuta("/dashboard/salesbot/algo"), "salesbot");
  });

  test("la entrada del menú usa el módulo y se oculta en Minorista", () => {
    const linea = layout.split("\n").find((l) => l.includes('href: "/dashboard/salesbot"'));
    assert.ok(linea, "falta la entrada del menú");
    assert.match(linea, /modulo: "salesbot"/);
    assert.match(linea, /minoristaOculto: true/);
  });

  test("getProgramaDetalle delega en el mismo armado puro que el lector seguro", () => {
    const programas = leer("../lib/programas.ts");
    const cuerpo = (nombre: string) => programas.slice(programas.indexOf(`export async function ${nombre}(`)).split("\n}\n")[0];
    assert.match(cuerpo("getProgramaDetalle"), /return armarDetallePrograma\(programa,/);
    assert.match(cuerpo("getProgramaDetalleSeguro"), /armarDetallePrograma\(programa,/);
  });

  test("el lector seguro no lee el proveedor", () => {
    const programas = leer("../lib/programas.ts");
    const seguro = programas.slice(programas.indexOf("export async function getProgramaDetalleSeguro(")).split("\n}\n")[0];
    assert.doesNotMatch(seguro, /proveedores\(/);
  });
});
