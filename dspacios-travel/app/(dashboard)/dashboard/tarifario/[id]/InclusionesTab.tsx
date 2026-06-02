"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearInclusion, eliminarInclusion } from "../actions";

type Inclusion = { id: number; tipo: string; texto: string; orden: number };

export function InclusionesTab({ destinoId, inclusiones }: { destinoId: number; inclusiones: Inclusion[] }) {
  const [texto, setTexto] = useState("");
  const [tipo, setTipo] = useState<"incluye" | "no_incluye">("incluye");
  const [pending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    startTransition(async () => {
      await crearInclusion(destinoId, tipo, texto.trim());
      setTexto("");
    });
  }

  const incluye = inclusiones.filter((i) => i.tipo === "incluye");
  const noIncluye = inclusiones.filter((i) => i.tipo === "no_incluye");

  return (
    <div className="max-w-2xl space-y-6">
      <form onSubmit={handleAdd} className="flex gap-2">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "incluye" | "no_incluye")}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white shrink-0"
        >
          <option value="incluye">✓ Incluye</option>
          <option value="no_incluye">✗ No incluye</option>
        </select>
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej: Tiquetes aéreos, Traslados aeropuerto/hotel/aeropuerto..."
          className="flex-1"
        />
        <Button type="submit" disabled={pending || !texto.trim()} style={{ backgroundColor: "var(--brand-primary)" }}>
          Agregar
        </Button>
      </form>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-[#66B596] mb-3 flex items-center gap-1">
            <span>✓</span> Incluye
          </h3>
          <ul className="space-y-2">
            {incluye.length === 0 ? (
              <li className="text-sm text-gray-400 italic">Sin items</li>
            ) : incluye.map((i) => (
              <InclusionItem key={i.id} item={i} destinoId={destinoId} />
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-1">
            <span>✗</span> No incluye
          </h3>
          <ul className="space-y-2">
            {noIncluye.length === 0 ? (
              <li className="text-sm text-gray-400 italic">Sin items</li>
            ) : noIncluye.map((i) => (
              <InclusionItem key={i.id} item={i} destinoId={destinoId} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function InclusionItem({ item, destinoId }: { item: { id: number; texto: string }; destinoId: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-start justify-between gap-2 text-sm text-gray-700 group">
      <span>{item.texto}</span>
      <button
        onClick={() => startTransition(() => eliminarInclusion(item.id, destinoId))}
        disabled={pending}
        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-xs shrink-0 transition-all"
      >
        ✕
      </button>
    </li>
  );
}
