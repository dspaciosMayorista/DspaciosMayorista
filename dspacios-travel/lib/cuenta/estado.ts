import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Roles internos con acceso total a la cartera (igual que la RLS de abonos).
const ROLES_INTERNOS = ["superadmin", "administracion", "gerencia", "operaciones"];

export type AbonoCuenta = {
  id: number;
  fecha_abono: string;
  valor_abono: number;
  forma_pago: string | null;
  referencia: string | null;
  recibido_por: string | null;
  saldoTras: number; // saldo del contrato JUSTO DESPUÉS de este abono
};

export type EstadoCuenta = {
  numero_contrato: string;
  cliente: string | null;
  destino: string | null;
  fecha_salida: string | null;
  estado: string | null;
  moneda: string;
  precio_venta: number;
  pagado: number;
  saldo: number;
  abonos: AbonoCuenta[];
  esInterno: boolean;
};

// Número de recibo legible a partir del id del abono: RC-000123.
export function numeroRecibo(idAbono: number): string {
  return `RC-${String(idAbono).padStart(6, "0")}`;
}

/**
 * Carga el estado de cuenta de un contrato con CONTROL DE ACCESO:
 * lo ve un rol interno o el aliado B2B dueño del contrato. Devuelve null si
 * no existe o el usuario no tiene permiso (para que la página haga notFound()).
 * Los abonos vienen en orden cronológico con el saldo corriente tras cada uno.
 */
export async function cargarEstadoCuenta(numero: string): Promise<EstadoCuenta | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await sb.from("usuarios").select("nombre, rol").eq("id", user.id).maybeSingle();

  const admin = createAdminClient();
  const { data: v } = await admin
    .from("ventas")
    .select("numero_contrato, cliente, destino, fecha_salida, estado, precio_venta, moneda, b2b_usuario_id, agencia_nombre, freelance_nombre")
    .eq("numero_contrato", numero)
    .maybeSingle();
  if (!v) return null;

  const esInterno = ROLES_INTERNOS.includes(perfil?.rol ?? "");
  const esDueno =
    v.b2b_usuario_id === user.id ||
    [v.agencia_nombre, v.freelance_nombre].includes(perfil?.nombre ?? "");
  if (!esInterno && !esDueno) return null;

  const { data: abs } = await admin
    .from("abonos")
    .select("id, fecha_abono, valor_abono, forma_pago, referencia, recibido_por")
    .eq("numero_contrato", numero)
    .order("fecha_abono", { ascending: true })
    .order("id", { ascending: true });

  const precio = Number(v.precio_venta ?? 0);
  let acum = 0;
  const abonos: AbonoCuenta[] = (abs ?? []).map((a) => {
    acum += Number(a.valor_abono ?? 0);
    return {
      id: a.id as number,
      fecha_abono: a.fecha_abono as string,
      valor_abono: Number(a.valor_abono ?? 0),
      forma_pago: a.forma_pago as string | null,
      referencia: a.referencia as string | null,
      recibido_por: a.recibido_por as string | null,
      saldoTras: Math.max(precio - acum, 0),
    };
  });

  return {
    numero_contrato: v.numero_contrato as string,
    cliente: v.cliente as string | null,
    destino: v.destino as string | null,
    fecha_salida: v.fecha_salida as string | null,
    estado: v.estado as string | null,
    moneda: (v.moneda as string) ?? "COP",
    precio_venta: precio,
    pagado: acum,
    saldo: Math.max(precio - acum, 0),
    abonos,
    esInterno,
  };
}

/** Carga un recibo de caja (un abono) con el mismo control de acceso. */
export async function cargarRecibo(idAbono: number): Promise<{
  estado: EstadoCuenta;
  abono: AbonoCuenta;
} | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: a } = await admin
    .from("abonos")
    .select("numero_contrato")
    .eq("id", idAbono)
    .maybeSingle();
  if (!a) return null;

  const estado = await cargarEstadoCuenta(a.numero_contrato as string);
  if (!estado) return null;
  const abono = estado.abonos.find((x) => x.id === idAbono);
  if (!abono) return null;
  return { estado, abono };
}
