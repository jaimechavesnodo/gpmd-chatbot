-- ============================================================
-- GPMD v2.3 — PDV: columna Dirección (informativa, viene en el
-- listado final de puntos de venta)
-- ============================================================

ALTER TABLE gpmd_pdv ADD COLUMN IF NOT EXISTS direccion VARCHAR(250);
