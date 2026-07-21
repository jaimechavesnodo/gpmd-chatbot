const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/buscar?q=  — busca participantes por cédula, nombre o placa
router.get('/', requireAuth(['admin', 'agente', 'cliente', 'consulta']), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;

  const { data, error } = await supabase
    .from('gpmd_participants')
    .select(`
      id, nombre_piloto, cedula, tipo_documento_piloto, novato, rh, phone,
      vehiculo_marca, vehiculo_placa, codigo_preregistro, estado, created_at,
      facturas:gpmd_facturas ( id, estado, cliente, nit, referencia_producto, presentacion, valor_total, imagen_url, ocr_motivo_revision, created_at )
    `)
    .or(`nombre_piloto.ilike.${like},cedula.ilike.${like},vehiculo_placa.ilike.${like},codigo_preregistro.ilike.${like}`)
    .eq('estado', 'confirmado')
    .limit(25);

  if (error) return res.status(500).json({ error: error.message });

  const out = (data || []).map((p) => {
    const fs = (p.facturas || []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return { ...p, factura: fs[0] || null, tiene_factura: fs.length > 0, facturas: undefined };
  });
  res.json(out);
});

module.exports = router;
