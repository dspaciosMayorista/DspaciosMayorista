/** Servicios aéreos VIGENTES = vouchers aéreos que no están «retirado» (estado ausente = vigente, versiones sin la 338). «revisar» sigue siendo un servicio del contrato. */
export const cuentaServiciosAereosVigentes = (filas: readonly { estado?: string | null }[]): number => filas.filter((f) => f.estado !== "retirado").length;
