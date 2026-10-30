// #40 E2 — Reglas PURAS de la búsqueda de cliente/titular por número de documento (sin I/O).
//
// La identidad es número + tipo (#32, migración 214): el número se escribe primero y el tipo se conoce
// después, así que una búsqueda por número devuelve un candidato POR TIPO. Esta capa solo resume la
// respuesta de `buscar_personas_documento` y decide qué se puede aplicar sin pisar lo ya escrito.
import type { RespuestaBusquedaPersonas } from "./consulta";
import type { TipoDocPersona } from "./identidad";

export const CAMPOS_TITULAR_UI = ["nombres", "apellidos", "telefono", "email", "nacimiento"] as const;
export type CampoTitularUI = (typeof CAMPOS_TITULAR_UI)[number];
export type DatosTitular = Partial<Record<CampoTitularUI, string>>;

export type CandidatoTitular = {
  tipoDoc: TipoDocPersona;
  numero: string;
  datos: DatosTitular;
  /** Algún campo tiene valores distintos entre capturas: se muestra el más frecuente y se avisa. */
  divergencia: boolean;
};

const CAMPO_BD: Record<string, CampoTitularUI> = {
  nombres: "nombres", apellidos: "apellidos", telefono: "telefono", email: "email", fecha_nacimiento: "nacimiento",
};

/** null = la persona no existe o el actor no tiene nada autorizado (la base no distingue los casos). */
export function candidatoDeRespuesta(r: RespuestaBusquedaPersonas | null | undefined): CandidatoTitular | null {
  if (!r || !r.persona || r.error) return null;
  const datos: DatosTitular = {};
  for (const v of r.variantes ?? []) {
    const campo = CAMPO_BD[v.campo];
    const top = v.valores?.[0]?.valor?.trim();
    if (campo && top) datos[campo] = top;
  }
  return { tipoDoc: r.persona.tipo_doc, numero: r.persona.numero_norm, datos, divergencia: !!r.divergencia };
}

/** Para formularios con un solo campo de nombre completo: junta nombres + apellidos del candidato. */
export function nombreUnido(d: DatosTitular): DatosTitular {
  const { apellidos, ...resto } = d;
  const nombre = `${d.nombres ?? ""} ${apellidos ?? ""}`.trim();
  return nombre ? { ...resto, nombres: nombre } : resto;
}

export type Conflicto = { campo: CampoTitularUI; actual: string; nuevo: string };

/** Vacíos se llenan solos; lo ya escrito y distinto queda como conflicto que el usuario decide. */
export function planAplicacion(actual: DatosTitular, cand: DatosTitular, campos: readonly CampoTitularUI[] = CAMPOS_TITULAR_UI): { llenar: DatosTitular; conflictos: Conflicto[] } {
  const llenar: DatosTitular = {};
  const conflictos: Conflicto[] = [];
  for (const campo of campos) {
    const nuevo = cand[campo]?.trim();
    if (!nuevo) continue;
    const hoy = (actual[campo] ?? "").trim();
    if (!hoy) llenar[campo] = nuevo;
    else if (hoy.toLowerCase() !== nuevo.toLowerCase()) conflictos.push({ campo, actual: hoy, nuevo });
  }
  return { llenar, conflictos };
}
