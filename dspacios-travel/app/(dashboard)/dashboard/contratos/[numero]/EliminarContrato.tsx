"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { eliminarContrato, previsualizarReuso } from "./admin-actions";
import type { IdentidadContrato } from "@/lib/contrato/identidad";
import { reusoSujetoAElegibilidad } from "@/lib/contrato/reciclaje";

// Solo superadmin. Borra el contrato; opción de reusar el consecutivo.
// · Minorista: sin condiciones (como siempre).
// · Mayorista (DTM-): solo si el contrato está pendiente, nunca se confirmó y está vacío salvo por el titular.
//   La base lo decide y lo vuelve a comprobar al eliminar; aquí se muestra la vista previa y los motivos.
export function EliminarContrato({ numero, identidad }: { numero: string; identidad: IdentidadContrato }) {
  const router = useRouter();
  const sujeto = reusoSujetoAElegibilidad(numero);
  const [open, setOpen] = useState(false);
  const [reusar, setReusar] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [motivosError, setMotivosError] = useState<string[]>([]);
  const [prev, setPrev] = useState<{ cargando: boolean; elegible: boolean; motivos: string[] }>({ cargando: false, elegible: !sujeto, motivos: [] });

  useEffect(() => {
    if (!open || !sujeto) return;
    let vivo = true;
    setPrev({ cargando: true, elegible: false, motivos: [] });
    previsualizarReuso(numero).then((r) => {
      if (!vivo) return;
      // Ante lectura fallida o respuesta no válida: NO elegible (falla cerrado).
      setPrev({ cargando: false, elegible: r.ok && r.motivos.length === 0, motivos: r.motivos });
      if (!(r.ok && r.motivos.length === 0)) setReusar(false);
    });
    return () => { vivo = false; };
  }, [open, sujeto, numero]);

  function borrar() {
    setErr(""); setMotivosError([]);
    start(async () => {
      const r = await eliminarContrato(numero, reusar, identidad);
      if (r.ok) router.push("/dashboard/contratos");
      else { setErr(r.error ?? "No se pudo eliminar."); setMotivosError(r.motivos ?? []); }
    });
  }

  const puedeReusar = !sujeto || (prev.elegible && !prev.cargando);

  return (
    <section className="mt-6 rounded-2xl border border-red-200 bg-red-50/40 p-5">
      <h2 className="text-sm font-semibold text-red-700">Zona de superadmin</h2>
      <p className="mt-1 text-xs text-gray-500">Eliminar el contrato borra sus pagos, CxP, sillas (se liberan) y documentos. No se puede deshacer.</p>
      {!open ? (
        <Button variant="outline" className="mt-3 text-red-600" onClick={() => setOpen(true)}>Eliminar contrato</Button>
      ) : (
        <div className="mt-3 space-y-3">
          <label className={`flex items-center gap-2 text-sm ${puedeReusar ? "text-gray-700" : "text-gray-400"}`}>
            <input type="checkbox" checked={reusar} disabled={!puedeReusar} onChange={(e) => setReusar(e.target.checked)} />
            Reusar el consecutivo <span className="text-gray-400">(el próximo contrato tomará el número {numero})</span>
          </label>
          {sujeto && prev.cargando && <p className="text-xs text-gray-400">Comprobando si el consecutivo se puede reutilizar…</p>}
          {sujeto && !prev.cargando && prev.elegible && (
            <p className="text-xs text-gray-500">Este contrato está pendiente, nunca se confirmó y está vacío salvo por el titular: su consecutivo se puede reutilizar. El historial técnico del número se conserva para consulta interna.</p>
          )}
          {sujeto && !prev.cargando && !prev.elegible && (
            <div className="text-xs text-gray-500">
              <p>El consecutivo de este contrato DTM- no se puede reutilizar:</p>
              <ul className="mt-1 list-disc pl-5">{prev.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
              <p className="mt-1">Aun así puedes eliminar el contrato; su número no volverá a usarse.</p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={borrar} disabled={pending || (sujeto && prev.cargando)} style={{ backgroundColor: "#dc2626" }}>
              {pending ? "Eliminando…" : `Eliminar ${numero} definitivamente`}
            </Button>
            <button type="button" className="text-sm text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Cancelar</button>
          </div>
          {err && (
            <div className="text-sm text-red-600">
              <p>{err}</p>
              {motivosError.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{motivosError.map((m) => <li key={m}>{m}</li>)}</ul>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
