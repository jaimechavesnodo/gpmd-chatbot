const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth(['admin']), async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const from = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('gpmd_log')
    .select(`
      id, entidad, entidad_id, accion, detalle, fuente, created_at,
      usuario:usuario_id (nombre, email, rol)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count, page, limit });
});

module.exports = router;
