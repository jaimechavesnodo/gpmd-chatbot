const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');
// GET /api/facturas/pendientes — cola de revisión manual
router.get('/pendientes', requireAuth(['admin', 'agente']), async (req, res) => {
  const { data, error } = await supabase
    .from('gpmd_facturas')
    .select(`
      id, imagen_url, estado, created_at,
      ocr_establecimiento, ocr_ciudad, ocr_fecha_compra, ocr_referencia_producto,
      ocr_presentacion, ocr_cantidad, ocr_valor_total, ocr_confianza, ocr_motivo_revision,
      participant:participant_id (
        id, nombre_piloto, cedula, phone, ciudad, codigo_preregistro
      )
    `)
    .eq('estado', 'en_revision')
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/facturas/:id — detalle completo
router.get('/:id', requireAuth(['admin', 'agente']), async (req, res) => {
  const { data, error } = await supabase
    .from('gpmd_facturas')
    .select(`*, participant:participant_id (*)`)
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Factura no encontrada' });
  res.json(data);
});

// PATCH /api/facturas/:id/aprobar — aprobación manual
router.patch('/:id/aprobar', requireAuth(['admin', 'agente']), async (req, res) => {
  const { establecimiento, ciudad, fecha_compra, referencia_producto, presentacion, cantidad, valor_total } = req.body;

  const campos = { establecimiento, ciudad, fecha_compra, referencia_producto, presentacion, cantidad, valor_total };
  for (const [k, v] of Object.entries(campos)) {
    if (!v && v !== 0) return res.status(400).json({ error: `Campo requerido: ${k}` });
  }

  const { data, error } = await supabase
    .from('gpmd_facturas')
    .update({
      ...campos,
      estado: 'aprobada_manual',
      revisado_por: req.user.id,
      revisado_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select('*, participant:participant_id (phone, nombre_piloto, codigo_preregistro)')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Actualizar estado del participante
  await supabase.from('gpmd_participants')
    .update({ estado: 'aprobado', updated_at: new Date().toISOString() })
    .eq('id', data.participant_id);

  await logActivity({
    entidad: 'facturas', entidadId: req.params.id,
    accion: 'manual_aprobado',
    detalle: campos,
    usuarioId: req.user.id,
  });

  // Disparar notificación WhatsApp vía n8n
  await notificarParticipante(data.participant?.phone, 'aprobado', data.participant?.nombre_piloto, data.participant?.codigo_preregistro).catch(() => {});

  res.json({ ok: true, data });
});

// PATCH /api/facturas/:id/rechazar — rechazo manual
router.patch('/:id/rechazar', requireAuth(['admin', 'agente']), async (req, res) => {
  const { razon_rechazo, razon_rechazo_detalle } = req.body;
  if (!razon_rechazo) return res.status(400).json({ error: 'razon_rechazo requerido' });

  const { data, error } = await supabase
    .from('gpmd_facturas')
    .update({
      estado: 'rechazada',
      razon_rechazo,
      razon_rechazo_detalle: razon_rechazo_detalle || null,
      revisado_por: req.user.id,
      revisado_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select('*, participant:participant_id (phone, nombre_piloto, codigo_preregistro)')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Actualizar estado del participante
  await supabase.from('gpmd_participants')
    .update({ estado: 'rechazado', updated_at: new Date().toISOString() })
    .eq('id', data.participant_id);

  // Liberar el slot si tenía uno reservado
  await supabase.from('gpmd_slots')
    .update({ participant_id: null, reservado_at: null })
    .eq('participant_id', data.participant_id);

  await logActivity({
    entidad: 'facturas', entidadId: req.params.id,
    accion: 'manual_rechazado',
    detalle: { razon_rechazo, razon_rechazo_detalle },
    usuarioId: req.user.id,
  });

  await notificarParticipante(data.participant?.phone, 'rechazado', data.participant?.nombre_piloto, null, razon_rechazo).catch(() => {});

  res.json({ ok: true, data });
});

async function notificarParticipante(phone, estado, nombre, codigo, razon) {
  const url = `${process.env.N8N_WEBHOOK_BASE_URL}/notificacion`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gpmd-secret': process.env.N8N_WEBHOOK_SECRET,
    },
    body: JSON.stringify({ phone, estado, nombre, codigo, razon }),
  });
}

module.exports = router;
