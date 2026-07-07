-- ============================================================
-- GPMD — Confirmar a Elmer Herney López Cárdenas (GPMD-LVMMRF)
-- El agente había aprobado su factura y luego la rechazó por
-- error como "duplicada" junto con sus 2 reenvíos posteriores.
-- Jaime confirmó (2026-07-08) mantener su cupo confirmado.
-- ============================================================

UPDATE gpmd_facturas
SET estado = 'aprobada_manual', revisado_at = now()
WHERE id = 'ec893265-fdae-45f1-84f2-2e5031aaf6a6'; -- factura originalmente aprobada por el agente

UPDATE gpmd_participants
SET estado = 'confirmado', updated_at = now()
WHERE id = 'b5a58adc-85dd-460d-bc29-9c8296d567ff'; -- Elmer Herney López Cárdenas
