// Stub de las Server Actions de preparación de contrato del aliado (O-3, migración 325) para las pruebas que RENDERIZAN la tabla de cotizaciones del portal: las acciones reales
// arrastran next/cache y los clientes de Supabase y, renderizadas, no se invocan. Su comportamiento real lo ejercita guion_o3_completo.mjs (navegador, base y Storage reales)
// y pruebas/panelPreparacionContrato325.react.ts las sustituye por dobles que registran cada llamada.
const nada = async () => ({ ok: false, error: "stub de prueba" });
export const adjuntarEvidenciaCotizacion = nada;
export const retirarEvidenciaCotizacion = nada;
export const guardarPasajerosAliado = nada;
