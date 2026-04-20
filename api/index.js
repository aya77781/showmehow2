const express = require('express');
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

// Supabase client (init)
require('./config/supabase');
console.log('Supabase client initialized');

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tutorials', require('./routes/tutorial'));
app.use('/api/stripe', require('./routes/stripe'));
app.use('/api/explore', require('./routes/explore'));
app.use('/api/admin', require('./routes/admin'));

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
  SUPABASE_URL: process.env.SUPABASE_URL ? '✓ set' : '✗ MISSING',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? '✓ set' : '✗ MISSING',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '✓ set' : '✗ MISSING',
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ? '✓ set' : '✗ MISSING',
  ELEVENLABS_API_KEY_BACKUP: process.env.ELEVENLABS_API_KEY_BACKUP ? '✓ set' : '✗ MISSING',
  SERPER_API_KEY: process.env.SERPER_API_KEY ? '✓ set' : '✗ MISSING',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? '✓ set' : '✗ MISSING',
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
