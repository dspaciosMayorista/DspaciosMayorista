// #48 — Vista previa del precio NETO de una cotización dinámica B2B normal: composición PURA sobre `netoHija.ts` (espejo de p50_priv, migraciones 222/286/317).
// La base de datos es la autoridad (sella al crear con el rol real); esto solo muestra el mismo resultado antes de guardar y decide qué impide el botón.
import {
  calcularNetoHija, evaluarMargenNeto, bloqueoNeto, puedeAutorizarMargen, puedeFijarNeto, aUnidades,
  type ResultadoNeto, type EvaluacionNeto, type ServicioNeto,
} from "./netoHija.ts";

export type TipoAliado = "agencia" | "freelance";

/** % de comisión del aliado igual que `p50_priv.sellar_hija`: el del aliado → parámetro general → 12 % agencia / 11 % freelance, a 4 decimales. */
export function pctComisionNeto(pctAliado: number | null | undefined, parametro: number | null | undefined, tipo: TipoAliado): number {
  const v = pctAliado ?? parametro ?? (tipo === "agencia" ? 0.12 : 0.11);
  return Math.round(Number(v) * 10000) / 10000;
}

export type EntradaVistaNeto = {
  /** Servicios con su PVP (valor) y costo neto, en el orden del formulario. */
  servicios: { tipo: string; valor: number; costoNeto: number }[];
  total: number;
  recobro: number;
  ninos: number;
  tarifaNino: number;
  recobroAliado: number;
  /** Casilla «reconocer la participación del aliado en el recobro»; sin participación (> 0) no tiene efecto. */
  reconoce: boolean;
  pct: number;
  /** `p97_regla_neto_activa()`: la vista previa debe coincidir con lo que sellará la base. */
  reglaParticipacion: boolean;
  rol: string | null | undefined;
  autorizarMargen: boolean;
};

export type VistaNeto = {
  resultado: ResultadoNeto;
  evaluacion: EvaluacionNeto;
  neto: number;
  descuento: number;
  costos: number;
  /** Motivo que impide guardar en NETO (misma decisión y mismo orden que la base), o null. */
  bloqueo: string | null;
  puedeFijar: boolean;
  /** El margen no cubre el mínimo y el rol podría autorizarlo marcando la casilla. */
  requiereAutorizacion: boolean;
};

export function vistaNetoManual(e: EntradaVistaNeto): VistaNeto {
  const servicios: ServicioNeto[] = e.servicios.map((s, i) => ({ orden: i, tipo: s.tipo, valor: s.valor, costoNeto: s.costoNeto }));
  const resultado = calcularNetoHija({
    servicios, precioVenta: e.total, recobro: e.recobro, ninos: e.ninos, tarifaNino: e.tarifaNino,
    recobroAliado: e.recobroAliado, reconoceRecobro: e.reconoce && e.recobroAliado > 0, pct: e.pct, reglaParticipacion: e.reglaParticipacion,
  });
  const evaluacion = evaluarMargenNeto(resultado.neto, resultado.costos, resultado.soloTiquetes);
  const puedeFijar = puedeFijarNeto(e.rol);
  const bloqueoBase = bloqueoNeto(
    {
      hayDescuento: resultado.descuento > BigInt(0), costoCero: evaluacion.costoCero, bajoCosto: evaluacion.bajoCosto, cumple: evaluacion.cumple,
      soloTiquetes: resultado.soloTiquetes, margen: evaluacion.margen, pisoPct: evaluacion.pisoBps / 100,
    },
    { puedeAutorizar6: puedeAutorizarMargen(e.rol, false), puedeAutorizar2: puedeAutorizarMargen(e.rol, true) },
    e.autorizarMargen,
  );
  return {
    resultado, evaluacion,
    neto: aUnidades(resultado.neto), descuento: aUnidades(resultado.descuento), costos: aUnidades(resultado.costos),
    bloqueo: puedeFijar ? bloqueoBase : "Tu rol no puede fijar el precio NETO; pídeselo a gerencia, administración u operaciones.",
    puedeFijar,
    requiereAutorizacion: resultado.descuento > BigInt(0) && !evaluacion.costoCero && !evaluacion.bajoCosto && !evaluacion.cumple,
  };
}
