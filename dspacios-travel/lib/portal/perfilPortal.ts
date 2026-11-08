/**
 * #25 — «Mi perfil» del aliado (agencia / freelance). Lógica pura.
 *
 * `CAMPOS_PERFIL` es la TABLA DE POLÍTICA: quién puede qué sobre cada dato. Esta entrega solo habilita CONSULTA;
 * ningún campo se escribe desde el portal todavía. «editable_propuesto» y «aprobacion» son CLASIFICACIÓN PROPUESTA: no existe
 * ningún circuito de aprobación implementado ni se muestra al aliado; hasta aprobar la lista exacta de campos y validaciones,
 * cualquier cambio lo hace el personal interno a petición del aliado. Agencia y freelance son tipos de aliado (`usuarios.rol`); no se
 * relacionan con mayorista/minorista, que es la agencia interna dueña del contrato (`tenant`).
 */
export type Quien = "consulta" | "editable_propuesto" | "aprobacion" | "interno";
export type TipoAliado = "agencia" | "freelance";

export type CampoPolitica = { id: string; etiqueta: string; quien: Quien; aplica: "ambos" | TipoAliado; nota?: string };

export const CAMPOS_PERFIL: CampoPolitica[] = [
  // Consultables (se muestran hoy, solo lectura)
  { id: "tipo", etiqueta: "Tipo de aliado", quien: "interno", aplica: "ambos", nota: "Lo define el rol; no se cambia desde el portal." },
  { id: "email_acceso", etiqueta: "Correo de acceso", quien: "aprobacion", aplica: "ambos", nota: "Cambiarlo afecta el inicio de sesión." },
  { id: "nombre", etiqueta: "Nombre o razón social", quien: "aprobacion", aplica: "ambos", nota: "Identidad: el acceso heredado y los contratos antiguos se resolvían por nombre." },
  { id: "documento", etiqueta: "Tipo y número de documento", quien: "aprobacion", aplica: "ambos", nota: "Vincula la ficha con sus contratos y comisiones." },
  { id: "contacto", etiqueta: "Persona de contacto", quien: "editable_propuesto", aplica: "agencia" },
  { id: "telefono", etiqueta: "Teléfono", quien: "editable_propuesto", aplica: "ambos" },
  { id: "email_contacto", etiqueta: "Correo de contacto (ficha)", quien: "editable_propuesto", aplica: "ambos" },
  { id: "direccion", etiqueta: "Dirección", quien: "editable_propuesto", aplica: "ambos" },
  { id: "banco", etiqueta: "Datos bancarios (banco, tipo y cuenta)", quien: "aprobacion", aplica: "ambos", nota: "Destino de pagos de comisión: cambio con autorización explícita." },
  { id: "categoria", etiqueta: "Categoría y % de comisión", quien: "interno", aplica: "ambos", nota: "Se muestra como consulta." },
  { id: "retencion", etiqueta: "Retención aplicable", quien: "interno", aplica: "ambos" },
  { id: "rol_activo_tenant", etiqueta: "Rol, estado activo y agencia interna (tenant)", quien: "interno", aplica: "ambos" },
  { id: "acceso_legacy", etiqueta: "Acceso heredado por nombre", quien: "interno", aplica: "ambos" },
  { id: "vinculo_ficha", etiqueta: "Vínculo con la ficha del catálogo (aliado_id)", quien: "interno", aplica: "ambos" },
  { id: "agentes", etiqueta: "Agentes de la agencia", quien: "consulta", aplica: "agencia", nota: "Ya existe en la pestaña Agentes; no aplica a freelance." },
];

export type PerfilFila = { nombre: string | null; email: string | null; rol: string | null; pct_comision: number | null };
export type AliadoFicha = {
  nombre: string | null; nit: string | null; tipo_documento: string | null; contacto: string | null; email: string | null; telefono: string | null;
  direccion: string | null; banco: string | null; tipo_cuenta: string | null; numero_cuenta: string | null;
  aplica_retencion: boolean | null; pct_retencion: number | string | null;
} | null;

export type ItemPerfil = { id: string; etiqueta: string; valor: string | null; nota?: string };
export type PerfilPortal = { tipo: TipoAliado; titulo: string; grupos: { titulo: string; items: ItemPerfil[] }[]; sinFicha: boolean };

const t = (x: unknown): string | null => { const v = typeof x === "string" ? x.trim() : ""; return v ? v : null; };

/** Cuenta enmascarada: solo los últimos 4 dígitos. El número completo no sale al navegador. */
export function enmascararCuenta(c: string | null | undefined): string | null {
  const d = (c ?? "").replace(/\s+/g, "");
  if (!d) return null;
  return d.length <= 4 ? "••••" : `•••• ${d.slice(-4)}`;
}

export function armarPerfil(perfil: PerfilFila, ficha: AliadoFicha, tipo: TipoAliado, pctRetencionVisible = true): PerfilPortal {
  const ag = tipo === "agencia";
  const documento = ficha ? [t(ficha.tipo_documento), t(ficha.nit)].filter(Boolean).join(" ") || null : null;
  const banco = ficha ? [t(ficha.banco), t(ficha.tipo_cuenta), enmascararCuenta(ficha.numero_cuenta)].filter(Boolean).join(" · ") || null : null;
  const ret = ficha?.aplica_retencion ? (pctRetencionVisible && ficha.pct_retencion != null ? `Aplica (${(Number(ficha.pct_retencion) * 100).toFixed(2).replace(/\.00$/, "")} %)` : "Aplica") : ficha ? "No aplica" : null;
  const grupos = [
    { titulo: ag ? "Datos de la agencia" : "Datos del freelance", items: [
      { id: "nombre", etiqueta: ag ? "Razón social" : "Nombre", valor: t(perfil.nombre) ?? t(ficha?.nombre) },
      { id: "documento", etiqueta: "Documento", valor: documento },
      ...(ag ? [{ id: "contacto", etiqueta: "Persona de contacto", valor: t(ficha?.contacto) }] : []),
      { id: "direccion", etiqueta: "Dirección", valor: t(ficha?.direccion) },
    ] },
    { titulo: "Contacto", items: [
      { id: "email_acceso", etiqueta: "Correo de acceso", valor: t(perfil.email) },
      { id: "email_contacto", etiqueta: "Correo de contacto", valor: t(ficha?.email) },
      { id: "telefono", etiqueta: "Teléfono", valor: t(ficha?.telefono) },
    ] },
    { titulo: "Pagos de comisión", items: [
      { id: "banco", etiqueta: "Cuenta de pago", valor: banco, nota: "Para cambiarla, contacta a tu asesor." },
      { id: "retencion", etiqueta: "Retención", valor: ret },
    ] },
  ];
  return { tipo, titulo: ag ? "Perfil de agencia" : "Perfil de freelance", grupos, sinFicha: !ficha };
}
