// ─────────────────────────────────────────────────────────────────────────
// Nómina Colombia 2026 — seguridad social, parafiscales y prestaciones.
// Funciones PURAS. Actualizar tasas/valores cada diciembre.
// ─────────────────────────────────────────────────────────────────────────
import { SMMLV, SUBSIDIO_TRANSPORTE } from "@/lib/constants";

// Tasas a cargo del EMPLEADOR (2026).
export const TASAS_NOMINA = {
  salud: 0.085,          // 8.5% sobre el salario
  pension: 0.12,         // 12% sobre el salario
  sena: 0.02,            // parafiscal
  icbf: 0.03,            // parafiscal
  caja: 0.04,            // caja de compensación
  prima: 0.0833,         // 1 mes/año (sobre salario + auxilio)
  cesantias: 0.0833,     // 1 mes/año (sobre salario + auxilio)
  interesesCesantias: 0.01, // 12% de las cesantías → ~1%/mes (sobre salario + auxilio)
  vacaciones: 0.0417,    // 15 días/año (solo sobre salario)
} as const;

// Clases de riesgo ARL (porcentaje a cargo del empleador).
export const ARL = {
  I: 0.00522, II: 0.01044, III: 0.02436, IV: 0.0435, V: 0.0696,
} as const;
export type ClaseRiesgo = keyof typeof ARL;

// Exoneración de aportes (Art. 114-1 E.T., Ley 1819/2016): los empleadores
// DECLARANTES de renta (sociedades) no pagan Salud (8.5%) + SENA (2%) + ICBF (3%)
// por los empleados que ganen MENOS de 10 SMMLV. Caja (4%), pensión y ARL siempre.
export const UMBRAL_EXONERACION = 10 * SMMLV;

export type LiquidacionEmpleado = {
  salario: number;
  auxilio: number;
  salud: number; pension: number; arl: number;
  sena: number; icbf: number; caja: number;
  prima: number; cesantias: number; interesesCesantias: number; vacaciones: number;
  seguridadSocial: number;   // salud + pensión + ARL
  parafiscales: number;      // SENA + ICBF + caja
  prestaciones: number;      // prima + cesantías + intereses + vacaciones
  costoTotalMensual: number; // salario + auxilio + todo lo anterior
  exonerado: boolean;        // si se aplicó la exoneración (salud/SENA/ICBF en 0)
};

// El auxilio de transporte (por ley) aplica a salarios ≤ 2 SMMLV; el check del
// usuario decide si se incluye.
export function aplicaAuxilio(salario: number): boolean {
  return salario > 0 && salario <= 2 * SMMLV;
}

/**
 * Liquida el costo mensual real de un empleado por CONTRATO laboral.
 * - SS y parafiscales: sobre el salario (el auxilio no es base).
 * - Prima/cesantías/intereses: sobre salario + auxilio.
 * - Vacaciones: solo sobre salario.
 */
export function liquidarEmpleadoContrato(
  salario: number,
  conAuxilio: boolean,
  riesgo: ClaseRiesgo = "I",
  empresaDeclarante = false
): LiquidacionEmpleado {
  const s = Math.max(0, Number(salario) || 0);
  const auxilio = conAuxilio ? SUBSIDIO_TRANSPORTE : 0;
  const baseP = s + auxilio;

  // Exoneración: declarante de renta + salario < 10 SMMLV → no salud/SENA/ICBF.
  const exonerado = empresaDeclarante && s > 0 && s < UMBRAL_EXONERACION;

  const salud = exonerado ? 0 : s * TASAS_NOMINA.salud;
  const pension = s * TASAS_NOMINA.pension;
  const arl = s * ARL[riesgo];
  const sena = exonerado ? 0 : s * TASAS_NOMINA.sena;
  const icbf = exonerado ? 0 : s * TASAS_NOMINA.icbf;
  const caja = s * TASAS_NOMINA.caja;
  const prima = baseP * TASAS_NOMINA.prima;
  const cesantias = baseP * TASAS_NOMINA.cesantias;
  const interesesCesantias = baseP * TASAS_NOMINA.interesesCesantias;
  const vacaciones = s * TASAS_NOMINA.vacaciones;

  const seguridadSocial = salud + pension + arl;
  const parafiscales = sena + icbf + caja;
  const prestaciones = prima + cesantias + interesesCesantias + vacaciones;
  const r = (n: number) => Math.round(n);
  return {
    salario: s, auxilio,
    salud: r(salud), pension: r(pension), arl: r(arl),
    sena: r(sena), icbf: r(icbf), caja: r(caja),
    prima: r(prima), cesantias: r(cesantias), interesesCesantias: r(interesesCesantias), vacaciones: r(vacaciones),
    seguridadSocial: r(seguridadSocial), parafiscales: r(parafiscales), prestaciones: r(prestaciones),
    costoTotalMensual: r(s + auxilio + seguridadSocial + parafiscales + prestaciones),
    exonerado,
  };
}
