// Stub de "components/ui/DateInput.tsx" SOLO para las pruebas de interacción
// React que montan componentes que lo importan pero no lo prueban
// (DifusionClient, PagosList). El real arrastra "react-day-picker" (no está en
// node_modules en el entorno de pruebas) y "@base-ui/react"; aquí basta un
// <input> controlado que propague `onValueChange`. Nunca se interactúa con él
// en estas pruebas.
import React from "react";
export function DateInput({ value = "", onValueChange, className, ...rest }) {
  return React.createElement("input", {
    ...rest,
    type: "text",
    className,
    value,
    onChange: (e) => onValueChange?.(e.target.value),
  });
}