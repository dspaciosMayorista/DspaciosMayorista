import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { TarifarioPublic } from "@/app/tarifario/TarifarioPublic";
import { orquestarCargaInterna } from "@/lib/tarifario/orquestacion";
import { cargarFilasTarifarioLivianoCompartido, getProgramasResumenCompartido } from "@/lib/tarifario/catalogoCache";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina, registrarErrorTecnico,
  siguienteInvocacionProceso, medirPayloadSiHabilitado, textoEstimacionPayload, iniciarCronometro,
} from "@/lib/observabilidad/medicion";

export const dynamic = "force-dynamic";

const FLUJO = "pagina_tarifario_interno";

// Mensaje público FIJO — nunca "no hay tarifas" cuando en realidad falló la
// consulta (revisión posterior, defecto "PAGINACIÓN IGNORA ERRORES").
const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

// Diagnóstico del incidente de ~13s: la carga del tarifario (paginación +
// filtro de vigencia, compuestas como una sola tarea) y getProgramasResumen()
// no dependen una de la otra — arrancan CONCURRENTEMENTE vía
// orquestarCargaInterna() (lib/tarifario/orquestacion.ts, función PURA
// probada con promesas diferidas en pruebas/tarifarioOrquestacion.test.ts —
// la garantía de concurrencia real no depende de leer este archivo).
//
// ⚠️ CACHÉ COMPARTIDA (ronda posterior, "medición real de ~13s en preview"):
// ambas fuentes ahora pasan por `lib/tarifario/catalogoCache.ts` — el mismo
// catálogo (columnas LIVIANAS de esta ruta, y `soloPublicados=false`,
// idéntico al de siempre) queda cacheado y se comparte entre las 3 rutas
// de tarifario. Este page.tsx NO necesita saber si sirvió desde caché o
// recién se calculó: la etapa "catalogo_tarifario" mide lo que tardó de
// cualquier forma (hit ≈ unos pocos ms, miss ≈ el costo real de siempre).
// Ver auditoría de qué es global vs. de usuario en el propio módulo.
export default async function TarifarioInternoPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoPrep = iniciarCronometro();

  const sb = await createClient();

  const _cronoCarga = iniciarCronometro();
  const { tarifario: resTarifario, programas: resProgramas } = await orquestarCargaInterna({
    cargarTarifario: async () => {
      const _cronoCat = iniciarCronometro();
      const res = await cargarFilasTarifarioLivianoCompartido(sb);
      if (!res.ok) {
        registrarEtapa(FLUJO, flujoId, "catalogo_tarifario", _cronoCat(), "error");
        registrarErrorTecnico(FLUJO, flujoId, "catalogo_tarifario", "error_catalogo_tarifario_liviano", null);
        return { ok: false as const };
      }
      registrarEtapa(FLUJO, flujoId, "catalogo_tarifario", _cronoCat(), "ok");
      registrarDatoPagina(FLUJO, flujoId, "catalogo_tarifario", `filas=${res.filas.length}`);
      return { ok: true as const, filas: res.filas };
    },
    // Programas (interno: muestra activos aunque no estén publicados).
    cargarProgramas: () => getProgramasResumenCompartido(sb, false),
  });
  registrarEtapa(FLUJO, flujoId, "tarifario_y_programas", _cronoCarga(), resTarifario.ok && !resProgramas.error ? "ok" : "error");

  if (!resTarifario.ok) {
    // Nunca "aún no hay tarifas" cuando en realidad la consulta falló —
    // eso afirmaría algo falso. El detalle técnico ya quedó saneado en el
    // log de arriba (registrarErrorTecnico); acá solo el mensaje público fijo.
    return (
      <div className="mx-auto max-w-[1700px] p-4 md:p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Tarifario</h1>
        </div>
        <p className="py-20 text-center text-red-500">{MSG_ERROR_CARGAR_TARIFARIO}</p>
      </div>
    );
  }
  const filas = resTarifario.filas;
  if (resProgramas.error) {
    registrarErrorTecnico(FLUJO, flujoId, "programas_resumen", "error_getProgramasResumen", resProgramas.error);
  }
  const programas = resProgramas.programas;

  // Costo de la propia instrumentación (revisión posterior, defecto "COSTO
  // DE LA PROPIA INSTRUMENTACIÓN"): cada valor se estima UNA sola vez y se
  // reutiliza — antes `filas`/`programas` se serializaban más de una vez
  // por request solo para loguear el tamaño. La estimación en sí queda
  // detrás de `DIAGNOSTICO_MEDIR_PAYLOAD=1` (sin esa variable, bytes=0 de
  // costo real: no se llega a serializar nada) — ver el helper medirPayloadSiHabilitado.
  const estFilas = medirPayloadSiHabilitado(filas);
  const estProgramas = medirPayloadSiHabilitado(programas);
  registrarDatoPagina(FLUJO, flujoId, "programas_resumen", `programas=${programas.length} ${textoEstimacionPayload(estProgramas)}`);

  // ⚠️ "preparacion_servidor" (revisión posterior, defecto "MEDICIÓN 'TOTAL'
  // INCORRECTA"): esta etapa termina ANTES del `return` de JSX — NO incluye
  // el procesamiento posterior del árbol React, la serialización RSC real
  // (formato Flight, no JSON), la transmisión al navegador, la hidratación
  // ni el pintado. Mide solo el trabajo de ESTE Server Component: sesión +
  // carga de datos + armar las props. Antes se llamaba "total", nombre que
  // sugería falsamente cubrir la respuesta completa — se renombra para no
  // afirmar algo que no mide.
  registrarDatoPagina(
    FLUJO, flujoId, "preparacion_servidor",
    `invocacion_proceso=${invocacion} filas_estimacion=${textoEstimacionPayload(estFilas)} programas_estimacion=${textoEstimacionPayload(estProgramas)}`
  );
  registrarEtapa(FLUJO, flujoId, "preparacion_servidor", _cronoPrep(), "ok");

  return (
    <div className="mx-auto max-w-[1700px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tarifario</h1>
          <p className="mt-1 text-sm text-gray-500">
            Resultado publicado de los paquetes (vista interna). Para generar contratos usa <b>Reservar</b>.
          </p>
        </div>
        <Link href="/dashboard/producto/destinos" className="text-sm text-[var(--brand-accent)] hover:underline">
          Gestionar destinos →
        </Link>
      </div>

      {!filas.length && !programas.length ? (
        <p className="py-20 text-center text-gray-400">
          Aún no hay tarifas publicadas. Arma un paquete y dale <b>Generar tarifario</b>.
        </p>
      ) : (
        <TarifarioPublic filas={filas} programas={programas} />
      )}
    </div>
  );
}
