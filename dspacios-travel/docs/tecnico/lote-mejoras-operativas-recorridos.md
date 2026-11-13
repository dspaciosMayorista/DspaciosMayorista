# Lote de mejoras operativas — revisión local del dueño (2026-11-12)

> **Validado por el dueño el 2026-11-12:** los cinco recorridos (fechas, rótulos, selección masiva, portadas y cupos). Detalle en `lote-mejoras-operativas-evidencia-2026-11-12.md`.

Revisión en la **aplicación local** antes de cualquier Preview. Datos y usuarios **sintéticos**; nada de Producción.

## Acceso

| | |
|---|---|
| App | **http://127.0.0.1:3045** (build de producción del lote, solo en este equipo) |
| Contraseña de todos | `LoteRevision!` |
| Usuarios | `superadmin@lote.test` · `administracion@lote.test` · `operaciones@lote.test` · `venta@lote.test` |

**Encender** (PowerShell, desde `dspacios-travel\.worktrees\lote-mejoras-operativas\dspacios-travel\supabase\scripts\local-lote\`). Antes, comprobar que el entorno de #43/#60 no esté levantado; el script se niega a arrancar si lo está.

```powershell
.\locallote.ps1 iniciar     # pg4360 + servicios del lote (gateway 127.0.0.1:54361)
.\locallote.ps1 start       # app en http://127.0.0.1:3045 (Ctrl+C para cerrarla)
```

**Apagar al terminar cada sesión:** `.\locallote.ps1 detener -IncluirPostgres`. Los datos se conservan.

**Al terminar la revisión:** `.\locallote.ps1 limpiar` (con pg4360 encendido). Borra solo los recursos del lote y comprueba sus nombres y etiquetas antes de borrar.

`start` comprueba la memoria libre antes de arrancar y para la app si el equipo baja de 400 MB libres. Si eso pasa, cerrar otros programas y repetir `start`.

## Datos sintéticos sembrados

- **Hotel** «LOTE Hotel Cartagena»: categorías Estándar/Superior/Suite, plan PAM, tarifas del 1-dic-2026 al 31-mar-2027.
- **Paquetes**, generados y publicados desde la app; el hotel figura como «Recomendado», así que se ve sin elegir destino:
  - «LOTE Porción terrestre Cartagena»: opcionales Tour 2, City tour y Traslado grupal (este solo tiene precio para 10 a 20 pax).
  - «LOTE Bloqueo Cartagena»: record `LOTEBQ`, 12–15 dic 2026, con el Tour 2 como opcional.
  - «LOTE Receptivos Cartagena» (tipo Servicios): Tour 1.
- **Portadas:** Tour 1 = isotipo, Tour 2 = logo, City tour = globo. Son distintas a propósito, para que una portada equivocada se note.
- **Programa** «LOTE Programa Europa» (publicado).
- **Contrato pendiente** `DTM-9001`: paquete Porción, 2 pax, City tour ya elegido.
- **Abonos sin conciliar** de 100, 200, 300 y 5.000 (contratos `DTM-9011` a `DTM-9014`).
- **Cupos:** records `LOTE00` (sale el día de la siembra, 4 sillas), `LOTE14` (día 14, 3 sillas) y `LOTE15` (día 15, 5 sillas), más los records de ejemplo que traen las migraciones del repo.
  - Valores al sembrar (12-nov-2026): **58 sillas en 7 records** y alerta de **17 sillas en 3 records** (hoy, día 8 y día 14). El día 15 queda fuera.
  - Las fechas son relativas al día de la siembra: si la revisión es otro día, los números cambian según la ventana hoy–día 14.

## Recorridos

### 1. Fechas manuales (#15) — `administracion@lote.test`
*Contabilidad → Conciliaciones*, columna **Cartera**, campo «Desde (día)». Escribir y salir del campo:

| Escribe | Debe mostrar |
|---|---|
| `09052026` | 09/05/2026 |
| `090526` | 09/05/2026 |
| `09/05/26` | 09/05/2026 |
| `010156` | 01/01/2056 |
| `010157` | 01/01/1957 |
| `01011940` | 01/01/1940 (el año de cuatro dígitos se usa tal cual) |
| `31042026` | queda en rojo: «Escribe una fecha valida…» |

Regla aprobada: un año de dos dígitos cae entre el año actual −69 y el año actual +30. En cualquier formulario, escribir `090526` y pulsar **Enter** o **Guardar** sin salir antes del campo guarda 09/05/2026, nunca vacío. El calendario funciona igual que antes.

### 2. Rótulos (#34) — sin iniciar sesión o con cualquier usuario
1. http://127.0.0.1:3045/tarifario, pestaña **Paquetes**: en «Hoteles recomendados», tarjeta «LOTE Hotel Cartagena», **Ver opciones**.
2. En el modal, bajo «Incluye/No incluye», pulsar **Ver más**: secciones **«Incluye»** (Tiquete aéreo…, Alojamiento…) y **«No incluye»**, sin la palabra «programa».
3. Lo mismo en la pestaña **Porción terrestre**.
4. http://127.0.0.1:3045/tarifario/programa/915001 sigue diciendo **«El programa incluye»**.
5. Como `superadmin`: *Paquetes → LOTE Porción terrestre Cartagena → Configuración inicial*. Los campos se llaman «Incluye» y «No incluye».

### 3. Seleccionar / Deseleccionar todos (#50)
**Conciliaciones** (`administracion`, *Contabilidad → Conciliaciones*, columna Cartera):
1. Clic en el abono de **DTM-9014** (5.000) y escribir 1000 en «Valor máx» de esa columna. Quedan 3 abonos y aparece «1 seleccionado fuera del filtro».
2. Marcar **«Seleccionar todos (visibles)»**: se marcan los 3 visibles.
3. **«Deseleccionar todos (visibles)»**, luego borrar «Valor máx»: sigue marcado solo DTM-9014.
4. «Conciliados (0)»: nada se concilió.

**Contrato pendiente** (`superadmin`, *Contratos → DTM-9001*, bloque «Servicios adicionales»):
1. «Traslado grupal» aparece deshabilitado, con el aviso de que no hay precio para 2 pax.
2. **«Seleccionar todos»** marca Tour 2 y City tour, y el total se actualiza.
3. **«Deseleccionar todos»** los quita. Nada se guarda hasta pulsar «Guardar servicios».

**Blackouts** (`superadmin`, *Producto → Hoteles → LOTE Hotel Cartagena → Black out general*, desmarcar «Cierre total»):
1. **«Seleccionar todos»** en categorías: el resumen dice «Cierra Estándar, Superior, Suite por completo».
2. Lo mismo en acomodaciones. Nada se crea hasta pulsar «Agregar cierre».

### 4. Portadas de receptivos (#89) — sin iniciar sesión
1. /tarifario, pestaña **Receptivos**: Destino CARTAGENA, Ida `12122026`, Regreso `15122026`, 2 pax. Pulsar **Buscar receptivos**.
2. Cada tour lleva **su** portada: Tour 1 = isotipo, **Tour 2 = logo** (antes salía «Sin foto» por ser opcional de Porción/Bloqueo), City tour = globo.
3. Prueba de red lenta (opcional): DevTools → Network → *Slow 3G*. Buscar, pulsar «Limpiar resultados» durante la búsqueda y buscar con 3 pax. Nunca aparece la portada de otro servicio, y una búsqueda equivale a una solicitud.

### 5. Cupos (#59)
1. `operaciones`, *Inicio*: tarjeta «Cupos disponibles» con «58 sillas disponibles / en 7 records» y **«Ver inventario de vuelos»**, que abre el inventario. Alerta «Cupos críticos: 17 sillas disponibles en 3 records…».
2. `venta`, *Inicio*: la misma cifra **sin** enlace.

## Comprobación automática previa

Los cinco recorridos se ejecutaron en esta aplicación local con Edge sin interfaz por CDP antes de entregarla. El resultado de cada comprobación está en el informe del lote. Los scripts y las capturas quedan fuera del repositorio.
