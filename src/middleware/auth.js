const jwt = require('jsonwebtoken');

function requireAuth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autorizado' });

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = payload;
      if (roles.length && !roles.includes(payload.rol)) {
        return res.status(403).json({ error: 'Acceso denegado' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Token inválido' });
    }
  };
}

module.exports = { requireAuth };
