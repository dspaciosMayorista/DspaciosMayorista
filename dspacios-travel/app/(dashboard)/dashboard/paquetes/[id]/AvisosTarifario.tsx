"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { separarAvisos } from "@/lib/paquetes/avisosTarifario";

/** Detalle de los avisos de «Generar tarifario» para el operador, en secciones; el encabezado solo muestra el resumen. */
export function AvisosTarifario({ aviso, abierto, onCerrar }: { aviso: string | null | undefined; abierto: boolean; onCerrar: () => void }) {
  const secciones = separarAvisos(aviso);
  return (
    <Dialog open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="panel-avisos">
        <DialogHeader>
          <DialogTitle>Avisos del tarifario</DialogTitle>
          <DialogDescription>Qué se publicó con restricciones y qué conviene revisar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {secciones.length === 0 && <p className="text-gray-500">Sin avisos.</p>}
          {secciones.map((s) => (
            <section key={s.id} data-testid={`avisos-${s.id}`}>
              <h3 className="mb-1 font-semibold text-gray-800">{s.titulo}</h3>
              <div className="space-y-2">
                {s.bloques.map((b, i) => (
                  <div key={i} className="min-w-0 break-words text-gray-700">
                    <p>{b.resumen}</p>
                    {b.items.length > 0 && (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {b.items.map((it, j) => <li key={j} className="break-words">{it}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
