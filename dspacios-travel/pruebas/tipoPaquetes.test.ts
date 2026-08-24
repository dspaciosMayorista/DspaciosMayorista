import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TABS_TIPO_PAQUETE,
  TAB_TIPO_PAQUETE_DEFECTO,
  TIPOS_PAQUETE_VALIDOS,
  QS_TIPO_PAQUETE,
  esTipoPaqueteValido,
  resolverTabInicial,
  construirUrlConTab,
  filtrarYOrdenarPaquetes,
  type PaqueteListable,
  type TipoPaquete,
} from "../app/(dashboard)/dashboard/paquetes/tipo-paquetes.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

// ───────────────────────────────────────────────────────────────────────────
// PR B — filtro por tipo + orden alfabético del listado de Paquetes.
// Este archivo importa DIRECTO tipo-paquetes.ts (módulo puro, sin
// "use client"/Supabase) para ejecutar la lógica real de filtrado/orden, no
// solo inspeccionar texto. Las pruebas de "wiring" al final sí leen el
// código fuente de PaquetesListado.tsx/page.tsx como texto para confirmar
// que la pantalla usa este mismo helper (mismo patrón que
// pruebas/fronteraTramos.test.ts).
// ───────────────────────────────────────────────────────────────────────────

type P = PaqueteListable & { id: number };

function pkg(id: number, nombre: string, tipo: TipoPaquete): P {
  return { id, nombre, tipo };
}

const FIXTURE: P[] = [
  pkg(1, "San Andrés Todo Incluido", "bloqueo"),
  pkg(2, "árbol de Cartagena", "porcion_terrestre"),
  pkg(3, "Cartagena Colonial", "porcion_terrestre"),
  pkg(4, "Buceo en San Andrés", "servicios"),
  pkg(5, "Ápice Aventura", "servicios"),
  pkg(6, "Zafiro Caribe", "bloqueo"),
  pkg(7, "apice premium", "servicios"),
  pkg(8, "Full Day Islas", "dinamico"),
  pkg(9, "Écija Excursión", "porcion_terrestre"),
];

describe("TABS_TIPO_PAQUETE — dominio real", () => {
  test("las claves son EXACTAMENTE los 4 valores reales del enum tarifario_modulo", () => {
    assert.deepEqual(
      TABS_TIPO_PAQUETE.map((t) => t.key),
      ["bloqueo", "porcion_terrestre", "servicios", "dinamico"]
    );
    assert.deepEqual([...TIPOS_PAQUETE_VALIDOS].sort(), ["bloqueo", "dinamico", "porcion_terrestre", "servicios"]);
  });

  test("las etiquetas de las 3 pestañas pedidas son EXACTAMENTE las pactadas", () => {
    const porClave = Object.fromEntries(TABS_TIPO_PAQUETE.map((t) => [t.key, t.label]));
    assert.equal(porClave.bloqueo, "PAQUETES");
    assert.equal(porClave.porcion_terrestre, "PORCIÓN TERRESTRE");
    assert.equal(porClave.servicios, "RECEPTIVOS");
  });

  test("esTipoPaqueteValido acepta solo los 4 valores reales, nunca texto inventado", () => {
    for (const v of TIPOS_PAQUETE_VALIDOS) assert.equal(esTipoPaqueteValido(v), true);
    assert.equal(esTipoPaqueteValido("receptivos"), false); // "receptivos" es solo la ETIQUETA, no un valor de tipo
    assert.equal(esTipoPaqueteValido("paquete"), false);
    assert.equal(esTipoPaqueteValido(""), false);
    assert.equal(esTipoPaqueteValido(null), false);
    assert.equal(esTipoPaqueteValido(42), false);
  });

  test("TAB_TIPO_PAQUETE_DEFECTO es la primera pestaña (bloqueo/PAQUETES)", () => {
    assert.equal(TAB_TIPO_PAQUETE_DEFECTO, "bloqueo");
  });
});

describe("resolverTabInicial — ?tipo= de searchParams al tab inicial (sin useEffect)", () => {
  test('"servicios" (string válido) llega tal cual como tabInicial', () => {
    assert.equal(resolverTabInicial("servicios"), "servicios");
  });

  test("cada uno de los 4 valores reales se resuelve a sí mismo", () => {
    for (const v of TIPOS_PAQUETE_VALIDOS) assert.equal(resolverTabInicial(v), v);
  });

  test("valor inválido cae en TAB_TIPO_PAQUETE_DEFECTO (bloqueo)", () => {
    assert.equal(resolverTabInicial("receptivos"), TAB_TIPO_PAQUETE_DEFECTO);
    assert.equal(resolverTabInicial("cualquier-cosa"), TAB_TIPO_PAQUETE_DEFECTO);
    assert.equal(resolverTabInicial(""), TAB_TIPO_PAQUETE_DEFECTO);
  });

  test("ausente (undefined) cae en TAB_TIPO_PAQUETE_DEFECTO", () => {
    assert.equal(resolverTabInicial(undefined), TAB_TIPO_PAQUETE_DEFECTO);
  });

  test("arreglo (query repetido: ?tipo=a&tipo=b, Next.js lo entrega como string[]) cae en TAB_TIPO_PAQUETE_DEFECTO", () => {
    assert.equal(resolverTabInicial(["servicios", "bloqueo"]), TAB_TIPO_PAQUETE_DEFECTO);
    assert.equal(resolverTabInicial([]), TAB_TIPO_PAQUETE_DEFECTO);
  });

  test("otros tipos inesperados (null/número/objeto) caen en TAB_TIPO_PAQUETE_DEFECTO sin lanzar", () => {
    assert.doesNotThrow(() => resolverTabInicial(null));
    assert.equal(resolverTabInicial(null), TAB_TIPO_PAQUETE_DEFECTO);
    assert.equal(resolverTabInicial(42), TAB_TIPO_PAQUETE_DEFECTO);
    assert.equal(resolverTabInicial({ tipo: "servicios" }), TAB_TIPO_PAQUETE_DEFECTO);
  });
});

describe("construirUrlConTab — cambia SOLO `tipo`, conserva los demás params y el hash", () => {
  test("agrega `tipo` cuando no existía, conservando otro param y el hash", () => {
    const r = construirUrlConTab("https://app.example.com/dashboard/paquetes?ordenar=nombre#lista", "servicios");
    const url = new URL(r);
    assert.equal(url.pathname, "/dashboard/paquetes");
    assert.equal(url.searchParams.get("ordenar"), "nombre");
    assert.equal(url.searchParams.get(QS_TIPO_PAQUETE), "servicios");
    assert.equal(url.hash, "#lista");
  });

  test("reemplaza `tipo` cuando ya existía, sin tocar otros params ni el hash", () => {
    const r = construirUrlConTab(
      "https://app.example.com/dashboard/paquetes?tipo=bloqueo&pagina=2#seccion-x",
      "porcion_terrestre"
    );
    const url = new URL(r);
    assert.equal(url.searchParams.get(QS_TIPO_PAQUETE), "porcion_terrestre");
    assert.equal(url.searchParams.get("pagina"), "2");
    assert.equal(url.hash, "#seccion-x");
  });

  test("sin otros params ni hash: solo agrega `tipo`, el pathname no cambia", () => {
    const r = construirUrlConTab("https://app.example.com/dashboard/paquetes", "dinamico");
    const url = new URL(r);
    assert.equal(url.pathname, "/dashboard/paquetes");
    assert.equal(url.searchParams.get(QS_TIPO_PAQUETE), "dinamico");
    assert.equal(url.hash, "");
    assert.equal([...url.searchParams.keys()].length, 1);
  });

  test("conserva varios params existentes a la vez, en orden y valor", () => {
    const r = construirUrlConTab("https://app.example.com/x?a=1&b=2&tipo=servicios&c=3", "bloqueo");
    const url = new URL(r);
    assert.equal(url.searchParams.get("a"), "1");
    assert.equal(url.searchParams.get("b"), "2");
    assert.equal(url.searchParams.get("c"), "3");
    assert.equal(url.searchParams.get(QS_TIPO_PAQUETE), "bloqueo");
  });
});

describe("filtrarYOrdenarPaquetes — cada pestaña muestra únicamente su tipo", () => {
  for (const tipo of TIPOS_PAQUETE_VALIDOS) {
    test(`tipo="${tipo}" — todos los resultados tienen ese tipo, ninguno de otro`, () => {
      const r = filtrarYOrdenarPaquetes(FIXTURE, tipo);
      assert.ok(r.length > 0, "el fixture debe tener al menos un paquete de este tipo");
      assert.ok(r.every((p) => p.tipo === tipo));
    });
  }

  test("la unión de las 4 pestañas reconstruye el fixture completo, sin perder ni duplicar", () => {
    const union = TIPOS_PAQUETE_VALIDOS.flatMap((t) => filtrarYOrdenarPaquetes(FIXTURE, t));
    assert.equal(union.length, FIXTURE.length);
    assert.deepEqual(
      union.map((p) => p.id).sort((a, b) => a - b),
      FIXTURE.map((p) => p.id).sort((a, b) => a - b)
    );
  });
});

describe("filtrarYOrdenarPaquetes — orden alfabético español", () => {
  test("orden alfabético correcto dentro de un tipo", () => {
    const r = filtrarYOrdenarPaquetes(FIXTURE, "porcion_terrestre").map((p) => p.nombre);
    // árbol / Écija / Cartagena Colonial — bajo collator "es" base, á y é se
    // tratan como a/e: árbol < Cartagena Colonial < Écija.
    assert.deepEqual(r, ["árbol de Cartagena", "Cartagena Colonial", "Écija Excursión"]);
  });

  test("mayúsculas y tildes no rompen el orden (Ápice ~ apice, sin importar caja/tilde)", () => {
    const r = filtrarYOrdenarPaquetes(FIXTURE, "servicios").map((p) => p.nombre);
    // "Ápice Aventura" / "apice premium" / "Buceo en San Andrés": bajo
    // sensitivity "base", Ápice/apice comparan solo por lo que sigue
    // ("Aventura" < "premium"), y ambos empiezan por A, antes que "Buceo".
    assert.deepEqual(r, ["Ápice Aventura", "apice premium", "Buceo en San Andrés"]);
  });

  test("no depende del orden de entrada (mismo resultado si el fixture llega desordenado)", () => {
    const barajado = [...FIXTURE].reverse();
    const a = filtrarYOrdenarPaquetes(FIXTURE, "bloqueo").map((p) => p.id);
    const b = filtrarYOrdenarPaquetes(barajado, "bloqueo").map((p) => p.id);
    assert.deepEqual(a, b);
  });
});

describe("filtrarYOrdenarPaquetes — orden determinista con nombres equivalentes", () => {
  test("dos nombres binariamente idénticos se desempatan por id (menor primero), estable ante múltiples corridas", () => {
    const empatados: P[] = [
      pkg(30, "Empate", "bloqueo"),
      pkg(10, "Empate", "bloqueo"),
      pkg(20, "Empate", "bloqueo"),
    ];
    const esperado = [10, 20, 30];
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(filtrarYOrdenarPaquetes(empatados, "bloqueo").map((p) => p.id), esperado);
    }
  });

  test("nombres equivalentes bajo el collator pero binariamente distintos (Ápice vs ápice) no colapsan al azar: exacto antes que el id", () => {
    const r: P[] = [
      pkg(2, "ápice", "servicios"),
      pkg(1, "Ápice", "servicios"),
    ];
    // "Ápice" < "ápice" en comparación binaria de JS (mayúscula < minúscula
    // en UTF-16) — el desempate por texto exacto debe ganarle al id.
    assert.deepEqual(
      filtrarYOrdenarPaquetes(r, "servicios").map((p) => p.id),
      [1, 2]
    );
  });
});

describe("filtrarYOrdenarPaquetes — no muta el arreglo original", () => {
  test("el arreglo de entrada conserva su orden y contenido después de filtrar/ordenar", () => {
    const original = [...FIXTURE];
    const antesJSON = JSON.stringify(FIXTURE);
    filtrarYOrdenarPaquetes(FIXTURE, "porcion_terrestre");
    filtrarYOrdenarPaquetes(FIXTURE, "servicios");
    filtrarYOrdenarPaquetes(FIXTURE, "bloqueo");
    assert.equal(JSON.stringify(FIXTURE), antesJSON);
    assert.deepEqual(FIXTURE, original);
  });

  test("el arreglo devuelto es un objeto distinto al de entrada", () => {
    const r = filtrarYOrdenarPaquetes(FIXTURE, "bloqueo");
    assert.notEqual(r, FIXTURE);
  });
});

describe("filtrarYOrdenarPaquetes — tipo sin resultados", () => {
  test("un tipo sin ningún paquete devuelve arreglo vacío (no null/undefined, no lanza)", () => {
    const soloBloqueo: P[] = [pkg(1, "Único", "bloqueo")];
    assert.doesNotThrow(() => filtrarYOrdenarPaquetes(soloBloqueo, "dinamico"));
    assert.deepEqual(filtrarYOrdenarPaquetes(soloBloqueo, "dinamico"), []);
  });

  test("el arreglo de entrada vacío no lanza y devuelve vacío para cualquier tipo", () => {
    for (const t of TIPOS_PAQUETE_VALIDOS) assert.deepEqual(filtrarYOrdenarPaquetes([], t), []);
  });
});

describe("filtrarYOrdenarPaquetes — cambio repetido entre pestañas no duplica ni pierde", () => {
  test("alternar 20 veces entre las 4 pestañas siempre da el mismo resultado por pestaña (sin acumular estado)", () => {
    const esperadoPorTipo = new Map(TIPOS_PAQUETE_VALIDOS.map((t) => [t, filtrarYOrdenarPaquetes(FIXTURE, t).map((p) => p.id)]));
    const secuencia: TipoPaquete[] = [];
    for (let i = 0; i < 20; i++) secuencia.push(TIPOS_PAQUETE_VALIDOS[i % TIPOS_PAQUETE_VALIDOS.length]);
    for (const t of secuencia) {
      assert.deepEqual(filtrarYOrdenarPaquetes(FIXTURE, t).map((p) => p.id), esperadoPorTipo.get(t));
    }
  });
});

describe("filtrarYOrdenarPaquetes — se combina correctamente con un filtro adicional", () => {
  // Esta pantalla (/dashboard/paquetes) hoy NO tiene buscador/otros filtros
  // propios (confirmado por auditoría de código): la grilla se mostraba
  // completa sin ningún control adicional. Esta prueba deja constancia de
  // que el resultado de filtrarYOrdenarPaquetes es un arreglo común que
  // compone sin problemas con cualquier filtro adicional que se agregue más
  // adelante (ej. un buscador de texto), sin que uno rompa al otro.
  test("filtrar por tipo y luego por 'activo' da la intersección correcta, en el mismo orden alfabético", () => {
    const conActivo: (P & { activo: boolean })[] = [
      { ...pkg(1, "Zeta", "servicios"), activo: true },
      { ...pkg(2, "Beta", "servicios"), activo: false },
      { ...pkg(3, "Alfa", "servicios"), activo: true },
    ];
    const porTipo = filtrarYOrdenarPaquetes(conActivo, "servicios");
    const soloActivos = porTipo.filter((p) => p.activo);
    assert.deepEqual(soloActivos.map((p) => p.nombre), ["Alfa", "Zeta"]);
  });
});

describe("wiring — la pantalla usa el helper real, no una copia/aproximación", () => {
  const page = leer("app/(dashboard)/dashboard/paquetes/page.tsx");
  const listado = leer("app/(dashboard)/dashboard/paquetes/PaquetesListado.tsx");

  test("page.tsx selecciona la columna `tipo` real de armado_paquetes", () => {
    assert.match(page, /\.from\("armado_paquetes"\)/);
    assert.match(page, /\.select\(\s*"[^"]*\btipo\b[^"]*"/);
  });

  test("page.tsx recibe `searchParams` (Next.js 16: Promise) y resuelve `tipo` con el helper real, no con lógica propia", () => {
    assert.match(page, /searchParams:\s*Promise</);
    assert.match(page, /await searchParams/);
    assert.match(page, /resolverTabInicial\(/);
    assert.match(page, /from "\.\/tipo-paquetes"/);
  });

  test("page.tsx NO calcula el listado él mismo — delega en PaquetesListado, pasando tabInicial ya resuelto", () => {
    assert.match(page, /from "\.\/PaquetesListado"/);
    assert.match(page, /<PaquetesListado\s+paquetes=\{paquetes\}\s+tabInicial=\{tabInicial\}\s*\/>/);
  });

  test("PaquetesListado.tsx importa filtrarYOrdenarPaquetes/TABS_TIPO_PAQUETE/construirUrlConTab del módulo puro real (no redeclara el dominio)", () => {
    assert.match(listado, /from "\.\/tipo-paquetes"/);
    assert.match(listado, /filtrarYOrdenarPaquetes/);
    assert.match(listado, /TABS_TIPO_PAQUETE/);
    assert.match(listado, /construirUrlConTab/);
    // No debe existir una lista de labels hardcodeada aparte — la única
    // fuente de las 3 etiquetas pedidas es tipo-paquetes.ts.
    assert.doesNotMatch(listado, /"PAQUETES"/);
    assert.doesNotMatch(listado, /"PORCIÓN TERRESTRE"/);
    assert.doesNotMatch(listado, /"RECEPTIVOS"/);
  });

  test("PaquetesListado.tsx usa tabInicial directo como valor inicial del useState — SIN useEffect ni eslint-disable", () => {
    assert.match(listado, /useState<TipoPaquete>\(tabInicial\)/);
    assert.doesNotMatch(listado, /useEffect/);
    assert.doesNotMatch(listado, /\beslint-disable\b/);
  });

  test("PaquetesListado.tsx no dispara una consulta nueva al cambiar de pestaña (no usa router.push/replace ni fetch en el cambio de tab)", () => {
    assert.doesNotMatch(listado, /router\.(push|replace)\(/);
    assert.match(listado, /history\.replaceState/);
  });

  test("PaquetesListado.tsx conserva window.history.state (nunca lo pisa con null) al escribir el query string", () => {
    assert.match(listado, /window\.history\.replaceState\(\s*window\.history\.state\s*,/);
    assert.doesNotMatch(listado, /history\.replaceState\(\s*null\s*,/);
  });

  test("PaquetesListado.tsx muestra un estado vacío específico por pestaña además del estado vacío global", () => {
    assert.match(listado, /Sin paquetes en esta categoría/);
    assert.match(listado, /No hay paquetes armados/);
  });

  test("PaquetesListado.tsx conserva las acciones existentes de cada fila (link al detalle + eliminar)", () => {
    assert.match(listado, /EliminarPaqueteBtn/);
    assert.match(listado, /\/dashboard\/paquetes\/\$\{p\.id\}/);
  });

  test("no existe ningún eslint-disable en todo el módulo del listado (ni en tipo-paquetes.ts)", () => {
    const helper = leer("app/(dashboard)/dashboard/paquetes/tipo-paquetes.ts");
    assert.doesNotMatch(listado, /eslint-disable/);
    assert.doesNotMatch(helper, /eslint-disable/);
  });

  test("filtrarYOrdenarPaquetes y TABS_TIPO_PAQUETE no cambiaron: misma firma/lógica de filtro+orden que antes del fix", () => {
    const helper = leer("app/(dashboard)/dashboard/paquetes/tipo-paquetes.ts");
    assert.match(helper, /export function filtrarYOrdenarPaquetes<T extends PaqueteListable>/);
    assert.match(helper, /paquetes\s*\n\s*\.filter\(\(p\) => p\.tipo === tipo\)/);
    assert.match(helper, /new Intl\.Collator\("es", \{ sensitivity: "base" \}\)/);
  });
});
