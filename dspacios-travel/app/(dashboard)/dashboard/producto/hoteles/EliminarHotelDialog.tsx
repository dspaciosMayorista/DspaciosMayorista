"use client";

import { useState } from "react";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { PaqueteVinculado, ResultadoEliminarHotel } from "@/lib/hoteles/eliminarHotel";

// Diálogo de eliminación de un hotel. Recibe la acción por props (el botón
// le pasa la Server Action) para poder probarlo sin servidor.
// Si el servidor rechaza porque el hotel está en paquetes, además del error
// muestra qué paquetes son y los pasos para liberarlo.
export function EliminarHotelDialog({
  id, nombre, eliminar,
}: {
  id: number;
  nombre: string;
  eliminar: (id: number) => Promise<ResultadoEliminarHotel>;
}) {
  const [paquetes, setPaquetes] = useState<PaqueteVinculado[] | null>(null);

  async function confirmar() {
    const r = await eliminar(id);
    if (!r.ok) setPaquetes(r.paquetes?.length ? r.paquetes : null);
    return r;
  }

  return (
    <ConfirmDialog
      title={`¿Eliminar el hotel "${nombre}"?`}
      description={paquetes ? <GuiaDesvincular paquetes={paquetes} /> : (
        "Se borrarán también sus tarifas, temporadas, fotos y documentos. Los contratos ya generados conservan su información. Esta acción no se puede deshacer."
      )}
      confirmLabel={paquetes ? "Reintentar" : "Eliminar"}
      destructive
      onConfirm={confirmar}
      trigger={
        <button type="button" onClick={() => setPaquetes(null)} className="text-xs text-gray-400 hover:text-red-500">
          Eliminar
        </button>
      }
    />
  );
}

// Va dentro de la descripción del diálogo (un <p>): solo elementos en línea.
function GuiaDesvincular({ paquetes }: { paquetes: PaqueteVinculado[] }) {
  return (
    <span className="block space-y-2" data-guia-desvincular>
      <span className="block">Para eliminarlo, en cada paquete:</span>
      <span className="block pl-3">
        1. Desmarca el hotel en &quot;Adición de hoteles&quot;.<br />
        2. Pulsa &quot;Generar / actualizar tarifario&quot;.<br />
        3. Vuelve aquí y reintenta. Si el paquete ya no se usa, también puedes eliminarlo.
      </span>
      <span role="list" className="block space-y-1">
        {paquetes.map((p) => (
          <span role="listitem" key={p.id} className="block">
            <Link href={`/dashboard/paquetes/${p.id}`} className="font-medium text-[var(--brand-accent)] hover:underline">
              {p.nombre}
            </Link>
            <span className="text-gray-500">
              {" · "}{[p.enArmado && "en el armado", p.enTarifario && "en el tarifario generado"].filter(Boolean).join(" y ")}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
