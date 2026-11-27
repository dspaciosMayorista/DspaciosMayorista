// #13 — Avisos DENTRO de la aplicación por fin de vigencia de compra (tipo `compra_por_vencer` de la campana global). Reglas PURAS de presentación y de permiso; sin red ni next/*.
// El aviso solo lleva el nombre de la ventana, su fecha de fin y a dónde corregirla; nunca costos ni datos de clientes.
import { diasEntre, esFuenteCompra, etiquetaDias, rutaVentana } from "../paquetes/vencimientoCompra.ts";

/** Quienes reciben (y pueden ver) estos avisos: los que pueden ESCRIBIR paquetes y corregir la fecha. Debe coincidir con `generar_avisos_compra` (migración 343) y ESCRITURA.producto (lib/roles.ts). */
export const ROLES_AVISO_COMPRA = ["superadmin", "gerencia", "administracion", "operaciones"] as const;
export const puedeVerAvisosCompra = (rol: string | null | undefined): boolean => !!rol && (ROLES_AVISO_COMPRA as readonly string[]).includes(rol);

export type FilaCompra = { ventana_tipo?: string | null; ventana_id?: number | null; ventana_ref?: number | null; ventana_titulo?: string | null; compra_fin?: string | null };

/** Destino del aviso: la pantalla donde se corrige ESA vigencia. Sin datos suficientes, el listado de Paquetes (nunca una ruta inventada). */
export function hrefCompra(f: FilaCompra): string {
  return esFuenteCompra(f.ventana_tipo) && Number.isInteger(f.ventana_ref) ? rutaVentana(f.ventana_tipo, f.ventana_ref as number, f.ventana_id ?? null) : "/dashboard/paquetes";
}

const fechaCorta = (iso: string) => iso.split("-").reverse().join("/");
const TIPO_TEXTO: Record<string, string> = { paquete: "paquete", salida_dinamica: "salida dinámica", empaquetado: "empaquetado", paquete_total: "paquete dinámico total", hotel_vigencia: "vigencia de hotel", servicio_vigencia: "vigencia de servicio" };

/** Texto del aviso con el plazo calculado A LA FECHA DE HOY (Bogotá) en cada sondeo: «Vence hoy», «Vence mañana», «Vence en N días» o «Venció» si el archivo diario aún no lo retiró. */
export function textoCompra(f: FilaCompra, hoy: string): string {
  const titulo = (f.ventana_titulo ?? "").trim() || "una vigencia de compra";
  const fin = f.compra_fin ?? "";
  const d = fin ? diasEntre(hoy, fin) : null;
  const plazo = d === null ? "" : d < 0 ? "Venció" : etiquetaDias(d);
  const tipo = TIPO_TEXTO[f.ventana_tipo ?? ""];
  return `Compra por vencer${tipo ? ` · ${tipo}` : ""}: ${titulo}${plazo ? ` · ${plazo}` : ""}${fin ? ` (${fechaCorta(fin)})` : ""}`;
}
