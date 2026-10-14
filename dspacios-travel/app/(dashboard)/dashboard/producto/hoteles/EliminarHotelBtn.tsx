"use client";

import { eliminarHotel } from "./actions";
import { EliminarHotelDialog } from "./EliminarHotelDialog";

export function EliminarHotelBtn({ id, nombre }: { id: number; nombre: string }) {
  return <EliminarHotelDialog id={id} nombre={nombre} eliminar={eliminarHotel} />;
}
