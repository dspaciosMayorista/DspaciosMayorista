"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { crearHotel, eliminarHotel } from "../actions";
import type { Tables } from "@/types/database";

type Hotel = Pick<Tables<"hoteles">, "id" | "nombre" | "zona" | "notas" | "activo">;

export function HotelesTab({ destinoId, hoteles }: { destinoId: number; hoteles: Hotel[] }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState("");
  const [notas, setNotas] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    startTransition(async () => {
      await crearHotel(destinoId, nombre.trim(), zona.trim() || undefined, notas.trim() || undefined);
      setNombre(""); setZona(""); setNotas("");
      setOpen(false);
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{hoteles.length} hotel{hoteles.length !== 1 ? "es" : ""} cargado{hoteles.length !== 1 ? "s" : ""}</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" style={{ backgroundColor: "var(--brand-primary)" }} />}>
            + Agregar hotel
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Nuevo hotel</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3 mt-2">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Nombre *</label>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Hotel Decameron" autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Zona / Sector</label>
                <Input value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Ej: Sarie Bay" />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Notas</label>
                <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Observaciones opcionales" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={pending || !nombre.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>
                  {pending ? "Guardando..." : "Crear hotel"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {hoteles.length === 0 ? (
        <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
          Agrega el primer hotel para este destino
        </div>
      ) : (
        <div className="grid gap-3">
          {hoteles.map((h) => (
            <HotelRow key={h.id} hotel={h} destinoId={destinoId} />
          ))}
        </div>
      )}
    </div>
  );
}

function HotelRow({ hotel, destinoId }: { hotel: Hotel; destinoId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 group">
      <div>
        <p className="font-medium text-gray-800">{hotel.nombre}</p>
        <div className="flex gap-3 mt-0.5">
          {hotel.zona && <span className="text-xs text-gray-400">{hotel.zona}</span>}
          {hotel.notas && <span className="text-xs text-gray-400 italic">{hotel.notas}</span>}
        </div>
      </div>
      <button
        onClick={() => {
          if (!confirm(`¿Eliminar hotel "${hotel.nombre}"?`)) return;
          startTransition(() => eliminarHotel(hotel.id, destinoId));
        }}
        disabled={pending}
        className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 transition-all px-2 py-1 rounded"
      >
        Eliminar
      </button>
    </div>
  );
}
