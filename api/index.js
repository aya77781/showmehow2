const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());

// Stripe webhook needs raw body — MUST be before express.json()
app.use('/api/webhook', require('./routes/webhook'));

app.use(express.json());

// Static files — serve session images/videos
app.use('/output', express.static('output', { maxAge: '1d' }));

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hackatonapp')
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tutorials', require('./routes/tutorial'));
app.use('/api/stripe', require('./routes/stripe'));
app.use('/api/explore', require('./routes/explore'));

app.get('/', (req, res) => {
  res.json({ message: 'ShowMe AI API is running' });
});

// Socket.IO — tutorial real-time events
require('./sockets/tutorial')(io);

// Startup config log
console.log('[Config]', {
  PORT,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  API_URL: process.env.API_URL || `http://localhost:${PORT}`,
  MONGO_URI: process.env.MONGO_URI ? '✓ set' : '✗ MISSING',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '✓ set' : '✗ MISSING',
  FAL_KEY: process.env.FAL_KEY ? '✓ set' : '✗ MISSING',
  FAL_KEY_BACKUP: process.env.FAL_KEY_BACKUP ? '✓ set' : '✗ MISSING',
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ? '✓ set' : '✗ MISSING',
  ELEVENLABS_API_KEY_BACKUP: process.env.ELEVENLABS_API_KEY_BACKUP ? '✓ set' : '✗ MISSING',
  SERPER_API_KEY: process.env.SERPER_API_KEY ? '✓ set' : '✗ MISSING',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? '✓ set' : '✗ MISSING',
  SKIP_AVATAR: process.env.SKIP_AVATAR || 'false',
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
