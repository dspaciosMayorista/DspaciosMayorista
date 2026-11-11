-- HABILITAR la excepción de validación, DESPUÉS de aplicar y verificar el SQL de la ventana. Como postgres.
-- Pegar el SHA-256 (64 caracteres hex) del valor de MANTENIMIENTO_CLAVE. ⚠️ NUNCA pegar aquí el secreto: Postgres registra el texto de una
-- sentencia que falla. El hash se calcula fuera (p. ej. `printf '%s' "$CLAVE" | sha256sum`), en la máquina de quien lo genera.
select mant_priv.habilitar_excepcion('SHA256_DE_LA_CLAVE');
