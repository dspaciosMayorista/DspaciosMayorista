# CI — baterías históricas SQL/TS por `workflow_dispatch`

## Qué cambió

Los 8 workflows de `.github/workflows/` son baterías de migraciones ya cerradas (211-226). Cada una monta un
PostgreSQL desechable (imagen de Supabase), aplica la cadena real de migraciones y prueba fases, RLS por rol,
carreras, API con JWT locales y rollback. Algunas suman un job de pruebas TS en un contenedor Node.

Hasta ahora corrían en **cada `pull_request` hacia `main`** que tocara sus `paths`. Como varios `paths` son
archivos muy compartidos (`lib/reservar/computo.ts`, `types/database.ts`, `package.json`, `pnpm-lock.yaml`,
`lib/tarifario/**`, `app/tarifario/checkout/**`…), casi cualquier PR disparaba 11 o más jobs pesados.

Ahora **solo se ejecutan a mano** (`workflow_dispatch`). No cambió nada más: los 16 jobs, sus pasos, imágenes,
scripts, permisos, `concurrency` y `env` son idénticos a los de antes. No se quitó ninguna prueba; solo cambia
quién decide cuándo correrlas.

| Workflow | Jobs |
|---|---|
| `test-214-personas.yml` | `prueba-214` |
| `test-216-217-cotizacion-edicion.yml` | `prueba-216-217`, `pruebas-ts-39` |
| `test-220-destinos-aereos-67.yml` | `prueba-220`, `pruebas-ts-67` |
| `test-221-clientes-contratos-68.yml` | `prueba-221`, `pruebas-ts-68` |
| `test-222-223-neto-50.yml` | `prueba-222-223`, `bateria-211-sola`, `pruebas-ts-50` |
| `test-224-225-neto-empaquetados.yml` | `prueba-224-225`, `pruebas-ts-224` |
| `test-226-tarifa-infante.yml` | `prueba-226`, `pruebas-ts-226` |
| `test-personas-cotizaciones-42.yml` | `prueba-219`, `pruebas-ts-42` |

## Checks obligatorios de `main`

Verificado el 2026-10-23 con la API pública de GitHub:
- `GET /repos/dspaciosMayorista/DspaciosMayorista/branches/main` → `protected: false`, sin contextos ni checks obligatorios.
- `GET /rules/branches/main` → `[]`.
- `GET /rulesets?includes_parents=true` → `[]`, ni del repositorio ni heredados de la organización.

`main` **no exige ningún check**, así que ningún PR queda esperando un check que ya no se dispara. El check
`Vercel` no depende de estos workflows y sigue igual.

⚠️ Si algún día se marcan como obligatorios en `main` los nombres de estos jobs (por ejemplo
`226 · fases, SQL por rol, rollback exacto`), cada PR quedaría **pendiente para siempre**, porque ya no
se disparan solos. En ese caso hay que devolverles el disparador `pull_request` o no marcarlos.

## Cómo lanzar un workflow a mano

- **Web:** GitHub → *Actions* → elegir el workflow → *Run workflow* → seleccionar la **rama del PR** → *Run workflow*.
  La ejecución corre sobre el último commit de esa rama y queda registrada en *Actions*.
- **CLI** (si se tiene `gh` instalado): `gh workflow run test-226-tarifa-infante.yml --ref <rama-del-pr>`.
- No usan secretos ni Supabase remoto (solo contenedores desechables dentro del runner), así que lanzarlos
  no toca producción.

## Cuándo lanzar cada uno

Regla general: si el PR toca algo de la lista de un workflow, se lanza **antes de fusionar**. También se
lanza antes de aplicar en producción la migración que ese workflow cubre. Las listas son las mismas
`paths` que antes disparaban el workflow solo.

**Cualquier cambio a `dspacios-travel/supabase/scripts/preparar_esquema_local.sh` → lanzar los 8.**

| Workflow | Lanzarlo si el PR toca… |
|---|---|
| `test-214-personas` | migración `214_personas_identidad`; `scripts/{preflight,postcheck,rollback,test}_214_personas_identidad.sql`, `test_214_personas_carreras.sh`; `pruebas/fixtures/personasIdentidad.vectores.json` |
| `test-216-217-cotizacion-edicion` | migraciones 216/217; `scripts/*_216_*`, `*_217_*`; `pruebas/cotizacionEdicion39*`, `cotizacionComparativa35Paridad.test.ts`, `cotizacionesTenant.wiring.test.ts`; `app/(dashboard)/dashboard/reservar/actions.ts`, `app/(dashboard)/dashboard/cotizaciones/**`, `lib/cotizacion/**`; `package.json`, `pnpm-lock.yaml` |
| `test-220-destinos-aereos-67` | migración 220; `scripts/*_220_*`; `pruebas/destinosAereos67*`; `lib/paquetes/**`, `lib/reservar/computo.ts`, `lib/tarifario/**`, `app/tarifario/detalle-actions.ts`, `app/(dashboard)/dashboard/paquetes/**`, `app/(dashboard)/dashboard/vuelos/empaquetados-actions.ts`; `package.json`, `pnpm-lock.yaml` |
| `test-221-clientes-contratos-68` | migración 221; `scripts/*_221_*`, `test_216_fixtures.sql`; migraciones 142 y 156; `lib/crm/clientesContratos68.ts`, `pruebas/clientesContratos68*`, `types/database.ts`, `app/(crm)/**` |
| `test-222-223-neto-50` | migraciones 222/223; `scripts/*_222_*`, `*_223_*`, `test_216_fixtures.sql`, `test_216_edicion39.sql`, `test_211_fixtures.sql`, `test_211_cotizaciones_comparativas.sql`; `pruebas/netoHija*`, `margenContrato.test.ts`; `lib/cotizacion/**`, `lib/contrato/margenContrato.ts`, `types/database.ts`, `app/(dashboard)/dashboard/cotizaciones/**`, `app/tarifario/checkout/**`, `components/cotizacion/**`; `package.json`, `pnpm-lock.yaml` |
| `test-224-225-neto-empaquetados` | migraciones 224/225; `scripts/*_224_*`, `*_225_*`; `pruebas/netoEmpaquetados224*`; `lib/reservar/computo.ts`, `types/database.ts`; `package.json`, `pnpm-lock.yaml` |
| `test-226-tarifa-infante` | migración 226; `scripts/*_226_*`; `pruebas/tarifaInfante226*`; `lib/reservar/{menoresDeDos,computo,liquidacionHotel,serviciosPaquete}.ts`, `lib/calc/paquetes.ts`, `types/database.ts`; `package.json`, `pnpm-lock.yaml` |
| `test-personas-cotizaciones-42` | migraciones 219 y 214; `scripts/*_219_*`, `*_214_*`, `test_216_fixtures.sql`, `test_216_edicion39.sql`; `pruebas/fixtures/personasIdentidad.vectores.json`, `pruebas/*PersonasCotizacion42*`, `personasIdentidad.test.ts`, `personasConsulta.wiring.test.ts`; `lib/personas/**`, `lib/reservar/computo.ts`, `types/database.ts`, `app/(dashboard)/dashboard/reservar/actions.ts`, `app/(dashboard)/dashboard/cotizaciones/**`, `app/tarifario/checkout/**`, `app/(crm)/**` |

(Las rutas sin prefijo son relativas a `dspacios-travel/`; las migraciones son `supabase/migrations/20260601000NNN_*.sql`.)

Atajo: si el PR toca `lib/reservar/computo.ts` o `types/database.ts`, aplican 220, 221, 222/223, 224/225,
226 y 42. Si toca `package.json` o `pnpm-lock.yaml`, aplican 216/217, 220, 222/223, 224/225 y 226.

## Comandos locales que sustituyen la ejecución habitual

Todo se corre desde `dspacios-travel/` después de `pnpm install --frozen-lockfile` (Node 24; pnpm 10, por
`allowBuilds` en `pnpm-workspace.yaml`).

### Pruebas TS (los jobs `pruebas-ts-*`)

Base diaria: `npm run test:unit`, `npm run test:react` y `npx tsc --noEmit`. Cubren **todos** los archivos de
prueba de estos jobs, **salvo dos pruebas React** que solo corrían dentro de los workflows porque no están en
`test:react`. Esas dos se corren aparte:

```sh
node --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs \
  --experimental-loader ./pruebas/support/reactLoader.mjs --test \
  pruebas/destinosAereosEditor67.react.ts pruebas/clientesContratos68UI.react.ts
```

Comando exacto de cada job, para reproducirlo tal cual (archivos `*.test.ts` con el `aliasLoader`):

```sh
NODE_TS="node --test --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./pruebas/support/aliasLoader.mjs"
NODE_REACT="node --test --experimental-test-module-mocks --import ./pruebas/support/registrarProgramasRuta.mjs --experimental-loader ./pruebas/support/reactLoader.mjs"

# pruebas-ts-39 (216/217)
$NODE_TS pruebas/cotizacionEdicion39R4.test.ts pruebas/cotizacionEdicion39.wiring.test.ts \
  pruebas/cotizacionEdicion39Acciones.test.ts pruebas/cotizacionEdicion39Liquidacion.test.ts \
  pruebas/cotizacionComparativa35Paridad.test.ts pruebas/cotizacionesTenant.wiring.test.ts
# pruebas-ts-67 (220)
$NODE_TS pruebas/destinosAereos67.test.ts pruebas/destinosAereosFlujos67.test.ts pruebas/destinosAereos67Sql.wiring.test.ts
$NODE_REACT pruebas/destinosAereosEditor67.react.ts
# pruebas-ts-68 (221)
$NODE_TS pruebas/clientesContratos68Acceso.test.ts pruebas/clientesContratos68Cableado.test.ts
$NODE_REACT pruebas/clientesContratos68UI.react.ts
pnpm exec tsc --noEmit
# pruebas-ts-50 (222/223)
$NODE_TS pruebas/netoHijaPuro.test.ts pruebas/netoHijaCableado.wiring.test.ts pruebas/netoHijaAcciones.test.ts \
  pruebas/margenContrato.test.ts pruebas/contratoManualNeto.test.ts pruebas/contratoNetoB2B.test.ts \
  pruebas/cotizacionComparativa35Checkout.test.ts pruebas/cotizacionComparativa35Paridad.test.ts \
  pruebas/cotizacionEdicion39Acciones.test.ts pruebas/documentosContrato.wiring.test.ts
$NODE_REACT pruebas/netoHijaModalidad.react.ts pruebas/cotizacionComparativa35Ui.react.ts pruebas/contratoDocumentoNeto.react.ts
# pruebas-ts-224 (224/225)
$NODE_TS pruebas/netoEmpaquetados224.test.ts
# pruebas-ts-226
$NODE_TS pruebas/tarifaInfante226.test.ts pruebas/tarifaInfante226Cableado.test.ts pruebas/tarifaInfante226Checkout.test.ts
# pruebas-ts-42
$NODE_TS pruebas/vectoresPersonasCotizacion42.test.ts pruebas/cableadoPersonasCotizacion42.wiring.test.ts \
  pruebas/personasIdentidad.test.ts pruebas/personasConsulta.wiring.test.ts
```

Criterio de verde: `ℹ fail 0` y ningún `✖`. En CI, además, algunos jobs exigen que aparezcan ciertos nombres de
prueba ("marcas" `✔ …`, listadas en el paso *Pruebas TS* de cada workflow). Localmente basta con que pasen.

⚠️ **Windows con `core.autocrlf=true`:** el repo guarda LF, pero ese checkout deja los `.sql` con CRLF. Las
pruebas de cableado que leen SQL como texto fallan entonces en local sin que haya un defecto. Ejemplo
comprobado: `personasConsulta.wiring.test.ts`, de `pruebas-ts-42`, da 3 fallos contra la migración 214 en CRLF.
En CI (Linux, LF) no ocurre. Para validarlas, correrlas en un checkout con LF (WSL, o un clon con
`git -c core.autocrlf=false clone …`) o lanzar el workflow a mano.

### Baterías SQL (los jobs `prueba-*` y `bateria-211-sola`)

Requieren Docker. Usan las imágenes `supabase/postgres:15.8.1.085` y, para los pasos de API,
`ghcr.io/supabase/postgrest:v16.1`. Esquema de cada job:

1. Crear el contenedor PostgreSQL (y la red, si hay paso de API), como en el paso *PostgreSQL desechable* del workflow.
2. `bash supabase/scripts/preparar_esquema_local.sh <contenedor> <N> <plantilla>`, donde `N` es la última
   migración de la cadena base.
3. Correr los scripts de la batería con los mismos argumentos que en el workflow.

| Job | Cadena base (`N`) | Scripts de la batería |
|---|---|---|
| `prueba-214` | 213 | paso en línea *Migración 214 real* del workflow + `test_214_personas_carreras.sh <ct> <plantilla> <red>` |
| `prueba-216-217` | 214 | `test_216_fases.sh <ct> <plantilla>`, `test_216_carrera.sh <ct> <plantilla>`, `test_216_api.sh <ct> <plantilla> <red>` |
| `prueba-220` | 221 **sin la 220** (paso en línea *Esquema 001-221 SIN la 220*) | `test_220_fases.sh <ct> <plantilla>`, `test_220_carrera.sh <ct> <plantilla>`, `test_220_api.sh <ct> <plantilla> <red>` |
| `prueba-221` | 219 | `test_221_clientes_contratos_crm.sh <ct> <plantilla> <red>` |
| `prueba-222-223` | 221 | `test_222_neto_hija.sh <ct> <plantilla>` |
| `bateria-211-sola` | 211 | `test_222_neto_hija.sh <ct> <plantilla> 211sola` |
| `prueba-224-225` | 223 | `test_224_fases.sh`, `test_224_api.sh <red>`, `test_225_fases.sh`, `test_225_api.sh <red>` (cada uno con `<ct> <plantilla>`) |
| `prueba-226` | 225 | `test_226_fases.sh <ct> <plantilla>` |
| `prueba-219` (#42) | 217 | `test_219_personas_cotizaciones.sh <ct> <plantilla> <red>` |

Los pasos marcados "en línea" no tienen script propio: hay que copiarlos del `run:` del workflow. La fuente
de verdad del orden y de los criterios de éxito es siempre el YAML. Para la 213/214 hay recetas completas en
[`programas-destino-fijo.md`](./programas-destino-fijo.md) y en [`personas-identidad.md`](./personas-identidad.md) §5.1.

Si no hay Docker a mano, la alternativa es lanzar el workflow a mano (sección anterior): es la misma batería
en el runner de GitHub.
