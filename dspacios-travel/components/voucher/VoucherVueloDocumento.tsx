import { formatFechaLarga } from "@/lib/utils";
import { COLOR_DOCUMENTO } from "@/lib/contrato/colorDocumento";
import { Logo } from "@/components/Logo";
import { POWERED_BY } from "@/lib/contrato/plantilla";
import { NO_REGISTRADO, NOTA_PASAJEROS_TRAMOS, avisoVariosServiciosAereos, type VoucherVueloContenido } from "@/lib/voucher/vuelo";

const PRIMARY = COLOR_DOCUMENTO;

function Celda({ label, value }: { label: string; value: string }) {
  const falta = value === NO_REGISTRADO;
  return (
    <div className="border border-white/40">
      <div className="px-2 py-1 text-center text-[10px] font-bold uppercase text-white" style={{ backgroundColor: PRIMARY }}>{label}</div>
      <div className={`px-2 py-1.5 text-center text-xs ${falta ? "italic text-gray-400" : "text-gray-800"}`}>{value || "—"}</div>
    </div>
  );
}

// Voucher de servicio aéreo: solo datos guardados; lo ausente sale como «No registrado». ADL-041/042: muestra el PNR GUARDADO de cada tramo solo si llega en el tramo (la página lo quita mientras el contrato no esté 100 % pagado);
// sin PNR guardado el voucher es igual de válido (no se rotula «No registrado»: la ausencia no es un dato faltante del documento).
// `pnrPendientePago` es un aviso INTERNO (no se imprime): hay PNR guardado pero aún no se muestra.
// Rev2 B1-05/06: la limitación «no hay pasajero↔tramo» se dice a TODO visitante (interno o aliado) y se imprime. `serviciosAereos` = servicios aéreos vigentes del contrato (null = no leído): con más de uno se agrega un aviso visible.
export function VoucherVueloDocumento({ c, tenant, pnrPendientePago = false, serviciosAereos = null }: { c: VoucherVueloContenido; tenant?: "mayorista" | "minorista"; pnrPendientePago?: boolean; serviciosAereos?: number | null }) {
  return (
    <div className="voucher-doc mx-auto max-w-3xl bg-white text-gray-800" data-testid="voucher-vuelo">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <Logo variant="full" height={56} className="h-14 w-auto" tenant={tenant} />
        <div className="text-right">
          <div className="inline-block px-3 py-0.5 text-[10px] font-bold uppercase text-white" style={{ backgroundColor: PRIMARY }}>Fecha de emisión</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: PRIMARY }}>{formatFechaLarga(c.emision)}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-2 px-5 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-2">
          <Celda label="Contacto" value={c.contactoEmpresa} />
          <Celda label="Elaborado por" value={c.elaboradoPor} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Celda label="N° Reserva" value={c.nReserva} />
          <Celda label="Vendedor" value={c.vendedor} />
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="px-3 py-1 text-center text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: PRIMARY }}>Servicio aéreo</div>

        <div className="mt-2 grid grid-cols-1 gap-px">
          <Celda label="Nombre titular" value={c.titular} />
        </div>
        {pnrPendientePago && (
          <p className="mt-2 text-xs text-amber-700 print:hidden" data-testid="pnr-pendiente-pago">Hay un PNR guardado en este servicio; se mostrará en el voucher cuando el contrato esté 100 % pagado. Esta nota no se imprime.</p>
        )}

        <div className="mt-3 space-y-3">
          {c.tramos.map((t, i) => (
            <div key={i} className="break-inside-avoid rounded-lg border border-gray-200 p-3" data-testid="tramo-voucher-vuelo">
              <div className="mb-2 text-xs font-bold uppercase" style={{ color: PRIMARY }}>{t.tipo}</div>
              <div className="grid grid-cols-2 gap-px sm:grid-cols-4">
                <Celda label="Aerolínea" value={t.aerolinea} />
                <Celda label="Vuelo" value={t.numeroVuelo} />
                <Celda label="Fecha" value={t.fecha === NO_REGISTRADO ? t.fecha : formatFechaLarga(t.fecha)} />
                <Celda label="Equipaje / servicios" value={t.equipaje} />
                <Celda label="Origen" value={t.origen} />
                <Celda label="Destino" value={t.destino} />
                <Celda label="Hora de salida" value={t.horaSalida} />
                <Celda label="Hora de llegada" value={t.horaLlegada} />
              </div>
              {t.pnr && <div className="mt-px" data-testid="pnr-voucher-vuelo"><Celda label="PNR / Código de reserva" value={t.pnr} /></div>}
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-gray-200 p-3">
          <div className="mb-1 text-xs font-bold uppercase" style={{ color: PRIMARY }}>Pasajeros de la reserva</div>
          {c.pasajeros.length ? (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-gray-700">{c.pasajeros.map((n, i) => <li key={i}>{n}</li>)}</ul>
          ) : (
            <p className="text-xs italic text-gray-400">{NO_REGISTRADO}</p>
          )}
          {serviciosAereos != null && serviciosAereos > 1 && (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900" data-testid="aviso-varios-servicios">{avisoVariosServiciosAereos(serviciosAereos)}</p>
          )}
          <p className="mt-2 text-xs text-gray-600" data-testid="nota-pasajeros-tramos">{NOTA_PASAJEROS_TRAMOS}</p>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-gray-600">
          Itinerarios de vuelos sujetos a cambio sin previo aviso. Recuerde confirmarlos un día antes de su fecha y hora de viaje. Presente este documento y su
          documento de identidad vigente. Todo menor de edad debe viajar con los permisos exigidos por las autoridades.
        </p>
        <p className="mt-4 text-center text-[9px] text-gray-300">{POWERED_BY}</p>
      </div>
    </div>
  );
}
