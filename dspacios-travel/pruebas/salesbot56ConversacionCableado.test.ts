import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// #56 MVP de conversación guiada — cableado estático: la conversación vive solo
// en memoria (sin base de datos, URL, localStorage ni logs), la acción de
// servidor autoriza antes de avanzar, el flujo es puro y sin IA, y la página
// conserva las vistas de consulta como secundarias sin romper sus formularios.

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

const PANEL = "app/(dashboard)/dashboard/salesbot/PanelConversacion.tsx";
const ACCION = "app/(dashboard)/dashboard/salesbot/actions.ts";
const CONV = readdirSync(join(RAIZ, "lib/salesbot/conversacion")).filter((f) => f.endsWith(".ts")).map((f) => `lib/salesbot/conversacion/${f}`);

describe("la conversación vive solo en memoria", () => {
  test("el panel es el único componente de cliente y no persiste nada", () => {
    const src = sinComentarios(leer(PANEL));
    assert.match(leer(PANEL), /^"use client";/);
    assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    assert.doesNotMatch(src, /history\.(push|replace)State|useRouter|useSearchParams|router\.(push|replace)|location\.(href|search|hash)\s*=/);
    assert.doesNotMatch(src, /console\.|fetch\(|navigator\.sendBeacon/);
  });

  test("el panel solo importa React, el enlace de Next, íconos, la acción y tipos del contrato", () => {
    const imports = [...leer(PANEL).matchAll(/^import (?:type )?.* from "([^"]+)";/gm)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ["./actions", "@/lib/salesbot/conversacion/contrato", "lucide-react", "next/link", "react"]);
    assert.match(leer(PANEL), /^import type \{[^}]*\} from "@\/lib\/salesbot\/conversacion\/contrato";/m);
  });

  test("el flujo y el intérprete son puros: sin Supabase, entorno, red, logs ni IA", () => {
    for (const rel of CONV) {
      const src = sinComentarios(leer(rel));
      assert.doesNotMatch(src, /^import (?!type)[^;]*from "@\/lib\/(supabase|reservar|tarifario)\//m, rel);
      assert.doesNotMatch(src, /^import (?!type)[^;]*from "@\/lib\/salesbot\/(lectura|paquetes\/lectura)"/m, rel);
      assert.doesNotMatch(src, /server-only|process\.env|fetch\(|console\.|localStorage/, rel);
      assert.doesNotMatch(src, /openai|anthropic|deepseek|gemini|\bllm\b|completions/i, rel);
    }
  });
});

describe("acción de servidor", () => {
  const src = sinComentarios(leer(ACCION));

  test("es una Server Action que autoriza ANTES de avanzar, en cada turno", () => {
    assert.match(leer(ACCION), /^"use server";/);
    const cuerpo = src.slice(src.indexOf("export async function conversar("));
    const iAut = cuerpo.indexOf("await autorizar(");
    const iAv = cuerpo.indexOf("await avanzar(");
    assert.ok(iAut > 0 && iAv > iAut, "autorizar precede a avanzar");
    assert.match(cuerpo, /if \(!a\.ok\) return \{ ok: false, estado: estadoInicial\(\)/, "sin autorización se descarta el estado");
  });

  test("usa la misma regla de acceso que las consultas (roles y tenant)", () => {
    assert.match(src, /resolverAccesoConsulta\(/);
    assert.match(src, /getTenant\(\)/);
    assert.match(src, /select\("rol, activo"\)/);
  });

  test("solo lectura, sin service-role ni escrituras", () => {
    assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(|\.rpc\(/);
    assert.doesNotMatch(src, /createAdminClient|service_role|process\.env/);
    assert.doesNotMatch(src, /console\./);
  });

  test("solo las consultas ya saneadas de SalesBot", () => {
    const imports = [...src.matchAll(/^import \{([^}]*)\} from "(@\/lib\/[^"]+)";/gm)].map((m) => m[2]).sort();
    assert.deepEqual(imports, [
      "@/lib/fechaNegocio",
      "@/lib/observabilidad/medicion",
      "@/lib/salesbot/acceso",
      "@/lib/salesbot/contrato",
      "@/lib/salesbot/conversacion/contrato",
      "@/lib/salesbot/conversacion/flujo",
      "@/lib/salesbot/lectura",
      "@/lib/salesbot/paquetes/lectura",
      "@/lib/supabase/server",
      "@/lib/tenant.server",
    ]);
    assert.doesNotMatch(src, /reservar\/actions|checkout\/actions|lib\/reservar|lib\/tarifario/);
  });

  test("el registro de errores lleva solo el tipo de error, nunca el texto ni el estado", () => {
    const llamadas = [...src.matchAll(/registrarErrorTecnico\(([^;]*)\);/g)].map((m) => m[1]);
    for (const l of llamadas) assert.doesNotMatch(l, /entrada|estado|texto/, l);
    assert.match(src, /new Error\(error\.name\)/);
  });
});

describe("página y vistas secundarias", () => {
  test("la conversación es la vista principal y las consultas quedan como pestañas", () => {
    const pagina = sinComentarios(leer("app/(dashboard)/dashboard/salesbot/page.tsx"));
    assert.match(pagina, /producto === "conversacion" \?/);
    assert.match(pagina, /<PanelConversacion inicial=\{await conversar\(null, \{ tipo: "inicio" \}\)\} \/>/);
    const comun = leer("app/(dashboard)/dashboard/salesbot/comun.tsx");
    assert.match(comun, /\{ producto: "conversacion", etiqueta: "Conversación" \},\s*\{ producto: "programas"/);
  });

  test("los formularios y enlaces de Programas (sin `producto`) siguen abriendo Programas", () => {
    const comun = leer("app/(dashboard)/dashboard/salesbot/comun.tsx");
    const params = JSON.parse(comun.match(/const PARAMS_PROGRAMAS = (\[[^\]]*\]);/)![1]) as string[];
    const programas = leer("app/(dashboard)/dashboard/salesbot/PanelProgramas.tsx");
    const campos = [...programas.matchAll(/name="([a-zA-Z]+)"/g)].map((m) => m[1]);
    assert.ok(campos.length >= 6);
    for (const c of [...campos, "programa"]) assert.ok(params.includes(c), `falta ${c}`);
  });

  test("sin emojis en el panel ni en los textos del bot", () => {
    for (const rel of [PANEL, ...CONV]) assert.doesNotMatch(leer(rel), /\p{Extended_Pictographic}/u, rel);
  });

  test("Programas nunca promete un total; Bloqueos y Porción lo presentan como orientativo", () => {
    const flujo = leer("lib/salesbot/conversacion/flujo.ts");
    assert.match(flujo, /El total depende de las fechas y la acomodación: lo calcula el asesor\./);
    assert.equal((flujo.match(/Cotización ORIENTATIVA: /g) ?? []).length, 2);
    assert.doesNotMatch(flujo, /base_comisionable|monto_comision|comision_b2b/);
  });
});
