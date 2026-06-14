const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth(['admin', 'cliente']), async (req, res) => {
  const [
    { count: total_participantes },
    { count: aprobados },
    { count: rechazados },
    { count: en_revision },
    { data: facturas_estado },
    { data: slots_info },
    { data: referencias },
    { data: rechazos_causas },
  ] = await Promise.all([
    supabase.from('gpmd_participants').select('*', { count: 'exact', head: true }),
    supabase.from('gpmd_participants').select('*', { count: 'exact', head: true }).eq('estado', 'aprobado'),
    supabase.from('gpmd_participants').select('*', { count: 'exact', head: true }).eq('estado', 'rechazado'),
    supabase.from('gpmd_facturas').select('*', { count: 'exact', head: true }).eq('estado', 'en_revision'),
    supabase.from('gpmd_facturas').select('estado').neq('estado', null),
    supabase.from('gpmd_slots').select('fecha, franja, participant_id'),
    supabase.from('gpmd_facturas').select('referencia_producto').not('referencia_producto', 'is', null),
    supabase.from('gpmd_facturas').select('razon_rechazo').eq('estado', 'rechazada').not('razon_rechazo', 'is', null),
  ]);

  // Conteos de facturas por estado
  const conteo_facturas = {};
  (facturas_estado || []).forEach(f => {
    conteo_facturas[f.estado] = (conteo_facturas[f.estado] || 0) + 1;
  });

  // Slots: disponibles vs agendados por día/franja
  const agenda = {};
  (slots_info || []).forEach(s => {
    const key = `${s.fecha}_${s.franja}`;
    if (!agenda[key]) agenda[key] = { fecha: s.fecha, franja: s.franja, total: 0, agendados: 0 };
    agenda[key].total++;
    if (s.participant_id) agenda[key].agendados++;
  });

  // Frecuencia de referencias
  const refs = {};
  (referencias || []).forEach(f => {
    if (f.referencia_producto) refs[f.referencia_producto] = (refs[f.referencia_producto] || 0) + 1;
  });

  // Causas de rechazo
  const causas = {};
  (rechazos_causas || []).forEach(f => {
    if (f.razon_rechazo) causas[f.razon_rechazo] = (causas[f.razon_rechazo] || 0) + 1;
  });

  res.json({
    total_participantes,
    aprobados,
    rechazados,
    en_revision,
    facturas: {
      pendiente: conteo_facturas.pendiente || 0,
      aprobada_auto: conteo_facturas.aprobada_auto || 0,
      aprobada_manual: conteo_facturas.aprobada_manual || 0,
      en_revision: conteo_facturas.en_revision || 0,
      rechazada: conteo_facturas.rechazada || 0,
    },
    agenda: Object.values(agenda).sort((a, b) => a.fecha > b.fecha ? 1 : -1),
    referencias: Object.entries(refs).map(([ref, n]) => ({ ref, n })).sort((a, b) => b.n - a.n),
    causas_rechazo: Object.entries(causas).map(([causa, n]) => ({ causa, n })).sort((a, b) => b.n - a.n),
  });
});

module.exports = router;
