import { formatFechaLarga } from "@/lib/utils";
import type { VoucherContenido } from "@/app/(dashboard)/dashboard/contratos/[numero]/voucher-actions";

const PRIMARY = "#1D7C9A";
const ACCENT = "#26BBD9";
const LIMA = "#AEF44A";

const CLAUSULAS = [
  "Revisar que sus datos estén correctos.",
  "Los planes no son reembolsables, endosables o revisables.",
  "Viaje seguro, no olvide solicitar su asistencia médica.",
  "Es obligación del pasajero tener los documentos vigentes (Pasaporte con vigencia mínima de 6 meses a la fecha de viaje), Visa al día y vacunas según políticas del destino a visitar.",
  "Menores de edad requieren permiso de salida y registro civil autenticado que demuestre parentesco.",
  "Es obligatorio presentar este documento impreso para la prestación de los servicios.",
];

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-1 text-center text-xs font-bold uppercase tracking-wide text-white" style={{ backgroundColor: LIMA, color: "#1f3d10" }}>
      {children}
    </div>
  );
}

function Celda({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/40">
      <div className="px-2 py-1 text-center text-[10px] font-bold uppercase text-white" style={{ backgroundColor: ACCENT }}>{label}</div>
      <div className="px-2 py-1.5 text-center text-xs text-gray-800">{value || "—"}</div>
    </div>
  );
}

export function VoucherDocumento({ c }: { c: VoucherContenido }) {
  return (
    <div className="voucher-doc mx-auto max-w-3xl bg-white text-gray-800">
      {/* Encabezado: logo + fecha de emisión */}
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/marca/logo-full.png" alt="D'spacios Travel" className="h-14 w-auto" />
        <div className="text-right">
          <div className="inline-block px-3 py-0.5 text-[10px] font-bold uppercase text-white" style={{ backgroundColor: LIMA, color: "#1f3d10" }}>Fecha de emisión</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: PRIMARY }}>{formatFechaLarga(c.emision)}</div>
        </div>
      </header>

      {/* Contacto / reserva / vendedor */}
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
        <Banner>Información del tour operador · {c.proveedor}</Banner>

        {/* Tabla principal */}
        <div className="mt-2 grid grid-cols-2 gap-px sm:grid-cols-6">
          <Celda label="Hotel" value={c.hotel} />
          <Celda label="Destino" value={c.destino} />
          <Celda label="Fecha ingreso" value={c.fechaIngreso} />
          <Celda label="Tipo de pax" value={c.tipoPax} />
          <Celda label="Noches" value={c.noches} />
          <Celda label="Tipo de plan" value={c.tipoPlan} />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-px sm:grid-cols-5">
          <div className="sm:col-span-2"><Celda label="Nombre titular" value={c.titular} /></div>
          <Celda label="Adultos" value={c.adultos} />
          <Celda label="Niños / Infantes" value={c.ninos} />
          <Celda label="Check-in" value={c.checkIn} />
        </div>
        <div className="mt-2 w-40"><Celda label="Check-out" value={c.checkOut} /></div>

        {/* Incluye / información importante */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1 text-xs font-bold uppercase" style={{ color: PRIMARY }}>Incluye</div>
            <ul className="list-disc space-y-1 pl-4 text-xs text-gray-700">
              {c.incluye.length ? c.incluye.map((i, n) => <li key={n}>{i}</li>) : <li>—</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="mb-1 text-xs font-bold uppercase" style={{ color: PRIMARY }}>Información importante</div>
            <p className="whitespace-pre-wrap text-xs text-gray-700">{c.infoImportante || "—"}</p>
          </div>
        </div>

        <div className="mt-3">
          <Banner>No incluye: {c.noIncluye}</Banner>
        </div>

        {/* Información general */}
        <div className="mt-4">
          <div className="px-3 py-1 text-center text-xs font-bold uppercase text-white" style={{ backgroundColor: ACCENT }}>Información general</div>
          <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-gray-700">
            {CLAUSULAS.map((cl, n) => <li key={n}>Ø {cl}</li>)}
          </ul>
        </div>

        <p className="mt-4 text-center text-[10px] leading-relaxed text-gray-500">
          D&apos;SPACIOS TRAVEL rechaza la explotación, la pornografía, el turismo sexual y demás formas de abuso contra
          menores y contribuye al cumplimiento de la ley 679 de 2001. D&apos;SPACIOS TRAVEL está sujeta al régimen de
          responsabilidad que establece la ley 300/96 y D.R. 1075/97.
        </p>
        <p className="mt-2 text-center text-[11px] font-semibold" style={{ color: PRIMARY }}>
          En caso de necesitar asistencia médica, comuníquese en el momento de la calamidad al número registrado en su voucher.
        </p>
      </div>
    </div>
  );
}
