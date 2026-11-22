import type { ReactNode } from "react";
import { formatMonedaDocumento, formatFechaLarga } from "@/lib/utils";
import { pesosEnLetras } from "@/lib/utils/numeroALetras";
import { POWERED_BY } from "@/lib/contrato/plantilla";
import { fechaNegocio } from "@/lib/fechaNegocio";
import type { SnapshotCuenta } from "@/lib/cuentaCobro/snapshot";

/** Aceptación electrónica de ESTA versión. `imagen` = data URI de la firma (null = no disponible: se dice, no se oculta). */
export type FirmaAceptada = { version: number; aceptadaEn: string; imagen: string | null };

/**
 * Documento «Cuenta de cobro» dibujado SOLO desde un snapshot (#98): lo que se ve es lo que se congeló, nunca una relectura en vivo de una versión aceptada.
 * Con `firma`, la imagen va ARRIBA del nombre del aliado y el texto aclara el alcance: una aceptación electrónica de esta versión.
 */
export function CuentaCobroDocumento({ snap, firma, acciones }: { snap: SnapshotCuenta; firma: FirmaAceptada | null; acciones?: ReactNode }) {
  const { detalle, aliado, compania, moneda } = snap;
  const montoComision = detalle.totalPagar;
  return (
    <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
      <div className="cuenta-doc rounded-xl bg-white p-6 shadow-sm print:rounded-none print:p-0 print:shadow-none" data-version={firma ? firma.version : "sin-aceptar"}>
        <h1 className="text-center text-xl font-bold" style={{ color: "var(--brand-primary)" }}>CUENTA DE COBRO</h1>
        <p className="mt-0.5 text-center text-xs text-gray-500">Fecha de elaboración: {formatFechaLarga(snap.elaboracion)}</p>

        <div className="mt-3 grid grid-cols-2 gap-4 border-y border-gray-100 py-3 text-xs text-gray-700">
          <div>
            <p className="text-gray-400">DE (quien cobra)</p>
            <p className="text-sm font-semibold text-gray-900">{aliado.nombre}</p>
            {aliado.nit && <p>{aliado.tipoDocumento ?? "NIT"}: {aliado.nit}</p>}
            {aliado.direccion && <p>{aliado.direccion}</p>}
            {aliado.telefono && <p>Tel: {aliado.telefono}</p>}
            {aliado.email && <p>{aliado.email}</p>}
          </div>
          <div>
            <p className="text-gray-400">COMPAÑÍA</p>
            <p className="text-sm font-semibold text-gray-900">{compania.nombre}</p>
            {compania.nit && <p>NIT: {compania.nit}</p>}
            {compania.direccion && <p>{compania.direccion}</p>}
          </div>
        </div>

        <div className="mt-3 text-center">
          <p className="text-xs text-gray-500">DEBE LA SUMA DE</p>
          <p className="text-xl font-bold" style={{ color: "var(--brand-primary)" }}>{formatMonedaDocumento(montoComision, moneda)}</p>
          <p className="text-xs text-gray-500">({pesosEnLetras(montoComision, moneda === "USD" ? "USD" : "COP", true)})</p>
        </div>

        <div className="mt-3 text-xs text-gray-700">
          <p className="text-gray-400">POR CONCEPTO DE</p>
          <p className="font-medium">{snap.concepto}</p>
        </div>

        <table className="mt-3 w-full border-collapse text-xs">
          <tbody>
            <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Fecha de viaje</td><td className="py-1 text-right">{formatFechaLarga(snap.fechaSalida)}</td></tr>
            <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Total PVP</td><td className="py-1 text-right tabular-nums">{formatMonedaDocumento(detalle.pvp, moneda)}</td></tr>
            {detalle.baseComisionable != null && (
              <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Base comisionable</td><td className="py-1 text-right tabular-nums">{formatMonedaDocumento(detalle.baseComisionable, moneda)}</td></tr>
            )}
            <tr className="border-b border-gray-100">
              <td className="py-1 text-gray-500">{detalle.esPctPactado ? "% comisión (pactado)" : detalle.esPctEfectivo ? "% comisión (efectivo)" : "% comisión"}</td>
              <td className="py-1 text-right tabular-nums">{(detalle.pctComision * 100).toFixed(2)}%</td>
            </tr>
            {detalle.comisionBase != null && (
              <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Comisión</td><td className="py-1 text-right tabular-nums">{formatMonedaDocumento(detalle.comisionBase, moneda)}</td></tr>
            )}
            {detalle.recobroAliado != null && detalle.recobroAliado > 0 && (
              <tr className="border-b border-gray-100"><td className="py-1 text-gray-500">Recobro</td><td className="py-1 text-right tabular-nums">{formatMonedaDocumento(detalle.recobroAliado, moneda)}</td></tr>
            )}
            {detalle.aplicaRetencion && detalle.retencion != null && detalle.retencion > 0 && (
              <tr className="border-b border-gray-100">
                <td className="py-1 text-gray-500">Retención en la fuente ({((detalle.pctRetencion ?? 0) * 100).toFixed(1)}%)</td>
                <td className="py-1 text-right tabular-nums text-red-600">− {formatMonedaDocumento(detalle.retencion, moneda)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-2 flex items-center justify-between rounded-lg bg-[rgba(18,5,115,0.06)] px-3 py-2">
          <span className="text-xs font-semibold text-gray-700">Total a cobrar</span>
          <span className="text-base font-bold" style={{ color: "var(--brand-primary)" }}>{formatMonedaDocumento(montoComision, moneda)}</span>
        </div>

        {detalle.aplicaRetencion === false && (
          <div className="mt-3 text-[10px] leading-snug text-gray-500">
            <p>
              Para efectos de lo establecido en el parágrafo 2 del Artículo 383 del E.T., modificado por el
              Artículo 17 de la Ley 1819 de 2016, manifiesto que:
            </p>
            <ol className="ml-4 list-decimal">
              <li>No he contratado o vinculado dos (2) personas o más trabajadores asociados a la actividad que desarrollo.</li>
              <li>En el año gravable anterior mis ingresos o ventas no superaron las 3.300 UVT.</li>
              <li>No soy declarante de renta.</li>
            </ol>
            <p className="mt-1 text-center font-semibold text-gray-600">NO HACER RETENCIÓN EN LA FUENTE</p>
          </div>
        )}

        {aliado.numeroCuenta && (
          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[10px] leading-snug text-gray-600">
            <p className="font-semibold text-gray-700">Forma de pago: Transferencia bancaria</p>
            <p>
              {aliado.banco ?? "—"} — {aliado.tipoCuenta ?? "—"} · A nombre de {aliado.titularCuenta ?? aliado.nombre} · N.° {aliado.numeroCuenta}
            </p>
          </div>
        )}

        <div className="mt-6 text-xs text-gray-600" data-firma={firma ? "aceptada" : "pendiente"}>
          {firma?.imagen && (
            // eslint-disable-next-line @next/next/no-img-element -- data URI de la imagen de firma (bucket privado): no hay URL que optimizar
            <img src={firma.imagen} alt={`Firma de ${aliado.nombre}`} className="mb-1 block max-h-16 max-w-[220px] object-contain" />
          )}
          <div className="border-t border-gray-300 pt-1" style={{ width: 220 }}>Firma</div>
          <p className="mt-0.5">{aliado.nombre}</p>
          {aliado.nit && <p className="text-[10px] text-gray-400">{aliado.tipoDocumento ?? "NIT"} {aliado.nit}</p>}
          {firma ? (
            <div className="mt-2 text-[10px] leading-snug text-gray-500">
              <p className="font-semibold text-gray-700">Aceptación electrónica — versión {firma.version}, {formatFechaLarga(fechaNegocio(new Date(firma.aceptadaEn)))}</p>
              {!firma.imagen && <p>La imagen de la firma no está disponible en este momento; la aceptación sí quedó registrada.</p>}
              <p>El aliado aceptó electrónicamente esta versión del documento con su imagen de firma. No es una firma digital certificada.</p>
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-gray-400">Versión sin aceptar.</p>
          )}
        </div>

        <footer className="mt-4 border-t border-gray-200 pt-2 text-center text-[9px] text-gray-400">
          Documento generado por el Portal B2B de D&apos;spacios Travel.
          <span className="mt-0.5 block text-[8px] text-gray-300">{POWERED_BY}</span>
        </footer>
      </div>
      {acciones}
      <style dangerouslySetInnerHTML={{ __html: `
        .cuenta-doc, .cuenta-doc * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { size: letter; margin: 12mm; }
        @media print { html, body { background: #fff !important; } }
      ` }} />
    </div>
  );
}
