# Guía del dueño · NETA-05 y NETA-06 (versión corregida) — 2026-11-26

> Antes / ahora: antes, los costos de un contrato en dólares se veían como «$ 200» (como si fueran pesos), las obligaciones previstas sumaban dólares con pesos y no había dónde corregir la TRM de costos después de guardar el contrato. Ahora cada costo en USD dice «USD $200.00», su equivalente en pesos se rotula como PROVISIONAL (o «TRM de costos pendiente»), los totales van por moneda y, mientras el contrato esté Pendiente, administración puede corregir la TRM. Al confirmar, la TRM queda congelada. No se cambia ningún contrato, cuenta por pagar ni asiento ya existente.

Para repetir el recorrido sin agotar sillas: «NTU303» tiene sillas disponibles de sobra (la coordinación carga la semilla `semillas/rev2/neta.sql` si hiciera falta). Cada contrato toma 2 sillas.

## NETA-05 — Bloqueo en dólares: neta USD 100, reventa USD 120, TRM de costos 3.900

- **Cuenta:** venta@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/reservar/nuevo?paquete=91202&hotel=91202&bloqueo=91203&modulo=bloqueo
- **Qué hacer:** 1) «Doble · 2 pax» = 1. 2) Cliente «Ana Revision»; asesor «Rev Venta»; pasajeros Ana Revision (documento 91000041, nacimiento 15/03/1985) y Luis Revision (91000042, 20/08/1983). 3) «Generar cotización». 4) En la cotización, escribe «TRM provisional» 4000 si se pide, y en el recuadro «TRM de costos (COP por USD)» escribe 3900 (la ayuda dice que es provisional y que se puede corregir en la ficha del contrato mientras esté pendiente). Moneda de cobro USD. 5) «Confirmar → generar contrato».
- **Qué debe verse:** El contrato queda Pendiente, en USD, con precio de venta USD 450 (2 × 225). Como asesor de ventas no ves costos. (Los costos se leen en NETA-06.)
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

## NETA-06 — Contrato en dólares: ver los costos en USD, corregir la TRM provisional y confirmar

- **Cuenta:** administracion@consolidada.test
- **Enlace:** http://localhost:3090/dashboard/contratos (abre el contrato en USD recién creado)
- **Qué hacer y qué debe verse (en este orden):**
  1. Pestaña **«Costos»**. Debe verse un recuadro azul: «Los costos de este contrato están en USD (la moneda de la oferta), no en pesos» con «TRM de costos $3.900 (provisional)…». «Costo aéreo» = **USD $200.00** (no «$ 200»); «Costo directo total» también en USD.
  2. Arriba de la ficha, **«Obligaciones previstas — aún no exigibles»**: la fila del aéreo dice **USD $200.00** y debajo **«≈ $ 780.000 a TRM de costos $3.900 (provisional)»** (200 × 3.900). Las filas en dólares tienen su equivalente; los totales dicen «Total previsto en USD» y, debajo, «≈ … (provisional)». Los dólares no se suman con pesos. La nota explica que es distinta de la TRM del pago real y de la TRM de cobro.
  3. Pulsa **«Corregir la TRM de costos de este contrato»**. Escribe **4100**, motivo «TRM acordada con la aerolínea» y pulsa **«Guardar TRM»**. Debe aparecer «TRM de costos actualizada a $4.100 (N obligación(es))» y la fila del aéreo queda **«≈ $ 820.000 a TRM de costos $4.100 (provisional)»** (200 × 4.100). El precio de venta (USD 450), los costos en dólares y la pestaña «Proveedores» (vacía, sigue sin cuentas por pagar) NO cambian.
  4. **Dos pestañas (edición simultánea):** abre el mismo contrato en otra pestaña del navegador, corrige a 4200 y guarda. Vuelve a la primera pestaña (que todavía muestra 4.100), escribe 4300 y guarda: debe decir «La TRM de costos cambió mientras la editabas. Recarga la página y revisa el valor actual…» y NO cambiar nada.
  5. **Otra cuenta:** con venta@consolidada.test abre el mismo contrato: no hay panel de costos ni editor. (Con una cuenta de administración de la otra agencia, el contrato ni se ve.)
  6. Vuelve con administración y pulsa **«Confirmar venta»**. Pestaña **«Proveedores»**: nace UNA cuenta por pagar aérea de **USD $200.00** con «≈ $ 840.000 a TRM de costos $4.200 (congelada)» (la TRM que quedó al confirmar). Ya no aparece el panel de previstas ni el botón de corregir; en «Costos» el recuadro dice que la TRM «quedó congelada al confirmar». En Contabilidad → Libro diario el devengo del aéreo es de 840.000 pesos.
  7. En Pagos a proveedores (/dashboard/pagos) abre esa cuenta: «Equivalente en pesos (TRM de costos $4.200, congelada al confirmar). El pago usa la TRM del día en que se paga.»
- **Resultado:**  ☐ correcto   ☐ con observación: ____________

(Valores de ejemplo calculados a mano: 200 × 3.900 = 780.000 · 200 × 4.100 = 820.000 · 200 × 4.200 = 840.000. Si en el paso 4 usas otros números, el equivalente es siempre «USD × TRM».)

## Qué NO cambia (explicación para el dueño)
- Una cuenta por pagar ya confirmada no se corrige desde aquí: su equivalente ya generó un asiento contable. Corregirla requiere un proceso contable aparte (reversión) que usted debe aprobar; queda como decisión abierta en el informe.
- La TRM de costos es la del costeo. La del pago real a un proveedor se registra al pagar; la de cobro al cliente es otra.
