import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { buscarPaginaTarifarioLiviana, MODULOS_TARIFARIO } from "@/lib/tarifario/consulta";
import { obtenerNombresDestinos } from "@/lib/tarifario/metadata";
import { getProgramasResumen } from "@/lib/programas";
import { formatMoneda } from "@/lib/utils";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina, registrarErrorTecnico,
  siguienteInvocacionProceso, iniciarCronometro, medirPayloadSiHabilitado, textoEstimacionPayload,
} from "@/lib/observabilidad/medicion";

export const dynamic = "force-dynamic";

const FLUJO = "pagina_tarifario_interno";
const MODULO_LABEL: Record<string, string> = {
  bloqueo: "Paquetes", dinamico: "Salidas dinámicas", porcion_terrestre: "Porción terrestre", servicios: "Servicios",
};

// Mensaje público FIJO — nunca "no hay tarifas" cuando en realidad falló la consulta.
const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

/**
 * Rediseño "carga bajo demanda" (medición real de preview: la versión
 * anterior de esta página descargaba el catálogo COMPLETO — 17.197 filas,
 * ~11,1 MB — antes de mostrar nada, y el intento de cachear ese mismo bloque
 * fue rechazado por Next.js ("items over 2MB can not be cached"), así que
 * cada visita repetía el trabajo completo). Ahora es una tabla server-
 * paginada de verdad: filtros (búsqueda/módulo/destino/categoría/régimen)
 * en el WHERE de la consulta, `pagina` en `.range()` — SOLO se trae la
 * página pedida (50 filas, `PAGE_SIZE_INTERNO`), nunca el catálogo entero.
 * Los filtros van como GET (URL) para que "Filtrar"/"Siguiente"/regenerar el
 * tarifario en otra pantalla resulte, al volver acá, en una consulta fresca
 * — sin ninguna caché de por medio (se retiró la caché compartida del
 * catálogo de la ronda anterior: dejó de tener sentido una vez que ninguna
 * de las 3 rutas vuelve a cargar el catálogo completo).
 */
export default async function TarifarioInternoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoPrep = iniciarCronometro();
  const sp = await searchParams;

  const filtrosRaw = {
    texto: sp.q ?? "", modulo: sp.modulo ?? "", destino: sp.destino ?? "",
    categoria: sp.categoria ?? "", regimen: sp.regimen ?? "", page: sp.page ?? "1",
  };

  const sb = await createClient();

  const _crono = iniciarCronometro();
  const [res, destinos, resProgramas] = await Promise.all([
    buscarPaginaTarifarioLiviana(sb, filtrosRaw),
    obtenerNombresDestinos(sb),
    // Programas (circuitos): dataset chico (no forma parte del problema de
    // las ~17.000 filas de tarifario_resultado) — se sigue trayendo entero,
    // sin paginar, igual que siempre. Interno: activos aunque no publicados.
    getProgramasResumen(sb, false),
  ]);
  const ms = _crono();
  if (resProgramas.error) {
    registrarErrorTecnico(FLUJO, flujoId, "programas_resumen", "error_getProgramasResumen", resProgramas.error);
  }
  const programas = resProgramas.programas;

  if (!res.ok) {
    registrarEtapa(FLUJO, flujoId, "consulta_pagina", ms, "error");
    registrarErrorTecnico(FLUJO, flujoId, "consulta_pagina", "error_consulta_pagina_tarifario_liviana", res.error);
    return (
      <div className="mx-auto max-w-[1700px] p-4 md:p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Tarifario</h1>
        </div>
        <p className="py-20 text-center text-red-500">{MSG_ERROR_CARGAR_TARIFARIO}</p>
      </div>
    );
  }
  registrarEtapa(FLUJO, flujoId, "consulta_pagina", ms, "ok");
  // Tamaño estimado de la respuesta inicial (bytes) — gateado por
  // DIAGNOSTICO_MEDIR_PAYLOAD=1, mismo helper que /tarifario y
  // /dashboard/reservar — para comprobar en preview que la primera
  // respuesta de esta ruta es chica, nunca miles de filas.
  const estFilas = medirPayloadSiHabilitado(res.filas);
  registrarDatoPagina(
    FLUJO, flujoId, "consulta_pagina",
    `filas=${res.filas.length} total=${res.total} page=${res.page} pageSize=${res.pageSize} invocacion_proceso=${invocacion} ${textoEstimacionPayload(estFilas)}`
  );
  // "preparacion_servidor" — mismo criterio que /tarifario y /dashboard/
  // reservar: termina ANTES del `return` del JSX, no incluye serialización
  // RSC/transmisión/hidratación/pintado. Con la carga bajo demanda, esta
  // etapa es casi idéntica a "consulta_pagina" (ya no hay enriquecimiento de
  // Vista Booking en esta ruta) — se deja de todas formas para que las 3
  // rutas reporten el mismo set de etapas en los logs.
  registrarEtapa(FLUJO, flujoId, "preparacion_servidor", _cronoPrep(), "ok");

  const totalPaginas = Math.max(Math.ceil(res.total / res.pageSize), 1);

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (filtrosRaw.texto) p.set("q", filtrosRaw.texto);
    if (filtrosRaw.modulo) p.set("modulo", filtrosRaw.modulo);
    if (filtrosRaw.destino) p.set("destino", filtrosRaw.destino);
    if (filtrosRaw.categoria) p.set("categoria", filtrosRaw.categoria);
    if (filtrosRaw.regimen) p.set("regimen", filtrosRaw.regimen);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  const inputCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-[1700px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tarifario</h1>
          <p className="mt-1 text-sm text-gray-500">
            Resultado publicado de los paquetes (vista interna, solo lectura). {res.total.toLocaleString("es-CO")} filas.
            Para generar contratos usa <b>Reservar</b>.
          </p>
        </div>
        <Link href="/dashboard/producto/destinos" className="text-sm text-[var(--brand-accent)] hover:underline">
          Gestionar destinos →
        </Link>
      </div>

      {/* Filtros (GET) — buscan sobre el conjunto completo en base de datos, no solo la página visible. */}
      <form className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5" method="get">
        <input name="q" defaultValue={filtrosRaw.texto} placeholder="Buscar hotel/paquete/servicio…" className={inputCls} />
        <select name="modulo" defaultValue={filtrosRaw.modulo} className={inputCls}>
          <option value="">Todos los módulos</option>
          {MODULOS_TARIFARIO.map((m) => <option key={m} value={m}>{MODULO_LABEL[m] ?? m}</option>)}
        </select>
        <select name="destino" defaultValue={filtrosRaw.destino} className={inputCls}>
          <option value="">Todos los destinos</option>
          {destinos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input name="categoria" defaultValue={filtrosRaw.categoria} placeholder="Categoría" className={inputCls} />
        <input name="regimen" defaultValue={filtrosRaw.regimen} placeholder="Régimen" className={inputCls} />
        <div className="col-span-2 flex gap-2 md:col-span-5">
          <button type="submit" className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
            Filtrar
          </button>
          <Link href="/dashboard/tarifario" className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-gray-800">Limpiar</Link>
        </div>
      </form>

      {!res.filas.length ? (
        <p className="py-20 text-center text-gray-400">
          {filtrosRaw.texto || filtrosRaw.modulo || filtrosRaw.destino || filtrosRaw.categoria || filtrosRaw.regimen
            ? "No hay tarifas para estos filtros."
            : <>Aún no hay tarifas publicadas. Arma un paquete y dale <b>Generar tarifario</b>.</>}
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2">Módulo</th>
                    <th className="px-3 py-2">Destino</th>
                    <th className="px-3 py-2">Salida / Paquete</th>
                    <th className="px-3 py-2">Hotel / Servicio</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2">Régimen</th>
                    <th className="px-3 py-2">Acomodación</th>
                    <th className="px-3 py-2 text-right">PVP</th>
                  </tr>
                </thead>
                <tbody>
                  {res.filas.map((f, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-xs text-gray-500">{MODULO_LABEL[f.modulo] ?? f.modulo}</td>
                      <td className="px-3 py-2 text-gray-600">{f.destino_nombre ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{f.bloqueo_label ?? f.paquete_nombre ?? "—"}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{f.hotel_nombre ?? f.servicio_nombre ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{f.categoria ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{f.regimen ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-600">{f.acomodacion ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                        {formatMoneda(f.precio_pvp, f.moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPaginas > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>Página {res.page} de {totalPaginas.toLocaleString("es-CO")}</span>
              <div className="flex gap-2">
                {res.page > 1 && (
                  <Link href={qs({ page: res.page - 1 })} className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50">← Anterior</Link>
                )}
                {res.page < totalPaginas && (
                  <Link href={qs({ page: res.page + 1 })} className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50">Siguiente →</Link>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!!programas.length && (
        <div className="mt-8">
          <h2 className="mb-2 text-lg font-semibold text-gray-800">Programas ({programas.length})</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Ciudades</th>
                  <th className="px-3 py-2">Días/Noches</th>
                  <th className="px-3 py-2 text-right">Desde</th>
                </tr>
              </thead>
              <tbody>
                {programas.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-800">
                      <Link href={`/tarifario/programa/${p.id}`} className="hover:underline">{p.nombre}</Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{p.ciudades.join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{p.dias ? `${p.dias}D/${p.noches ?? ""}N` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--brand-primary)" }}>
                      {p.desde_pvp != null ? formatMoneda(p.desde_pvp, p.moneda) : "Consultar"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
