const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const port = process.env.PORT || 3000;

// Serve static files from the public folder
app.use(express.static('public'));

let players = {};

// Handle Socket.IO connections
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // Add new player with a default name
    players[socket.id] = { id: socket.id, name: `Player-${socket.id.substring(0, 4)}` };

    // Broadcast updated players list to all connected clients
    io.emit('players', Object.values(players));

    // Listen for chat messages
    socket.on('chat message', (msg) => {
        io.emit('chat message', { id: socket.id, msg });
    });

    // When a player disconnects, remove them from the list
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('players', Object.values(players));
    });

    // Future game-specific events (e.g., role assignment, voting) can be added here.
});

http.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
