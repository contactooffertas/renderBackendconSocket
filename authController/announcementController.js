// authController/announcementController.js
const Announcement = require('../models/announcementModelChat');
const Business     = require('../models/businessModel');
const User         = require('../models/userModel');
const PushSub      = require('../models/pushsuscriptionmodel');
const webpush      = require('web-push'); // ya viene configurado por pushRoute.js al levantar el server

function getIO(req) {
  return req.app.get('io');
}

async function createDBNotification(userId, title, message, type = 'general', meta = {}) {
  try {
    const Notification = require('../models/notificationModel');
    await Notification.create({ userId, type, title, message, meta, read: false });
  } catch (err) {
    console.error('[createDBNotification]', err.message);
  }
}

/* ── Helper: enviar push real a los usuarios de una audiencia ──────────────── */
async function sendPushToAudience({ audience, title, message, link }) {
  try {
    let roleFilter = {};
    if (audience === 'seller') roleFilter = { role: 'seller' };
    else if (audience === 'buyer') roleFilter = { role: { $ne: 'seller' } };
    // 'all' → sin filtro de rol

    const users = await User.find(roleFilter).select('_id').lean();
    if (!users.length) return;

    const userIds = users.map(u => u._id);
    const subs = await PushSub.find({ user: { $in: userIds } }).lean();
    if (!subs.length) return;

    const payload = JSON.stringify({
      title: `📢 ${title}`,
      body: message,
      url: link || '/',
      icon: 'https://ofert.vercel.app/assets/offerton.jpg',
      badge: 'https://ofert.vercel.app/assets/offerton.jpg',
      tag: 'announcement',
      renotify: true,
      requireInteraction: false,
    });

    const sends = subs.map(async (doc) => {
      try {
        await webpush.sendNotification(doc.subscription, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSub.deleteOne({ _id: doc._id });
        }
      }
    });

    await Promise.allSettled(sends);
    console.log(`[Push] Anuncio enviado a ${subs.length} dispositivos (audiencia: ${audience})`);
  } catch (err) {
    console.error('[sendPushToAudience]', err);
  }
}

/* ══════════════ ADMIN ══════════════ */

exports.getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 }).lean();
    res.json({ announcements });
  } catch (err) {
    console.error('[getAnnouncements]', err);
    res.status(500).json({ message: 'Error obteniendo anuncios' });
  }
};

exports.createAnnouncement = async (req, res) => {
  try {
    const { title, message, audience = 'all', durationHours = 24, link } = req.body;

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ message: 'Título y mensaje son requeridos' });
    }

    const hours = Math.max(1, Math.min(720, Number(durationHours) || 24));
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + hours);

    const announcement = await Announcement.create({
      title: title.trim(),
      message: message.trim(),
      audience,
      durationHours: hours,
      link: link?.trim() || undefined,
      expiresAt,
      active: true,
      createdBy: req.user.id,
    });

    // ── Socket: solo para quien tiene la app abierta en este momento ──────
    const io = getIO(req);
    if (io) {
      io.emit('new_announcement', {
        _id: announcement._id,
        title: announcement.title,
        message: announcement.message,
        audience: announcement.audience,
        link: announcement.link,
        createdAt: announcement.createdAt,
        expiresAt: announcement.expiresAt,
      });
    }

    // ── Push real: llega aunque la app esté cerrada o en 2do plano ────────
    sendPushToAudience({
      audience,
      title: announcement.title,
      message: announcement.message,
      link: announcement.link,
    });

    res.status(201).json({ message: `Anuncio creado y enviado a "${audience}"`, announcement });
  } catch (err) {
    console.error('[createAnnouncement]', err);
    res.status(500).json({ message: 'Error creando anuncio' });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ message: 'Anuncio no encontrado' });
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ message: 'Anuncio eliminado' });
  } catch (err) {
    console.error('[deleteAnnouncement]', err);
    res.status(500).json({ message: 'Error eliminando anuncio' });
  }
};

/* ══════════════ USUARIO ══════════════ */

/**
 * GET /api/announcements/active
 * Devuelve activos según rol, EXCLUYENDO los que el usuario actual ya leyó.
 * Así "desaparece" solo para él, sin tocar el documento compartido.
 */
exports.getActiveAnnouncements = async (req, res) => {
  try {
    const now = new Date();
    const userRole = req.user?.role || 'user';
    const userId = req.user.id;

    let audienceFilter;
    if (userRole === 'admin') {
      audienceFilter = { audience: { $in: ['all', 'seller', 'buyer'] } };
    } else if (userRole === 'seller') {
      audienceFilter = { audience: { $in: ['all', 'seller'] } };
    } else {
      audienceFilter = { audience: { $in: ['all', 'buyer'] } };
    }

    const announcements = await Announcement.find({
      ...audienceFilter,
      expiresAt: { $gt: now },
      active: true,
      readBy: { $ne: userId }, // ← clave: no se la muestro de nuevo a quien ya la leyó
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ announcements });
  } catch (err) {
    console.error('[getActiveAnnouncements]', err);
    res.status(500).json({ message: 'Error obteniendo anuncios' });
  }
};

/**
 * PATCH /api/announcements/:id/read
 * Marca el anuncio como leído SOLO para el usuario autenticado.
 */
exports.markAnnouncementRead = async (req, res) => {
  try {
    await Announcement.findByIdAndUpdate(req.params.id, {
      $addToSet: { readBy: req.user.id },
    });
    res.json({ message: 'Marcado como leído' });
  } catch (err) {
    console.error('[markAnnouncementRead]', err);
    res.status(500).json({ message: 'Error marcando como leído' });
  }
};

/* ══════════════ SUSCRIPTORES (sin cambios) ══════════════ */

exports.getSubscribers = async (req, res) => {
  try {
    const { search = '', limit = 100 } = req.query;
    const query = search ? { name: { $regex: search, $options: 'i' } } : {};
    const businesses = await Business.find(query)
      .sort({ cuotaSuscriptor: -1, createdAt: -1 })
      .limit(Number(limit))
      .populate('owner', 'name email')
      .lean();
    res.json({ businesses });
  } catch (err) {
    console.error('[getSubscribers]', err);
    res.status(500).json({ message: 'Error obteniendo suscriptores' });
  }
};

exports.updateSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { cuotaSuscriptor, fechaPago, fechaFinaliza } = req.body;
    const biz = await Business.findById(id).populate('owner', '_id name email');
    if (!biz) return res.status(404).json({ message: 'Negocio no encontrado' });
    const wasActive = biz.cuotaSuscriptor;
    biz.cuotaSuscriptor = Boolean(cuotaSuscriptor);
    biz.fechaPago = fechaPago ? new Date(fechaPago) : null;
    biz.fechaFinaliza = fechaFinaliza ? new Date(fechaFinaliza) : null;
    await biz.save();

    const ownerId = biz.owner?._id;
    if (ownerId && cuotaSuscriptor) {
      const io = getIO(req);
      const fechaPagoFmt = fechaPago ? new Date(fechaPago).toLocaleDateString('es-AR') : '—';
      const fechaFinalizaFmt = fechaFinaliza ? new Date(fechaFinaliza).toLocaleDateString('es-AR') : '—';
      const msg = wasActive
        ? `✅ Tu suscripción en "${biz.name}" fue actualizada. Vigente hasta el ${fechaFinalizaFmt}.`
        : `🎉 ¡Tu suscripción en "${biz.name}" fue activada! Fecha de pago: ${fechaPagoFmt}. Válida hasta: ${fechaFinalizaFmt}.`;

      if (io) {
        io.to(`user_${ownerId.toString()}`).emit('subscription_activated', { businessName: biz.name, fechaPago: fechaPagoFmt, fechaFinaliza: fechaFinalizaFmt, message: msg });
        io.to(`user:${ownerId.toString()}`).emit('subscription_activated', { businessName: biz.name, fechaPago: fechaPagoFmt, fechaFinaliza: fechaFinalizaFmt, message: msg });
      }
      await createDBNotification(ownerId, wasActive ? '✅ Suscripción actualizada' : '🎉 ¡Suscripción activada!', msg, 'subscription_activated', { businessId: biz._id, fechaPago, fechaFinaliza });
    }

    res.json({
      message: cuotaSuscriptor ? 'Suscripción activada y notificación enviada al vendedor' : 'Suscripción removida',
      business: { _id: biz._id, cuotaSuscriptor: biz.cuotaSuscriptor, fechaPago: biz.fechaPago, fechaFinaliza: biz.fechaFinaliza },
    });
  } catch (err) {
    console.error('[updateSubscription]', err);
    res.status(500).json({ message: 'Error actualizando suscripción' });
  }
};
