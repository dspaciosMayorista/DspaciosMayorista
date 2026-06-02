"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { crearTemporada, eliminarTemporada } from "../actions";

type Fecha = { id: number; fecha_inicio: string; fecha_fin: string };
type Temporada = { id: number; nombre: "ALTA" | "MEDIA" | "BAJA"; anio: number; temporada_fechas: Fecha[] };

const COLORES: Record<string, string> = {
  ALTA: "bg-red-100 text-red-700",
  MEDIA: "bg-yellow-100 text-yellow-700",
  BAJA: "bg-green-100 text-green-700",
};

export function TemporadasTab({ destinoId, temporadas }: { destinoId: number; temporadas: Temporada[] }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState<"ALTA" | "MEDIA" | "BAJA">("ALTA");
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [fechas, setFechas] = useState([{ inicio: "", fin: "" }]);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fechasValidas = fechas.filter((f) => f.inicio && f.fin);
    startTransition(async () => {
      await crearTemporada(destinoId, nombre, anio, fechasValidas);
      setFechas([{ inicio: "", fin: "" }]);
      setOpen(false);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{temporadas.length} temporada{temporadas.length !== 1 ? "s" : ""}</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" style={{ backgroundColor: "var(--brand-primary)" }} />}>
            + Agregar temporada
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Nueva temporada</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Tipo *</label>
                  <select
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value as "ALTA" | "MEDIA" | "BAJA")}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="ALTA">ALTA</option>
                    <option value="MEDIA">MEDIA</option>
                    <option value="BAJA">BAJA</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Año *</label>
                  <Input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} min={2024} max={2030} />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Rangos de fechas</label>
                  <button
                    type="button"
                    onClick={() => setFechas([...fechas, { inicio: "", fin: "" }])}
                    className="text-xs text-[#1D7C9A] hover:underline"
                  >
                    + Agregar rango
                  </button>
                </div>
                {fechas.map((f, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <Input type="date" value={f.inicio} onChange={(e) => {
                      const nf = [...fechas]; nf[i].inicio = e.target.value; setFechas(nf);
                    }} className="text-sm" />
                    <span className="text-gray-400 text-sm">→</span>
                    <Input type="date" value={f.fin} onChange={(e) => {
                      const nf = [...fechas]; nf[i].fin = e.target.value; setFechas(nf);
                    }} className="text-sm" />
                    {fechas.length > 1 && (
                      <button type="button" onClick={() => setFechas(fechas.filter((_, j) => j !== i))}
                        className="text-gray-400 hover:text-red-500 text-xs px-1">✕</button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={pending} style={{ backgroundColor: "var(--brand-primary)" }}>
                  {pending ? "Guardando..." : "Crear temporada"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {temporadas.length === 0 ? (
        <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
          Agrega las temporadas (Alta, Media, Baja) con sus rangos de fechas
        </div>
      ) : (
        <div className="grid gap-3">
          {temporadas.map((t) => (
            <TemporadaRow key={t.id} temporada={t} destinoId={destinoId} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemporadaRow({ temporada, destinoId }: { temporada: Temporada; destinoId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-start justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 group">
      <div className="flex items-start gap-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mt-0.5 ${COLORES[temporada.nombre]}`}>
          {temporada.nombre}
        </span>
        <div>
          <p className="text-sm font-medium text-gray-700">{temporada.anio}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {temporada.temporada_fechas.map((f) => (
              <span key={f.id} className="text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded">
                {new Date(f.fecha_inicio + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
                {" → "}
                {new Date(f.fecha_fin + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short" })}
              </span>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => {
          if (!confirm("¿Eliminar esta temporada y sus fechas?")) return;
          startTransition(() => eliminarTemporada(temporada.id, destinoId));
        }}
        disabled={pending}
        className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 transition-all px-2 py-1 rounded"
      >
        Eliminar
      </button>
    </div>
  );
}
