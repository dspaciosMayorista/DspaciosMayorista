import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ContratoDocumento } from "@/components/contrato/ContratoDocumento";
import { PrintButton } from "@/components/contrato/PrintButton";
import { adjuntarNotaRegimen } from "@/lib/contrato/regimenNotas";
import { agenciaDe } from "@/lib/tenant.server";
import type { Tenant } from "@/lib/tenant";
import { tituloDocumento } from "@/lib/utils/tituloDocumento";
import { Eye } from "lucide-react";

// ¿Quien mira puede ver el contrato COMPLETO, o solo la parte comercial?
// Un asesor consultando el contrato de un colega de su agencia recibe el
// documento incompleto por RLS: sin pasajeros (migración 142), sin dirección
// del cliente ni cédula del firmante (147/148) y con el documento del titular
// enmascarado. Eso no es un contrato: es una vista comercial, y hay que decirlo.
//
// La propiedad se resuelve con la MISMA función que usan las policies, igual
// que en la ficha del contrato — nunca por `share_token` ni comparando nombres.
async function resolverAlcance(sb: Awaited<ReturnType<typeof createClient>>, numero: string) {
  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const rolCompleto = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");
  if (rolCompleto) return { completo: true };
  const { data: esAsesor } = await sb.rpc("soy_asesor_del_contrato", { num: numero });
  return { completo: esAsesor === true };
}

// El título usa el cliente SIEMPRE por el cliente con sesión (RLS), nunca por
// service-role: el número de contrato es secuencial y adivinable (00-0481), así
// que con service-role cualquiera podía sacar el nombre del cliente de un
// contrato ajeno leyendo el <title>, aunque el cuerpo de la página sí quedara
// bloqueado. Sin permiso de lectura, el título cae al genérico.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();
  const [{ data }, alcance] = await Promise.all([
    sb.from("ventas_basica").select("cliente").eq("numero_contrato", numero).maybeSingle(),
    resolverAlcance(sb, numero),
  ]);
  // El nombre del archivo descargado también tiene que decir la verdad: si es
  // la versión limitada, no se llama "Contrato".
  return { title: { absolute: tituloDocumento(alcance.completo ? "Contrato" : "Vista comercial", numero, data?.cliente) } };
}

export default async function ContratoImprimiblePage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();
  const { completo } = await resolverAlcance(sb, numero);

  const [
    { data: venta },
    { data: pasajeros },
    { data: hoteles },
    { data: vuelos },
    { data: items },
    { data: abonos },
    { data: planes },
  ] = await Promise.all([
    // Las dos vistas, no las tablas base: desde la migración 144 el rol
    // `venta` no lee `ventas`, y desde la 148 tampoco `contrato_vuelos`.
    // Consultarlas directamente dejaba esta página en 404 para cualquier
    // asesor, incluso en su propio contrato. Los roles administrativos ven
    // exactamente lo mismo por la vista (el documento no usa ni una columna
    // financiera); a un asesor le llega el record del vuelo solo si el
    // contrato es suyo.
    sb.from("ventas_basica").select("*").eq("numero_contrato", numero).single(),
    sb.from("contrato_pasajeros").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_hoteles").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_vuelos_basica").select("*").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_items").select("*").eq("numero_contrato", numero).order("orden"),
    // Igual que en la ficha: el detalle de pagos solo llega en el contrato
    // propio. En la vista comercial el total sale del resumen agregado, para
    // que el saldo impreso no diga "$0 pagado" cuando el cliente sí ha abonado.
    (completo
      ? sb.from("abonos").select("valor_abono").eq("numero_contrato", numero)
      : sb.from("abonos_resumen").select("total_pagado").eq("numero_contrato", numero)),
    sb.from("planes_alimentacion").select("codigo, nombre, nota_especial"),
  ]);

  if (!venta) notFound();

  const agencia = await agenciaDe((venta.tenant as Tenant | null) ?? undefined);

  const totalPagado = (abonos ?? []).reduce(
    (s, a) => s + Number(("valor_abono" in a ? a.valor_abono : a.total_pagado) ?? 0),
    0
  );
  const hotelesConNota = adjuntarNotaRegimen(hoteles ?? [], planes ?? []);

  return (
    <div className="min-h-screen bg-gray-100 py-6">
      {/* Barra (no se imprime) */}
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between px-4 print:hidden">
        <Link
          href={`/dashboard/contratos/${encodeURIComponent(numero)}`}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          ← Volver al contrato
        </Link>
        {/* Sin impresión en la versión limitada: un PDF al que le faltan los
            pasajeros, la dirección del cliente y la cédula del firmante se
            vería como un contrato válido al abrirlo suelto, y nadie sabría que
            está incompleto. No hay caso de negocio para entregarlo — quien
            necesita el contrato firmado es el asesor que lo gestiona, y él sí
            puede imprimirlo. */}
        {completo && <PrintButton />}
      </div>

      {!completo && (
        <div className="mx-auto mb-4 flex max-w-3xl items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 print:hidden">
          <Eye className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Vista comercial — versión limitada, no es el contrato</p>
            <p className="mt-0.5 text-amber-800">
              Estás consultando el contrato de otro asesor de tu agencia. Faltan los pasajeros,
              la dirección del cliente y los datos de firma, y el documento del titular sale
              enmascarado. Sirve para atender al cliente, no como documento del contrato: por eso
              no se puede imprimir. Pídeselo a {venta.asesor ?? "el asesor responsable"}.
            </p>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">
        <div className="overflow-hidden rounded-xl shadow-sm print:rounded-none print:shadow-none">
          <ContratoDocumento
            venta={venta}
            pasajeros={pasajeros ?? []}
            hoteles={hotelesConNota}
            vuelos={vuelos ?? []}
            items={items ?? []}
            totalPagado={totalPagado}
            agencia={agencia}
          />
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            /* Forzar impresión de colores de fondo (azul, grises) en el PDF */
            .contrato-doc, .contrato-doc * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            @page { size: A4; margin: 12mm; }
            @media print {
              html, body { background: #fff !important; }
              .contrato-doc { box-shadow: none !important; }
            }
          `,
        }}
      />
    </div>
  );
}
