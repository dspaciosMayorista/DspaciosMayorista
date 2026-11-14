"use client";

import { useEffect, useRef } from "react";

// Escape en las ventanas PROPIAS (capas `fixed inset-0` hechas a mano). Los diálogos compartidos (`components/ui/dialog.tsx`,
// base-ui) ya cierran con Escape por su cuenta. Reglas:
//  · Escape hace EXACTAMENTE lo que la X / «Cancelar» de la ventana: se le pasa ese mismo manejador, así conserva sus
//    protecciones (confirmar cambios sin guardar, etc.).
//  · Solo cierra la capa SUPERIOR: las capas propias abiertas forman una pila; y si encima se abrió un popup de base-ui
//    (diálogo, popover, menú, lista), Escape es de ese popup.
//  · `bloqueado` (p. ej. mientras se guarda, cuando «Cancelar» está deshabilitado): Escape no hace nada.
//  · Un control que ya usó Escape (una lista desplegable que se cierra) lo marca con preventDefault / stopPropagation: no cierra.
// shortcut: la pila sigue el orden de APERTURA; dos capas anidadas que se montaran en el mismo render quedarían invertidas (React
// corre primero el efecto de la interior). En la app cada capa se abre con un clic desde la de abajo; revisar si eso cambia.
const pila: symbol[] = [];
const POPUPS_BASE_UI = '[data-open]:is([role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"])';
const popupsAbiertos = () => document.querySelectorAll(POPUPS_BASE_UI).length;

export function useEscapeCerrar(abierto: boolean, cerrar: () => void, bloqueado = false): void {
  const actual = useRef({ cerrar, bloqueado });
  useEffect(() => { actual.current = { cerrar, bloqueado }; });
  useEffect(() => {
    if (!abierto) return;
    const id = Symbol("capa");
    pila.push(id);
    const popupsAlAbrir = popupsAbiertos();
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (pila[pila.length - 1] !== id) return;          // hay otra capa propia encima
      if (popupsAbiertos() > popupsAlAbrir) return;       // un popup de base-ui abierto después está encima
      if (actual.current.bloqueado) return;
      e.preventDefault();
      actual.current.cerrar();
    };
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      const i = pila.indexOf(id);
      if (i >= 0) pila.splice(i, 1);
    };
  }, [abierto]);
}
