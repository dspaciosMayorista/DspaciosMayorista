"use client";
// Piezas de formulario compartidas por el montaje del paquete dinámico (#82): etiquetas, estilos y la rejilla de precios por acomodación.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACOMS_DIN, type AcomDin, type PrecioAcom } from "@/lib/paqueteDinamico/calculo";

export const ETQ: Record<AcomDin, string> = { sencilla: "Sencilla", doble: "Doble", triple: "Triple", multiple: "Múltiple", nino: "Niño 1", nino2: "Niño 2", infante: "Infante" };
export const ACOMS_SOLO_ADULTOS: readonly AcomDin[] = ["sencilla", "doble", "triple", "multiple"];
export const sel = "h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm";
export const lbl = "mb-1 block text-xs font-medium text-gray-600";
export const n = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[^\d.-]/g, "")));

export function GridAcom({ valor, onChange, etiqueta, solo }: { valor: PrecioAcom; onChange: (v: PrecioAcom) => void; etiqueta: string; solo?: readonly AcomDin[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(solo ?? ACOMS_DIN).map((a) => (
        <div key={a} className="min-w-0">
          <label className={lbl}>{etiqueta} · {ETQ[a]}</label>
          <Input inputMode="numeric" aria-label={`${etiqueta} ${ETQ[a]}`} value={valor[a] == null ? "" : String(valor[a])} onChange={(e) => onChange({ ...valor, [a]: n(e.target.value) })} />
        </div>
      ))}
    </div>
  );
}

/** Ventana emergente de edición (hotel, vuelo, servicio): edita una COPIA; «Guardar cambios» la aplica; «Cancelar», Escape, clic fuera y la X la descartan. */
export function Ventana({ abierta, titulo, descripcion, onCancelar, onGuardar, children, testid = "ventana-hotel" }: {
  abierta: boolean; titulo: string; descripcion: string; onCancelar: () => void; onGuardar: () => void; children: React.ReactNode; testid?: string;
}) {
  return (
    <Dialog open={abierta} onOpenChange={(o) => { if (!o) onCancelar(); }}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] overflow-y-auto overflow-x-hidden sm:max-w-2xl" data-testid={testid}>
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-semibold">{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">{children}</div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancelar}>Cancelar</Button>
          <Button type="button" onClick={onGuardar} style={{ backgroundColor: "var(--brand-primary)" }}>Guardar cambios</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
