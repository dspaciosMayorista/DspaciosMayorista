// Render del correo a partir de campos AMIGABLES (sin que el usuario escriba HTML).
// El mensaje se escribe como texto normal; aquí se arma el HTML del email (tablas
// + estilos en línea para máxima compatibilidad). Pura → se usa en el preview
// (cliente) y al enviar (servidor).

export type EmailContenido = {
  asunto?: string;
  mensaje: string;                 // texto normal del usuario
  imagenUrl?: string | null;       // flyer / imagen
  botonTexto?: string | null;
  botonUrl?: string | null;
  remitenteNombre?: string | null; // marca en la cabecera
};

const PRIMARY = "#1D7C9A";

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Texto normal → párrafos HTML (respeta saltos de línea, sin que el user sepa HTML).
function textoAParrafos(s: string): string {
  const bloques = s.replace(/\r/g, "").split(/\n{2,}/).filter((b) => b.trim() !== "");
  if (!bloques.length) return "";
  return bloques
    .map((b) => `<p style="margin:0 0 14px;line-height:1.6">${escapar(b).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function renderEmailHtml(c: EmailContenido, firma?: string | null): string {
  const marca = escapar(c.remitenteNombre || "D'spacios Travel");
  const cuerpo = textoAParrafos(c.mensaje || "");
  const img = c.imagenUrl
    ? `<tr><td style="padding:0"><img src="${escapar(c.imagenUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto"/></td></tr>`
    : "";
  const boton = c.botonTexto && c.botonUrl
    ? `<tr><td style="padding:8px 28px 24px"><a href="${escapar(c.botonUrl)}" style="display:inline-block;background:${PRIMARY};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${escapar(c.botonTexto)}</a></td></tr>`
    : "";
  const pie = firma ? `<div style="color:#888;font-size:12px">${firma}</div>` : "";

  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;padding:16px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr><td style="background:${PRIMARY};color:#fff;padding:16px 28px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700">${marca}</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:0 0 12px 12px;overflow:hidden">
    ${img}
    <tr><td style="padding:24px 28px 6px;color:#333;font-size:15px">${cuerpo}</td></tr>
    ${boton}
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #eee">${pie}</td></tr>
  </table>
  </body></html>`;
}
