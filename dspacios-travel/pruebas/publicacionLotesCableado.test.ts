import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VENTANA_PETICION_MS } from "../lib/tarifario/controladorPublicacion.ts";
import { publicacionPorLotesActiva, puertoSupabase, ErrorRpc, type RpcCliente } from "../lib/tarifario/puertoSupabase.ts";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const actions = leer("app/(dashboard)/dashboard/paquetes/actions.ts");
const ini = actions.indexOf("export async function generarTarifario(");
const fin = actions.indexOf("\nexport async function ", ini + 10);
const cuerpo = actions.slice(ini, fin);

describe("publicación por lotes — cableado en «Generar tarifario»", () => {
  test("APAGADA por defecto: el código puede desplegarse antes que la migración", () => {
    assert.equal(publicacionPorLotesActiva({}), false);
    assert.equal(publicacionPorLotesActiva({ TARIFARIO_PUBLICACION_POR_LOTES: "0" }), false);
    assert.equal(publicacionPorLotesActiva({ TARIFARIO_PUBLICACION_POR_LOTES: "1" }), true);
  });

  test("el publicador monolítico sigue siendo el camino por defecto y se conserva intacto", () => {
    assert.ok(cuerpo.includes('sb.rpc("publicar_tarifario_resultado_63"'));
    assert.ok(cuerpo.includes('sb.rpc("publicar_tarifario_resultado"'));
    assert.match(cuerpo, /const \{ data: publicado, error: ePublicar \} = usarLotes\s*\n\s*\? \{ data: true as boolean \| null, error: null \}\s*\n\s*: modo63/);
  });

  test("un conjunto vacío no se carga por lotes (lo publica el publicador de siempre)", () => {
    assert.match(cuerpo, /const usarLotes = porLotes && filas\.length > 0;/);
  });

  test("reanudar NO pide una generación nueva: usa la generación y la revisión que fijó el manifiesto", () => {
    assert.match(cuerpo, /if \(opciones\.reanudar\) \{[\s\S]*?leerPublicacionPendiente\([\s\S]*?generacion = pend\.generacion;\s*\n\s*revisionCapturada = pend\.revisionCapturada;/);
    assert.match(actions, /export async function continuarPublicacionTarifario\(paqueteId: number\): Promise<Result> \{\s*\n\s*return generarTarifario\(paqueteId, \{ reanudar: true \}\);/);
  });

  test("una publicación pendiente se informa como ok con «pendiente» y si continúa sola (no como éxito ni error) y se mide aparte", () => {
    assert.match(cuerpo, /medir\("pendiente"\);\s*\n\s*if \(rp\.automatica\) await empujarContinuacion\(\);\s*\n\s*retornoLotes = \{\s*\n\s*ok: true, pendiente: \{ faltan: rp\.faltan, total: rp\.total, automatica: rp\.automatica \}/);
  });

  test("un descarte (generación vieja, fuente cambiada, cálculo distinto) se mide como descartado; un rechazo de integridad o un error de la base es un fallo técnico, nunca «obsoleta»", () => {
    assert.match(cuerpo, /rp\.estado === "descartada" \|\| rp\.estado === "conflicto"\) \{\s*\n\s*medir\("descartado"\);/);
    assert.match(cuerpo, /rp\.estado === "rechazada"\) \{\s*\n\s*return await fallarTecnico\(/);
    assert.match(cuerpo, /\} catch \(e\) \{\s*\n\s*return await fallarTecnico\(e instanceof Error \? e\.message : String\(e\)\);/);
  });

  test("las filas exactas llevan neto_hotel del MOTOR; «desde» (porción) y la fila de infante sintética no (no verificables)", () => {
    assert.match(cuerpo, /neto_hotel: netoHotelExacto,/);
    assert.match(cuerpo, /publicarFila\(acom, costoHotel, procedencia, masBarato \? null : costoHotel\);/);
    assert.match(cuerpo, /publicarFila\("infante", 0, procedenciaHab\);/);
  });

  test("la pantalla usa el bucle reanudable: si todo está en la base solo CONSULTA (no recalcula), se detiene si se desmonta y ofrece «Continuar publicación» al reabrir", () => {
    const cliente = leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx");
    assert.match(cliente, /ejecutarReanudable\(inicial, async \(previa\) => \{[\s\S]*?previa\.pendiente\?\.automatica[\s\S]*?estadoPublicacionTarifario\(props\.paqueteId\)[\s\S]*?continuarPublicacionTarifario\(props\.paqueteId\)/);
    assert.match(cliente, /interrumpido: \(\) => !montado\.current/);
    assert.match(cliente, /props\.publicacionPendiente && !pending && !msg/);
    const pagina = leer("app/(dashboard)/dashboard/paquetes/[id]/page.tsx");
    assert.match(pagina, /publicacionPorLotesActiva\(\) \? await leerPublicacionPendiente\(/);
  });

  test("el desempate entre vigencias de igual prioridad es DETERMINISTA y el mismo en generador, cotización, reserva y vigencia: se carga por (orden, id)", () => {
    for (const [rel, ancla] of [
      ["app/(dashboard)/dashboard/paquetes/actions.ts", 'sb.from("hotel_temporadas").select('],
      ["lib/reservar/computo.ts", 'admin.from("hotel_temporadas").select('],
      ["lib/reservar/cotizar.ts", 'admin.from("hotel_temporadas").select('],
    ] as const) {
      const src = leer(rel); const i = src.indexOf(ancla);
      assert.ok(i >= 0, `${rel}: no se encontró la carga de hotel_temporadas`);
      const linea = src.slice(i, src.indexOf("\n", i));
      assert.match(linea, /\.order\("orden"\)\.order\("id"\)/, `${rel}: la carga debe ordenar por (orden, id)`);
    }
    const vig = leer("lib/tarifario/vigencia.ts");
    assert.match(vig, /\.from\("hotel_temporadas"\)[\s\S]{0,400}?\.order\("orden"\)\s*\n\s*\.order\("id"\)/);
  });

  test("la composición de la 258 sale de lo que se hornea en cada salida de bloqueo/dinámico y viaja en el manifiesto (ya no es [])", () => {
    assert.match(actions, /const composicionPorFecha = new Map<string, number\[\]>\(\);/);
    // Con el hotfix 256 integrado la composición de cada fecha descuenta los incluidos OMITIDOS (sin tarifa vigente); sin él, todos los incluidos.
    assert.match(actions, /if \(modulo === "bloqueo" \|\| modulo === "dinamico"\)\s*\{?\s*composicionPorFecha\.set\(fechaIda, /);
    assert.match(cuerpo, /composicion: composicionDeManifiesto\(composicionPorFecha\), regla: REGLA_COMPOSICION_(MANIFIESTO|PUBLICADA),/);
    assert.doesNotMatch(cuerpo, /composicion: \[\]/);
  });

  test("las regeneraciones en segundo plano (hotel, servicio, vuelo, salida) TAMBIÉN publican por lotes: la base continúa sola, así que no necesitan quién las reanude", () => {
    assert.match(cuerpo, /const porLotes = \(opciones\.porLotes === true \|\| opciones\.reanudar === true\) && publicacionPorLotesActiva\(\);/);
    assert.match(actions, /const enSegundoPlano = \(inicioMs: number = Date\.now\(\)\): OpcionesGenerar => \(\{ porLotes: true, segundoPlano: true, inicioMs \}\);/);
    for (const rel of ["app/(dashboard)/dashboard/paquetes/actions.ts", "app/(dashboard)/dashboard/producto/servicios/actions.ts", "app/(dashboard)/dashboard/vuelos/actions.ts", "app/(dashboard)/dashboard/producto/hoteles/actions.ts"]) {
      const src = leer(rel);
      for (const m of src.matchAll(/(?<![\w.])generarTarifario\(([^)\n]*(?:\([^)\n]*\))?[^)\n]*)\)/g)) {
        if (/paqueteId: number/.test(m[1]) || /paquete_id=/.test(m[1])) continue;   // la firma y los mensajes de log
        assert.match(m[1], /porLotes|enSegundoPlano|reanudar|opciones/, `${rel}: una regeneración sin lotes quedaría sujeta al límite de 30 s del publicador monolítico: ${m[0]}`);
      }
    }
    for (const fn of ["regenerarTarifariosDeHotel", "regenerarTarifariosDeBloqueo", "regenerarTarifariosDeServicio"]) {
      assert.match(actions, new RegExp(`export async function ${fn}\\(\\w+: number, inicioMs\\?: number\\)`), `${fn} recibe la ventana de la acción que llama`);
    }
    assert.match(actions, /Promise\.allSettled\(ids\.map\(\(id\) => generarTarifario\(id, enSegundoPlano\(inicioMs\)\)\)\)/);
    // varias regeneraciones en bucle comparten UNA sola ventana (la de la acción), no una por paquete/hotel
    assert.match(leer("app/(dashboard)/dashboard/producto/hoteles/actions.ts"), /const inicioRegen = Date\.now\(\); for \(const hid of tocados\) await regenerarTarifariosDeHotel\(hid, inicioRegen\)/);
    assert.match(leer("app/(dashboard)/dashboard/vuelos/actions.ts"), /inicioMs: inicioRegen/);
    assert.match(leer("app/(dashboard)/dashboard/producto/servicios/actions.ts"), /inicioMs: inicioRegen/);
    assert.match(leer("app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx"), /generarTarifario\(props\.paqueteId, \{ porLotes: true \}\)/);
  });

  test("sin tiempo para PREPARAR los lotes, una regeneración en segundo plano marca el fallo en vez de quedar «recalculando» en falso", () => {
    assert.match(cuerpo, /rp\.estado === "pendiente" && !rp\.automatica && opciones\.segundoPlano\) \{[\s\S]*?return await fallar\(/);
  });

  test("toda página que aloja una de esas acciones declara maxDuration como literal igual a VENTANA_PETICION_MS", () => {
    for (const p of ["paquetes/[id]", "paquetes", "producto/hoteles/[id]", "producto/hoteles", "producto/servicios", "vuelos/[id]", "vuelos"]) {
      const m = /export const maxDuration = (\d+);/.exec(leer(`app/(dashboard)/dashboard/${p}/page.tsx`));
      assert.ok(m, `${p}: falta export const maxDuration (literal)`);
      assert.equal(Number(m![1]) * 1000, VENTANA_PETICION_MS, p);
    }
  });

  test("la ventana de la petición se cuenta desde el inicio de la acción que llama", () => {
    assert.match(actions, /const inicioAccion = opciones\.inicioMs \?\? Date\.now\(\);/);
    assert.match(cuerpo, /inicioMs: inicioAccion/);
  });

  test("los tipos conocen las columnas de generación, pero el costo neto del hotel NO es una columna de la tabla legible", () => {
    const tipos = leer("types/database.ts");
    assert.match(tipos, /generacion\?: number \| null;\s*\n\s*revision_fuente\?: number \| null;\s*\n\s*lote\?: number \| null;/);
    assert.doesNotMatch(tipos, /neto_hotel/, "neto_hotel vive en tarifario_resultado_neto, sin acceso para anon/authenticated");
    assert.doesNotMatch(tipos, /tarifario_manifiesto_crear/, "las firmas RPC del prototipo no deben quedar dentro de otra función (se llaman por el cliente sin tipos)");
    assert.match(actions, /type ResultadoInsert = Database\["public"\]\["Tables"\]\["tarifario_resultado"\]\["Insert"\] & \{ neto_hotel\?: number \| null \};/);
  });

  test("la continuación SIN navegador: ruta de cron protegida con CRON_SECRET que llama al trabajador de la base", () => {
    const ruta = "app/api/cron/publicacion-tarifario/route.ts";
    assert.ok(existsSync(join(raiz, ruta)), "falta la ruta de continuación");
    const src = leer(ruta);
    assert.match(src, /process\.env\.CRON_SECRET/);
    assert.match(src, /tarifario_cola_correr/);
    assert.match(src, /export const maxDuration = 60;/);
  });
});

describe("puerto de Supabase — los errores reales de la base no se confunden con «obsoleta»", () => {
  const cliente = (resp: { data?: unknown; error?: { message: string; code?: string } | null }): RpcCliente => ({ rpc: async () => ({ data: resp.data ?? null, error: resp.error ?? null }) });

  test("una FK inválida (23503) llega como ErrorRpc con su código", async () => {
    const p = puertoSupabase(cliente({ error: { message: 'insert or update on table "tarifario_resultado" violates foreign key constraint "tarifario_resultado_hotel_id_fkey"', code: "23503" } }));
    await assert.rejects(() => p.espera(73, 5, 1, "[]"), (e: unknown) => e instanceof ErrorRpc && e.codigo === "23503" && /hotel_id_fkey/.test(e.message));
  });

  test("la respuesta textual «obsoleta» de la base sí se entrega como texto", async () => {
    assert.equal(await puertoSupabase(cliente({ data: "obsoleta" })).espera(73, 5, 1, "[]"), "obsoleta");
  });

  test("una respuesta con forma inesperada falla cerrado", async () => {
    await assert.rejects(() => puertoSupabase(cliente({ data: { x: 1 } })).avanzar(73, 5), ErrorRpc);
  });
});
