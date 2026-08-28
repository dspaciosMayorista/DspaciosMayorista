import { createClient } from "@/lib/supabase/server";
import { TarifarioPublic } from "@/app/tarifario/TarifarioPublic";
import { CartDrawer } from "@/app/tarifario/CartDrawer";
import { CartProvider } from "@/lib/cart/CartContext";
import { getProgramasResumen } from "@/lib/programas";
import { cargarDatosTarifario } from "@/lib/tarifario/datos";
import { orquestarCargaReservar } from "@/lib/tarifario/orquestacion";
import { compactarFilasTarifario } from "@/lib/tarifario/compacto";
import { liberarVencidas } from "./actions";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina, registrarErrorTecnico,
  siguienteInvocacionProceso, medirPayloadSiHabilitado, textoEstimacionPayload, iniciarCronometro,
} from "@/lib/observabilidad/medicion";

export const dynamic = "force-dynamic";

const FLUJO = "pagina_reservar";

// Mensaje público FIJO — nunca "no hay tarifas" cuando en realidad falló la
// consulta (revisión posterior, defecto "PAGINACIÓN IGNORA ERRORES").
const MSG_ERROR_CARGAR_TARIFARIO = "No fue posible cargar el tarifario en este momento. Intenta nuevamente en unos segundos.";

// Diagnóstico del incidente de ~13s en /dashboard/reservar, /dashboard/
// tarifario y /tarifario (las tres comparten las mismas fuentes pesadas,
// aunque no el mismo código): cada request genera su propio `flujoId` y deja
// en los logs, con el mismo formato ya usado por crearContrato()/
// reservarPrograma() (lib/observabilidad/medicion.ts), el tiempo de:
//  - `liberar_vencidas` — SECUENCIAL antes de lo demás a propósito: libera
//    sillas vencidas (cambia `sillas`), y `cargarDatosTarifario()` lee cupos
//    calculados a partir de esas mismas sillas — paralelizarlo arriesgaría
//    leer cupos ANTES de liberar, mostrando menos disponibilidad de la real.
//    La secuencia real (nunca se invoca cargarTarifario/cargarProgramas
//    hasta que liberarVencidas TERMINÓ) la garantiza
//    `orquestarCargaReservar()` (lib/tarifario/orquestacion.ts, función
//    PURA probada con promesas diferidas en
//    pruebas/tarifarioOrquestacion.test.ts) — no un comentario ni el orden
//    visual del código.
//  - `tarifario_y_programas` — cargarDatosTarifario() y getProgramasResumen()
//    NO dependen una de la otra (ninguna lee lo que la otra escribe ni usa su
//    resultado), así que arrancan CONCURRENTEMENTE (mismo orquestador). Sus
//    propias etapas internas (carga_paginada/filtro_vigencia/datos_
//    auxiliares para la primera) se miden aparte dentro de
//    `cargarDatosTarifario()`.
//  - `preparacion_servidor` — el Server Component hasta el `return` del JSX.
//    NO incluye serialización RSC real, transmisión, hidratación ni pintado
//    del navegador (revisión posterior, defecto "MEDICIÓN 'TOTAL'
//    INCORRECTA" — antes se llamaba "total", nombre que sugería falsamente
//    cubrir la respuesta completa).
export default async function ReservarPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoPrep = iniciarCronometro();

  const sb = await createClient();

  // ⚠️ Ningún cierre de abajo reasigna una variable externa (regla
  // `react-hooks/immutability` del linter de React Compiler — trata este
  // Server Component como si fuera a re-renderizar, y prohíbe mutar
  // variables capturadas por un cierre incluso aunque en la práctica un
  // Server Component solo corre una vez por request). Cada cierre es puro:
  // recibe lo que necesita por clausura de solo-lectura (`sb`, `FLUJO`,
  // `flujoId`) y DEVUELVE todo lo que el cuerpo de la función necesita
  // después, incluida su propia duración — nunca escribe a una `let` de
  // afuera. `msTotal - msLiberar` reconstruye la duración del tramo
  // concurrente (cargarTarifario/cargarProgramas) sin necesitar un
  // cronómetro que arranque DENTRO de un cierre y se lea DESDE afuera.
  const _cronoTotal = iniciarCronometro();
  const { liberado, datos: resDatos, programas: resProgramas } = await orquestarCargaReservar({
    liberarVencidas: async () => {
      // Liberar reservas vencidas (perezoso) al entrar — medido aparte, ver nota arriba.
      const _cronoLiberar = iniciarCronometro();
      const r = await liberarVencidas().catch(() => ({ ok: false, liberadas: 0 }));
      const ms = _cronoLiberar();
      registrarEtapa(FLUJO, flujoId, "liberar_vencidas", ms, r.ok ? "ok" : "error");
      registrarDatoPagina(FLUJO, flujoId, "liberar_vencidas", `liberadas=${r.liberadas}`);
      return { ...r, ms };
    },
    cargarTarifario: () => cargarDatosTarifario(sb, FLUJO, flujoId),
    // interno: activos aunque no publicados (igual que /dashboard/tarifario)
    cargarProgramas: () => getProgramasResumen(sb, false),
  });
  registrarEtapa(
    FLUJO, flujoId, "tarifario_y_programas",
    Math.max(0, _cronoTotal() - liberado.ms),
    resDatos.ok && !resProgramas.error ? "ok" : "error"
  );

  if (!resDatos.ok) {
    // Nunca "no hay tarifas publicadas" cuando en realidad la consulta
    // falló — eso afirmaría algo falso. El detalle técnico ya quedó
    // saneado en el log dentro de cargarDatosTarifario() (registrarErrorTecnico).
    return (
      <CartProvider>
        <div className="mx-auto max-w-6xl p-4 md:p-8">
          <h1 className="mb-1 text-2xl font-semibold text-gray-900">Reservar</h1>
          <p className="py-20 text-center text-red-500">{MSG_ERROR_CARGAR_TARIFARIO}</p>
        </div>
      </CartProvider>
    );
  }
  const {
    filasVisibles, filasAddon, cuposPorBloqueo, origenPorBloqueo, fotosPorHotel, fotosPorServicio,
    infoPorHotel, capPorHotel, planesInfo, ventanaPorPaquete, incluidosPorPaquete,
  } = resDatos.datos;
  if (resProgramas.error) {
    registrarErrorTecnico(FLUJO, flujoId, "programas_resumen", "error_getProgramasResumen", resProgramas.error);
  }
  const programas = resProgramas.programas;

  // Costo de la propia instrumentación (revisión posterior, defecto "COSTO
  // DE LA PROPIA INSTRUMENTACIÓN"): cada valor se estima UNA sola vez y se
  // reutiliza — la estimación en sí queda detrás de
  // `DIAGNOSTICO_MEDIR_PAYLOAD=1` (ver el helper medirPayloadSiHabilitado).
  const estDatos = medirPayloadSiHabilitado(resDatos.datos);
  const estProgramas = medirPayloadSiHabilitado(programas);
  registrarDatoPagina(FLUJO, flujoId, "programas_resumen", `programas=${programas.length} ${textoEstimacionPayload(estProgramas)}`);
  registrarDatoPagina(
    FLUJO, flujoId, "preparacion_servidor",
    `invocacion_proceso=${invocacion} datos_estimacion=${textoEstimacionPayload(estDatos)} programas_estimacion=${textoEstimacionPayload(estProgramas)}`
  );
  registrarEtapa(FLUJO, flujoId, "preparacion_servidor", _cronoPrep(), "ok");

  return (
    <CartProvider>
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="mb-1 text-2xl font-semibold text-gray-900">Reservar</h1>
            <p className="text-sm text-gray-500">
              Tarifario comercial. Arma tu selección (hoteles y servicios) en el carrito y finaliza para generar la cotización.
            </p>
          </div>
          <CartDrawer checkoutHabilitado fotosPorHotel={fotosPorHotel} />
        </div>
        {!filasVisibles.length && !programas.length ? (
          <p className="py-20 text-center text-gray-400">No hay tarifas publicadas. Genera el tarifario en un paquete.</p>
        ) : (
          <TarifarioPublic
            filas={compactarFilasTarifario(filasVisibles)}
            programas={programas}
            puedeReservar
            cuposPorBloqueo={cuposPorBloqueo}
            origenPorBloqueo={origenPorBloqueo}
            fotosPorHotel={fotosPorHotel}
            fotosPorServicio={fotosPorServicio}
            infoPorHotel={infoPorHotel}
            planesInfo={planesInfo}
            capPorHotel={capPorHotel}
            ventanaPorPaquete={ventanaPorPaquete}
            incluidosPorPaquete={incluidosPorPaquete}
            filasAddon={filasAddon}
          />
        )}
      </div>
    </CartProvider>
  );
}

