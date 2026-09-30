<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Alcance de este archivo

Solo el bloque entre los marcadores `nextjs-agent-rules` lo genera y actualiza `next dev` (reglas de Next.js 16); esta nota queda fuera del bloque y no se sobrescribe. Este archivo no es el router del proyecto: las reglas universales, el enrutamiento por rol y la lectura mínima están en `../AGENTS.md` (raíz del repositorio), que prevalece para el flujo de trabajo. El `CLAUDE.md` de esta carpeta solo importa este archivo y es distinto del `CLAUDE.md` de la raíz. Consultar la guía puntual de `node_modules/next/dist/docs/` es compatible con la regla de excluir `node_modules` en búsquedas amplias.
