import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { TarifarioPublic } from "@/app/tarifario/TarifarioPublic";
import { getProgramasResumen } from "@/lib/programas";
import { filtrarTarifarioVencidas } from "@/lib/tarifario/vigencia";
import { cargarFilasResumenPaginado, expandirResumenAFilas } from "@/lib/tarifario/resumen";
import { orquestarCargaInterna } from "@/lib/tarifario/orquestacion";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina, registrarErrorTecnico,
  siguienteInvocacionProceso, medirPayloadSiHabilitado, textoEstimacionPayload, iniciarCronometro,
} from "@/lib/observabilidad/medicion";

export const dynamic = "force-dynamic";

const FLUJO = "pagina_tarifario_interno";

// Carga en dos niveles (ver lib/tarifario/resumen.ts): esta vista solo
// necesita mostrar la tabla, no arma el enriquecimiento completo de Vista
// Booking (cupos, fotos, hoteles, capacidades, planes, ventana, "incluye")
// que sí necesita Reservar/público — reusar `cargarResumenTarifario()`
// (que SÍ arma ese enriquecimiento) aquí aumentaría consultas y payload sin
// necesidad, así que esta página sigue con su propio camino liviano: solo
// pide el resumen (`cargarFilasResumenPaginado`) y aplica la MISMA vigencia
// de siempre — sin el filtro de "salidas ya pasadas" ni el de "empaquetados
// vencidos" que sí aplican `/tarifario` y `/dashboard/reservar` (esta vista
// nunca los tuvo; no es una equivalencia rota, es la interfaz actual de esta
// página, que no se toca).

// Mensaje público FIJO — nunca "no hay tarifas" cuando en realidad falló la
// consulta (revisión posterior, defecto "PAGINACIÓN IGNORA ERRORES").
const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

// Diagnóstico del incidente de ~13s: la carga del tarifario (paginación +
// filtro de vigencia, compuestas como una sola tarea) y getProgramasResumen()
// no dependen una de la otra — arrancan CONCURRENTEMENTE vía
// orquestarCargaInterna() (lib/tarifario/orquestacion.ts, función PURA
// probada con promesas diferidas en pruebas/tarifarioOrquestacion.test.ts —
// la garantía de concurrencia real no depende de leer este archivo).
export default async function TarifarioInternoPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoPrep = iniciarCronometro();

  const sb = await createClient();

  const _cronoCarga = iniciarCronometro();
  const { tarifario: resTarifario, programas: resProgramas } = await orquestarCargaInterna({
    cargarTarifario: async () => {
      const _cronoPag = iniciarCronometro();
      const pag = await cargarFilasResumenPaginado(sb);
      if (!pag.ok) {
        registrarEtapa(FLUJO, flujoId, "resumen_inicial", _cronoPag(), "error");
        registrarErrorTecnico(FLUJO, flujoId, "resumen_inicial", "error_carga_tarifario_resumen", pag.error);
        return { ok: false as const };
      }
      registrarEtapa(FLUJO, flujoId, "resumen_inicial", _cronoPag(), "ok");
      registrarDatoPagina(FLUJO, flujoId, "resumen_inicial", `filas_resumen=${pag.filas.length} paginas=${pag.paginasConsultadas} consultas_iniciales=${pag.paginasConsultadas}`);

      // Oculta tarifas de hotel con vigencia de compra vencida (igual que el
      // público: lo vencido no aparece). El histórico se consulta en el
      // detalle del hotel. Best-effort: un error aquí NO aborta la página
      // completa (el resto del tarifario sigue mostrándose), pero
      // `filtrarTarifarioVencidas` FALLA CERRADO ante un error técnico — las
      // filas de hotel verificables (bloqueo/porción con fecha) se OCULTAN
      // por completo, nunca se dejan "sin el filtro" ni se publican sin
      // poder verificar su vigencia — y queda registrado como
      // resultado=error, nunca "ok".
      const _cronoVig = iniciarCronometro();
      let huboVigencia = false;
      let filasFiltradas = pag.filas;
      let huboErrorVigencia = false;
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const resVig = await filtrarTarifarioVencidas(createAdminClient(), pag.filas);
        filasFiltradas = resVig.filas;
        huboVigencia = true;
        if (resVig.error) {
          huboErrorVigencia = true;
          registrarErrorTecnico(FLUJO, flujoId, "filtro_vigencia", "error_hotel_temporadas_o_tarifa_hotel", resVig.error);
        }
      }
      registrarEtapa(FLUJO, flujoId, "filtro_vigencia", _cronoVig(), huboErrorVigencia ? "error" : "ok");
      registrarDatoPagina(FLUJO, flujoId, "filtro_vigencia", `filas=${filasFiltradas.length} consultas=${huboVigencia ? 2 : 0}`);
      return { ok: true as const, filas: expandirResumenAFilas(filasFiltradas) };
    },
    // Programas (interno: muestra activos aunque no estén publicados).
    cargarProgramas: () => getProgramasResumen(sb, false),
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
