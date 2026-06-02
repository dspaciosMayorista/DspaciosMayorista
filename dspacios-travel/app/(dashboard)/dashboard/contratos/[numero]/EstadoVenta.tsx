"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { confirmarVenta } from "../../reservar/actions";

const COLOR: Record<string, string> = {
  pendiente: "#d97706",
  confirmado: "var(--brand-success)",
  cancelado: "#9ca3af",
  activo: "var(--brand-primary)",
};

export function EstadoVenta({
  numero, estado, plazo, puedeConfirmar,
}: {
  numero: string; estado: string; plazo: string | null; puedeConfirmar: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <span className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ backgroundColor: COLOR[estado] ?? "#6b7280" }}>
        {estado === "pendiente" ? "Pendiente" : estado === "confirmado" ? "Confirmado" : estado === "cancelado" ? "Cancelado" : estado}
      </span>
      {estado === "pendiente" && plazo && (
        <span className="text-xs text-gray-500">Plazo: {plazo}</span>
      )}
      {estado === "pendiente" && puedeConfirmar && (
        <Button
          disabled={pending}
          onClick={() => start(async () => { await confirmarVenta(numero); router.refresh(); })}
          style={{ backgroundColor: "var(--brand-success)" }}
        >
          {pending ? "Confirmando…" : "Confirmar venta"}
        </Button>
      )}
    </div>
  );
}
