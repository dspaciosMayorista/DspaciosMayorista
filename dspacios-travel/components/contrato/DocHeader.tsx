import { Logo } from "@/components/Logo";
import { EMPRESA } from "@/lib/contrato/plantilla";
import { agenciaDe } from "@/lib/tenant.server";
import { identidadAgencia } from "@/lib/agencia/identidadAgencia";
import type { Tenant } from "@/lib/tenant";

// Encabezado de marca para documentos imprimibles (recibo, estado de cuenta).
// Muestra la identidad de la AGENCIA del documento (por tenant), solo de la tabla
// `agencias` (#49): sin fila o sin razón social/NIT/RNT lanza error; no hay respaldo
// en `EMPRESA` (es la identidad de Minorista).
export async function DocHeader({ tenant }: { tenant?: string }) {
  const t = ((tenant as Tenant) ?? "mayorista");
  const ag = await agenciaDe(t).catch(() => null);
  const id = identidadAgencia(ag, t);
  const razonSocial = id.razonSocial;
  const nit = ag?.dv ? `${id.nit}-${ag.dv}` : id.nit;
  const rnt = id.rnt;
  const correo = id.correo;
  const ciudad = ag?.ciudad ?? "";

  return (
    <div className="flex items-start justify-between border-b border-gray-200 pb-4">
      <div>
        <Logo variant="full" height={40} className="h-9 w-auto" tenant={(tenant as Tenant) === "minorista" ? "minorista" : "mayorista"} />
        <p className="mt-2 text-[11px] leading-tight text-gray-500">
          {razonSocial}
          <br />
          NIT {nit} · RNT {rnt}
          {correo && <><br />{correo}</>}
        </p>
      </div>
      <div className="text-right text-[11px] leading-tight text-gray-500">
        {ciudad && <p>{ciudad}</p>}
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
