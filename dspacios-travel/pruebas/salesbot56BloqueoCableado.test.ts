import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// #56 multiproducto — cableado estático de la consulta de PAQUETES (bloqueo y
// porción) y de las pestañas. Recorre lib/salesbot/ COMPLETO (incluida la
// subcarpeta paquetes/) y todas las pantallas de la consulta. No reemplaza a
// las pruebas de comportamiento (salesbot56Bloqueo*, salesbot56Porcion*).

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

function archivos(dirRel: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const n of readdirSync(join(RAIZ, dirRel))) {
    const rel = `${dirRel}/${n}`;
    if (statSync(join(RAIZ, rel)).isDirectory()) out.push(...archivos(rel, ext));
    else if (ext.test(n)) out.push(rel);
  }
  return out;
}

/** Código sin comentarios de línea ni de bloque (los comentarios pueden nombrar lo que el código NO usa). */
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

const LIB = archivos("lib/salesbot", /\.ts$/);
const PAQUETES = archivos("lib/salesbot/paquetes", /\.ts$/);
const PANTALLAS = archivos("app/(dashboard)/dashboard/salesbot", /\.tsx$/);
const TODO = [...LIB, ...PANTALLAS];

describe("inventario", () => {
  test("existen los módulos de paquetes y las pantallas por producto", () => {
    for (const f of ["contrato", "bloqueo", "porcion", "lectura"]) assert.ok(PAQUETES.includes(`lib/salesbot/paquetes/${f}.ts`), f);
    for (const f of ["page", "comun", "PanelProgramas", "PanelBloqueos", "PanelPorcion"]) assert.ok(PANTALLAS.includes(`app/(dashboard)/dashboard/salesbot/${f}.tsx`), f);
  });
});

describe("solo lectura y sin privilegios propios", () => {
  test("la lectura de paquetes es de servidor", () => {
    assert.match(leer("lib/salesbot/paquetes/lectura.ts"), /^import "server-only";/);
  });

  test("solo los lectores de servidor importan motores o Supabase (los módulos puros no)", () => {
    for (const rel of ["lib/salesbot/paquetes/contrato.ts", "lib/salesbot/paquetes/bloqueo.ts", "lib/salesbot/paquetes/porcion.ts"]) {
      const src = sinComentarios(leer(rel));
      assert.doesNotMatch(src, /^import (?!type)[^;]*from "@\/lib\/(supabase|reservar|tarifario)\//m, rel);
      assert.doesNotMatch(src, /server-only|process\.env/, rel);
    }
  });

  test("nada escribe ni llama RPC", () => {
    for (const rel of TODO) {
      const src = sinComentarios(leer(rel));
      assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/, rel);
      assert.doesNotMatch(src, /\.rpc\(/, rel);
    }
  });

  test("ningún cliente administrador ni service-role propio", () => {
    for (const rel of TODO) assert.doesNotMatch(sinComentarios(leer(rel)), /createAdminClient|service_role|@\/lib\/supabase\/admin/, rel);
  });

  test("la variable de service-role solo se usa para comprobar que EXISTE (nunca se lee su valor)", () => {
    for (const rel of TODO) {
      const src = sinComentarios(leer(rel));
      const usos = src.match(/process\.env\.[A-Z_]+/g) ?? [];
      if (rel !== "lib/salesbot/paquetes/lectura.ts") {
        assert.deepEqual(usos, [], rel);
        continue;
      }
      assert.deepEqual(usos, ["process.env.SUPABASE_SERVICE_ROLE_KEY"]);
      assert.match(src, /if \(!process\.env\.SUPABASE_SERVICE_ROLE_KEY\)/);
    }
  });

  test("con la sesión, la lectura de paquetes solo consulta el perfil y la fila del paquete", () => {
    const src = sinComentarios(leer("lib/salesbot/paquetes/lectura.ts"));
    const tablas = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(tablas, ["armado_paquetes", "usuarios"]);
    // Del paquete solo se pide `pct_mk`, la MISMA columna que lee el motor, para verificar el markup; nunca costos.
    const selects = [...src.matchAll(/from\("armado_paquetes"\)\.select\("([^"]*)"\)/g)].map((m) => m[1]);
    assert.deepEqual(selects, ["pct_mk"]);
  });

  test("el % leído solo se compara: nunca entra en una respuesta", () => {
    const src = sinComentarios(leer("lib/salesbot/paquetes/lectura.ts"));
    const usos = [...src.matchAll(/\.pct\b/g)].length;
    assert.equal(usos, 2, "solo `antes.pct === despues.pct`");
    assert.match(src, /antes\.pct === despues\.pct/);
  });

  test("nunca se consultan sillas, bloqueos ni cupos directamente (llegan agregados del cargador)", () => {
    for (const rel of TODO) assert.doesNotMatch(sinComentarios(leer(rel)), /from\("(sillas|bloqueos_vuelo|cupos_por_bloqueo|empaquetados|tarifa_hotel|hotel_tarifas_unidad)"\)/, rel);
  });

  test("motores consumidos sin editar: solo por sus exports públicos", () => {
    const src = sinComentarios(leer("lib/salesbot/paquetes/lectura.ts"));
    const motores = [...src.matchAll(/^import \{([^}]*)\} from "@\/lib\/(reservar|tarifario)\/([a-zA-Z]+)";/gm)].map((m) => `${m[2]}/${m[3]}:${m[1].replace(/\s+/g, "")}`).sort();
    assert.deepEqual(motores, ["reservar/computo:computarReserva", "reservar/cotizar:buscarHoteles,cotizarPorFechas", "tarifario/datos:cargarDatosTarifario,typeDatosTarifario"]);
  });

  test("no tocan reservar/actions, checkout, CRM ni personas", () => {
    for (const rel of TODO) assert.doesNotMatch(sinComentarios(leer(rel)), /reservar\/actions|checkout\/actions|crm_leads|crm_contactos|lib\/personas/, rel);
  });
});

describe("exclusiones de esta pieza", () => {
  test("ni add-on, ni mascotas: las entradas del motor fijan servicios vacíos y no declaran mascotas", () => {
    for (const rel of ["lib/salesbot/paquetes/bloqueo.ts", "lib/salesbot/paquetes/porcion.ts"]) {
      const src = sinComentarios(leer(rel));
      assert.match(src, /servicios: \[\],/, rel);
      assert.match(src, /pasajeros: \[\],/, rel);
      assert.doesNotMatch(src, /mascotas\s*:/, rel);
    }
  });

  test("sin base comisionable, comisión calculada ni total de Programas", () => {
    for (const rel of TODO.filter((r) => r !== "lib/salesbot/contrato.ts")) {
      const src = sinComentarios(leer(rel));
      assert.doesNotMatch(src, /base_comisionable|comision_estimada|precioTotal|\btotal_pvp\b/, rel);
      assert.doesNotMatch(src, /pct\s*\*\s*\(?\s*(precio|total|pvp|base)/i, rel);
    }
  });

  test("las pantallas solo muestran el % propio de la agencia, nunca un monto", () => {
    for (const rel of PANTALLAS) assert.doesNotMatch(sinComentarios(leer(rel)), /pct_comision|base_comision|monto_comision|comisionB2B/, rel);
  });
});

describe("pantallas", () => {
  // La conversación guiada (#56 MVP) es el ÚNICO componente de cliente; sus garantías
  // (sin persistencia, solo la acción de servidor) las prueba salesbot56ConversacionCableado.
  test("vistas de consulta: de servidor, sin chat", () => {
    for (const rel of PANTALLAS.filter((r) => !r.endsWith("/PanelConversacion.tsx"))) {
      const src = sinComentarios(leer(rel));
      assert.doesNotMatch(src, /"use client"/, rel);
      assert.doesNotMatch(src, /textarea|chat|mensaje del bot/i, rel);
    }
  });

  test("sin emojis", () => {
    for (const rel of PANTALLAS) assert.doesNotMatch(leer(rel), /\p{Extended_Pictographic}/u, rel);
  });

  test("una pestaña por producto y la página las usa", () => {
    const comun = leer("app/(dashboard)/dashboard/salesbot/comun.tsx");
    for (const p of ["programas", "bloqueos", "porcion"]) assert.match(comun, new RegExp(`producto: "${p}"`), p);
    const page = sinComentarios(leer("app/(dashboard)/dashboard/salesbot/page.tsx"));
    assert.match(page, /<Pestanas activo=\{producto\} \/>/);
    for (const p of ["PanelProgramas", "PanelBloqueos", "PanelPorcion"]) assert.match(page, new RegExp(`<${p} sp=\\{sp\\} />`), p);
  });

  test("page.tsx solo exporta lo que Next admite en una página", () => {
    const exports = [...leer("app/(dashboard)/dashboard/salesbot/page.tsx").matchAll(/^export (?:default )?(?:async )?(?:const|function) (\w+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(exports, ["ConsultaComercialPage", "dynamic"]);
  });

  test("las pantallas de paquetes nunca muestran record, netos ni datos de silla", () => {
    for (const rel of PANTALLAS.filter((r) => /Panel(Bloqueos|Porcion)/.test(r))) {
      const src = sinComentarios(leer(rel));
      assert.doesNotMatch(src, /\brecord\b|\bpnr\b/, rel); // en minúscula: `Record<…>` es el tipo de TypeScript
      assert.doesNotMatch(src, /neto|numero_silla|pasajero_|tarifa_para_empaquetar|impuesto/i, rel);
    }
  });

  test("privacidad de ruta: ningún código de SalesBot usa bloqueo_label, la ruta ni origenPorBloqueo", () => {
    for (const rel of TODO) {
      const src = sinComentarios(leer(rel));
      assert.doesNotMatch(src, /bloqueo_label/, rel);
      assert.doesNotMatch(src, /\.ruta\b|\bruta:/, rel);
      assert.doesNotMatch(src, /origenPorBloqueo|origen_iata|origenPublico/, rel);
    }
  });

  test("tarjeta y título de bloqueos: solo destino, noches y fechas", () => {
    const src = sinComentarios(leer("app/(dashboard)/dashboard/salesbot/PanelBloqueos.tsx"));
    assert.match(src, /\{\[o\.destino, o\.noches \? `\$\{o\.noches\} noches` : null\]\.filter\(Boolean\)\.join\(" · "\)\}/);
    assert.match(src, /Cotizar: \{\[oferta\.hotel_nombre \?\? "Hotel", oferta\.destino, `\$\{formatFechaLarga\(oferta\.fecha_ida\)\}/);
    assert.doesNotMatch(src, /Desde \$\{/);
  });
});
