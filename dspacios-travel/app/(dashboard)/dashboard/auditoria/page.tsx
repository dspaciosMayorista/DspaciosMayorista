import { createClient } from "@/lib/supabase/server";
import { permisosDelUsuario } from "@/lib/permisos";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;
const ROLES_OK = ["superadmin", "gerencia"];

// Etiqueta legible de cada tabla auditada (las que no estén aquí se muestran tal cual).
const TABLA_LABEL: Record<string, string> = {
  ventas: "Venta", abonos: "Abono", cuentas_por_pagar: "Cuenta por pagar",
  aliados_b2b: "Aliado B2B", liquidacion_comisiones: "Liquidación comisión",
  facturacion: "Facturación", rentabilidad: "Rentabilidad", asesores: "Asesor",
  proveedores: "Proveedor", aliados: "Aliado", parametros_tributarios: "Parámetro tributario",
  usuarios: "Usuario", bloqueos_vuelo: "Bloqueo de vuelo", sillas: "Silla",
  movimientos_silla: "Movimiento de silla", destinos: "Destino", hoteles: "Hotel",
  habitaciones: "Habitación", tarifa_hotel: "Tarifa de hotel", servicios_adicionales: "Servicio",
  paquetes: "Paquete", programas: "Programa", cotizaciones: "Cotización",
  cotizacion_servicios: "Servicio de cotización", contrato_items: "Ítem de contrato",
  contrato_pasajeros: "Pasajero", contrato_hoteles: "Hotel de contrato",
  contrato_vuelos: "Vuelo de contrato", formas_pago: "Forma de pago", rangos_edad: "Rango de edad",
  vouchers: "Voucher", cuotas: "Cuota",
};

// Opciones del filtro por tabla (las más usadas; el resto se ve igual en la tabla).
const TABLAS_FILTRO = [
  "ventas", "abonos", "cuentas_por_pagar", "cotizaciones", "bloqueos_vuelo", "sillas",
  "hoteles", "tarifa_hotel", "paquetes", "programas", "proveedores", "aliados",
  "asesores", "usuarios", "parametros_tributarios", "destinos", "servicios_adicionales",
];

const ACCION = {
  INSERT: { verbo: "Creó", clase: "bg-green-50 text-green-700" },
  UPDATE: { verbo: "Editó", clase: "bg-blue-50 text-blue-700" },
  DELETE: { verbo: "Eliminó", clase: "bg-red-50 text-red-700" },
} as const;

function fechaHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function valorCorto(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

type Cambios = Record<string, { antes?: unknown; despues?: unknown }>;

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { rol } = await permisosDelUsuario();
  if (!ROLES_OK.includes(rol ?? "")) redirect("/dashboard");

  const sp = await searchParams;
  const fTabla = sp.tabla?.trim() || "";
  const fAccion = sp.accion?.trim() || "";
  const fReg = sp.q?.trim() || "";
  const fActor = sp.actor?.trim() || "";
  const fDesde = sp.desde?.trim() || "";
  const fHasta = sp.hasta?.trim() || "";
  const pagina = Math.max(Number(sp.page) || 1, 1);

  const sb = await createClient();
  let query = sb
    .from("auditoria")
    .select("id, creado_en, actor_email, actor_nombre, actor_rol, accion, tabla, registro_id, antes, despues, cambios", { count: "exact" })
    .order("creado_en", { ascending: false });

  if (fTabla) query = query.eq("tabla", fTabla);
  if (fAccion) query = query.eq("accion", fAccion);
  if (fReg) query = query.ilike("registro_id", `%${fReg}%`);
  if (fActor) query = query.or(`actor_email.ilike.%${fActor}%,actor_nombre.ilike.%${fActor}%`);
  if (fDesde) query = query.gte("creado_en", `${fDesde}T00:00:00`);
  if (fHasta) query = query.lte("creado_en", `${fHasta}T23:59:59`);

  const desde = (pagina - 1) * POR_PAGINA;
  const { data: filas, count } = await query.range(desde, desde + POR_PAGINA - 1);
  const total = count ?? 0;
  const totalPaginas = Math.max(Math.ceil(total / POR_PAGINA), 1);

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (fTabla) p.set("tabla", fTabla);
    if (fAccion) p.set("accion", fAccion);
    if (fReg) p.set("q", fReg);
    if (fActor) p.set("actor", fActor);
    if (fDesde) p.set("desde", fDesde);
    if (fHasta) p.set("hasta", fHasta);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  const inputCls = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Auditoría</h1>
      <p className="mt-1 text-sm text-gray-500">
        Historial de cambios: quién creó, editó o eliminó cada registro. {total.toLocaleString("es-CO")} movimientos.
      </p>

      {/* Filtros (GET) */}
      <form className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-6" method="get">
        <select name="tabla" defaultValue={fTabla} className={inputCls}>
          <option value="">Todas las tablas</option>
          {TABLAS_FILTRO.map((t) => <option key={t} value={t}>{TABLA_LABEL[t] ?? t}</option>)}
        </select>
        <select name="accion" defaultValue={fAccion} className={inputCls}>
          <option value="">Toda acción</option>
          <option value="INSERT">Creó</option>
          <option value="UPDATE">Editó</option>
          <option value="DELETE">Eliminó</option>
        </select>
        <input name="q" defaultValue={fReg} placeholder="N° contrato / record / id" className={inputCls} />
        <input name="actor" defaultValue={fActor} placeholder="Usuario (nombre/email)" className={inputCls} />
        <input type="date" name="desde" defaultValue={fDesde} className={inputCls} />
        <input type="date" name="hasta" defaultValue={fHasta} className={inputCls} />
        <div className="col-span-2 flex gap-2 md:col-span-6">
          <button type="submit" className="rounded-lg px-4 py-2 text-sm font-medium text-white" style={{ backgroundColor: "var(--brand-primary)" }}>Filtrar</button>
          <Link href="/dashboard/auditoria" className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-gray-800">Limpiar</Link>
        </div>
      </form>

      {/* Tabla */}
      <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase text-gray-400">
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2">Usuario</th>
                <th className="px-4 py-2">Acción</th>
                <th className="px-4 py-2">Registro</th>
                <th className="px-4 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(filas ?? []).map((f) => {
                const acc = ACCION[f.accion as keyof typeof ACCION] ?? { verbo: f.accion, clase: "bg-gray-100 text-gray-600" };
                const cambios = (f.cambios ?? null) as Cambios | null;
                const nClaves = cambios ? Object.keys(cambios).length : 0;
                return (
                  <tr key={f.id} className="border-t border-gray-50 align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-gray-500">{fechaHora(f.creado_en)}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-800">{f.actor_nombre || f.actor_email || "Sistema"}</div>
                      {f.actor_rol && <div className="text-[11px] text-gray-400">{f.actor_rol}</div>}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${acc.clase}`}>{acc.verbo}</span>
                      <div className="mt-1 text-xs text-gray-500">{TABLA_LABEL[f.tabla] ?? f.tabla}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">{f.registro_id || "—"}</td>
                    <td className="px-4 py-2">
                      {f.accion === "UPDATE" && cambios ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-[#1D7C9A] hover:underline">{nClaves} campo{nClaves === 1 ? "" : "s"} cambiado{nClaves === 1 ? "" : "s"}</summary>
                          <table className="mt-2 w-full text-xs">
                            <tbody>
                              {Object.entries(cambios).map(([campo, v]) => (
                                <tr key={campo} className="border-t border-gray-50">
                                  <td className="py-1 pr-2 font-medium text-gray-600">{campo}</td>
                                  <td className="py-1 pr-1 text-gray-400 line-through">{valorCorto(v.antes)}</td>
                                  <td className="py-1 pr-1 text-gray-400">→</td>
                                  <td className="py-1 text-gray-800">{valorCorto(v.despues)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      ) : f.accion === "DELETE" ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-[#1D7C9A] hover:underline">Ver fila eliminada</summary>
                          <pre className="mt-2 max-w-[420px] overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-[11px] text-gray-600">{JSON.stringify(f.antes, null, 2)}</pre>
                        </details>
                      ) : f.accion === "INSERT" ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-[#1D7C9A] hover:underline">Ver fila creada</summary>
                          <pre className="mt-2 max-w-[420px] overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-[11px] text-gray-600">{JSON.stringify(f.despues, null, 2)}</pre>
                        </details>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filas?.length && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin movimientos para estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <span>Página {pagina} de {totalPaginas}</span>
          <div className="flex gap-2">
            {pagina > 1 && <Link href={qs({ page: pagina - 1 })} className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50">← Anterior</Link>}
            {pagina < totalPaginas && <Link href={qs({ page: pagina + 1 })} className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50">Siguiente →</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
