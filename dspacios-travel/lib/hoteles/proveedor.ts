export type ProveedorHotelNormalizado =
  | { ok: true; proveedorId: number | null | undefined }
  | { ok: false; error: string };

export function normalizarProveedorHotelId(input: unknown): ProveedorHotelNormalizado {
  if (input === undefined) return { ok: true, proveedorId: undefined };
  if (input === null) return { ok: true, proveedorId: null };
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0) {
    return { ok: false, error: "El proveedor seleccionado no es valido." };
  }
  return { ok: true, proveedorId: input };
}
