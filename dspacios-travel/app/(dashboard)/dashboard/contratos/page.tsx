import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant.server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContratosList } from "./ContratosList";

export const dynamic = "force-dynamic";

export default async function ContratosPage() {
  const sb = await createClient();
  const tenant = await getTenant();
  // Se lee de `ventas_basica` (migración 144), no de la tabla base: el rol
  // `venta` ya no tiene acceso de fila a `ventas` — así no puede pedir las
  // columnas de costo por la API. La vista sirve igual a los demás roles y
  // aplica el mismo filtro por agencia, así que basta una sola consulta.
  const { data: ventas } = await sb
    .from("ventas_basica")
    .select(
      "numero_contrato, cliente, destino, fecha_salida, precio_venta, moneda, estado, created_at"
    )
    .eq("tenant", tenant)
    // Z-A por número de contrato: el más reciente (mayor consecutivo) primero.
    .order("numero_contrato", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Contratos</h1>
          <p className="mt-1 text-sm text-gray-500">
            Generador de contratos de servicios turísticos
          </p>
        </div>
        <Link href="/dashboard/contratos/nuevo">
          <Button style={{ backgroundColor: "var(--brand-primary)" }}>
            + Nuevo contrato
          </Button>
        </Link>
      </div>

      {!ventas?.length ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center text-gray-400">
          <p className="text-lg">Aún no hay contratos</p>
          <p className="mt-1 text-sm">
            Crea el primero con el botón “Nuevo contrato”.
          </p>
        </div>
      ) : (
        <ContratosList ventas={ventas} />
      )}
    </div>
  );
}
