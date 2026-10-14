import User from '../models/User.js';
import GeneratedQuote from '../models/GeneratedQuote.js';
import createNotification from './createNotification.js';

/**
 * Notifica cambios de Proyectos/entregas entre Arturo y Paula:
 *  - Broadcast por socket ('proyectos:update') para que la sección se refresque sola.
 *  - Notificación con badge (type 'proyecto') al que NO hizo el cambio.
 * Fire-and-forget: nunca tira la request principal.
 */
export async function notifyCambioProyecto(req, { quoteId, accion, priority = 'medium' }) {
  try {
    const actor = req.user?.name || 'Alguien';
    const gq = quoteId ? await GeneratedQuote.findById(quoteId).select('clientName').lean() : null;
    const cliente = gq?.clientName || 'un proyecto';
    const message = `📦 ${actor} ${accion} — ${cliente}`;

    // Refresco en vivo para todos los que tengan Proyectos abierto
    try { req.app?.get?.('io')?.emit('proyectos:update', { quoteId: String(quoteId || ''), por: actor, accion }); } catch { /* noop */ }

    // Badge/campana solo para el que no hizo el cambio (Arturo superadmin + Paula admin)
    const targets = await User.find({
      $or: [{ role: 'superadmin' }, { role: 'admin', name: /paula/i }],
    }).select('_id name').lean();
    for (const t of targets) {
      if (String(t._id) === String(req.user?._id)) continue;
      await createNotification(req.app, {
        user: t._id,
        type: 'proyecto',
        message,
        data: { quoteId: String(quoteId || '') },
        link: '/admin/proyectos',
        priority,
      });
    }
  } catch (e) {
    console.warn('[notifyProyectos]', e.message);
  }
}

export default notifyCambioProyecto;
