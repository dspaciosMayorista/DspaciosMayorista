// ─────────────────────────────────────────────────────────────────────────
// Datos de vuelo de un empaquetado (tabla `empaquetados`, migración 156)
// normalizados al MISMO shape que ya se leía de `bloqueos_vuelo` en los
// puntos donde el flujo de reserva arma el tramo del contrato / el costo
// aéreo — un solo lugar para no repetir el mismo SELECT+cast 3 veces
// (reservarDesdeTarifarioInterno, crearCotizacion) y para que agregar un
// campo nuevo no obligue a tocar cada call site por separado.
//
// Un empaquetado NUNCA tiene sillas ni cupo negociado — a diferencia de
// `bloqueos_vuelo`, el caller de esta función jamás debe intentar reservar/
// decrementar `sillas` para el resultado que devuelve (ver la nota en
// `reservarDesdeTarifarioInterno`, paso 9).
// ─────────────────────────────────────────────────────────────────────────

export type ProveedorVuelo = { nombre: string | null; aplica_retencion: boolean | null; pct_retencion: number | null } | null;

export type DatosVueloOrigen = {
  aerolinea: string | null;
  record: string | null;
  ruta: string | null;
  fecha_ida: string | null;
  fecha_regreso: string | null;
  vuelo_ida: string | null;
  vuelo_regreso: string | null;
  hora_salida_ida: string | null;
  hora_llegada_ida: string | null;
  hora_salida_reg: string | null;
  hora_llegada_reg: string | null;
  tarifa_para_empaquetar: number;
  fee_infante: number;
  proveedor: ProveedorVuelo;
};

/**
 * Trae los datos de vuelo de un `empaquetado`, en el mismo shape que ya se
 * usaba para `bloqueos_vuelo` en los call sites de reservar/actions.ts.
 * `sb` puede ser el cliente de sesión o el admin (service-role) — el mismo
 * criterio que ya usan esos call sites según necesiten leer costos netos.
 */
export async function datosVueloEmpaquetado(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  empaquetadoId: number
): Promise<DatosVueloOrigen | null> {
  const { data: e } = await sb
    .from("empaquetados")
    .select(
      "aerolinea, record, ruta, fecha_ida, fecha_regreso, vuelo_ida, vuelo_regreso, hora_salida_ida, hora_llegada_ida, hora_salida_reg, hora_llegada_reg, tarifa_para_empaquetar, fee_infante, proveedores(nombre, aplica_retencion, pct_retencion)"
    )
    .eq("id", empaquetadoId)
    .maybeSingle();
  if (!e) return null;
  return {
    aerolinea: e.aerolinea, record: e.record, ruta: e.ruta,
    fecha_ida: e.fecha_ida, fecha_regreso: e.fecha_regreso,
    vuelo_ida: e.vuelo_ida, vuelo_regreso: e.vuelo_regreso,
    hora_salida_ida: e.hora_salida_ida, hora_llegada_ida: e.hora_llegada_ida,
    hora_salida_reg: e.hora_salida_reg, hora_llegada_reg: e.hora_llegada_reg,
    tarifa_para_empaquetar: Number(e.tarifa_para_empaquetar) || 0,
    fee_infante: Number(e.fee_infante) || 0,
    proveedor: e.proveedores as unknown as ProveedorVuelo,
  };
}
