// Uso de un destino (Producto → Destinos): conteos, etiquetas y la fuente
// autoritativa de qué bloquea el borrado.
//   - lib/producto/usoDestino.ts — etiquetas singular/plural y resumen para el modal.
//   - lib/producto/receptivos.ts — "receptivo" derivado de
//     tipoProveedorCxpServicio, y el conteo por destino SIN agregados de
//     PostgREST (carga paginada de destino_id, ejecutada aquí con páginas falsas).
//   - REFERENCIAS_DESTINO == las FK a destinos(id) de las migraciones.
//   - Los roles que pueden borrar destinos leen TODAS las filas de esas tablas
//     (policies reconstruidas desde las migraciones) — base de "sin contenido".
// Las lecturas de fuente normalizan CRLF→LF: la copia de trabajo en Windows
// (core.autocrlf) trae CRLF y el índice LF; estas pruebas pasan con ambos.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  REFERENCIAS_DESTINO,
  etiquetaConteo,
  resumirUsoDestino,
  modoEliminacion,
} from "../lib/producto/usoDestino.ts";
import {
  CATEGORIAS_RECEPTIVO,
  cargarFilasReceptivos,
  cargarReceptivosSegunRol,
  contarReceptivosPorDestino,
  filaNombreReceptivoDe,
  agruparReceptivosPorDestino,
  filaReceptivoConNombre,
  LIMITE_PRECARGA_POR_DESTINO,
  LIMITE_PRECARGA_TOTAL,
} from "../lib/producto/receptivos.ts";
import { ejecutarConsultaPaginada } from "../lib/tarifario/paginacion.ts";
import { tipoProveedorCxpServicio, normalizarCategoriaServicio } from "../lib/reservar/serviciosPaquete.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (src: string) => src.replace(/^\s*--.*$/gm, "");

describe("etiquetaConteo — singular, plural y cero", () => {
  test("1 usa singular; 0 y >1 usan plural", () => {
    assert.equal(etiquetaConteo(0, "receptivo", "receptivos"), "0 receptivos");
    assert.equal(etiquetaConteo(1, "receptivo", "receptivos"), "1 receptivo");
    assert.equal(etiquetaConteo(2, "receptivo", "receptivos"), "2 receptivos");
    assert.equal(etiquetaConteo(1, "hotel", "hoteles"), "1 hotel");
    assert.equal(etiquetaConteo(12, "hotel", "hoteles"), "12 hoteles");
  });
});

describe("conteo de receptivos por destino — sin agregados, desconocido nunca es 0", () => {
  test("cuenta por destino; un destino listado sin filas es 0 verificado; destino no listado se ignora", () => {
    const filas = [{ destino_id: 1 }, { destino_id: 1 }, { destino_id: 3 }, { destino_id: 99 }];
    assert.deepEqual(contarReceptivosPorDestino(filas, [1, 2, 3]), { 1: 2, 2: 0, 3: 1 });
    assert.deepEqual(contarReceptivosPorDestino([], [1, 2]), { 1: 0, 2: 0 });
  });

  test("respuesta inesperada = null (desconocido), nunca 0", () => {
    for (const filas of [null, undefined, {}, "x", 3]) {
      assert.equal(contarReceptivosPorDestino(filas, [1]), null, `filas=${JSON.stringify(filas)}`);
    }
    for (const fila of [null, {}, { destino_id: null }, { destino_id: "1" }, { destino_id: 1.5 }, { destino_id: Number.NaN }]) {
      assert.equal(contarReceptivosPorDestino([{ destino_id: 1 }, fila], [1]), null, `fila=${JSON.stringify(fila)}`);
    }
  });

  // Páginas falsas con la misma firma que `.range(desde, hasta)` de PostgREST.
  const paginador = (paginas: Array<{ data: unknown[] | null; error: unknown }>) => {
    const pedidas: Array<[number, number]> = [];
    let i = 0;
    const pedir = async (desde: number, hasta: number) => {
      pedidas.push([desde, hasta]);
      return paginas[i++] ?? { data: [], error: null };
    };
    return { pedir, pedidas };
  };

  test("recorre TODAS las páginas avanzando por filas reales (no se trunca en el Max rows)", async () => {
    const p1 = Array.from({ length: 1000 }, (_, k) => ({ destino_id: k % 2 === 0 ? 1 : 2 }));
    const { pedir, pedidas } = paginador([{ data: p1, error: null }, { data: [{ destino_id: 2 }], error: null }]);
    const r = await cargarFilasReceptivos(pedir);
    assert.equal(r.ok, true);
    assert.deepEqual(contarReceptivosPorDestino(r.ok ? r.filas : null, [1, 2]), { 1: 500, 2: 501 });
    assert.deepEqual(pedidas.slice(0, 2), [[0, 999], [1000, 1999]]);
  });

  test("un error en CUALQUIER página → ok:false con el error real; nunca un conteo parcial", async () => {
    const err = { message: "timeout" };
    const p1 = Array.from({ length: 1000 }, () => ({ destino_id: 1 }));
    const { pedir } = paginador([{ data: p1, error: null }, { data: null, error: err }]);
    const r = await cargarFilasReceptivos(pedir);
    assert.deepEqual(r, { ok: false, error: err });
  });

  test("error en la primera página (ej. permiso/red) → desconocido", async () => {
    const { pedir } = paginador([{ data: null, error: { message: "permission denied" } }]);
    const r = await cargarFilasReceptivos(pedir);
    assert.equal(r.ok, false);
  });

  // ── Ronda 3: páginas mal formadas SIN error — el paginador compartido las
  // tomaría como fin de datos; aquí deben fallar cerrado. ─────────────────
  const paginaLlena = (id: number) => Array.from({ length: 1000 }, () => ({ destino_id: id }));

  test("premisa: el paginador compartido (sin tocar) sí toma `data: null` sin error como fin válido", async () => {
    let n = 0;
    const r = await ejecutarConsultaPaginada<unknown>(async () => (n++ === 0 ? { data: paginaLlena(1), error: null } : { data: null, error: null }));
    assert.equal(r.error, null);
    assert.equal(r.data?.length, 1000, "sin la validación propia, esto sería un conteo parcial 'válido'");
  });

  const anomalias: Array<[string, unknown]> = [
    ["data: null sin error", { data: null, error: null }],
    ["data: undefined", { error: null }],
    ["data objeto", { data: { destino_id: 1 }, error: null }],
    ["data texto", { data: "[]", error: null }],
    ["respuesta null", null],
    ["respuesta undefined", undefined],
    ["fila sin destino_id", { data: [{ destino_id: 1 }, { id: 9 }], error: null }],
    ["fila con destino_id texto", { data: [{ destino_id: "1" }], error: null }],
    ["más filas que las pedidas", { data: Array.from({ length: 1001 }, () => ({ destino_id: 1 })), error: null }],
  ];

  for (const [nombre, respuesta] of anomalias) {
    test(`primera página con ${nombre} → ok:false, nunca filas vacías`, async () => {
      const r = await cargarFilasReceptivos(async () => respuesta as { data: unknown; error: unknown });
      assert.equal(r.ok, false);
    });
    test(`${nombre} DESPUÉS de una página válida completa → ok:false, nunca un conteo parcial`, async () => {
      // Sin el `??` de `paginador`: una respuesta null/undefined debe llegar tal cual.
      let i = 0;
      const pedidas: number[] = [];
      const r = await cargarFilasReceptivos(async (desde) => {
        pedidas.push(desde);
        return (i++ === 0 ? { data: paginaLlena(1), error: null } : respuesta) as { data: unknown; error: unknown };
      });
      assert.deepEqual(pedidas, [0, 1000], "la anomalía llegó en la SEGUNDA página");
      assert.equal(r.ok, false);
      assert.ok(!("filas" in r), "no entrega las 1000 filas de la página válida como si fueran el total");
    });
  }

  test("una excepción al pedir la página (rechazo) → ok:false, nunca lanza", async () => {
    const r = await cargarFilasReceptivos(async (desde) => {
      if (desde > 0) throw new Error("socket cerrado");
      return { data: paginaLlena(1), error: null };
    });
    assert.equal(r.ok, false);
    assert.match(String((r as { error: unknown }).error), /socket cerrado/);
  });

  test("solo `[]` sin error cierra: 0 filas en total es un 0 verificado", async () => {
    const r = await cargarFilasReceptivos(async () => ({ data: [], error: null }));
    assert.deepEqual(r, { ok: true, filas: [] });
    assert.deepEqual(contarReceptivosPorDestino(r.ok ? r.filas : null, [1, 2]), { 1: 0, 2: 0 });
  });
});

describe("cargarReceptivosSegunRol — el rol se resuelve ANTES de consultar", () => {
  // Predicado equivalente a puedeEscribir("producto", rol); que ese set sea
  // exactamente quien lee servicios_adicionales se verifica contra las
  // migraciones más abajo (describe "RLS"). La prueba de página
  // (destinosPageReceptivos.react.ts) usa el predicado REAL de lib/roles.ts.
  const PRODUCTO = ["superadmin", "gerencia", "administracion", "operaciones"];
  const puedeLeer = (rol: string | null) => rol !== null && PRODUCTO.includes(rol);

  const consulta = (filas: unknown[] = [{ destino_id: 1 }]) => {
    const llamadas: Array<[number, number]> = [];
    let i = 0;
    const pedirPagina = async (desde: number, hasta: number) => {
      llamadas.push([desde, hasta]);
      return i++ === 0 ? { data: filas, error: null } : { data: [], error: null };
    };
    return { pedirPagina, llamadas };
  };

  for (const rol of PRODUCTO) {
    test(`${rol}: consulta y devuelve las filas`, async () => {
      const { pedirPagina, llamadas } = consulta();
      const r = await cargarReceptivosSegunRol({ obtenerRol: async () => ({ data: rol, error: null }), puedeLeer, pedirPagina });
      assert.deepEqual(r, { estado: "ok", filas: [{ destino_id: 1 }] });
      assert.ok(llamadas.length >= 1);
    });
  }

  for (const rol of ["control_vuelo", "venta", "agencia"]) {
    test(`${rol}: sin permiso — NO inicia la consulta paginada`, async () => {
      const { pedirPagina, llamadas } = consulta();
      const r = await cargarReceptivosSegunRol({ obtenerRol: async () => ({ data: rol, error: null }), puedeLeer, pedirPagina });
      assert.deepEqual(r, { estado: "sin_permiso" });
      assert.equal(llamadas.length, 0);
    });
  }

  test("rol null (sin rol o usuario inactivo): sin permiso, sin consultar", async () => {
    const { pedirPagina, llamadas } = consulta();
    const r = await cargarReceptivosSegunRol({ obtenerRol: async () => ({ data: null, error: null }), puedeLeer, pedirPagina });
    assert.deepEqual(r, { estado: "sin_permiso" });
    assert.equal(llamadas.length, 0);
  });

  test("error al obtener el rol: error_rol, sin consultar", async () => {
    const { pedirPagina, llamadas } = consulta();
    const err = { message: "JWT expired" };
    const r = await cargarReceptivosSegunRol({ obtenerRol: async () => ({ data: "superadmin", error: err }), puedeLeer, pedirPagina });
    assert.deepEqual(r, { estado: "error_rol", error: err });
    assert.equal(llamadas.length, 0, "un rol no confirmado nunca habilita la consulta");
  });

  test("excepción o respuesta ausente al obtener el rol: error_rol, sin consultar, nunca lanza", async () => {
    for (const obtenerRol of [
      async () => { throw new Error("red"); },
      async () => undefined as unknown as { data: unknown; error: unknown },
    ]) {
      const { pedirPagina, llamadas } = consulta();
      const r = await cargarReceptivosSegunRol({ obtenerRol, puedeLeer, pedirPagina });
      assert.equal(r.estado, "error_rol");
      assert.equal(llamadas.length, 0);
    }
  });

  test("rol autorizado pero página mal formada: error_consulta (no 'ok' con filas parciales)", async () => {
    let i = 0;
    const r = await cargarReceptivosSegunRol({
      obtenerRol: async () => ({ data: "superadmin", error: null }),
      puedeLeer,
      pedirPagina: async () => (i++ === 0 ? { data: paginaLlenaGlobal(), error: null } : { data: null, error: null }),
    });
    assert.equal(r.estado, "error_consulta");
  });
});

function paginaLlenaGlobal() {
  return Array.from({ length: 1000 }, () => ({ destino_id: 1 }));
}

describe("resumirUsoDestino", () => {
  const cero = Object.fromEntries(REFERENCIAS_DESTINO.map((r) => [r.tabla, 0]));

  test("todo en cero: sin items, total 0, nada sin verificar", () => {
    assert.deepEqual(resumirUsoDestino(cero), { items: [], sinVerificar: [], total: 0 });
  });

  test("destino con receptivos/servicios pero sin hoteles: solo lista lo que tiene filas", () => {
    const r = resumirUsoDestino({ ...cero, servicios_adicionales: 1, bloqueos_vuelo: 2 });
    assert.deepEqual(r.items.map((i) => i.texto), ["1 servicio adicional", "2 bloqueos de vuelo"]);
    assert.equal(r.total, 3);
    assert.deepEqual(r.sinVerificar, []);
  });

  test("orden estable (el de REFERENCIAS_DESTINO), no el de la entrada", () => {
    const r = resumirUsoDestino({ ...cero, inclusiones: 1, hoteles: 2 });
    assert.deepEqual(r.items.map((i) => i.tabla), ["hoteles", "inclusiones"]);
  });

  test("null o ausente = sin verificar (no suma y no cuenta como 0)", () => {
    const sinHoteles: Record<string, number | null> = { ...cero, empaquetados: null };
    delete sinHoteles.hoteles;
    const r = resumirUsoDestino(sinHoteles);
    assert.deepEqual(r.sinVerificar, ["hoteles", "empaquetados"]);
    assert.equal(r.total, 0);
    assert.deepEqual(r.items, []);
  });
});

describe("fuente autoritativa: REFERENCIAS_DESTINO == FKs a destinos(id) en las migraciones", () => {
  const dirMig = join(raiz, "supabase/migrations");
  const archivos = readdirSync(dirMig).filter((f) => f.endsWith(".sql")).sort();

  // Tabla dueña de cada `references public.destinos(id)`: la sentencia
  // create table / alter table más cercana hacia atrás.
  const fks: { tabla: string; archivo: string; linea: string }[] = [];
  for (const archivo of archivos) {
    const sql = sinComentarios(leer(`supabase/migrations/${archivo}`));
    const re = /references\s+(?:public\.)?destinos\s*\(\s*id\s*\)[^,\n]*/gi;
    for (const m of sql.matchAll(re)) {
      const antes = sql.slice(0, m.index);
      const duenos = [...antes.matchAll(/(?:create table(?: if not exists)?|alter table(?: only)?(?: if exists)?)\s+(?:public\.)?(\w+)/gi)];
      const tabla = duenos.at(-1)?.[1];
      assert.ok(tabla, `no se pudo resolver la tabla dueña de una FK a destinos en ${archivo}`);
      fks.push({ tabla: tabla!, archivo, linea: m[0] });
    }
  }

  test("el conjunto de tablas coincide exactamente (una FK nueva obliga a actualizar el modal)", () => {
    const enMigraciones = [...new Set(fks.map((f) => f.tabla))].sort();
    const enModulo = REFERENCIAS_DESTINO.map((r) => r.tabla).slice().sort();
    assert.deepEqual(enModulo, enMigraciones);
  });

  test("ninguna FK a destinos declara ON DELETE: cualquier fila bloquea el borrado (premisa del texto del modal)", () => {
    for (const f of fks) assert.doesNotMatch(f.linea, /on\s+delete/i, `${f.archivo}: ${f.tabla}`);
  });

  test("fn_fusionar_destino (112) re-apunta TODA FK a destinos y solo eso; ninguna migración posterior la redefine", () => {
    const fn = sinComentarios(leer("supabase/migrations/20260601000112_fusionar_destino.sql"));
    assert.match(fn, /where c\.contype = 'f' and c\.confrelid = 'public\.destinos'::regclass/);
    assert.match(fn, /update %s set %I = \$1 where %I = \$2/);
    const redefiniciones = archivos.filter((a) =>
      /create\s+or\s+replace\s+function\s+public\.fn_fusionar_destino/i.test(sinComentarios(leer(`supabase/migrations/${a}`)))
    );
    assert.deepEqual(redefiniciones, ["20260601000112_fusionar_destino.sql"]);
  });
});

describe("receptivo = categoría que tipoProveedorCxpServicio clasifica como 'receptivo'", () => {
  test("hoy es exactamente tour_traslado", () => {
    assert.deepEqual([...CATEGORIAS_RECEPTIVO], ["tour_traslado"]);
  });
  test("coherente con la normalización al reservar (texto libre fuera de los valores fijos cae a 'otro', no a receptivo)", () => {
    for (const libre of ["Tour_traslado", "tour", "receptivo", "", null]) {
      assert.notEqual(tipoProveedorCxpServicio(normalizarCategoriaServicio(libre)), "receptivo", String(libre));
    }
  });
});

describe("RLS: los roles que pueden borrar destinos leen TODAS las filas de las tablas referenciantes", () => {
  // Reconstruye el estado FINAL de las policies aplicando, en orden, cada
  // create/drop policy de las migraciones (incluido el `foreach … format(...)`
  // de la 018 para armado_*). Base de la afirmación "sin contenido" del modal.
  type Pol = { cmd: string; restrictiva: boolean; using: string };
  const TABLAS: string[] = [...REFERENCIAS_DESTINO.map((r) => r.tabla as string), "destinos"];
  const pol = new Map<string, Map<string, Pol>>(TABLAS.map((t) => [t, new Map()]));
  const rls = new Set<string>();
  const deshabilitadas: string[] = [];
  const dirMig = join(raiz, "supabase/migrations");
  for (const archivo of readdirSync(dirMig).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = sinComentarios(leer(`supabase/migrations/${archivo}`));
    // Bloques dinámicos: foreach t in array array['a','b'] … format('create policy "%s: …" …', t, t)
    for (const m of sql.matchAll(/foreach\s+t\s+in\s+array\s+array\[([^\]]+)\]([\s\S]*?)end loop/gi)) {
      const tablas = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
      const cuerpo = m[2].replace(/'\s*\n\s*'/g, "").replace(/''/g, "'");
      const c = cuerpo.match(/create policy "%s: ([^"]+)" on public\.%I for (\w+)\s+using \((.*?)\) with check/i);
      if (!c) continue;
      for (const t of tablas) pol.get(t)?.set(`${t}: ${c[1]}`, { cmd: c[2].toLowerCase(), restrictiva: false, using: c[3] });
    }
    for (const st of sql.split(";")) {
      const s1 = st.replace(/\s+/g, " ").trim();
      const d = s1.match(/drop policy if exists "([^"]+)" on (?:public\.)?(\w+)/i);
      if (d) pol.get(d[2])?.delete(d[1]);
      const c = s1.match(/create policy "([^"]+)" on (?:public\.)?(\w+)(.*)/i);
      if (c && pol.has(c[2])) {
        const resto = c[3];
        pol.get(c[2])!.set(c[1], {
          cmd: (resto.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? "all").toLowerCase(),
          restrictiva: /as restrictive/i.test(resto),
          using: resto.match(/using \((.*)\)(?: with check|$)/i)?.[1] ?? "",
        });
      }
      const r = s1.match(/alter table (?:public\.)?(\w+) enable row level security/i);
      if (r) rls.add(r[1]);
      const dis = s1.match(/alter table (?:public\.)?(\w+) disable row level security/i);
      if (dis && TABLAS.includes(dis[1])) deshabilitadas.push(`${archivo}: ${dis[1]}`);
    }
  }

  // Roles que una expresión USING deja pasar SIN filtrar filas: `true`, o un
  // `mi_rol() in (...)` (opcionalmente `or` otra condición, que solo AMPLÍA).
  // Con un `and` se filtrarían filas → no cuenta como lectura completa.
  const rolesDe = (using: string): Set<string> | "todos" | null => {
    if (/^\s*true\s*$/i.test(using)) return "todos";
    if (/\band\b/i.test(using)) return null;
    const m = using.match(/mi_rol\(\)(?:::text)?(?:\s*,\s*'')?\)?\s+in\s+\(([^)]*)\)/i);
    if (!m) return null;
    return new Set([...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
  };
  const leeTodo = (tabla: string, rol: string) =>
    [...pol.get(tabla)!.values()].some((p) => {
      if (p.restrictiva || !["select", "all"].includes(p.cmd)) return false;
      const r = rolesDe(p.using);
      return r === "todos" || (r instanceof Set && r.has(rol));
    });

  const borradores = (() => {
    const p = [...pol.get("destinos")!.values()].filter((x) => ["all", "delete"].includes(x.cmd));
    const r = p.map((x) => rolesDe(x.using)).filter((x): x is Set<string> => x instanceof Set);
    return [...new Set(r.flatMap((x) => [...x]))].sort();
  })();

  test("quién puede borrar destinos (policy final): exactamente superadmin/gerencia/administracion/operaciones", () => {
    assert.deepEqual(borradores, ["administracion", "gerencia", "operaciones", "superadmin"]);
  });

  test("todas las tablas tienen RLS, nunca se deshabilita, y no hay policies restrictivas", () => {
    assert.deepEqual(deshabilitadas, []);
    for (const t of TABLAS) {
      assert.ok(rls.has(t), `${t} sin RLS habilitada`);
      assert.ok(pol.get(t)!.size > 0, `${t} sin policies reconstruidas (¿el parser no las vio?)`);
      for (const [n, p] of pol.get(t)!) assert.equal(p.restrictiva, false, `${t}: "${n}" es restrictiva`);
    }
  });

  test("cada rol que puede borrar lee TODAS las filas de las 10 tablas (policy sin filtro de filas, solo de rol)", () => {
    for (const t of REFERENCIAS_DESTINO.map((r) => r.tabla)) {
      for (const rol of borradores) assert.ok(leeTodo(t, rol), `${rol} no lee todas las filas de ${t}`);
    }
  });

  test("control_vuelo (entra a Producto) NO lee todo — por eso el modal no puede afirmar 'sin contenido' para ese rol", () => {
    assert.equal(leeTodo("servicios_adicionales", "control_vuelo"), false);
    assert.equal(leeTodo("armado_paquetes", "control_vuelo"), false);
  });

  test("quien lee TODO servicios_adicionales == los roles que pueden borrar destinos (compuerta de la insignia de receptivos)", () => {
    const internos = ["superadmin", "gerencia", "administracion", "operaciones", "venta", "control_vuelo"];
    assert.deepEqual(internos.filter((r) => leeTodo("servicios_adicionales", r)).sort(), borradores);
  });

  test("lib/roles.ts ESCRITURA.producto (lo que usa usoDestino) == los roles que pueden borrar destinos", () => {
    const roles = leer("lib/roles.ts");
    const admin = roles.match(/export const ADMIN_ROLES: readonly Rol\[\] = \[([^\]]*)\]/)?.[1] ?? "";
    assert.match(roles, /producto: \[\.\.\.ADMIN_ROLES, "operaciones"\] as Rol\[\],/);
    const producto = [...[...admin.matchAll(/"(\w+)"/g)].map((x) => x[1]), "operaciones"].sort();
    assert.deepEqual(producto, borradores);
  });

  test("fn_fusionar_destino (112) exige EXACTAMENTE el mismo set de roles (la acción no amplía ni recorta sus permisos)", () => {
    const fn = sinComentarios(leer("supabase/migrations/20260601000112_fusionar_destino.sql"));
    const lista = fn.match(/if public\.mi_rol\(\) not in \(([^)]*)\) then/)?.[1] ?? "";
    assert.deepEqual([...lista.matchAll(/'(\w+)'/g)].map((x) => x[1]).sort(), borradores);
    // Semántica que la acción NO cambia: origen inexistente = return silencioso
    // (por eso la acción comprueba antes y después), y borra el origen al final.
    assert.match(fn, /if not exists \(select 1 from public\.destinos where id = p_origen\) then\s*return;/);
    assert.match(fn, /delete from public\.destinos where id = p_origen;/);
  });
});

describe("cableado — listado de destinos y Server Action de uso", () => {
  const pagina = leer("app/(dashboard)/dashboard/producto/destinos/page.tsx");
  const acciones = leer("app/(dashboard)/dashboard/tarifario/actions.ts");

  test("la página no usa agregados de PostgREST: carga paginada de destino_id de los receptivos, en paralelo con el listado", () => {
    assert.doesNotMatch(pagina, /\(count\)|count\(\)/, "nada de count embebido/agregado");
    assert.match(pagina, /pedirPagina: \(desde, hasta\) =>/);
    // Desde la precarga limitada la MISMA consulta trae también id y nombre
    // (cero viajes extra) — nunca columnas de costo.
    assert.match(pagina, /\.from\("servicios_adicionales"\)\s*\.select\("id, nombre, destino_id"\)/, "solo id, nombre y destino_id");
    assert.match(pagina, /filaValida: filaReceptivoConNombre,/, "cada fila se valida con su forma completa");
    assert.match(pagina, /\.in\("categoria", \[\.\.\.CATEGORIAS_RECEPTIVO\]\)/);
    assert.match(pagina, /\.not\("destino_id", "is", null\)/);
    assert.match(pagina, /\.order\("nombre"\)\s*\.order\("id"\)\s*\.range\(desde, hasta\)/, "orden total (nombre, id) para paginar sin huecos — el mismo que la carga bajo demanda");
    assert.match(pagina, /await Promise\.all\(\[/);
    assert.doesNotMatch(pagina, /tour_traslado/, "la categoría no se repite como literal");
  });

  test("la página resuelve el rol ANTES de consultar (orquestación cargarReceptivosSegunRol con el predicado real)", () => {
    assert.match(pagina, /cargarReceptivosSegunRol\(\{/);
    assert.match(pagina, /obtenerRol: \(\) => sb\.rpc\("mi_rol"\),/);
    assert.match(pagina, /puedeLeer: \(rol\) => puedeEscribir\("producto", rol\),/);
    assert.doesNotMatch(pagina, /cargarFilasReceptivos\(/, "la carga solo se inicia a través de la orquestación por rol");
  });

  test("cualquier estado distinto de 'ok' → null (insignia omitida), nunca 0; el listado se renderiza igual", () => {
    assert.match(pagina, /receptivos\.estado === "ok" \? agruparReceptivosPorDestino\(receptivos\.filas, [^\n]*\) : null;/);
    // Conteos y precargas salen de la MISMA agrupación: ambos null si no es "ok".
    assert.match(pagina, /receptivosPorDestino=\{agrupados\?\.conteos \?\? null\}/);
    assert.match(pagina, /receptivosPrecargados=\{agrupados\?\.precargados \?\? null\}/);
  });

  test("usoDestino cuenta con head:true (Prefer count=exact, no es agregado), marca el alcance por rol y no escribe nada", () => {
    const i = acciones.indexOf("export async function usoDestino(");
    assert.ok(i > -1);
    const cuerpo = acciones.slice(i, acciones.indexOf("\n}\n", i));
    assert.match(cuerpo, /REFERENCIAS_DESTINO\.map/);
    assert.match(cuerpo, /select\("\*", \{ count: "exact", head: true \}\)\.eq\("destino_id", id\)/);
    assert.match(cuerpo, /error \|\| count == null \? null : count/, "un error es null, nunca 0");
    assert.match(cuerpo, /sb\.rpc\("mi_rol"\)/);
    assert.match(cuerpo, /puedeEscribir\("producto", [^)]*\) \? "si" : "no"/);
    assert.match(cuerpo, /const permiso: UsoDestino\["permiso"\] = rolRes\.error\s*\? "desconocido"/, "rol no resuelto = permiso desconocido");
    assert.match(cuerpo, /alcanceCompleto: permiso === "si",/);
    assert.doesNotMatch(cuerpo, /\.delete\(|\.update\(|\.insert\(|\.upsert\(|revalidatePath|fn_fusionar_destino/);
  });
});

describe("lista de receptivos de un destino (diálogo) — mismo criterio que el conteo", () => {
  test("filaNombreReceptivoDe: exige id entero, nombre texto y EXACTAMENTE ese destino", () => {
    const valida = filaNombreReceptivoDe(3);
    assert.equal(valida({ id: 1, nombre: "City tour", destino_id: 3 }), true);
    for (const f of [
      null, {}, { id: 1, nombre: "X", destino_id: 4 }, { id: 1, nombre: "X", destino_id: null },
      { id: 1, nombre: "X" }, { id: "1", nombre: "X", destino_id: 3 }, { id: 1.5, nombre: "X", destino_id: 3 },
      { id: 1, nombre: null, destino_id: 3 }, { id: 1, destino_id: 3 },
    ]) assert.equal(valida(f), false, JSON.stringify(f));
  });

  test("la acción de la lista y el conteo de la página filtran igual (categoría derivada + destino), así el número y la lista coinciden", () => {
    const accion = leer("app/(dashboard)/dashboard/producto/destinos/actions.ts");
    const pagina = leer("app/(dashboard)/dashboard/producto/destinos/page.tsx");
    for (const src of [accion, pagina]) {
      assert.match(src, /\.from\("servicios_adicionales"\)/);
      assert.match(src, /\.in\("categoria", \[\.\.\.CATEGORIAS_RECEPTIVO\]\)/);
      assert.doesNotMatch(src, /tour_traslado/, "la categoría nunca se repite como literal");
    }
    // Conteo: todos los receptivos CON destino, agrupados por destino_id.
    assert.match(pagina, /\.not\("destino_id", "is", null\)/);
    // Lista: exactamente ESE destino (nunca servicios generales sin destino).
    assert.match(accion, /\.eq\("destino_id", destinoId\)/);
    assert.match(accion, /filaValida: filaNombreReceptivoDe\(destinoId\),/);
    // Misma compuerta de rol que el conteo.
    assert.match(accion, /cargarReceptivosSegunRol\(\{/);
    assert.match(accion, /puedeLeer: \(rol\) => puedeEscribir\("producto", rol\),/);
    // Solo id y nombre salen del servidor.
    assert.match(accion, /\.select\("id, nombre, destino_id"\)/);
    assert.match(accion, /\.map\(\(f\) => \(\{ id: f\.id, nombre: f\.nombre \}\)\)/);
  });

  test("la página no hace consultas EXTRA para nombres: van en la del conteo (con tope); el resto se pide al abrir, una vez", () => {
    const lista = leer("app/(dashboard)/dashboard/producto/destinos/DestinosLista.tsx");
    const pagina = leer("app/(dashboard)/dashboard/producto/destinos/page.tsx");
    assert.doesNotMatch(pagina, /listarReceptivosDestino/, "la página no llama a la carga bajo demanda");
    // Una sola consulta de servicios en la página: conteo + nombres a la vez.
    assert.equal([...pagina.matchAll(/\.from\("servicios_adicionales"\)/g)].length, 1);
    // El diálogo pide solo si su lista no está ya "ok" (precargada o pedida antes).
    assert.match(lista, /if \(abierto\) \{ if \(lista\.estado !== "ok"\) cargar\(\); \}/);
    assert.match(lista, /precargados \? \{ estado: "ok", receptivos: precargados \} : \{ estado: "inactivo" \}/);
    assert.equal([...lista.matchAll(/listarReceptivosDestino\(/g)].length, 1, "una sola llamada, dentro de cargar()");
  });
});

describe("precarga limitada de receptivos (agruparReceptivosPorDestino)", () => {
  const r = (id: number, destino_id: number, nombre = `R${id}`) => ({ id, nombre, destino_id });
  const repetir = (n: number, destino: number, desde = 0) => Array.from({ length: n }, (_, k) => r(desde + k + 1, destino));

  test("topes vigentes: 50 por destino y 1.000 nombres en total", () => {
    assert.equal(LIMITE_PRECARGA_POR_DESTINO, 50);
    assert.equal(LIMITE_PRECARGA_TOTAL, 1000);
  });

  test("conteos de TODOS los destinos (0 verificado) y listas completas solo de los chicos, en el orden recibido", () => {
    const g = agruparReceptivosPorDestino([r(2, 1, "B"), r(1, 1, "A"), r(9, 3, "Z")], [1, 2, 3]);
    assert.deepEqual(g, {
      conteos: { 1: 2, 2: 0, 3: 1 },
      precargados: { 1: [{ id: 2, nombre: "B" }, { id: 1, nombre: "A" }], 3: [{ id: 9, nombre: "Z" }] },
    });
  });

  test("1, 5 y 50 se precargan; 51 y más de 1.000 solo cuentan (se piden al abrir)", () => {
    const filas = [...repetir(1, 1), ...repetir(5, 2, 100), ...repetir(50, 3, 200), ...repetir(51, 4, 300), ...repetir(1201, 5, 1000)];
    const g = agruparReceptivosPorDestino(filas, [1, 2, 3, 4, 5])!;
    assert.deepEqual(g.conteos, { 1: 1, 2: 5, 3: 50, 4: 51, 5: 1201 });
    assert.deepEqual(Object.keys(g.precargados).map(Number).sort((a, b) => a - b), [1, 2, 3]);
    assert.equal(g.precargados[3].length, 50, "una lista precargada va COMPLETA, nunca recortada");
  });

  test("tope total: prioriza los destinos más chicos y nunca recorta una lista", () => {
    const filas = [...repetir(3, 1), ...repetir(40, 2, 100), ...repetir(10, 3, 200)];
    const g = agruparReceptivosPorDestino(filas, [1, 2, 3], { porDestino: 50, total: 20 })!;
    assert.deepEqual(Object.keys(g.precargados).map(Number).sort((a, b) => a - b), [1, 3], "3 + 10 = 13 ≤ 20; el de 40 no cabe");
    assert.equal(g.precargados[3].length, 10);
    assert.deepEqual(g.conteos, { 1: 3, 2: 40, 3: 10 }, "los conteos no dependen de la precarga");
  });

  test("con el tope real, el total precargado nunca pasa de LIMITE_PRECARGA_TOTAL", () => {
    const filas = Array.from({ length: 60 }, (_, d) => repetir(45, d + 1, d * 100)).flat();
    const g = agruparReceptivosPorDestino(filas, Array.from({ length: 60 }, (_, d) => d + 1))!;
    const total = Object.values(g.precargados).reduce((n, l) => n + l.length, 0);
    assert.ok(total <= LIMITE_PRECARGA_TOTAL, `precargados ${total}`);
    assert.equal(total, 22 * 45, "22 destinos de 45 = 990 ≤ 1.000; el 23º no cabe");
    assert.equal(Object.keys(g.conteos).length, 60, "todos siguen contados");
  });

  test("forma inesperada → null (conteo y listas desconocidos, nunca 0 ni listas vacías)", () => {
    for (const filas of [null, {}, "x"]) assert.equal(agruparReceptivosPorDestino(filas, [1]), null);
    for (const f of [{ destino_id: 1 }, { id: 1, destino_id: 1 }, { id: 1, nombre: "X", destino_id: null }, { id: "1", nombre: "X", destino_id: 1 }]) {
      assert.equal(agruparReceptivosPorDestino([r(1, 1), f], [1]), null, JSON.stringify(f));
      assert.equal(filaReceptivoConNombre(f), false);
    }
  });

  test("filas de destinos que no están en el listado se ignoran (ni cuentan ni se precargan)", () => {
    const g = agruparReceptivosPorDestino([r(1, 1), r(2, 99)], [1])!;
    assert.deepEqual(g, { conteos: { 1: 1 }, precargados: { 1: [{ id: 1, nombre: "R1" }] } });
  });
});

describe("modoEliminacion — lo que ofrece el modal sale de lo VERIFICADO, nunca de la cantidad de hoteles", () => {
  const cero = Object.fromEntries(REFERENCIAS_DESTINO.map((r) => [r.tabla, 0])) as Record<string, number | null>;
  const uso = (conteos: Record<string, number | null>, permiso: "si" | "no" | "desconocido" = "si") =>
    ({ conteos: { ...cero, ...conteos }, alcanceCompleto: permiso === "si", permiso }) as Parameters<typeof modoEliminacion>[0];

  test("0 hoteles y 5 receptivos → fusión (hay contenido aunque no haya hoteles)", () => {
    assert.equal(modoEliminacion(uso({ servicios_adicionales: 5 })), "fusion");
  });
  test("verificado sin contenido (rol autorizado, las 10 tablas contadas) → borrado directo", () => {
    assert.equal(modoEliminacion(uso({})), "borrado_directo");
  });
  test("una tabla sin contar o rol no resuelto, sin contenido visto → no verificado (nunca borrado directo)", () => {
    assert.equal(modoEliminacion(uso({ empaquetados: null })), "no_verificado");
    assert.equal(modoEliminacion(uso({}, "desconocido")), "no_verificado");
  });
  test("contenido visto aunque falte verificar otra tabla → fusión", () => {
    assert.equal(modoEliminacion(uso({ hoteles: 1, empaquetados: null })), "fusion");
    assert.equal(modoEliminacion(uso({ bloqueos_vuelo: 2 }, "desconocido")), "fusion");
  });
  test("rol sin permiso → sin permiso, con o sin contenido", () => {
    assert.equal(modoEliminacion(uso({}, "no")), "sin_permiso");
    assert.equal(modoEliminacion(uso({ hoteles: 3 }, "no")), "sin_permiso");
  });
  test("inconsistencia alcanceCompleto=false con permiso 'si' → no verificado (nunca borrado directo)", () => {
    assert.equal(modoEliminacion({ ...uso({}), alcanceCompleto: false }), "no_verificado");
  });
});

describe("cableado — eliminarDestino nunca afirma un éxito que no ocurrió", () => {
  const acciones = leer("app/(dashboard)/dashboard/tarifario/actions.ts");
  const i = acciones.indexOf("export async function eliminarDestino(");
  const cuerpo = acciones.slice(i, acciones.indexOf("\n}\n", i));
  const modal = leer("app/(dashboard)/dashboard/tarifario/EliminarDestinoBtn.tsx");

  test("permiso primero, origen existente, DELETE con filas devueltas y confirmación tras la fusión", () => {
    assert.match(cuerpo, /if \(!puedeEscribir\("producto", rol\)\) return \{ ok: false,/);
    const idxPermiso = cuerpo.indexOf('puedeEscribir("producto", rol)');
    const idxExiste = cuerpo.indexOf("const antes = await existe();");
    const idxRpc = cuerpo.indexOf('sb.rpc("fn_fusionar_destino"');
    const idxDelete = cuerpo.indexOf('.from("destinos").delete()');
    assert.ok(idxPermiso > -1 && idxExiste > idxPermiso && idxRpc > idxExiste && idxDelete > idxExiste, "orden: permiso → existencia → operación");
    assert.match(cuerpo, /\.from\("destinos"\)\.delete\(\)\.eq\("id", id\)\.select\("id"\)/);
    assert.match(cuerpo, /borrados\.length !== 1/);
    assert.match(cuerpo, /const despues = await existe\(\);/);
    assert.equal([...cuerpo.matchAll(/return \{ ok: true \};/g)].length, 2, "solo dos éxitos: fusión confirmada y borrado de una fila");
  });

  test("la fusión sigue siendo fn_fusionar_destino (112) con los mismos parámetros; nada toca contratos/ventas/cotizaciones", () => {
    assert.match(cuerpo, /sb\.rpc\("fn_fusionar_destino", \{ p_origen: id, p_destino: reasignarA \}\)/);
    assert.doesNotMatch(cuerpo, /ventas|contrato|cotizacion/i);
  });

  test("el modal decide por modoEliminacion, no por la cantidad de hoteles", () => {
    assert.match(modal, /modoEliminacion\(uso\.uso\)/);
    assert.doesNotMatch(modal, /hoteles > 0/);
    assert.match(modal, /const reasignarA = modo === "borrado_directo" \? undefined : Number\(target\);/, "solo el borrado directo va sin destino");
  });
});
