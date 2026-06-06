"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearDestino } from "./actions";

export function NuevoDestinoDialog() {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [iata, setIata] = useState("");
  const [pais, setPais] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setError("");
    startTransition(async () => {
      try {
        await crearDestino(nombre.trim(), iata.trim() || undefined, pais.trim() || undefined);
        setNombre("");
        setIata("");
        setPais("");
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al crear destino");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button style={{ backgroundColor: "var(--brand-primary)" }} />}>
        + Nuevo destino
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo destino</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Nombre *</label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: San Andrés Islas"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Código IATA</label>
            <Input
              value={iata}
              onChange={(e) => setIata(e.target.value.toUpperCase())}
              placeholder="Ej: ADZ"
              maxLength={4}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">País</label>
            <Input
              value={pais}
              onChange={(e) => setPais(e.target.value)}
              placeholder="Ej: Colombia"
              list="paises-sugeridos"
            />
            <datalist id="paises-sugeridos">
              {["Colombia", "República Dominicana", "México", "Panamá", "Aruba", "Curazao", "Cuba", "Brasil", "Perú", "España", "Estados Unidos"].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !nombre.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>
              {pending ? "Guardando..." : "Crear destino"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
