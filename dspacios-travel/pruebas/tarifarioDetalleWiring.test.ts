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

  test("⚠️ item 2 — bloqueoIds es obligatorio para modulo:'bloqueo' (nunca 'todo el hotel' sin alcance)", () => {
    assert.match(detalleActions, /import \{ validarEntradaDetalleHotel, validarEntradaDetalleSalida, validarEntradaDetallePaquete \} from "@\/lib\/tarifario\/detalleValidacion"/);
    assert.match(detalleActions, /\.eq\("hotel_id", v\.hotelId\)\.in\("bloqueo_id", v\.bloqueoIds\)/, "el filtro de hotel en modulo bloqueo debe cruzar hotel_id CON el alcance de bloqueoIds");
  });

  test("⚠️ item 2 — alcance vacío devuelve 'sin opciones' (ok:true, filas:[]) SIN consultar Supabase — nunca cae a traer todo el hotel", () => {
    const cuerpo = detalleActions.slice(detalleActions.indexOf("export async function obtenerDetalleHotel"), detalleActions.indexOf("export async function obtenerDetalleSalida"));
    assert.match(cuerpo, /v\.bloqueoIds\.length === 0/);
    assert.match(cuerpo, /return \{ ok: true, filas: \[\] \};/);
  });

  test("⚠️ item 4 — falla cerrada de verdad: errorVigencia/errorEmpaquetado hacen que la Server Action devuelva ok:false (nunca ok:true con filas parciales/vacías disfrazadas de 'sin disponibilidad')", () => {
    const cuerpo = detalleActions.slice(detalleActions.indexOf("async function cargarDetalleAcotado"), detalleActions.indexOf("export async function obtenerDetalleHotel"));
    const idxIf = cuerpo.indexOf("if (res.errorVigencia || res.errorEmpaquetado)");
    assert.ok(idxIf > -1, "cargarDetalleAcotado debe revisar errorVigencia/errorEmpaquetado");
    const idxSiguienteReturn = cuerpo.indexOf("return {", idxIf);
    const finBloque = cuerpo.indexOf(";", idxSiguienteReturn) + 1;
    const bloqueIf = cuerpo.slice(idxIf, finBloque);
    assert.match(bloqueIf, /return \{ ok: false, error: MSG_ERROR_DETALLE \};/, `el primer return tras detectar el error de filtros debe ser ok:false — encontrado: ${bloqueIf.slice(-80)}`);
  });

  test("⚠️ item 4 — registra resultado=error (nunca 'ok') cuando falla vigencia/empaquetados o falta service-role", () => {
    const cuerpo = detalleActions.slice(detalleActions.indexOf("async function cargarDetalleAcotado"), detalleActions.indexOf("export async function obtenerDetalleHotel"));
    // Debe haber un registrarEtapa(..., "error") DESPUÉS de detectar el error de filtros — no un "ok" suelto que lo contradiga.
    const idxErrorFiltros = cuerpo.indexOf("if (res.errorVigencia || res.errorEmpaquetado)");
    const idxEtapaError = cuerpo.indexOf('registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error")', idxErrorFiltros);
    const idxReturnFalse = cuerpo.indexOf("return { ok: false, error: MSG_ERROR_DETALLE };", idxErrorFiltros);
    assert.ok(idxErrorFiltros > -1);
    assert.ok(idxEtapaError > idxErrorFiltros, "debe registrar la etapa como 'error' después de detectar el fallo de filtros");
    assert.ok(idxReturnFalse > idxEtapaError, "el return ok:false debe venir después de registrar el error — nunca 'ok' seguido de 'error' sin retornar");
    // Config faltante (service-role indispensable): mismo criterio.
    const idxConfig = cuerpo.indexOf("ad == null && crudas.some(esFilaHotelVerificable)");
    const idxEtapaErrorConfig = cuerpo.indexOf('registrarEtapa(FLUJO, flujoId, "detalle_tarifas", Math.round(performance.now() - t0), "error")', idxConfig);
    assert.ok(idxConfig > -1 && idxEtapaErrorConfig > idxConfig, "la rama de config faltante también debe registrar resultado=error");
  });

  test("⚠️ item 4 — vigencia INDISPENSABLE: si falta service-role y hay filas de hotel verificables, error de configuración (ok:false), nunca se salta la validación en silencio", () => {
    assert.match(detalleActions, /import \{ esFilaHotelVerificable \} from "@\/lib\/tarifario\/vigencia"/);
    const cuerpo = detalleActions.slice(detalleActions.indexOf("async function cargarDetalleAcotado"), detalleActions.indexOf("export async function obtenerDetalleHotel"));
    assert.match(cuerpo, /ad == null && crudas\.some\(esFilaHotelVerificable\)/);
    assert.match(cuerpo, /error_config_service_role_faltante_/);
  });
});

describe("VistaBooking.tsx — 'Ver opciones' dispara el detalle bajo demanda con dedup/caché y guarda contra carreras", () => {
  test("abrirHotel usa conCacheDetalle + obtenerDetalleHotel (no llama a Supabase directo)", () => {
    assert.match(vistaBooking, /import \{ obtenerDetalleHotel \} from "\.\/detalle-actions"/);
    assert.match(vistaBooking, /import \{ conCacheDetalle, claveDetalleHotel, type EstadoDetalle \} from "@\/lib\/tarifario\/detalleCliente"/);
    const cuerpo = vistaBooking.slice(vistaBooking.indexOf("function abrirHotel"), vistaBooking.indexOf("function cerrarHotel"));
    assert.match(cuerpo, /conCacheDetalle\(/);
    assert.match(cuerpo, /obtenerDetalleHotel\(/);
  });

  test("⚠️ item 2 — preserva el alcance activo: abrirHotel calcula bloqueoIds de salidasFiltradas (el filtro origen/destino/salida vigente), no 'todo el hotel'", () => {
    const cuerpo = vistaBooking.slice(vistaBooking.indexOf("function abrirHotel"), vistaBooking.indexOf("function cerrarHotel"));
    assert.match(cuerpo, /salidasFiltradas\.map\(\(s\) => s\.id\)/, "el alcance debe salir de las salidas YA filtradas por origen/destino/salida, no del catálogo completo");
    assert.match(cuerpo, /claveDetalleHotel\(/, "la clave de caché debe construirse con el helper que normaliza el alcance");
    assert.match(cuerpo, /bloqueoIds:\s*bloqueoIds/, "bloqueoIds debe viajar como argumento a obtenerDetalleHotel — nunca solo {modulo, hotelId}");
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

  test("useDetalleTabla descarta una respuesta que ya no corresponde a la SOLICITUD vigente (clave+intento — misma guarda que VistaBooking, ahora también a prueba de reintentos)", () => {
    const cuerpo = tarifarioPublic.slice(tarifarioPublic.indexOf("function useDetalleTabla"), tarifarioPublic.indexOf("function EstadoCargaTabla"));
    assert.match(cuerpo, /solicitudRef\.current\s*!==\s*solicitud/);
  });

  test("⚠️ item 8 — useDetalleTabla NO llama setState síncrono ANTES de la llamada async (dentro del cuerpo directo del efecto): 'cargando' se DERIVA comparando la solicitud vigente contra la del último resultado guardado", () => {
    const cuerpo = tarifarioPublic.slice(tarifarioPublic.indexOf("function useDetalleTabla"), tarifarioPublic.indexOf("function EstadoCargaTabla"));
    const idxEfecto = cuerpo.indexOf("useEffect(() => {");
    const idxCargar = cuerpo.indexOf("conCacheDetalle(clave, cargar)", idxEfecto);
    assert.ok(idxEfecto > -1 && idxCargar > idxEfecto);
    // Entre el inicio del efecto y el disparo de la llamada async no puede
    // haber ningún setResultado(...) — ese era exactamente el
    // `setEstado({estado:"cargando"})` síncrono que disparaba la regla.
    const antesDeLlamar = cuerpo.slice(idxEfecto, idxCargar);
    assert.doesNotMatch(antesDeLlamar, /setResultado\(/, "no debe haber un setState síncrono ANTES de iniciar la carga — eso es lo que señala react-hooks/set-state-in-effect");
    // Los dos únicos setResultado(...) del archivo deben vivir DENTRO de los
    // callbacks .then()/.catch() (después de idxCargar) — nunca en el cuerpo
    // directo del efecto.
    const despuesDeLlamar = cuerpo.slice(idxCargar);
    const usos = [...despuesDeLlamar.matchAll(/setResultado\(/g)];
    assert.equal(usos.length, 2, "setResultado solo debe llamarse desde .then() y .catch()");
    assert.doesNotMatch(cuerpo, /eslint-disable[^\n]*set-state-in-effect/, "no se suprime la regla — se corrige de verdad");
    assert.match(cuerpo, /resultado\.solicitud === solicitudActual/, "el estado 'ok'/'error' solo se usa si coincide con la solicitud vigente");
    assert.match(cuerpo, /return \[\{ estado: "cargando" \}/, "cargando se DERIVA como valor de retorno, no como setState");
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
