import { sinPnr, tienePnr, type VoucherVueloContenido } from "@/lib/voucher/vuelo";

// ADL-041: el PNR GUARDADO de cada tramo se muestra en el voucher aéreo SOLO con el contrato 100 % pagado. Quien abre el voucher como ALIADO ya pasó la comprobación de pago al resolver el acceso (307): no se repite
// (cero consultas añadidas). La vista previa INTERNA hace UNA consulta, y solo si el voucher trae PNR. Sin pago, o ante cualquier fallo de la lectura del pago (falla cerrado), el PNR se QUITA del objeto antes
// de renderizar: ni siquiera viaja en la respuesta de la página. La ausencia de PNR no impide nada (el voucher se genera y se ve igual). `pagado` = el criterio único de pago (lib/voucher/pagoCompleto.ts).
export async function vueloVisible(
  c: VoucherVueloContenido, modo: "interno" | "aliado", numero: string, pagado: (numero: string) => Promise<boolean>,
): Promise<{ contenido: VoucherVueloContenido; pnrPendientePago: boolean }> {
  if (!tienePnr(c) || modo === "aliado") return { contenido: c, pnrPendientePago: false };
  let ok = false;
  try { ok = await pagado(numero); } catch { ok = false; }
  return ok ? { contenido: c, pnrPendientePago: false } : { contenido: sinPnr(c), pnrPendientePago: true };
}
