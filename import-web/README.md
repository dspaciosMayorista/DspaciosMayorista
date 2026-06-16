# 📥 Importar la página web (migración desde Hostinger)

Esta carpeta es **solo un buzón temporal** para que subas el código descargado
de tu web actual. Una vez lo subas, Claude lo lee, te dice exactamente qué es
(HTML estático, WordPress, React/Next, export del site builder, etc.) y lo
monta dentro del proyecto tal cual, configurando luego el dominio/DNS.

## Cómo subir el código (elige la más fácil para ti)

### Opción A — GitHub web (recomendada, sin instalar nada)
1. Entra al repo en GitHub, rama **`claude/modest-clarke-Ehftt`**.
2. Abre esta carpeta `import-web/`.
3. Botón **Add file → Upload files**.
4. **Arrastra la carpeta descompactada** (todos los archivos/carpetas de tu web).
   - Si solo tienes un **.zip**, también sirve: súbelo tal cual aquí; yo lo
     descomprimo del lado de Claude.
5. **Commit changes** (a esta misma rama).
6. Avísame: "ya subí la web a `import-web/`".

### Opción B — Git (si te manejas con la terminal)
```bash
git checkout claude/modest-clarke-Ehftt
# copia tu código descargado dentro de import-web/
git add import-web/
git commit -m "Subo código de la web actual para migrar"
git push origin claude/modest-clarke-Ehftt
```

## Qué me sirve más
- **Ideal:** los archivos **descomprimidos** conservando su estructura de
  carpetas (así veo exactamente cómo está armada).
- **También vale:** el **.zip** tal cual lo descargaste.
- Si el panel te deja elegir, descarga **"todo el sitio / código fuente"**
  (no solo un backup de base de datos).

## Lo que haré cuando lo subas
1. Identifico la tecnología y cómo está construida.
2. Te propongo cómo montarla aquí (sitio estático, ruta dentro de la app,
   subdominio propio, etc.) **respetando que quede igual** a la actual.
3. Configuramos el dominio/DNS para su propia URL.

> Nota: esta carpeta `import-web/` se borrará una vez la migración esté montada
> en su lugar definitivo.
