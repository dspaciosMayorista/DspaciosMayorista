#!/usr/bin/env python3
"""Extrae el isotipo (avión + espiral) de los logos oficiales D'spacios Travel.

Contexto (ver docs/marca/README.md): el isotipo NO existe como archivo de
marca aparte — solo aparece fusionado dentro del lettering, reemplazando la
letra "O" de "D'SPACIOS" en public/marca/logo-{full,black,white}.png. Este
script lo AISLA por selección de píxeles sobre el canal alfa (equivalente a
"varita mágica" en un editor de imágenes) — nunca redibuja ni reconstruye
ningún trazo.

Requiere: Pillow y NumPy (`pip install pillow numpy`).

Uso (desde la raíz de dspacios-travel/):
    python scripts/marca/extraer_isotipo.py

Regenera public/marca/isotipo-{full,black,white}.png a partir de los
logo-*.png actuales.

⚠️ Supuestos válidos SOLO para el lockup actual (logo-*.png de ~1400px de
ancho, "D'SPACIOS" en la fila superior, marca a la derecha de "CI" y antes de
la "S" final): la ventana de búsqueda (`x0`) y los umbrales de forma que
distinguen la marca de las letras "I"/"S" vecinas (`UMBRAL_LETRA_I_ANCHO`/
`UMBRAL_LETRA_I_ALTO`) están calibrados a esa geometría. Si el logo oficial
cambia de diseño o resolución, hay que re-verificar visualmente el resultado
(este script imprime las componentes conservadas/descartadas para poder
revisarlo) antes de confiar en la salida — no es un mecanismo genérico de
"quitar letras de cualquier logo".
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

RAIZ = Path(__file__).resolve().parents[2]  # dspacios-travel/
MARCA_DIR = RAIZ / "public" / "marca"

# Umbral de alfa para considerar un pixel "sólido" (no fondo transparente).
UMBRAL_ALFA = 60
# Componentes con menos píxeles que esto se descartan como ruido de
# antialiasing (evita fragmentos sueltos de 1-2px que a veces sobreviven en
# los bordes de las letras).
MIN_PIXELES_COMPONENTE = 300
# Ventana de búsqueda: fracción del alto (franja superior donde vive
# "D'SPACIOS") y columna inicial en X (excluye la "D"/"'"/"S"/"P"/"A"/"C"
# iniciales, deja solo "I" + marca + "S" final en el universo de búsqueda).
FRACCION_ALTO_BUSQUEDA = 0.55
X0_BUSQUEDA = 924
# La letra "I" es una barra angosta y alta — se distingue de los tramos de
# la marca (más anchos y bajos) por su bounding box.
UMBRAL_LETRA_I_ANCHO = 40
UMBRAL_LETRA_I_ALTO = 100
# Margen (en px, a esta resolución de ~1400px de ancho) alrededor del
# bounding box de la marca antes de recortar.
MARGEN_RECORTE = 14

VARIANTES = {
    "logo-full.png": "isotipo-full.png",
    "logo-black.png": "isotipo-black.png",
    "logo-white.png": "isotipo-white.png",
}


def _componentes_conectadas(mascara: np.ndarray) -> list[dict]:
    """8-conectividad sobre una máscara booleana 2D. Devuelve, por
    componente, su lista de píxeles (fila, columna)."""
    alto, ancho = mascara.shape
    visitado = np.zeros_like(mascara, dtype=bool)
    componentes = []
    for y in range(alto):
        for x in range(ancho):
            if mascara[y, x] and not visitado[y, x]:
                pixeles = [(y, x)]
                visitado[y, x] = True
                cola = deque([(y, x)])
                while cola:
                    cy, cx = cola.popleft()
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            if dy == 0 and dx == 0:
                                continue
                            ny, nx = cy + dy, cx + dx
                            if (
                                0 <= ny < alto
                                and 0 <= nx < ancho
                                and mascara[ny, nx]
                                and not visitado[ny, nx]
                            ):
                                visitado[ny, nx] = True
                                cola.append((ny, nx))
                                pixeles.append((ny, nx))
                componentes.append({"pixeles": pixeles})
    return componentes


def _bbox(pixeles: list[tuple[int, int]]) -> tuple[int, int, int, int]:
    ys = [p[0] for p in pixeles]
    xs = [p[1] for p in pixeles]
    return min(xs), min(ys), max(xs), max(ys)


def extraer_isotipo(nombre_logo: str, nombre_salida: str) -> None:
    ruta_entrada = MARCA_DIR / nombre_logo
    imagen = Image.open(ruta_entrada).convert("RGBA")
    arr = np.array(imagen)
    alfa = arr[:, :, 3]
    alto, ancho = alfa.shape

    y0, y1 = 0, int(alto * FRACCION_ALTO_BUSQUEDA)
    x0, x1 = X0_BUSQUEDA, ancho
    mascara_solida = alfa > UMBRAL_ALFA
    ventana = np.zeros_like(mascara_solida)
    ventana[y0:y1, x0:x1] = mascara_solida[y0:y1, x0:x1]

    componentes = [
        c for c in _componentes_conectadas(ventana) if len(c["pixeles"]) > MIN_PIXELES_COMPONENTE
    ]
    for c in componentes:
        c["bbox"] = _bbox(c["pixeles"])

    # Letra "I": barra angosta y alta.
    ids_letras = {
        i
        for i, c in enumerate(componentes)
        if (c["bbox"][2] - c["bbox"][0]) < UMBRAL_LETRA_I_ANCHO
        and (c["bbox"][3] - c["bbox"][1]) > UMBRAL_LETRA_I_ALTO
    }
    # Letra "S" final: la componente cuyo borde derecho llega más lejos que
    # todas las demás (la marca + el avión nunca se extienden tan a la
    # derecha como la última letra del lockup).
    idx_mas_a_la_derecha = max(range(len(componentes)), key=lambda i: componentes[i]["bbox"][2])
    ids_letras.add(idx_mas_a_la_derecha)

    pixeles_marca: list[tuple[int, int]] = []
    for i, c in enumerate(componentes):
        estado = "LETRA (descartada)" if i in ids_letras else "marca (conservada)"
        print(f"  [{nombre_logo}] componente {i}: bbox={c['bbox']} px={len(c['pixeles'])} -> {estado}")
        if i not in ids_letras:
            pixeles_marca.extend(c["pixeles"])

    if not pixeles_marca:
        raise RuntimeError(f"{nombre_logo}: no se encontró ninguna componente de marca — revisar umbrales")

    minx, miny, maxx, maxy = _bbox(pixeles_marca)
    salida = np.zeros_like(arr)
    ys = np.array([p[0] for p in pixeles_marca])
    xs = np.array([p[1] for p in pixeles_marca])
    salida[ys, xs] = arr[ys, xs]

    recorte = salida[max(0, miny - MARGEN_RECORTE) : maxy + MARGEN_RECORTE, max(0, minx - MARGEN_RECORTE) : maxx + MARGEN_RECORTE]
    recorte_img = Image.fromarray(recorte)

    # Lienzo cuadrado centrado — para que el spinner no distorsione el mark
    # al forzarlo a una caja 1:1.
    ancho_recorte, alto_recorte = recorte_img.size
    lado = max(ancho_recorte, alto_recorte)
    cuadro = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    cuadro.paste(recorte_img, ((lado - ancho_recorte) // 2, (lado - alto_recorte) // 2), recorte_img)

    ruta_salida = MARCA_DIR / nombre_salida
    cuadro.save(ruta_salida)
    print(f"  [{nombre_logo}] -> {ruta_salida} ({cuadro.size[0]}x{cuadro.size[1]})")


def main() -> None:
    for logo, salida in VARIANTES.items():
        extraer_isotipo(logo, salida)


if __name__ == "__main__":
    main()
