-- ============================================================
-- GPMD — Validación de facturas duplicadas entre participantes
-- (mismo NIT + número de factura, o mismo NIT + fecha + valor)
-- ============================================================

ALTER TABLE gpmd_facturas ADD COLUMN IF NOT EXISTS numero_factura VARCHAR(60);
CREATE INDEX IF NOT EXISTS idx_facturas_nit_numero ON gpmd_facturas(nit, numero_factura);
