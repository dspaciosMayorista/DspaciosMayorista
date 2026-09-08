// ─────────────────────────────────────────────────────────────────────────
// Validación PURA del formulario de alta/edición de UN infante (sin silla)
// directamente desde el detalle de un vuelo — ver migración 168
// (`guardar_infante_vuelo`, RPC estrecho) y `docs/tecnico/` para el diseño
// completo.
//
// ⚠️ Esta validación es SOLO para adelantar mensajes en el cliente/Server
// Action antes del viaje de red — el servidor SQL (SECURITY DEFINER, migra-
// ción 168) es la ÚNICA autoridad real: relee bloqueos_vuelo.fecha_ida,
// resuelve el contrato efectivo de la silla, ubica al responsable por
// documento y vuelve a aplicar sus propias reglas desde cero. Si esta
// validación y la del servidor llegaran a divergir, la del servidor manda.
//
// La clasificación INF/CHD en vivo (para que el formulario avise "esto ya
// no es un infante" mientras el asesor escribe la fecha de nacimiento)
// reutiliza `esInfantePorEdad`/`EDAD_INFANTE_MAX_VUELO` de
// lib/reservar/pasajeros.ts — la MISMA fuente de verdad que usa el resto del
// sistema para esta clasificación (nunca un umbral reinventado aquí).
import { esInfantePorEdad, EDAD_INFANTE_MAX_VUELO } from "../reservar/pasajeros.ts";

export { esInfantePorEdad, EDAD_INFANTE_MAX_VUELO };

// `contrato_pasajeros.nombre` es UN solo campo (no hay nombres/apellidos
// separados en la tabla) — el formulario y el RPC (migración 168, que
// concatena p_nombres+p_apellidos con `concat_ws`) usan un único "nombre
// completo" para no inventar una separación que no existe en el dato ya
// guardado (evita partir a la mitad un nombre existente al editar). Se manda
// como `p_nombres` con `p_apellidos = ""` — el RPC simplemente omite la
// parte vacía al concatenar.
export type InfanteVueloInput = {
  nombreCompleto: string;
  tipoDoc: string;
  numeroDoc: string;
  fechaNacimiento: string; // ISO yyyy-mm-dd
};

export type ValidacionInfanteVuelo = { ok: true } | { ok: false; error: string };

const FECHA_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida la FORMA de los datos del infante — mismos límites que el RPC
 * (migración 168, que a su vez mira los de `_reemplazar_pasajeros_nucleo`,
 * migración 167) para no divergir del resto del sistema. No decide nada de
 * negocio (responsable, contrato, autorización): eso vive exclusivamente en
 * el servidor.
 */
export function validarInfanteVueloInput(input: InfanteVueloInput): ValidacionInfanteVuelo {
  const nombreCompleto = input.nombreCompleto.trim();
  if (!nombreCompleto) return { ok: false, error: "El nombre del infante es obligatorio." };
  if (nombreCompleto.length > 200) return { ok: false, error: "El nombre es demasiado largo." };

  const tipoDoc = input.tipoDoc.trim();
  if (!tipoDoc) return { ok: false, error: "El tipo de documento es obligatorio." };
  if (tipoDoc.length > 10) return { ok: false, error: "El tipo de documento es inválido." };

  const numeroDoc = input.numeroDoc.trim();
  if (!numeroDoc) return { ok: false, error: "El número de documento es obligatorio." };
  if (numeroDoc.length > 30) return { ok: false, error: "El número de documento es demasiado largo." };
  if (tipoDoc !== "PAS" && !/^\d+$/.test(numeroDoc)) {
    return { ok: false, error: "El documento debe ser solo números (excepto Pasaporte)." };
  }

  if (!input.fechaNacimiento || !FECHA_ISO_RE.test(input.fechaNacimiento)) {
    return { ok: false, error: "La fecha de nacimiento es obligatoria." };
  }
  const hoy = new Date().toISOString().slice(0, 10);
  if (input.fechaNacimiento > hoy) return { ok: false, error: "La fecha de nacimiento no puede ser futura." };

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// ¿La silla ya tiene ALGÚN dato de pasajero? Usado por PasajeroAcciones.tsx
// para decidir si el alta manual está partiendo de una silla VACÍA (la
// conversión automática a infante solo aplica ahí) o si es una EDICIÓN de un
// pasajero ya registrado (donde esa conversión queda bloqueada — ver ese
// componente). Una fila puede llegar con datos PARCIALES (ej. solo
// documento cargado, sin nombre todavía): cualquiera de los 5 campos con
// valor cuenta como "ya tiene pasajero", nunca solo nombre+apellido.
// ─────────────────────────────────────────────────────────────────────────
export type DatosPasajeroSilla = {
  pasajero_nombres: string;
  pasajero_apellidos: string;
  tipo_doc: string;
  numero_doc: string;
  nacimiento: string;
};

export function sillaTieneDatosDePasajero(d: DatosPasajeroSilla): boolean {
  return Boolean(
    d.pasajero_nombres.trim() ||
      d.pasajero_apellidos.trim() ||
      d.tipo_doc.trim() ||
      d.numero_doc.trim() ||
      d.nacimiento.trim()
  );
}
