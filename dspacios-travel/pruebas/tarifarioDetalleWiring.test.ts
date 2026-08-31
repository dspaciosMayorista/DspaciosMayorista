import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// app/tarifario/detalle-actions.ts requiere `next/headers` (cookies()) real
// para `createClient()` — no se puede ejecutar con `node --test` en este
// entorno (mismo motivo documentado en pruebas/cotizarFechasWiring.test.ts
// para lib/reservar/cotizar.ts). Se verifica por inspección del código
// FUENTE real: seguridad (RLS/anon para el dato público, service-role SOLO
// para las verificaciones internas), 1 sola consulta por alcance (sin N+1),
// y que la validación de `unknown` corre ANTES de tocar Supabase.
// ───────────────────────────────────────────────────────────────────────────

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");

const detalleActions = leer("app/tarifario/detalle-actions.ts");
const vistaBooking = leer("app/tarifario/VistaBooking.tsx");
const tarifarioPublic = leer("app/tarifario/TarifarioPublic.tsx");
const resumen = leer("lib/tarifario/resumen.ts");

describe("detalle-actions.ts — seguridad de la lectura pública", () => {
  test("todo export es async (regla de Next.js para archivos 'use server')", () => {
    assert.match(detalleActions, /^"use server";/);
    const exportados = [...detalleActions.matchAll(/^export (async function|function) (\w+)/gm)];
    assert.ok(exportados.length >= 4, "deben existir las 4 acciones de detalle");
    for (const [linea, kw] of exportados) {
      assert.equal(kw, "async function", `export no-async encontrado: "${linea}" — un archivo "use server" de Next.js solo puede exportar funciones async`);
    }
  });

  test("las 4 acciones leen tarifario_resultado con `sb` (createClient, RLS/anon), nunca con el admin/service-role", () => {
    // El ÚNICO `.from("tarifario_resultado")` de todo el archivo debe colgar
    // de `sb`, no de `ad`/`admin()` — grep de la línea completa.
    const lineasConsulta = detalleActions.split("\n").filter((l) => l.includes('.from("tarifario_resultado")'));
    assert.ok(lineasConsulta.length >= 4, "cada una de las 4 acciones debe consultar tarifario_resultado");
    for (const linea of lineasConsulta) {
      assert.ok(linea.trim().startsWith("sb.from") || linea.includes("await sb.from") || linea.includes("(sb) =>"), `una consulta a tarifario_resultado no cuelga de "sb": ${linea}`);
      assert.doesNotMatch(linea, /\bad\.from|\badmin\(\)\.from/, `tarifario_resultado se leyó con el cliente admin/service-role, no con sb: ${linea}`);
    }
  });

  test("cada acción valida el input ANTES de llamar a cargarDetalleAcotado/crear el cliente", () => {
    for (const fn of ["obtenerDetalleHotel", "obtenerDetalleSalida", "obtenerDetallePaquete"]) {
      const idxFn = detalleActions.indexOf(`export async function ${fn}(`);
      assert.ok(idxFn > -1, `no se encontró ${fn}`);
      const idxValidar = detalleActions.indexOf("validarEntrada", idxFn);
      const idxCargar = detalleActions.indexOf("cargarDetalleAcotado(", idxFn);
      assert.ok(idxValidar > -1 && idxCargar > -1, `${fn} debe validar y luego cargar`);
      assert.ok(idxValidar < idxCargar, `${fn} debe validar el input ANTES de tocar Supabase (cargarDetalleAcotado)`);
    }
  });

  test("un error de Supabase nunca se re-expone crudo — solo MSG_ERROR_DETALLE (mensaje fijo)", () => {
    // Todo `return { ok: false, error: ...}` debe usar la constante fija,
    // nunca interpolar el error real de Supabase.
    const returns = [...detalleActions.matchAll(/return \{ ok: false, error: ([^}]+)\}/g)];
    assert.ok(returns.length >= 4);
    for (const [, expr] of returns) assert.equal(expr.trim(), "MSG_ERROR_DETALLE");
  });

  test("obtenerDetalleServicios: 2 consultas fijas (servicios + armado_paquetes), ninguna dentro de un loop por fila", () => {
    const cuerpo = detalleActions.slice(detalleActions.indexOf("export async function obtenerDetalleServicios"));
    const fromCalls = [...cuerpo.matchAll(/\.from\(/g)];
    // 2 llamadas .from() reales en el cuerpo de la función (tarifario_resultado + armado_paquetes) —
    // no debe haber un tercer .from() dentro de un for/map (N+1 por fila).
    assert.ok(fromCalls.length <= 3, `obtenerDetalleServicios tiene ${fromCalls.length} llamadas .from() — revisar que no haya N+1`);
    assert.doesNotMatch(cuerpo, /for\s*\([^)]*\)\s*\{[\s\S]*?\.from\(/, "no debe haber una consulta a Supabase DENTRO de un loop (N+1)");
  });

  test("las verificaciones internas (vigencia/empaquetados) usan aplicarFiltrosPostCarga — mismo helper que Tier 1 (resumen.ts)", () => {
    assert.match(detalleActions, /import \{ aplicarFiltrosPostCarga \} from "@\/lib\/tarifario\/filtrosPostCarga"/);
    assert.match(resumen, /import \{ aplicarFiltrosPostCarga \} from "\.\/filtrosPostCarga\.ts"/);
  });
});

describe("VistaBooking.tsx — 'Ver opciones' dispara el detalle bajo demanda con dedup/caché y guarda contra carreras", () => {
  test("abrirHotel usa conCacheDetalle + obtenerDetalleHotel (no llama a Supabase directo)", () => {
    assert.match(vistaBooking, /import \{ obtenerDetalleHotel \} from "\.\/detalle-actions"/);
    assert.match(vistaBooking, /import \{ conCacheDetalle, type EstadoDetalle \} from "@\/lib\/tarifario\/detalleCliente"/);
    const cuerpo = vistaBooking.slice(vistaBooking.indexOf("function abrirHotel"), vistaBooking.indexOf("function cerrarHotel"));
    assert.match(cuerpo, /conCacheDetalle\(/);
    assert.match(cuerpo, /obtenerDetalleHotel\(/);
  });

  test("el botón 'Ver opciones' llama abrirHotel (no setAbierto directo, que saltaría el detalle)", () => {
    assert.match(vistaBooking, /onClick=\{\(\) => abrirHotel\(h\)\}/);
    assert.doesNotMatch(vistaBooking, /onClick=\{\(\) => setAbierto\(h\)\}/, "el click de la tarjeta debe pasar por abrirHotel, no llamar setAbierto directo");
  });

  test("carrera al abrir dos hoteles: la respuesta de un hotel viejo se descarta si claveAbiertaRef ya cambió", () => {
    const cuerpo = vistaBooking.slice(vistaBooking.indexOf("function abrirHotel"), vistaBooking.indexOf("function cerrarHotel"));
    assert.match(cuerpo, /claveAbiertaRef\.current\s*!==\s*clave/, "debe descartar la respuesta si la clave abierta ya no coincide");
  });

  test("un error de detalle no borra la tarjeta/grilla — solo cambia el estado DENTRO del modal", () => {
    assert.match(vistaBooking, /estado: "error"/);
    assert.match(vistaBooking, /Reintentar/);
    // El estado de error se guarda en `detalleHotel`, un state SEPARADO de
    // `abierto`/`hoteles` — nunca se sobreescribe `filas`/`hoteles`.
    assert.doesNotMatch(vistaBooking.slice(vistaBooking.indexOf("function abrirHotel"), vistaBooking.indexOf("function cerrarHotel")), /setHoteles|setFilas/);
  });
});

describe("TarifarioPublic.tsx — Vista tabla (PorSalida/PorPaquete/PorServicios) pide detalle acotado, no el resumen", () => {
  test("importa las 3 acciones de detalle + el módulo de caché compartido con VistaBooking", () => {
    assert.match(tarifarioPublic, /import \{ obtenerDetalleSalida, obtenerDetallePaquete, obtenerDetalleServicios \} from "\.\/detalle-actions"/);
    assert.match(tarifarioPublic, /import \{ conCacheDetalle, type EstadoDetalle \} from "@\/lib\/tarifario\/detalleCliente"/);
  });

  test("useDetalleTabla se usa en PorSalida, PorPaquete y PorServicios", () => {
    const usos = [...tarifarioPublic.matchAll(/useDetalleTabla\(/g)];
    assert.ok(usos.length >= 3, `se esperaban al menos 3 usos de useDetalleTabla (PorSalida, PorPaquete, PorServicios) — hubo ${usos.length}`);
  });

  test("PorSalida acota por bloqueoId/salidaId (no por la clave compuesta de texto usada solo para las pastillas)", () => {
    const cuerpo = tarifarioPublic.slice(tarifarioPublic.indexOf("function PorSalida"), tarifarioPublic.indexOf("function PorPaquete"));
    assert.match(cuerpo, /obtenerDetalleSalida\(\{ modulo: "bloqueo", bloqueoId: selFila!\.bloqueo_id \}\)/);
    assert.match(cuerpo, /obtenerDetalleSalida\(\{ modulo: "dinamico", salidaId: selFila!\.salida_id \}\)/);
  });

  test("PorPaquete acota por paqueteId", () => {
    const cuerpo = tarifarioPublic.slice(tarifarioPublic.indexOf("function PorPaquete"), tarifarioPublic.indexOf("function PorServicios"));
    assert.match(cuerpo, /obtenerDetallePaquete\(\{ paqueteId: selFila!\.paquete_id \}\)/);
  });

  test("PorServicios pide el detalle completo de servicios sin parámetros (módulo completo, acotado por módulo)", () => {
    const cuerpo = tarifarioPublic.slice(tarifarioPublic.indexOf("function PorServicios"));
    assert.match(cuerpo, /obtenerDetalleServicios\(\)/);
  });

  test("useDetalleTabla descarta una respuesta que ya no corresponde a la clave vigente (misma guarda que VistaBooking)", () => {
    const cuerpo = tarifarioPublic.slice(tarifarioPublic.indexOf("function useDetalleTabla"), tarifarioPublic.indexOf("function EstadoCargaTabla"));
    assert.match(cuerpo, /claveRef\.current\s*!==\s*clave/);
  });
});

describe("lib/tarifario/detalleCliente.ts — dedup/caché en memoria del navegador", () => {
  const detalleCliente = leer("lib/tarifario/detalleCliente.ts");
  test("un resultado ok:false NUNCA se cachea (se puede reintentar de verdad)", () => {
    assert.match(detalleCliente, /if \(!r\.ok\) enVuelo\.delete\(clave\)/);
  });
  test("una promesa rechazada se limpia de la caché (catch borra la clave)", () => {
    assert.match(detalleCliente, /\.catch\(\(e\) => \{\s*enVuelo\.delete\(clave\)/);
  });
  test("una segunda llamada con la misma clave reutiliza la promesa en vuelo (dedup)", () => {
    assert.match(detalleCliente, /const existente = enVuelo\.get\(clave\);\s*if \(existente\) return existente/);
  });
});
