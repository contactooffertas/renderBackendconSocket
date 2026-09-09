// server.js
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const http       = require('http');
const connectDB  = require('./config/db');
const { initSocket } = require('./socket');

// ── Rutas ─────────────────────────────────────────────────────────────────────
const authRoutes            = require('./routes/authRoute');
const userRoutes            = require('./routes/userRoute');
const busiRoutes            = require('./routes/businessRoute');
const productRoutes         = require('./routes/productRoute');
const adminRoutes           = require('./routes/adminRoute');
const cartRoutes            = require('./routes/cartRoute');
const orderRoutes           = require('./routes/orderRoute');
const chatRoutes            = require('./routes/chatRoute');
const reportRoutes          = require('./routes/reportRoute');
const announcementRoutes    = require('./routes/announcementRoute');
const terminosRoutes        = require('./routes/terminosRoute');
const eliminaUsuarioRoutes  = require('./routes/eliminarUsuarioRoute');
const { router: pushRoutes } = require('./routes/pushRoute');

const app = express();
connectDB();

// ── CORS compartido con el frontend de producción ─────────────────────────────
const ALLOWED_ORIGINS = [
  'https://rosariomarket.com.ar',
  'https://www.rosariomarket.com.ar',
];

const isAllowedOrigin = (origin) => (
  !origin ||
  ALLOWED_ORIGINS.includes(origin) ||
  /^https:\/\/ofertas-[a-z0-9-]+-contactooffertas-projects\.vercel\.app$/.test(origin)
);

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS bloqueado: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Servidor de Offertas conectado' });
});

app.use('/api/auth',            authRoutes);
app.use('/api/user',            userRoutes);
app.use('/api/business',        busiRoutes);
app.use('/api/products',        productRoutes);
app.use('/api/cart',            cartRoutes);
app.use('/api/orders',          orderRoutes);
app.use('/api/chat',            chatRoutes);
app.use('/api/push',            pushRoutes);
app.use('/api/reports',         reportRoutes);
app.use('/api/admin',           adminRoutes);
app.use('/api/announcements',   announcementRoutes);
app.use('/api/terminos',        terminosRoutes);
app.use('/api/elimina-usuario', eliminaUsuarioRoutes);

const httpServer = http.createServer(app);
const io         = initSocket(httpServer);
app.set('io', io);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO listo`);
});

module.exports = { app, httpServer, io };
