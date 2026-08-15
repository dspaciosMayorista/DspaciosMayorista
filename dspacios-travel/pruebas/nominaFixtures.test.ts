import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crearFixturesNomina,
  registrarRuta,
  eliminarRutasConocidas,
  verificarRutasEliminadas,
} from "../supabase/scripts/pruebas/nominaFixtures.mjs";

// ───────────────────────────────────────────────────────────────────────────
// Robustez de los fixtures de nómina en storage-adjuntos.mjs.
//
// El bug real: `idsEmpleados = [empPropio.id, empOtro.id]` se calculaba en UNA
// sola asignación al final. Si el segundo `insert` fallaba —o cualquier paso
// intermedio—, el primero no quedaba en ningún sitio que la limpieza pudiera
// ver: huérfano silencioso en la base real. Estas pruebas simulan justo esos
// fallos a mitad de camino y comprueban que lo ya creado SIGUE registrado.
// ───────────────────────────────────────────────────────────────────────────

function ctxVacio(overrides = {}) {
  return {
    marca: "__TEST__",
    sello: 123,
    tenant: "mayorista",
    otroTenant: "minorista",
    textoContrato: "contenido de prueba",
    idsEmpleados: [],
    rutasConocidas: new Set(),
    ...overrides,
  };
}

// ── CONTROL NEGATIVO 1: primer empleado creado, el segundo falla ─────────

test("NEGATIVO: si el segundo empleado falla, el primero YA quedó en idsEmpleados", async () => {
  const ctx = ctxVacio();
  const deps = {
    crearEmpleado: async (nombre: string, tenant: string) => {
      if (tenant === ctx.otroTenant) throw new Error("el insert del segundo empleado falló (simulado)");
      return { id: 501 };
    },
    subirArchivo: async () => {},
    actualizarContratoPath: async () => ({ error: null }),
  };

  await assert.rejects(() => crearFixturesNomina(deps, ctx), /el insert del segundo empleado falló/);

  assert.deepEqual(ctx.idsEmpleados, [501], "el primer id debe seguir ahí pese al fallo del segundo");
});

test("NEGATIVO: si el PRIMER empleado falla, no hay nada que registrar (y no revienta al limpiar después)", async () => {
  const ctx = ctxVacio();
  const deps = {
    crearEmpleado: async () => {
      throw new Error("el insert del primer empleado falló (simulado)");
    },
    subirArchivo: async () => {},
    actualizarContratoPath: async () => ({ error: null }),
  };

  await assert.rejects(() => crearFixturesNomina(deps, ctx));
  assert.deepEqual(ctx.idsEmpleados, []);
  assert.equal(ctx.rutasConocidas.size, 0);

  // La limpieza con listas vacías no debe hacer NADA raro (ni llamar a la API).
  let llamoEliminar = false;
  const depsLimpieza = { eliminarArchivos: async () => { llamoEliminar = true; return { error: null }; } };
  const r = await eliminarRutasConocidas(depsLimpieza, ctx.rutasConocidas);
  assert.equal(r.ok, true);
  assert.equal(r.borrados, 0);
  assert.equal(llamoEliminar, false, "con cero rutas no debe ni llamar a remove()");
});

// ── CONTROL NEGATIVO 2: fallo al actualizar contrato_path ─────────────────

test("NEGATIVO: si falla el update de contrato_path, se detiene Y todo lo ya creado sigue registrado", async () => {
  const ctx = ctxVacio();
  const deps = {
    crearEmpleado: async (nombre: string, tenant: string) => ({ id: tenant === ctx.tenant ? 777 : 778 }),
    subirArchivo: async () => {}, // el archivo SÍ se subió
    actualizarContratoPath: async () => ({ error: { message: "RLS: no autorizado" } }),
  };

  await assert.rejects(
    () => crearFixturesNomina(deps, ctx),
    /No se pudo actualizar contrato_path.*RLS: no autorizado/
  );

  // Los dos empleados se crean ANTES de tocar el contrato_path del primero:
  // los dos deben seguir registrados aunque el update falle después.
  assert.deepEqual(ctx.idsEmpleados, [777, 778]);
  // El archivo ya se subió (se registró ANTES del update, no después): la
  // limpieza tiene que poder alcanzarlo aunque la fixture se dé por fallida.
  assert.deepEqual([...ctx.rutasConocidas], ["pe-empleados/777-contrato.txt"]);
});

// ── CONTROL NEGATIVO 3: carpeta con más de 100 objetos ────────────────────

test("NEGATIVO: la verificación encuentra la ruta aunque la carpeta tenga >100 objetos y no esté en la 'primera página'", async () => {
  // Carpeta simulada: 150 objetos, y el que nos importa es el #120 —más allá
  // de una hipotética página de 100. `existeRuta` en la implementación real
  // busca por NOMBRE EXACTO (`list(carpeta, {search: nombre})`), no pagina
  // una lista completa; aquí se simula ese comportamiento (no el de un
  // `list()` plano que solo trajera los primeros 100).
  const carpetaSimulada = Array.from({ length: 150 }, (_, i) => `objeto-${i}.txt`);
  carpetaSimulada[120] = "42-contrato.txt";

  const deps = {
    existeRuta: async (ruta: string) => {
      const nombre = ruta.split("/").pop() ?? "";
      return carpetaSimulada.includes(nombre); // búsqueda directa, no "primeros 100"
    },
  };

  const r = await verificarRutasEliminadas(deps, ["pe-empleados/42-contrato.txt"]);
  assert.equal(r.length, 1);
  assert.equal(r[0].eliminada, false, "el objeto #120 SIGUE existiendo y debe detectarse igual");
});

test("NEGATIVO: un `list()` plano de 100 items habría dado un FALSO 'ya no existe' — por eso no se usa", () => {
  // Control negativo del control negativo: demuestra que el patrón viejo
  // (listar y quedarse con la primera página) sí se habría equivocado.
  const carpetaSimulada = Array.from({ length: 150 }, (_, i) => `objeto-${i}.txt`);
  carpetaSimulada[120] = "42-contrato.txt";

  const primerosCien = carpetaSimulada.slice(0, 100); // lo que devolvería list() sin paginar
  const siguePorListadoPlano = primerosCien.includes("42-contrato.txt");
  assert.equal(siguePorListadoPlano, false, "con un listado plano de 100 el objeto #120 parece haber desaparecido");
  // …y sin embargo el objeto SIGUE ahí (ver la prueba anterior): confirmando
  // por qué `verificarRutasEliminadas` no puede usar ese patrón.
});

test("la verificación SÍ confirma cuando la ruta de verdad ya no está", async () => {
  const deps = { existeRuta: async () => false };
  const r = await verificarRutasEliminadas(deps, ["pe-empleados/1-x.txt", "pe-empleados/2-y.txt"]);
  assert.ok(r.every((x) => x.eliminada));
});

// ── Camino feliz: las dos fixtures se crean y se registran en orden ──────

test("feliz: ambos empleados y la ruta quedan registrados, en el orden esperado", async () => {
  const ctx = ctxVacio();
  const orden: string[] = [];
  const deps = {
    crearEmpleado: async (nombre: string, tenant: string) => {
      orden.push(`crear:${tenant}`);
      return { id: tenant === ctx.tenant ? 10 : 20 };
    },
    subirArchivo: async (ruta: string) => { orden.push(`subir:${ruta}`); },
    actualizarContratoPath: async (id: number) => { orden.push(`update:${id}`); return { error: null }; },
  };

  const r = await crearFixturesNomina(deps, ctx);

  assert.equal(r.empPropio.id, 10);
  assert.equal(r.empOtro.id, 20);
  assert.equal(r.rutaContratoPropio, "pe-empleados/10-contrato.txt");
  assert.deepEqual(ctx.idsEmpleados, [10, 20]);
  assert.deepEqual([...ctx.rutasConocidas], ["pe-empleados/10-contrato.txt"]);
  // El id se registra ANTES de subir, y el archivo se sube ANTES del update.
  assert.deepEqual(orden, [
    "crear:mayorista",
    "crear:minorista",
    "subir:pe-empleados/10-contrato.txt",
    "update:10",
  ]);
});

// ── registrarRuta: cada intento se marca antes de tocarlo ─────────────────

test("registrarRuta añade al Set compartido y devuelve la misma ruta", () => {
  const ctx = ctxVacio();
  const ruta = registrarRuta(ctx, "pe-empleados/99-intruso.txt");
  assert.equal(ruta, "pe-empleados/99-intruso.txt");
  assert.ok(ctx.rutasConocidas.has("pe-empleados/99-intruso.txt"));
});

// ── eliminarRutasConocidas: por ruta exacta, nunca por listado previo ─────

test("eliminarRutasConocidas pasa las rutas EXACTAS a eliminarArchivos, una sola llamada por lote", async () => {
  const recibidas: string[][] = [];
  const deps = { eliminarArchivos: async (rutas: string[]) => { recibidas.push(rutas); return { error: null }; } };
  const r = await eliminarRutasConocidas(deps, new Set(["a/1.txt", "a/2.txt"]));
  assert.equal(r.ok, true);
  assert.equal(r.borrados, 2);
  assert.equal(recibidas.length, 1, "un solo lote, no una llamada por ruta ni un list() previo");
  assert.deepEqual(recibidas[0].sort(), ["a/1.txt", "a/2.txt"]);
});

test("eliminarRutasConocidas reporta el error tal cual, sin tragárselo", async () => {
  const deps = { eliminarArchivos: async () => ({ error: { message: "denegado" } }) };
  const r = await eliminarRutasConocidas(deps, ["a/1.txt"]);
  assert.equal(r.ok, false);
  assert.equal(r.error.message, "denegado");
});
