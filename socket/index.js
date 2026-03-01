// socket/index.js
const { Server } = require("socket.io");
const jwt        = require("jsonwebtoken");
const User       = require("../models/userModel");

/**
 * initSocket(httpServer)
 * Llamar desde server.js después de crear el servidor HTTP.
 * Devuelve la instancia `io` — pasarla a Express con app.set('io', io).
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: [
        "https://ofertas-lime-ten.vercel.app",
      ],
      methods:     ["GET", "POST"],
      credentials: true,
    },
  });

  /* ── Middleware de autenticación JWT ──────────────────────────────────── */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token provided"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id || decoded._id || decoded.userId;

      if (!socket.userId) return next(new Error("Invalid token payload"));

      try {
        const user      = await User.findById(socket.userId).select("role name").lean();
        socket.role     = user?.role  || "user";
        socket.userName = user?.name  || socket.userId;
      } catch {
        socket.role     = "user";
        socket.userName = socket.userId;
      }

      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  /* ── Conexión ─────────────────────────────────────────────────────────── */
  io.on("connection", (socket) => {
    const uid = socket.userId?.toString();

    // ── Salas privadas del usuario — unirse SIEMPRE al conectar ──────────
    // El chatController emite a user_${pid}, por eso ambos formatos son necesarios
    socket.join(`user_${uid}`);
    socket.join(`user:${uid}`);

    if (socket.role === "admin") {
      socket.join("admins");
      console.log(`[WS] Admin conectado: ${socket.userName}`);
    } else {
      console.log(`[WS] Usuario conectado: ${uid} (${socket.role})`);
    }

    /* ── Registro explícito de salas desde el cliente ─────────────────────
       FIX: el frontend envía { userId } como objeto, hay que desestructurar */
    socket.on("join_user_room", (payload) => {
      // Soporta tanto join_user_room("abc123") como join_user_room({ userId: "abc123" })
      const targetId = (typeof payload === "object" ? payload?.userId : payload)?.toString();
      if (targetId && targetId === uid) {
        socket.join(`user_${targetId}`);
        socket.join(`user:${targetId}`);
        console.log(`[WS] join_user_room OK: user_${targetId}`);
      } else {
        console.warn(`[WS] join_user_room rechazado: payload=${JSON.stringify(payload)}, uid=${uid}`);
      }
    });

    socket.on("join_admin_room", () => {
      if (socket.role === "admin") socket.join("admins");
    });

    /* ════════════════════════════════════════════════════════════════════
       CHAT
    ════════════════════════════════════════════════════════════════════ */

    // Unirse a la sala de una conversación específica
    // El chatController emite a user_${pid} (sala personal), no a conv_${id},
    // pero join_conv sirve para typing/stop_typing que sí usan conv_${id}
    socket.on("join_conv", ({ conversationId }) => {
      if (conversationId) {
        socket.join(`conv_${conversationId}`);
        console.log(`[WS] ${uid} joined conv_${conversationId}`);
      }
    });

    socket.on("read_messages", ({ conversationId }) => {
      socket.broadcast.emit("messages_read", { conversationId });
    });

    socket.on("typing", ({ conversationId }) => {
      socket.broadcast
        .to(`conv_${conversationId}`)
        .emit("typing", { userId: uid, conversationId });
    });

    socket.on("stop_typing", ({ conversationId }) => {
      socket.broadcast
        .to(`conv_${conversationId}`)
        .emit("stop_typing", { userId: uid, conversationId });
    });

    /* ════════════════════════════════════════════════════════════════════
       DESCONEXIÓN
    ════════════════════════════════════════════════════════════════════ */
    socket.on("disconnect", () => {
      console.log(`[WS] Usuario desconectado: ${uid}`);
    });
  });

  /* ── Helpers para usar desde controllers ─────────────────────────────── */

  /**
   * Emite a un usuario específico usando ambos formatos de sala.
   */
  io.emitToUser = (userId, event, data) => {
    io.to(`user_${userId.toString()}`).emit(event, data);
    io.to(`user:${userId.toString()}`).emit(event, data);
  };

  /**
   * Emite a todos los admins conectados.
   */
  io.emitToAdmins = (event, data) => {
    io.to("admins").emit(event, data);
  };

  return io;
}


module.exports = { initSocket };
