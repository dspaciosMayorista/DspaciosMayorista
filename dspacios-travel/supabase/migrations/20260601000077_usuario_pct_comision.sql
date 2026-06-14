-- ───────────────────────────────────────────────────────────────────────────
-- 077 · COMISIÓN POR AGENCIA (en el usuario)
--
-- La comisión es POR AGENCIA, no por paquete. Cada aliado (usuario agencia/
-- freelance) trae su % por defecto al registrarse (12% agencia, 11% freelance)
-- y el superadmin puede ajustarlo por usuario. Se aplica sobre la base
-- comisionable (PVP − impuesto; si no hay impuesto, sobre el total).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.usuarios
  add column if not exists pct_comision numeric(6,4);  -- fracción (0.12 = 12%)
