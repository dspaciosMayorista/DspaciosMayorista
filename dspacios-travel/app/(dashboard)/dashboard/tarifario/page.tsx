import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { TarifarioPublic, type FilaTarifario } from "@/app/tarifario/TarifarioPublic";
import { getProgramasResumen } from "@/lib/programas";
import { filtrarTarifarioVencidas } from "@/lib/tarifario/vigencia";
import { cargarFilasTarifarioPaginado } from "@/lib/tarifario/paginacion";
import {
  generarFlujoId, registrarEtapa, registrarDatoPagina,
  siguienteInvocacionProceso, tamanoAproximadoBytes, iniciarCronometro,
} from "@/lib/observabilidad/medicion";

export const dynamic = "force-dynamic";

const FLUJO = "pagina_tarifario_interno";

// Columnas LIVIANAS — a propósito, más chicas que las de cargarDatosTarifario()
// (lib/tarifario/datos.ts): esta vista solo necesita mostrar la tabla, no
// arma el enriquecimiento completo de Vista Booking (cupos, fotos, hoteles,
// capacidades, planes, ventana, "incluye") que sí necesita Reservar/público.
// Reusar cargarDatosTarifario() aquí aumentaría consultas y payload sin
// necesidad — ver auditoría de duplicación en el PR.
const COLUMNAS_LIVIANAS =
  "modulo, bloqueo_label, bloqueo_id, paquete_id, hotel_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, fecha_ida, fecha_regreso, noches, destino_nombre, paquete_nombre, hotel_nombre, categoria, regimen, acomodacion, precio_pvp, moneda";

// Diagnóstico del incidente de ~13s: la carga del tarifario (paginación +
// filtro de vigencia) y getProgramasResumen() no dependen una de la otra —
// arrancan CONCURRENTEMENTE con Promise.all.
export default async function TarifarioInternoPage() {
  const flujoId = generarFlujoId();
  const invocacion = siguienteInvocacionProceso(FLUJO);
  const _cronoTotal = iniciarCronometro();

  const sb = await createClient();

  const _cronoCarga = iniciarCronometro();
  const [filas, programas] = await Promise.all([
    (async () => {
      const _cronoPag = iniciarCronometro();
      const { filas: filasPaginadas, paginasConsultadas } = await cargarFilasTarifarioPaginado<FilaTarifario>(sb, COLUMNAS_LIVIANAS);
      registrarEtapa(FLUJO, flujoId, "carga_paginada", _cronoPag(), "ok");
      registrarDatoPagina(FLUJO, flujoId, "carga_paginada", `filas=${filasPaginadas.length} paginas=${paginasConsultadas} consultas=${paginasConsultadas}`);

      // Oculta tarifas de hotel con vigencia de compra vencida (igual que el
      // público: lo vencido no aparece). El histórico se consulta en el
      // detalle del hotel.
      const _cronoVig = iniciarCronometro();
      let huboVigencia = false;
      let filasFiltradas = filasPaginadas;
      if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
        filasFiltradas = await filtrarTarifarioVencidas(createAdminClient(), filasPaginadas);
        huboVigencia = true;
      }
      registrarEtapa(FLUJO, flujoId, "filtro_vigencia", _cronoVig(), "ok");
      registrarDatoPagina(FLUJO, flujoId, "filtro_vigencia", `filas=${filasFiltradas.length} consultas=${huboVigencia ? 2 : 0}`);
      return filasFiltradas;
    })(),
    // Programas (interno: muestra activos aunque no estén publicados).
    getProgramasResumen(sb, false),
  ]);
  registrarEtapa(FLUJO, flujoId, "tarifario_y_programas", _cronoCarga(), "ok");
  registrarDatoPagina(
    FLUJO, flujoId, "programas_resumen",
    `programas=${programas.length} payload_bytes=${tamanoAproximadoBytes(programas)}`
  );
  registrarDatoPagina(
    FLUJO, flujoId, "total",
    `invocacion_proceso=${invocacion} payload_bytes=${tamanoAproximadoBytes(filas) + tamanoAproximadoBytes(programas)}`
  );
  registrarEtapa(FLUJO, flujoId, "total", _cronoTotal(), "ok");

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
