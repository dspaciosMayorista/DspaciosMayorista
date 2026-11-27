"use client";

import { MAX_MENSAJE_ADICIONAL } from "@/lib/solicitudProveedor/nucleo";

// H103-13: nota opcional de ESTE envío, escrita por quien envía. Va arriba de las tablas del correo estructurado; no las reemplaza ni toca el código de promoción, el proveedor, los pagos o los soportes.
export function MensajeAdicional({ id, valor, onChange }: { id: string; valor: string; onChange: (t: string) => void }) {
  const largo = valor.trim().length;
  return (
    <div>
      <label htmlFor={id} className="mb-0.5 block text-[11px] font-medium text-gray-500">Mensaje adicional para el proveedor (opcional)</label>
      <textarea id={id} value={valor} rows={3} maxLength={MAX_MENSAJE_ADICIONAL + 200} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-ayuda`}
        placeholder="Ej. Llegamos tarde: por favor confirmen el late check-in." className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
      <p id={`${id}-ayuda`} className={`text-[11px] ${largo > MAX_MENSAJE_ADICIONAL ? "text-red-600" : "text-gray-400"}`}>
        Se envía arriba de las tablas de la solicitud (no las reemplaza). Solo texto, máx. {MAX_MENSAJE_ADICIONAL} caracteres ({largo}/{MAX_MENSAJE_ADICIONAL}). Queda guardado con el mensaje enviado.
      </p>
    </div>
  );
}
