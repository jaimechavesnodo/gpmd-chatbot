const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');
const wati = require('../lib/wati');
const { etiquetaFecha } = require('../lib/conversation');

const RAZONES_LABEL = {
  foto_ilegible: 'la foto o factura no es legible',
  fuera_periodo: 'la factura está fuera de las fechas de participación',
  producto_no_participante: 'el producto o la presentación no participan',
  establecimiento_no_participante: 'el establecimiento no participa',
  factura_duplicada: 'la factura ya fue registrada anteriormente',
  valor_insuficiente: 'el valor no cumple el mínimo requerido',
  otro: null,
};

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

  // Notificar al participante por WhatsApp + atributos WATI
  await notificarAprobado(data.participant_id, data.participant).catch((e) => console.error('[GPMD] notif aprobado:', e.message));

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

  await notificarRechazado(data.participant, razon_rechazo, razon_rechazo_detalle).catch((e) => console.error('[GPMD] notif rechazo:', e.message));

  res.json({ ok: true, data });
});

// Aprobación manual: confirma cita por WhatsApp + setea atributos agendado/fecha_agenda
async function notificarAprobado(participantId, part) {
  if (!part?.phone) return;
  const { data: slot } = await supabase.from('gpmd_slots')
    .select('fecha, franja').eq('participant_id', participantId).maybeSingle();
  const fechaAgenda = slot ? etiquetaFecha(slot.fecha, slot.franja) : '';
  const nombre = (part.nombre_piloto || '').split(' ')[0] || 'piloto';

  await wati.updateContactAttributes(part.phone, [
    { name: 'agendado', value: 'true' },
    { name: 'fecha_agenda', value: fechaAgenda },
  ]).catch(() => {});

  await wati.sendSessionMessage(part.phone,
    `✅ *¡Tu cita quedó confirmada, ${nombre}!*\n\n`
    + `Tu factura fue verificada para el *Gran Premio Mobil Delvac 2026*.\n\n`
    + `🏁 Código: *${part.codigo_preregistro}*\n`
    + `📅 Cita: *${fechaAgenda}*\n\n`
    + `Preséntate en tu horario con los documentos originales. ¡Mucha suerte! 🚛💨`);
}

// Rechazo manual: informa la razón al participante por WhatsApp
async function notificarRechazado(part, razon, detalle) {
  if (!part?.phone) return;
  const nombre = (part.nombre_piloto || '').split(' ')[0] || 'piloto';
  const label = RAZONES_LABEL[razon] || detalle || 'no cumple las condiciones de participación';

  await wati.sendSessionMessage(part.phone,
    `❌ *Hola ${nombre},*\n\n`
    + `Tuvimos un problema con tu factura: *${label}*.\n\n`
    + `Si tienes dudas o deseas intentar de nuevo, responde este mensaje y un asesor te ayudará.`);
}

module.exports = router;
