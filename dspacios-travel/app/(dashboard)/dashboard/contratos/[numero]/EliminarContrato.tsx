"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { eliminarContrato } from "./admin-actions";
import { esNumeroReciclable } from "@/lib/contrato/reciclaje";

// Solo superadmin. Borra el contrato; opción de reusar el consecutivo (solo
// para contratos que no sean DTM-).
export function EliminarContrato({ numero }: { numero: string }) {
  const router = useRouter();
  const reciclable = esNumeroReciclable(numero);
  const [open, setOpen] = useState(false);
  const [reusar, setReusar] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  function borrar() {
    setErr("");
    start(async () => {
      const r = await eliminarContrato(numero, reciclable && reusar);
      if (r.ok) router.push("/dashboard/contratos");
      else setErr(r.error ?? "No se pudo eliminar.");
    });
  }

  return (
    <section className="mt-6 rounded-2xl border border-red-200 bg-red-50/40 p-5">
      <h2 className="text-sm font-semibold text-red-700">Zona de superadmin</h2>
      <p className="mt-1 text-xs text-gray-500">Eliminar el contrato borra sus pagos, CxP, sillas (se liberan) y documentos. No se puede deshacer.</p>
      {!open ? (
        <Button variant="outline" className="mt-3 text-red-600" onClick={() => setOpen(true)}>Eliminar contrato</Button>
      ) : (
        <div className="mt-3 space-y-3">
          {reciclable ? (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={reusar} onChange={(e) => setReusar(e.target.checked)} />
              Reusar el consecutivo <span className="text-gray-400">(el próximo contrato tomará el número {numero})</span>
            </label>
          ) : (
            <p className="text-xs text-gray-400">Los contratos DTM- (mayorista) no reciclan su número — cada uno sale de un consecutivo propio.</p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={borrar} disabled={pending} style={{ backgroundColor: "#dc2626" }}>
              {pending ? "Eliminando…" : `Eliminar ${numero} definitivamente`}
            </Button>
            <button type="button" className="text-sm text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Cancelar</button>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      )}
    </section>
  );
}
