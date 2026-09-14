const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      // Render mantiene este proceso vivo para Socket.IO; cinco conexiones
      // alcanzan para el tráfico actual sin presionar el clúster Atlas M0.
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 30000,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
    });
    console.log('✅ MongoDB conectado a su base');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

module.exports = connectDB;
