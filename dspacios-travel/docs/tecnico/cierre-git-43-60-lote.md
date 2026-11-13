# Cierre Git del combinado #43/#60 + lote operativo → PR #448

Preparado 2026-11-13. **Nada de esto lo ejecutó Claude**: sin staging, commit, push ni Preview; sin activar grupos ni regenerar
tarifas remotas. Lo ejecuta el dueño, en orden, deteniéndose ante cualquier comprobación que falle.

## 1. Estado de partida (verificado)

| Qué | Valor |
|---|---|
| Worktree del cierre | `dspacios-travel/.worktrees/43-lote-combinado` — HEAD separado en `5974d4136e936f9b92f71b57208b88156aa83375` |
| PR #448 | rama `claude/43-60-3b-calculadoras`; su cabeza en GitHub es **`5974d4136`** (la misma base): el push es *fast-forward*, sin rebase |
| Originales que se conservan | `43-vigencias-dia` (rama local `claude/43-60-3b-calculadoras`, cambios sin confirmar) y `lote-mejoras-operativas` (`codex/lote-mejoras-operativas`). No se tocan |
| Migraciones | **298, 299, 300, 301 y 302 aplicadas en Producción por el dueño (2026-11-13), postchecks correctos: INMUTABLES.** Ninguna otra migración en el cierre. La **303** (#45) NO está ni se incluye |
| Inventario | `cierre-git-43-60-lote.huellas.tsv`: **217 archivos** (117 nuevos, 100 modificados) con su blob de Git; más este documento y el propio inventario = **219** en el commit |
| Excluido | `.next/`, `node_modules/`, `*.tsbuildinfo`, `.env*`, perfiles de Edge, capturas y registros (todo fuera del árbol o ignorado; comprobado: ninguno aparece en el inventario). Sin secretos: los únicos secretos en scripts son los **locales y sintéticos** de las pruebas (`humo43-local-secreto-solo-pruebas-…`), que no abren nada fuera de la máquina |
| Separación de #442 | 5 archivos se tocan en los dos (`reservar/actions.ts`, `components/cotizacion/ComposicionPrecio.tsx`, `lib/cotizacion/composicionPrecio.ts`, `package.json`, `pruebas/support/reactLoader.mjs`), pero **ninguna línea agregada por #442 está en el combinado** (comprobado línea por línea): el que se fusione segundo resuelve esos archivos |
| Separación del bloque #16/#45/#49/#52 | 5 archivos se tocan en los dos (ficha de hotel `page.tsx` y `actions.ts`, `TarifarioPublic.tsx`, `VistaBooking.tsx`, `types/database.ts`); **ninguna línea del bloque está en el combinado** (comprobado). Su 303 vive solo en su worktree |
| Índice | 10 archivos aparecen como `MM`: el `git apply -3` de la integración del lote dejó contenido en el índice. No es un staging del cierre; el paso 4 los vuelve a agregar con su contenido final |

### ⚠️ La 301 tiene dos textos locales
La 301 aplicada puede ser la del worktree original o la del combinado: el combinado mejoró **el texto** del aviso de contradicción
(misma regla comercial) el 2026-11-13, el mismo día en que se aplicó. El repositorio debe guardar exactamente la que corrió, y los
postchecks de la 301 no distinguen las dos. Por eso el **paso 0** es una consulta de solo lectura:
`supabase/scripts/verificar_version_301_produccion.sql` (probada en local contra las dos versiones: devuelve `COMBINADO` u `ORIGINAL`).
- `COMBINADO — … continuar` → seguir con el procedimiento tal cual.
- `ORIGINAL — … detenerse` o `MIXTO` → **no seguir**: el archivo del combinado no es el que corrió. Hay que dejar en el repo la 301
  original y, si el dueño quiere el aviso mejorado, llevarlo a una migración nueva (304) con su preflight y postcheck. Avisar antes de
  tocar nada.

## 2. Procedimiento (resumen)
0. Ejecutar en Supabase (SQL Editor, solo lectura) `verificar_version_301_produccion.sql` y comprobar `COMBINADO`.
1. En el worktree combinado, comprobar base, rama remota del PR y huellas de los 217 archivos.
2. Comprobar que no hay cambios fuera del inventario.
3. Crear una rama local nueva desde el HEAD separado (no se usa la rama del original, que está tomada por su worktree).
4. Agregar exactamente las 219 rutas y comprobar el índice contra la lista.
5. Commit con el mensaje de §4.
6. Push de ese commit a la rama del PR #448 (`HEAD:claude/43-60-3b-calculadoras`, fast-forward).
7. En GitHub, actualizar el título y la descripción del PR #448 con §5. No crear otro PR, no fusionar, no tocar #442.

Después del push, la rama local `claude/43-60-3b-calculadoras` del worktree original queda **detrás** del remoto: es lo esperado.
**No** hacer `git pull`, `reset` ni `checkout` en los originales (conservan su estado y sus cambios sin confirmar).

## 3. Comandos PowerShell (Windows PowerShell 5.1)

```powershell
# ── 0. (Antes, en Supabase) correr supabase/scripts/verificar_version_301_produccion.sql y confirmar «COMBINADO». Si no, PARAR.

# ── 1. Ubicación, base y rama remota del PR ─────────────────────────────────────────────────────────────────
Set-Location "C:\Users\Usuario\Documents\DspaciosMayorista\dspacios-travel\.worktrees\43-lote-combinado"
$base = "5974d4136e936f9b92f71b57208b88156aa83375"
if ((git rev-parse HEAD) -ne $base) { throw "HEAD no es la base esperada ($base): detenerse" }
git fetch origin claude/43-60-3b-calculadoras
if ($LASTEXITCODE -ne 0) { throw "Falló fetch: detenerse" }
if ((git rev-parse origin/claude/43-60-3b-calculadoras) -ne $base) { throw "La rama del PR #448 avanzó desde $base: detenerse y avisar" }

# ── 1b. Huellas: cada archivo debe coincidir con el inventario ───────────────────────────────────────────────
$tsv = "dspacios-travel\docs\tecnico\cierre-git-43-60-lote.huellas.tsv"
$filas = Get-Content -Encoding UTF8 $tsv | Select-Object -Skip 1 | Where-Object { $_ } | ForEach-Object {
  $c = $_ -split "`t"; [pscustomobject]@{ Estado = $c[0]; Blob = $c[1]; Ruta = $c[2] } }
if ($filas.Count -ne 217) { throw "El inventario debería tener 217 filas y tiene $($filas.Count)" }
$malas = $filas | Where-Object { (git hash-object -- $_.Ruta) -ne $_.Blob }
if ($malas) { $malas | Format-Table -AutoSize; throw "Hay archivos que no coinciden con su huella" }
"Huellas OK: $($filas.Count) archivos"

# ── 2. Nada fuera del inventario ────────────────────────────────────────────────────────────────────────────
$cierre = @("dspacios-travel/docs/tecnico/cierre-git-43-60-lote.md", "dspacios-travel/docs/tecnico/cierre-git-43-60-lote.huellas.tsv")
$rutas = @($filas | ForEach-Object { $_.Ruta }) + $cierre
$cambios = @(git -c core.quotepath=false status --porcelain=v1 -uall | ForEach-Object { $_.Substring(3) })
$extra = @($cambios | Where-Object { $rutas -notcontains $_ })
$faltan = @($rutas | Where-Object { $cambios -notcontains $_ })
if ($extra.Count -or $faltan.Count) { "Fuera del inventario:"; $extra; "Faltan:"; $faltan; throw "El árbol no coincide con el inventario" }
"Árbol OK: $($cambios.Count) cambios, todos en el inventario"

# ── 3. Rama local nueva desde el HEAD separado ──────────────────────────────────────────────────────────────
git switch -c codex/cierre-43-60-lote-combinado
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la rama local: detenerse" }

# ── 4. Staging exacto y comprobación del índice ────────────────────────────────────────────────────────────
git --literal-pathspecs add -- $rutas
if ($LASTEXITCODE -ne 0) { throw "Falló git add: detenerse" }
$indice = @(git -c core.quotepath=false diff --cached --name-only)
if ((Compare-Object $indice $rutas) -or $indice.Count -ne 219) { throw "El índice no es exactamente la lista del cierre ($($indice.Count))" }
if (git -c core.quotepath=false status --porcelain=v1 -uall | Where-Object { $_ -notmatch '^(M |A )' }) { throw "Quedan cambios sin agregar o mixtos" }
git diff --cached --stat | Select-Object -Last 1

# ── 5. Commit (mensaje en UTF-8 sin BOM) ───────────────────────────────────────────────────────────────────
$msg = Join-Path $env:TEMP "msg-cierre-43-60.txt"
[IO.File]::WriteAllText($msg, @'
#43/#60 + lote operativo: grupos de días, promociones por grupo, precedencia, «desde» real y límite de 30 noches

- Calculadoras y tarifas por grupo de días; «Aplicar a la venta» con empates y vuelta a todos los días (298, 299).
- Promociones por grupo calculadas en vivo sobre la base ganadora, sin filas promocionales (300).
- Acumulación y precedencia con EBB / Long Stay, cambio pendiente persistente (P3) y aviso de contradicción
  que nombra la decisión que difiere con una estadía de ejemplo (301).
- «Desde» con la estadía real que lo produce: precio, noches y entrada precargada (302).
- Límite de 30 noches en todos los tipos; Escape cierra las ventanas propias (useEscapeCerrar).
- «Tarifas generadas»: promociones dinámicas explicadas por categoría (solo lectura, netos solo para roles con costos).
- Lote operativo integrado: selección masiva (#50), portada de receptivos (#89), cupos del dashboard (#59) y demás.

Migraciones 298–302 ya aplicadas en Producción (inmutables). Sin 303 (#45) ni el bloque #16/#45/#49/#52; #442 aparte.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@)
git commit -F $msg
if ($LASTEXITCODE -ne 0) { throw "Falló el commit: no ejecutar push" }
git log --oneline -1

# ── 6. Push al PR #448 (fast-forward sobre 5974d4136) ──────────────────────────────────────────────────────
git push origin HEAD:claude/43-60-3b-calculadoras
if ($LASTEXITCODE -ne 0) { throw "Falló el push: detenerse y revisar" }
```

Si algo falla después del paso 4 y antes del 6: `git reset --soft $base` deshace el commit sin perder archivos, y
`git switch --detach $base` deja el worktree como estaba (los cambios siguen en el árbol).

## 4. Mensaje del commit
Incluido en el paso 5 (título + viñetas + línea de coautoría).

## 5. Título y descripción del PR #448

**Título:** `#43/#60 + lote operativo: grupos de días, promociones por grupo, precedencia EBB/Long Stay, «desde» real y 30 noches`

**Descripción:**

```markdown
## Resumen
Cierre de #43/#60 (vigencias por grupos de días) integrado con el lote de mejoras operativas, probado en local (build de producción,
humo, recorridos con login real) y validado por el dueño en la revisión visual. Un solo PR (#448); los originales se conservan.

## Migraciones
- **298–302 ya aplicadas en Producción por el dueño (2026-11-13)**, cada una entre su preflight y su postcheck correctos. Inmutables.
  Este PR no trae migraciones nuevas. La 301 del PR es la que corrió (verificado con `verificar_version_301_produccion.sql`).
- **Sin activar grupos ni regenerar tarifas** como parte de este PR: el código nuevo lee las columnas que esas migraciones ya crearon.

## #43/#60
- Calculadoras y tarifas por grupo de días; «Aplicar a la venta» (empates, volver a todos los días) — 298/299.
- Promociones por grupo: se calculan en vivo sobre la base ganadora; ninguna fila promocional nueva — 300.
- Acumulación / precedencia con EBB y Long Stay; reglas retenidas; cambio pendiente persistente (P3); aviso de contradicción que nombra
  las dos promociones, la decisión que difiere y una estadía de ejemplo — 301.
- «Desde» real: precio, noches y entrada que lo producen, con la entrada precargada al cotizar (550.000 / 600.000, nunca 500.000) — 302.
- Límite configurable de 30 noches en todos los tipos (TS y SQL sincronizados por prueba).
- Regeneración de paquetes con concurrencia máxima 2; presupuesto del «desde» por combinación y por generación.
- Escape cierra las ventanas propias como su X / «Cancelar» (`components/ui/useEscapeCerrar.ts`; solo la superior; respeta «guardando»).
- «Tarifas generadas»: promociones dinámicas por grupo explicadas por categoría con «Ver tarifas» (modal compartido), unidades
  coherentes y reparto exacto; netos solo para superadmin / gerencia / administración / operaciones.

## Lote operativo
Integrado sin conflictos (ConfigForm y resumen del tarifario fusionados): selección masiva (#50), portada de receptivos (#89),
tarjeta de cupos del dashboard (#59) y el resto del lote validado. Sus 3 pruebas React registradas en `test:react`.

## Fuera de este PR
- Bloque #16/#45/#49/#52 y su migración 303 (otro frente).
- #442 (`codex/cotizaciones-contratos`) sigue separado. Comparte 5 archivos con este PR (`reservar/actions.ts`,
  `ComposicionPrecio.tsx`, `composicionPrecio.ts`, `package.json`, `reactLoader.mjs`) sin contenido de #442 aquí: el que se fusione
  segundo resuelve esos archivos.

## Pruebas (local)
- `next build` ✓ (incluye TypeScript) · `tsc --noEmit` 0 errores.
- SQL 298–302 (incluida la 301 con E4/E4b/E4c/I6 y la carrera de P3): 0 fallos.
- Unitarias y React: los mismos fallos que HEAD por nombre, más 2 de `modalSeleccionTarjeta90` que dependen de la fecha (fallan igual
  sin estos cambios desde el 2026-11-13).
- Recorridos con la app real y login: Semana/Fin de semana 550.000/600.000, promoción nueva 100.000 → 90.000 → 108.000 sin fila
  promocional, Escape, «Tarifas generadas» a 375 y 1280 px con 0 solicitudes al abrir/cerrar el detalle.
- Detalle y evidencia: `docs/tecnico/auditoria-final-43-60.md`. Inventario y huellas: `docs/tecnico/cierre-git-43-60-lote.*`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
