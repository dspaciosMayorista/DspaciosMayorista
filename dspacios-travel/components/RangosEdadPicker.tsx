"use client";

export type RangoEdad = { id: number; denominacion: string; edad_min: number; edad_max: number };

/** Selector múltiple (checkboxes) de rangos de edad aplicables a un componente. */
export function RangosEdadPicker({
  rangos,
  seleccionados,
  onChange,
  label = "Rangos de edad que aplican",
}: {
  rangos: RangoEdad[];
  seleccionados: number[];
  onChange: (ids: number[]) => void;
  label?: string;
}) {
  function toggle(id: number) {
    onChange(seleccionados.includes(id) ? seleccionados.filter((x) => x !== id) : [...seleccionados, id]);
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {!rangos.length ? (
        <p className="text-xs text-gray-400">
          No hay rangos creados. Agrégalos en Configuración → Rangos de edad.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rangos.map((r) => {
            const on = seleccionados.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggle(r.id)}
                className="rounded-full border px-3 py-1 text-xs transition-colors"
                style={
                  on
                    ? { borderColor: "var(--brand-accent)", backgroundColor: "rgba(38,187,217,0.12)", color: "var(--brand-primary)" }
                    : { borderColor: "#e5e7eb", color: "#6b7280" }
                }
              >
                {r.denominacion} ({r.edad_min}–{r.edad_max})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
