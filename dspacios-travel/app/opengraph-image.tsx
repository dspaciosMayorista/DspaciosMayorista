import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Imagen de previsualización al compartir el link (WhatsApp, redes, etc.).
// Marca D'spacios: logo blanco sobre el degradado oficial, 1200×630.
export const alt = "D'spacios Travel — Mayorista de Turismo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logo = await readFile(join(process.cwd(), "public/marca/logo-white.png"));
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: "linear-gradient(135deg, #1D7C9A 0%, #26BBD9 55%, #66B596 100%)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={640} alt="D'spacios Travel" />
        <div
          style={{
            marginTop: 28,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: 8,
            color: "#ffffff",
          }}
        >
          MAYORISTA DE TURISMO
        </div>
      </div>
    ),
    { ...size }
  );
}
