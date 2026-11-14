// Stub de las Server Actions de soportes de pago (#86) para las pruebas que RENDERIZAN la pestaña/ficha: las acciones reales arrastran next/cache
// y los clientes de Supabase. Renderizadas en servidor no se invocan. Las acciones REALES las ejercita pruebas/soportesPago281.pg.ts.
const nada = async () => ({ ok: false, error: "stub de prueba" });
export const subirSoporte = nada;
export const reemplazarSoporte = nada;
export const retirarSoporte = nada;
export const urlSoporteAliado = nada;
export const urlSoporteInterno = nada;
