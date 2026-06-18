import { Logo } from "@/components/Logo";
import { EMPRESA } from "@/lib/contrato/plantilla";

// Encabezado de marca reutilizable para documentos imprimibles (recibo de caja,
// estado de cuenta). Mantiene el look del resto de documentos.
export function DocHeader() {
  return (
    <div className="flex items-start justify-between border-b border-gray-200 pb-4">
      <div>
        <Logo variant="full" height={40} className="h-9 w-auto" />
        <p className="mt-2 text-[11px] leading-tight text-gray-500">
          {EMPRESA.razonSocial}
          <br />
          NIT {EMPRESA.nit} · RNT {EMPRESA.rnt}
          <br />
          {EMPRESA.correo}
        </p>
      </div>
      <div className="text-right text-[11px] leading-tight text-gray-500">
        <p>{EMPRESA.ciudadEmision}</p>
        <p>{EMPRESA.sitio}</p>
      </div>
    </div>
  );
}

// Estilos de impresión compartidos (colores exactos + A4).
export const PRINT_DOC_STYLE = `
  .doc-print, .doc-print * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  @page { size: A4; margin: 14mm; }
  @media print { html, body { background: #fff !important; } .print\\:hidden { display: none !important; } }
`;
