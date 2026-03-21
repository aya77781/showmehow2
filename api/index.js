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
app.use(express.json());

// Static files — serve session images/videos
app.use('/output', express.static('output'));

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/hackatonapp')
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tutorials', require('./routes/tutorial'));

app.get('/', (req, res) => {
  res.json({ message: 'ShowMe AI API is running' });
});

// Socket.IO — tutorial real-time events
require('./sockets/tutorial')(io);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
