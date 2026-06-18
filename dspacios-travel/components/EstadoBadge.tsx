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
} as const;

type Tono = keyof typeof TONOS;

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
