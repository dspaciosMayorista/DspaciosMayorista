import { TIPOS_DOC_PERSONA } from "@/lib/personas/identidad";
import { ETIQUETA_TIPO_DOC, TIPOS_DOC_PASAJERO } from "@/lib/personas/tiposDocumento";

/** <option>s del catálogo de personas (PAS se muestra como «Pasaporte»). `pasajero`: solo los tipos que la reserva admite para un pasajero. */
export function OpcionesTipoDoc({ pasajero = false }: { pasajero?: boolean }) {
  const tipos = pasajero ? TIPOS_DOC_PASAJERO : TIPOS_DOC_PERSONA;
  return <>{tipos.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO_DOC[t]}</option>)}</>;
}
