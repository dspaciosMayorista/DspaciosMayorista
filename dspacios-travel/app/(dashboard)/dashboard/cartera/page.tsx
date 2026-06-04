import { createClient } from "@/lib/supabase/server";
import { CarteraList, type CarteraRow } from "./CarteraList";

export const dynamic = "force-dynamic";

const ROLES_CONTABLES = ["superadmin", "gerencia", "administracion", "operaciones"];

export default async function CarteraPage() {
  const sb = await createClient();

  // Acceso restringido a roles contables (igual que la RLS de abonos).
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  if (!ROLES_CONTABLES.includes(perfil?.rol ?? "")) {
    return (
      <div className="mx-auto max-w-5xl p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-gray-900">Cartera</h1>
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No tienes permisos para ver la cartera. Solicítalo a un administrador.
        </p>
      </div>
    );
  }

  const [{ data: ventas }, { data: abonos }, { data: formasPagoRows }] = await Promise.all([
    sb
      .from("ventas")
      .select("numero_contrato, cliente, destino, precio_venta, estado, fecha_salida, created_at")
      .order("created_at", { ascending: false }),
    sb
      .from("abonos")
      .select("id, numero_contrato, fecha_abono, valor_abono, forma_pago, referencia")
      .order("fecha_abono", { ascending: true }),
    sb.from("formas_pago").select("nombre").eq("activo", true).order("orden"),
  ]);

  // Agrupa abonos por contrato.
  const abonosPorContrato = new Map<string, CarteraRow["abonos"]>();
  for (const a of abonos ?? []) {
    const arr = abonosPorContrato.get(a.numero_contrato) ?? [];
    arr.push({
      id: a.id,
      fecha_abono: a.fecha_abono,
      valor_abono: a.valor_abono ?? 0,
      forma_pago: a.forma_pago,
      referencia: a.referencia,
    });
    abonosPorContrato.set(a.numero_contrato, arr);
  }

  const rows: CarteraRow[] = (ventas ?? []).map((v) => {
    const ab = abonosPorContrato.get(v.numero_contrato) ?? [];
    const pagado = ab.reduce((s, x) => s + (x.valor_abono ?? 0), 0);
    const saldo = Math.max((v.precio_venta ?? 0) - pagado, 0);
    return {
      numero_contrato: v.numero_contrato,
      cliente: v.cliente,
      destino: v.destino,
      precio_venta: v.precio_venta ?? 0,
      estado: v.estado,
      fecha_salida: v.fecha_salida,
      pagado,
      saldo,
      abonos: ab,
    };
  });

  const formasPago = (formasPagoRows ?? []).map((f) => f.nombre);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Cartera — por cobrar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Saldos a recaudar por contrato. Registra abonos y consulta el estado de cuenta sin
          entrar a cada contrato.
        </p>
      </div>
      <CarteraList rows={rows} formasPago={formasPago} />
    </div>
  );
}
