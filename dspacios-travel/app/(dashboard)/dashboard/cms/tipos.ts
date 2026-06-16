import type { Database } from "@/types/database";

export type PaginaRow = Database["public"]["Tables"]["web_paginas"]["Row"];
export type SeccionRow = Database["public"]["Tables"]["web_secciones"]["Row"];

// Página con sus secciones (ordenadas) — lo que carga el server y maneja el CMS.
export type PaginaConSecciones = PaginaRow & {
  secciones: SeccionRow[];
};

// Nodo de árbol: página + sus hijas anidadas (para el panel izquierdo).
export type PaginaNodo = PaginaConSecciones & {
  hijos: PaginaNodo[];
};
