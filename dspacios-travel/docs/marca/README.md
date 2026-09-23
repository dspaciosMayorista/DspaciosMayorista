# Marca — D'spacios Travel

Carpeta para los archivos de identidad de marca (manual, logos, paleta).

## Sube aquí el PDF de identidad

Sube el manual/identidad como:

```
dspacios-travel/docs/marca/identidad.pdf
```

Cuando esté arriba, avísame y lo leo para alinear el diseño de la app
(paleta exacta, tipografías, logo, estilo y tono).

## Otros archivos de marca (opcional)

- `logo-full-color.png` / `logo-full-color.svg`
- `logo-mono.png` / `logo-mono.svg`
- Variantes de fondo claro/oscuro

> Nota: los tokens de color y tipografía vigentes están en `CLAUDE.md` (sección 2).
> Si el PDF define algo distinto, esta carpeta manda y se actualizan los tokens.

## Isotipo (avión + espiral) — auditoría y extracción (sep-2026)

**No existe un isotipo oficial como archivo aparte.** Se revisaron `public/marca/*.png`
y las 5 páginas de `Identidad DESPACIOS.pdf` (portada, aplicaciones full color,
aplicaciones monocromáticas, paleta, tipografías) — ninguna trae el símbolo
avión+espiral solo; solo aparece fusionado dentro del lettering, reemplazando
la letra "O" de "D'SPACIOS" en `logo-full.png`/`logo-black.png`/`logo-white.png`.

Antes de tocarlo se comprobó si era separable a simple vista (crop rectangular)
o si el diseño lo funde con la tipografía: el degradado del remolino se apaga
hacia el mismo verde lima de las letras en su borde exterior, así que un
recorte rectangular ingenuo arrastra fragmentos de las letras vecinas ("I" y
la "S" final). **No se redibujó ni inventó ningún trazo nuevo** — se extrajo
por selección de píxeles del PNG oficial (equivalente a "varita mágica" en un
editor de imágenes, no a recrear el arte):

1. Sobre el canal alfa de cada `logo-*.png`, se calculan sus componentes
   conectadas (8-conectividad) dentro de la franja donde vive "D'SPACIOS".
2. Se descartan las dos componentes que son letras: la "I" (barra angosta:
   ancho < 40px y alto > 100px) y la "S" final (la componente cuyo borde
   derecho llega más lejos que todas las demás).
3. El resto de componentes (el avión, el detalle de la cabina —queda como
   pieza separada por una costura de antialiasing— y los dos tramos del
   remolino) se unen en una sola máscara; todo lo que quede fuera se vuelve
   transparente (no se recolorea ni se suaviza el borde de corte).
4. Se recorta al bounding box de esa máscara + un margen (~14px a la
   resolución del logo) y se centra sobre un lienzo cuadrado transparente,
   para que el spinner no distorsione el mark al forzarlo a una caja 1:1.

Resultado en `public/marca/isotipo-{full,black,white}.png` (mismo criterio de
variante que `Logo.tsx`: `full` = degradado de marca para fondos claros,
`white`/`black` = monocromo). **El script quedó versionado en
`scripts/marca/extraer_isotipo.py`** (Python + Pillow + NumPy) — correrlo de
nuevo (`python scripts/marca/extraer_isotipo.py` desde `dspacios-travel/`)
regenera los tres PNG a partir de los `logo-*.png` actuales; verificado
byte-a-byte (`md5sum`) que reproduce exactamente los mismos archivos ya
commiteados, así que sí es repetible tal como está, no solo una descripción
en prosa del proceso. ⚠️ Los umbrales de forma que distinguen la marca de las
letras "I"/"S" vecinas están calibrados a la geometría de ESTE lockup
(~1400px de ancho); si el logo oficial cambia de diseño o resolución, correr
el script igual pero revisar a ojo su salida (imprime qué componente
descartó como letra y cuál conservó como marca) antes de confiar en el
resultado — no es un mecanismo genérico para cualquier logo.

Usado por `components/LoadingScreen.tsx` (indicador de carga de pantalla
completa). Si en algún momento el dueño entrega el archivo vectorial original
(.AI/.EPS/.SVG con capas), esa fuente reemplaza a estos PNG extraídos —
sería la vía "fiel" real (capas separadas del diseñador) en vez de una
extracción por píxeles.
