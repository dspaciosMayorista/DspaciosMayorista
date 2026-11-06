# Incidentes — índice

> **Qué es esto:** el registro de incidentes del sistema que merecen quedar escritos: qué pasó, cómo se
> investigó, cuál fue la causa raíz, cómo se resolvió y qué quedó pendiente. No sustituye al
> `CLAUDE.md` (decisiones de negocio e historial) ni a `docs/tecnico/` (mapa técnico por módulo);
> los enlaza cuando hace falta.
>
> **Reglas de este registro:** sin secretos, sin datos personales y sin pegar resultados completos de
> consultas SQL (se citan ids de catálogo y conclusiones). Un incidente **no** declara un merge ni una
> validación en Producción que nadie haya confirmado: lo pendiente va en «Límites y seguimientos».

## Incidentes

| Fecha | Documento | Resumen | Estado |
|---|---|---|---|
| 2026-11-06 | [439 — Límite de combinaciones de la tarjeta](2026-11-06-439-limite-combinaciones.md) | Todas las salidas de los hoteles con más de 12 combinaciones categoría×régimen fallaban en tarjeta, modal y Vista tabla: el validador rechazaba antes de calcular. | Corregido y validado por el dueño en Preview; merge y Producción sin confirmar |

## Estructura de cada documento

Nombre del archivo: `AAAA-MM-DD-<número de tarea>-<tema-corto>.md`. Secciones, en este orden:

1. **Suceso y síntomas** — qué se vio y dónde, con las palabras de quien lo reportó.
2. **Impacto y alcance comprobado** — a quién y a qué afectó; separar lo comprobado de lo supuesto.
3. **Investigación y evidencias** — qué se probó, con qué herramienta, qué se descartó y por qué.
4. **Causa raíz** — la causa demostrada (no la más probable), con la prueba que la demuestra.
5. **Resolución** — qué cambió, a nivel de diseño, y qué se decidió no cambiar.
6. **Pruebas y validación** — qué se ejecutó, con resultados reales, y quién validó dónde.
7. **Límites y seguimientos separados** — lo que no se resolvió, con su tarea o responsable.
