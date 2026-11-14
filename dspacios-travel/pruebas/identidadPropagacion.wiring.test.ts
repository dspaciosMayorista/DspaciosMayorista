import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

// #75 · entrega 2 — el INVENTARIO de propagación de la identidad del contrato es verificable: cada archivo listado en
// pruebas/support/inventarioIdentidad.*.json se revisa aquí. Convenciones en docs/tecnico/identidad-propagacion-285.md.
// El comportamiento (la base rechaza identidad antigua/ausente) se prueba contra Postgres real en supabase/scripts/test_284_*.sh y test_285_*.sh.
function leer(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}
type Inventario = { acciones: string[]; helpers: string[]; paginas: string[]; componentes: string[] };
const dirSoporte = new URL("./support/", import.meta.url);
const inventarios: Array<{ nombre: string; inv: Inventario }> = readdirSync(dirSoporte)
  .filter((f) => /^inventarioIdentidad\..+\.json$/.test(f))
  .sort()
  .map((f) => ({ nombre: f.replace(/^inventarioIdentidad\.|\.json$/g, ""), inv: JSON.parse(readFileSync(new URL(f, dirSoporte), "utf8")) as Inventario }));

const NA = /identidad:n\/a\s*[—-]\s*\S+/; // excepción CON motivo escrito

/** Parámetros (texto) de la función exportada que empieza en `idx`: balancea paréntesis hasta cerrar la lista. */
function parametros(src: string, idx: number): string {
  const ini = src.indexOf("(", idx);
  let prof = 0;
  for (let i = ini; i < src.length; i++) {
    if (src[i] === "(") prof++;
    else if (src[i] === ")" && --prof === 0) return src.slice(ini + 1, i);
  }
  return "";
}

function lineaDe(src: string, idx: number): number {
  return src.slice(0, idx).split("\n").length;
}

describe("inventario de identidad: archivos", () => {
  test("hay al menos un inventario y los archivos listados existen", () => {
    assert.ok(inventarios.length >= 1);
    const faltan: string[] = [];
    for (const { nombre, inv } of inventarios)
      for (const rel of [...inv.acciones, ...inv.helpers, ...inv.paginas, ...inv.componentes])
        if (!existsSync(new URL(`../${rel}`, import.meta.url))) faltan.push(`${nombre}: ${rel}`);
    assert.deepEqual(faltan, [], `archivos del inventario que no existen:\n${faltan.join("\n")}`);
  });
});

describe("acciones y ayudantes: ningún cliente de Supabase anónimo de identidad", () => {
  for (const { nombre, inv } of inventarios) {
    for (const rel of [...inv.acciones, ...inv.helpers]) {
      test(`${nombre} · ${rel}: createClient()/createAdminClient() sin argumento llevan «identidad:n/a — motivo»`, () => {
        const src = leer(rel);
        const malas: string[] = [];
        src.split("\n").forEach((l, i) => {
          if (/\bcreate(Admin)?Client\(\s*\)/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !NA.test(l)) malas.push(`${i + 1}: ${l.trim().slice(0, 110)}`);
        });
        assert.deepEqual(malas, [], `cliente sin identidad (añade el argumento o «// identidad:n/a — motivo»):\n${malas.join("\n")}`);
      });
    }
  }
});

describe("acciones de usuario: toda función exportada declara «identidad: IdentidadContrato» o una excepción con motivo", () => {
  for (const { nombre, inv } of inventarios) {
    for (const rel of inv.acciones) {
      test(`${nombre} · ${rel}`, () => {
        const src = leer(rel);
        const re = /^export\s+async\s+function\s+(\w+)/gm;
        const malas: string[] = [];
        for (let m = re.exec(src); m; m = re.exec(src)) {
          const params = parametros(src, m.index);
          const linea = src.slice(0, m.index).split("\n").length;
          const previas = src.split("\n").slice(Math.max(0, linea - 3), linea).join("\n");
          if (!/IdentidadContrato/.test(params) && !NA.test(previas) && !NA.test(src.split("\n")[linea - 1] ?? "")) malas.push(`${m[1]} (línea ${linea})`);
        }
        assert.deepEqual(malas, [], `funciones sin parámetro de identidad ni «// identidad:n/a — motivo»:\n${malas.join("\n")}`);
      });
    }
  }
});

describe("páginas: el uid sale de la misma consulta que carga el contrato", () => {
  for (const { nombre, inv } of inventarios) {
    for (const rel of inv.paginas) {
      test(`${nombre} · ${rel} selecciona contrato_uid y construye la identidad`, () => {
        const src = leer(rel);
        assert.match(src, /contrato_uid/, "la página debe seleccionar contrato_uid en su consulta");
        assert.match(src, /identidadDe\(/, "la página debe construir la identidad con identidadDe(numero, uid)");
        // Prohibido resolver el uid con una consulta posterior por número para una petición que viene de una pantalla.
        assert.doesNotMatch(src, /rpc\(\s*["']contratos_identidades["']/, "no se consulta la identidad por número aparte: debe venir en la misma consulta");
      });
    }
  }
});

describe("componentes: reciben la identidad como prop y no la recalculan", () => {
  for (const { nombre, inv } of inventarios) {
    for (const rel of inv.componentes) {
      test(`${nombre} · ${rel}`, () => {
        const src = leer(rel);
        assert.match(src, /identidad/, "el componente debe recibir y reenviar `identidad`");
        assert.doesNotMatch(src, /rpc\(\s*["']contratos_identidades["']/, "el cliente no consulta la identidad por número");
      });
    }
  }
});

describe("ningún archivo de la aplicación resuelve la identidad por número para sustituir la de la pantalla", () => {
  test("contratos_identidades solo se usa en el servidor, nunca desde componentes cliente", () => {
    const usos: string[] = [];
    for (const { inv } of inventarios)
      for (const rel of inv.componentes) if (/contratos_identidades/.test(leer(rel))) usos.push(rel);
    assert.deepEqual(usos, []);
  });
});

export { lineaDe };

describe("control_vuelo: la identidad de las sillas sale de sillas_identidades, leída ANTES que las sillas y usada solo si el número coincide", () => {
  for (const rel of ["app/(dashboard)/dashboard/vuelos/[id]/page.tsx", "app/(dashboard)/dashboard/vuelos/pasajeros/page.tsx"]) {
    test(rel, () => {
      const src = leer(rel);
      assert.match(src, /rpc\("sillas_identidades"/, "debe pedir la identidad por la RPC operativa (control_vuelo no lee ventas)");
      assert.doesNotMatch(src, /ventas\(contrato_uid\)/, "el embed de ventas deja a control_vuelo sin identidad");
      assert.ok(src.indexOf('rpc("sillas_identidades"') < src.indexOf('from("sillas")'), "la identidad se lee antes que los datos de las sillas");
      assert.match(src, /\.numero === s\.numero_contrato/, "solo se usa el uid si el número de la silla coincide con el leído");
    });
  }
});

describe("aviso de contrato eliminado/reemplazado: es cortesía, nunca protección", () => {
  test("la ficha monta el aviso con el uid que ya tenía y la acción no devuelve el uid vigente", () => {
    assert.match(leer("app/(dashboard)/dashboard/contratos/[numero]/page.tsx"), /<AvisoContratoCambio numero=\{venta\.numero_contrato\} uid=\{venta\.contrato_uid/);
    const accion = leer("app/(dashboard)/dashboard/contratos/[numero]/vigencia-actions.ts");
    assert.match(accion, /Promise<boolean \| null>/);
    assert.doesNotMatch(accion, /return\s+fila\b|return\s+data\b/, "no devuelve la fila ni el uid vigente");
    const comp = leer("app/(dashboard)/dashboard/contratos/[numero]/AvisoContratoCambio.tsx");
    assert.match(comp, /router\.replace\("\/dashboard"\)/);
    assert.doesNotMatch(comp, /contratos_identidades/);
  });
});
