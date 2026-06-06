"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cargarDestinosSugeridos } from "../../tarifario/actions";

// Botón que carga de una lista curada de destinos famosos (Colombia, R. Dominicana,
// México) con su código IATA. Omite los que ya existan; no duplica.
export function CargarDestinosSugeridos() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function cargar() {
    if (!confirm("¿Cargar destinos sugeridos (Colombia, R. Dominicana y México)? No duplica los que ya tengas.")) return;
    setMsg("");
    start(async () => {
      try {
        const r = await cargarDestinosSugeridos();
        setMsg(`✓ ${r.insertados} agregados${r.omitidos ? ` · ${r.omitidos} ya existían` : ""}`);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Error al cargar.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={cargar} disabled={pending}>
        {pending ? "Cargando…" : "Cargar sugeridos"}
      </Button>
      {msg && <span className={msg.startsWith("✓") ? "text-sm text-green-600" : "text-sm text-red-600"}>{msg}</span>}
    </div>
  );
}
