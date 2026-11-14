// #49 — Fila `agencias` SINTÉTICA para las pruebas que renderizan documentos: los documentos ya no tienen respaldo en la constante EMPRESA (identidad de Minorista),
// así que toda prueba debe pasar una agencia. Valores ficticios, nunca los RNT/NIT reales.
export const AGENCIA_PRUEBA = {
  tenant: "mayorista", razon_social: "Agencia de Prueba SAS", nombre_comercial: "Agencia de Prueba", nit: "800123456", dv: "7", rnt: "RNT-PRUEBA-1",
  correo: "prueba@agencia.test", banco: "Banco de Prueba", tipo_cuenta: "Cuenta de prueba", numero_cuenta: "000-000000-00",
  direccion: null, ciudad: "Ciudad de Prueba", telefono: null, actividad_economica: null, responsabilidades: null, representante_legal: null, factura_electronica: false, updated_at: "2026-01-01T00:00:00Z",
};
