// Badge de estado reutilizable (lenguaje "Blueprint": pastilla con borde fino,
// radio moderado y color semántico). Infiere el tono del texto del estado:
//   confirmado/pagado/disponible/activo  → verde (ok)
//   pendiente/en plazo/borrador/proceso   → ámbar (warn)
//   cancelado/vencido/crítico/devuelta…   → rojo (crit)
//   otros                                  → neutro
const TONOS = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  crit: "border-red-200 bg-red-50 text-red-700",
  neutral: "border-gray-300 bg-gray-100 text-gray-600",
  // Tono EXPLÍCITO únicamente — `inferir()` nunca lo devuelve, así que solo
  // aparece cuando un llamador lo pide a propósito (ver lib/vuelos/control.ts,
  // tonoEstadoEmision/tonoEstadoPago): un estado "sin dato real" (null,
  // inválido, "Por confirmar") no debe leerse como éxito. `inferir()` clasificaba
  // "Por confirmar" como verde (`ok`) solo por contener "confirm" — visualmente
  // indistinguible de Emitido/Pagado.
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  // Tono EXPLÍCITO únicamente (igual criterio que `orange`) — informativo, ni
  // éxito ni alerta. Usado por `tonoModalidadControl("sistema")` en
  // lib/vuelos/control.ts: una tarifa de Sistema no es "buena" ni "mala", es
  // un tipo de modalidad distinto de Serie/Grupo.
  info: "border-teal-200 bg-teal-50 text-teal-700",
} as const;

export type Tono = keyof typeof TONOS;

function inferir(estado: string): Tono {
  const e = estado.toLowerCase();
  if (/(confirm|pagad|disponible|activ|aprob|emitid|vigente)/.test(e)) return "ok";
  if (/(pend|plazo|proceso|borrador|revisar|entrante)/.test(e)) return "warn";
  if (/(cancel|vencid|critic|rechaz|anul|devuelt|no_vend|no vend)/.test(e)) return "crit";
  return "neutral";
}

export function EstadoBadge({ estado, tono, className = "" }: { estado: string | null | undefined; tono?: Tono; className?: string }) {
  const txt = (estado ?? "").toString().trim();
  if (!txt) return <span className="text-xs text-gray-400">—</span>;
  const t = tono ?? inferir(txt);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${TONOS[t]} ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {txt.replace(/_/g, " ")}
    </span>
  );
}
