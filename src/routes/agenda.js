const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');

// GET /api/agenda — todos los slots con info de participante si está reservado
router.get('/', requireAuth(['admin', 'cliente']), async (req, res) => {
  const { data, error } = await supabase
    .from('gpmd_slots')
    .select(`
      id, fecha, franja, hora_inicio, hora_fin, numero_slot, reservado_at,
      participant:participant_id (
        id, nombre_piloto, cedula, phone, email, ciudad,
        nombre_copiloto, vehiculo_placa, vehiculo_marca, vehiculo_modelo,
        codigo_preregistro, estado
      )
    `)
    .order('fecha')
    .order('franja')
    .order('numero_slot');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/agenda/:id — detalle de un slot
router.get('/:id', requireAuth(['admin', 'cliente']), async (req, res) => {
  const { data, error } = await supabase
    .from('gpmd_slots')
    .select(`
      *,
      participant:participant_id (*),
      factura:participant_id ( gpmd_facturas(*) )
    `)
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Slot no encontrado' });
  res.json(data);
});

// POST /api/agenda/manual — registro manual de slot (solo admin)
router.post('/manual', requireAuth(['admin']), async (req, res) => {
  const { slot_id, participant_id } = req.body;
  if (!slot_id || !participant_id) return res.status(400).json({ error: 'slot_id y participant_id requeridos' });

  // Verificar que el slot esté disponible
  const { data: slot } = await supabase
    .from('gpmd_slots')
    .select('id, participant_id')
    .eq('id', slot_id)
    .single();

  if (!slot) return res.status(404).json({ error: 'Slot no encontrado' });
  if (slot.participant_id) return res.status(409).json({ error: 'Slot ya ocupado' });

  const { data, error } = await supabase
    .from('gpmd_slots')
    .update({ participant_id, reservado_at: new Date().toISOString() })
    .eq('id', slot_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await logActivity({
    entidad: 'slots', entidadId: slot_id,
    accion: 'slot_reservado_manual',
    detalle: { participant_id, por: 'admin' },
    usuarioId: req.user.id,
  });

  res.json(data);
});

// DELETE /api/agenda/:id/liberar — liberar un slot (solo admin)
router.delete('/:id/liberar', requireAuth(['admin']), async (req, res) => {
  const { data: slot } = await supabase.from('gpmd_slots').select('*').eq('id', req.params.id).single();
  if (!slot) return res.status(404).json({ error: 'Slot no encontrado' });

  await supabase.from('gpmd_slots')
    .update({ participant_id: null, reservado_at: null })
    .eq('id', req.params.id);

  await logActivity({
    entidad: 'slots', entidadId: req.params.id,
    accion: 'slot_liberado',
    detalle: { anterior_participant: slot.participant_id },
    usuarioId: req.user.id,
  });

  res.json({ ok: true });
});

module.exports = router;
