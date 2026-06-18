import {
  EMPRESA,
  CONTRATO_TITULO,
  CONTRATO_INTRO,
  CLAUSULAS,
  CONSTANCIA_PREFIJO,
  FIRMA_ETIQUETAS,
  COPYRIGHT_PREFIJO,
} from "@/lib/contrato/plantilla";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";

const PRIMARY = "#1D7C9A";

type ItemSnap = {
  descripcion: string;
  tarifa_adulto: number;
};

type VentaSnap = {
  numero_contrato?: string;
  cliente?: string;
  destino?: string;
  fecha_salida?: string;
  fecha_regreso?: string;
  pax?: number;
  precio_venta?: number;
  moneda?: string;
  asesor?: string;
  observaciones?: string;
};

type ClienteSnap = {
  tipoDoc?: string;
  numeroDoc?: string;
  telefono?: string;
  email?: string;
};

type Props = {
  codigo: string;
  venta: VentaSnap;
  items: ItemSnap[];
  cliente: ClienteSnap;
  vigenciaHasta?: string | null;
  fechaEmision?: string | null;
};

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-800">{value || "—"}</span>
    </div>
  );
}

export function CotizacionManualDocumento({ codigo, venta, items, cliente, vigenciaHasta, fechaEmision }: Props) {
  const moneda = venta.moneda ?? "COP";
  const total = items.reduce((s, it) => s + (it.tarifa_adulto ?? 0), 0);
  const anio = new Date().getFullYear();
  const hoy = fechaEmision ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="contrato-doc mx-auto max-w-3xl bg-white text-gray-800">
      {/* ── Encabezado ─────────────────────────────────────────── */}
      <header
        className="flex flex-col gap-3 rounded-t-xl px-5 py-5 text-white sm:flex-row sm:items-start sm:justify-between sm:gap-4 md:px-8 md:py-6"
        style={{ backgroundColor: PRIMARY }}
      >
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/marca/logo-white.png" alt="D'spacios Travel — Mayorista de Turismo" className="h-12 w-auto" />
        </div>
        <div className="text-center">
          <div className="text-base font-semibold">COTIZACIÓN</div>
          <div className="mt-1 text-xs opacity-90">
            {venta.numero_contrato
              ? `Contrato #: ${venta.numero_contrato}`
              : `Cotización #: ${codigo ?? "—"}`}
          </div>
          <div className="text-xs opacity-90">Emisión: {formatFechaLarga(hoy)}</div>
          {venta.fecha_salida && (
            <div className="text-xs opacity-90">Viaje: {formatFechaLarga(venta.fecha_salida)}</div>
          )}
          {vigenciaHasta && (
            <div className="text-xs opacity-90">Válida hasta: {formatFechaLarga(vigenciaHasta)}</div>
          )}
        </div>
        <div className="text-right text-xs opacity-90">
          <div>{EMPRESA.sitio}</div>
          <div>{EMPRESA.correo}</div>
          <div className="mt-1">RNT {EMPRESA.rnt}</div>
        </div>
      </header>

      {/* ── Estado ─────────────────────────────────────────────── */}
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-xs font-semibold text-amber-700 md:px-8">
        ⏳ COTIZACIÓN — sujeta a disponibilidad y confirmación. No constituye reserva en firme hasta su confirmación.
      </div>

      <div className="space-y-7 px-5 py-6 text-sm md:px-8 md:py-7">
        {/* ── Cliente ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>Cliente</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Pill label="Nombre" value={venta.cliente ?? ""} />
            <Pill label={cliente.tipoDoc ?? "Documento"} value={cliente.numeroDoc ?? ""} />
            <Pill label="Teléfono" value={cliente.telefono ?? ""} />
            <Pill label="Email" value={cliente.email ?? ""} />
          </div>
        </section>

        {/* ── Detalles del viaje ───────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>Detalles del viaje</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Pill label="Destino" value={venta.destino ?? ""} />
            <Pill label="Pasajeros" value={String(venta.pax ?? "")} />
            <Pill label="Ida" value={formatFechaLarga(venta.fecha_salida)} />
            <Pill label="Regreso" value={formatFechaLarga(venta.fecha_regreso)} />
          </div>
        </section>

        {/* ── Servicios ────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>Servicios cotizados</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="border border-gray-200 px-3 py-2">Descripción</th>
                  <th className="border border-gray-200 px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="border border-gray-200 px-3 py-2">{it.descripcion}</td>
                    <td className="border border-gray-200 px-3 py-2 text-right tabular-nums">
                      {formatMoneda(it.tarifa_adulto, moneda)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="border border-gray-200 px-3 py-2">Total</td>
                  <td className="border border-gray-200 px-3 py-2 text-right tabular-nums">
                    {formatMoneda(total, moneda)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {venta.observaciones && (
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span className="font-semibold">Observaciones: </span>{venta.observaciones}
            </div>
          )}
        </section>

        {/* ── Valores ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: PRIMARY }}>Valores</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <div className="rounded-lg p-3 text-white" style={{ backgroundColor: PRIMARY }}>
              <div className="text-[10px] uppercase opacity-80">Total cotización</div>
              <div className="text-base font-bold">{formatMoneda(total, moneda)}</div>
            </div>
            <Pill label="Moneda" value={moneda} />
            {venta.asesor && <Pill label="Asesor" value={venta.asesor} />}
          </div>
        </section>

        {/* ── Cláusulas ────────────────────────────────────────── */}
        <section className="break-before-page">
          <h2 className="mb-3 text-center text-sm font-bold uppercase tracking-wide text-gray-700">
            {CONTRATO_TITULO}
          </h2>
          <p className="mb-4 text-justify text-xs leading-relaxed text-gray-600">{CONTRATO_INTRO}</p>
          <div className="space-y-3">
            {CLAUSULAS.map((c) => (
              <div key={c.numero} className="break-inside-avoid">
                <h3 className="text-xs font-semibold text-gray-700">{c.numero}. {c.titulo}</h3>
                {c.parrafos.map((p, i) => (
                  <p key={i} className="mt-1 text-justify text-[11px] leading-relaxed text-gray-600">{p}</p>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ── Constancia + Firma ───────────────────────────────── */}
        <section className="break-inside-avoid pt-2 text-xs text-gray-600">
          <p>{CONSTANCIA_PREFIJO} {formatFechaLarga(hoy)}.</p>
          <div className="mt-8">
            <div className="w-64 border-t border-gray-400 pt-1">
              <div className="font-semibold text-gray-800">{venta.asesor ?? "—"}</div>
              <div>{FIRMA_ETIQUETAS.cargo} Asesor/a</div>
            </div>
          </div>

          <div className="mt-6 rounded-lg bg-gray-50 p-3 text-[11px]">
            <div className="font-semibold text-gray-700">Datos de pago</div>
            <div>{EMPRESA.cuentaBancaria.banco} — {EMPRESA.cuentaBancaria.tipo} {EMPRESA.cuentaBancaria.numero}</div>
            <div>A nombre de {EMPRESA.cuentaBancaria.titular}</div>
            <div className="mt-1">{EMPRESA.razonSocial} · NIT {EMPRESA.nit} · RNT {EMPRESA.rnt}</div>
          </div>

          <p className="mt-6 text-center text-[10px] text-gray-400">
            {COPYRIGHT_PREFIJO} {anio} · Documento digital — se solicita no imprimir.
          </p>
        </section>
      </div>
    </div>
  );
}
