// socket/index.js
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const User       = require('../models/userModel');

const SOCKET_ALLOWED_ORIGINS = [
  'https://rosariomarket.com.ar',
  'https://www.rosariomarket.com.ar',
  'https://ofertas-lime-ten.vercel.app',
  'http://localhost:3000',
];

function isSocketOriginAllowed(origin) {
  return (
    !origin ||
    SOCKET_ALLOWED_ORIGINS.includes(origin) ||
    /^https:\/\/ofertas-[a-z0-9-]+-contactooffertas-projects\.vercel\.app$/.test(origin)
  );
}

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isSocketOriginAllowed(origin)) return callback(null, true);
        return callback(new Error(`Socket CORS bloqueado: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type'],
    },
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token provided'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id || decoded._id || decoded.userId;
      if (!socket.userId) return next(new Error('Invalid token payload'));

      try {
        const user = await User.findById(socket.userId).select('role name').lean();
        socket.role = user?.role || 'user';
        socket.userName = user?.name || socket.userId;
      } catch {
        socket.role = 'user';
        socket.userName = socket.userId;
      }

      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.userId?.toString();

    socket.join(`user_${uid}`);
    socket.join(`user:${uid}`);

    if (socket.role === 'admin') {
      socket.join('admins');
      console.log(`[WS] Admin conectado: ${socket.userName}`);
    } else {
      console.log(`[WS] Usuario conectado: ${uid} (${socket.role})`);
    }

    socket.on('join_user_room', (payload) => {
      const targetId = (typeof payload === 'object' ? payload?.userId : payload)?.toString();
      if (targetId && targetId === uid) {
        socket.join(`user_${targetId}`);
        socket.join(`user:${targetId}`);
      }
    });

    socket.on('join_admin_room', () => {
      if (socket.role === 'admin') socket.join('admins');
    });

    socket.on('join_conv', ({ conversationId }) => {
      if (conversationId) socket.join(`conv_${conversationId}`);
    });

    socket.on('read_messages', ({ conversationId }) => {
      if (!conversationId) return;
      socket.to(`conv_${conversationId}`).emit('messages_read', { conversationId });
    });

    socket.on('typing', ({ conversationId }) => {
      if (!conversationId) return;
      socket.broadcast.to(`conv_${conversationId}`).emit('typing', { userId: uid, conversationId });
    });

    socket.on('stop_typing', ({ conversationId }) => {
      if (!conversationId) return;
      socket.broadcast.to(`conv_${conversationId}`).emit('stop_typing', { userId: uid, conversationId });
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Usuario desconectado: ${uid}`);
    });
  });

  io.emitToUser = (userId, event, data) => {
    const id = userId.toString();
    io.to(`user_${id}`).emit(event, data);
    io.to(`user:${id}`).emit(event, data);
  };

  io.emitToAdmins = (event, data) => {
    io.to('admins').emit(event, data);
  };

  return io;
}

module.exports = { initSocket };
