-- ============================================================
-- GPMD 2026 — Seed de slots
-- Fechas: martes 21, miércoles 22, jueves 23, viernes 24 de julio 2026
-- Franjas: AM (08:00-12:00) | PM (14:00-18:00)
-- Capacidad por franja: 50 slots (ajustar SLOTS_POR_FRANJA según necesidad)
-- ============================================================

DO $$
DECLARE
  dias DATE[] := ARRAY['2026-07-21','2026-07-22','2026-07-23','2026-07-24']::DATE[];
  d DATE;
  i INTEGER;
  slots_por_franja INTEGER := 50;  -- ← AJUSTAR SEGÚN CONFIRMACIÓN DEL CLIENTE
BEGIN
  FOREACH d IN ARRAY dias LOOP
    FOR i IN 1..slots_por_franja LOOP
      INSERT INTO gpmd_slots (fecha, franja, hora_inicio, hora_fin, numero_slot)
      VALUES (d, 'AM', '08:00', '12:00', i)
      ON CONFLICT (fecha, franja, numero_slot) DO NOTHING;

      INSERT INTO gpmd_slots (fecha, franja, hora_inicio, hora_fin, numero_slot)
      VALUES (d, 'PM', '14:00', '18:00', i)
      ON CONFLICT (fecha, franja, numero_slot) DO NOTHING;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Slots creados: % días × 2 franjas × % = % slots totales',
    array_length(dias,1), slots_por_franja, array_length(dias,1)*2*slots_por_franja;
END $$;

-- Verificar
SELECT fecha, franja, COUNT(*) AS total_slots
FROM gpmd_slots
GROUP BY fecha, franja
ORDER BY fecha, franja;
