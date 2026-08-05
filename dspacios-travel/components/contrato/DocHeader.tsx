import { Logo } from "@/components/Logo";
import { EMPRESA } from "@/lib/contrato/plantilla";
import { agenciaDe } from "@/lib/tenant.server";
import type { Tenant } from "@/lib/tenant";

// Encabezado de marca para documentos imprimibles (recibo, estado de cuenta).
// Muestra la identidad de la AGENCIA del documento (por tenant); si no hay datos
// en la tabla `agencias`, cae a la constante EMPRESA.
export async function DocHeader({ tenant }: { tenant?: string }) {
  const ag = await agenciaDe((tenant as Tenant) ?? "mayorista").catch(() => null);
  const razonSocial = ag?.razon_social ?? EMPRESA.razonSocial;
  const nit = ag?.nit ? `${ag.nit}${ag.dv ? `-${ag.dv}` : ""}` : EMPRESA.nit;
  const rnt = ag?.rnt || EMPRESA.rnt;
  const correo = ag?.correo ?? EMPRESA.correo;
  const ciudad = ag?.ciudad ?? EMPRESA.ciudadEmision;

  return (
    <div className="flex items-start justify-between border-b border-gray-200 pb-4">
      <div>
        <Logo variant="full" height={40} className="h-9 w-auto" tenant={(tenant as Tenant) === "minorista" ? "minorista" : "mayorista"} />
        <p className="mt-2 text-[11px] leading-tight text-gray-500">
          {razonSocial}
          <br />
          NIT {nit}{rnt ? ` · RNT ${rnt}` : ""}
          <br />
          {correo}
        </p>
      </div>
      <div className="text-right text-[11px] leading-tight text-gray-500">
        <p>{ciudad}</p>
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
