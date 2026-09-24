# Calendarios personalizados

## Alcance

Se sustituyeron 121 controles en 49 archivos de `app/` y `components/`:
118 fechas y 3 periodos mensuales. Incluye Dashboard, contratos, pasajeros,
reservas, vuelos, producto, contabilidad, CRM, Tarifario publico y cotizacion
del sitio. No se modificaron SQL, permisos, calculos ni Server Actions.

## Contrato del componente

`components/ui/DateInput.tsx` usa React DayPicker 9 y Popover/Select de Base UI.
El componente admite `value`/`onValueChange` o `defaultValue`, `name`, `form`,
`disabled`, `readOnly`, `required`, `min` y `max`.

- Fecha visible: `dd/MM/yyyy`; valor de callback y formulario: `YYYY-MM-DD`.
- Mes visible: `MM/yyyy`; valor de callback y formulario: `YYYY-MM`.
- Las fechas civiles se convierten localmente, nunca mediante UTC.
- El campo visible valida texto y limites; el campo oculto con `name` envia ISO.
- Texto incompleto o imposible conserva el borrador, invalida el campo y emite
  valor vacio. No se inventan dias ni fechas de reemplazo.
- Los limites son inclusivos y se reevaluan cuando cambian las props.
- El calendario permite seleccionar mes/anio, usar teclado, limpiar y volver
  a hoy. Los controles de solo lectura o deshabilitados no abren el calendario.
- Un resultado de busqueda de pasajero puede actualizar el valor sin remontar
  el componente. Los formularios no controlados conservan reset y FormData.

Para campos nuevos se debe usar `DateInput`, no `input type="date/month"`.
Los callbacks reciben el valor ISO directamente, no un evento sintetico.

## Verificacion

- `npm run test:calendar`: conversion, fechas invalidas/bisiestas, limites,
  meses, cobertura AST de toda la aplicacion y 8 pruebas React del componente.
- `npm run test:react`: integra estas 8 pruebas con las 22 ya existentes.
- Dos pruebas de wiring se actualizaron para verificar los mismos limites e
  invalidacion de resultados con `onValueChange`.
- Verificacion en navegador real, 1440x900 y 390x844: calendario diario/mensual,
  selector de anio, Escape/foco, escritura, FormData, reset, limites, componente
  real de Booking y calendario dentro del Dialog real. Sin recorte del popup.
- Se retiro el icono decorativo duplicado de Booking/Receptivos para que la
  fecha completa quepa en movil junto al boton del calendario.

La prueba visual uso una pagina temporal con datos de ejemplo, retirada del
diff final. No equivale a ejecutar todas las rutas autenticadas con Supabase.
No se utilizaron credenciales ni se escribieron datos remotos.

La suite unitaria general tiene fallos anteriores al cambio: se compararon
contra el checkout original de `main`, no se asumieron por su cantidad.
ESLint tambien detecta un error y seis advertencias preexistentes en cuatro
archivos migrados; el codigo nuevo no introduce esos hallazgos.
