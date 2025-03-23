const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const ADMIN_SECRET = "your-secret-key"; // Change this to your secret key
const port = process.env.PORT || 3000;

// Serve static files from the public folder
app.use(express.static('public'));

// Admin page route – requires secret key via query parameter (e.g. /admin?key=your-secret-key)
app.get('/admin', (req, res) => {
    const key = req.query.key;
    if (key !== ADMIN_SECRET) {
        return res.status(403).send("Forbidden: Incorrect secret key.");
    }
    res.sendFile(__dirname + '/public/admin.html');
});

// Game state and player store
let players = {}; // { socketId: { id, name, role, alive } }
let gameState = {
    phase: "waiting", // waiting, night, day, voting
    werewolfVote: null,
    seerVote: null,
    medicVote: null,
    votes: {} // { targetId: voteCount }
};

// Utility function to broadcast current phase and player status to all clients
function broadcastStatus() {
    io.emit('phase changed', { phase: gameState.phase });
    io.emit('players', Object.values(players));
}

// Function to randomly assign roles to players
function assignRoles() {
    const playerIds = Object.keys(players);
    const numPlayers = playerIds.length;
    if (numPlayers < 4) {
        io.emit('game message', "Not enough players to start the game. Minimum 4 required.");
        return;
    }
    // For simplicity, we assign one werewolf, one seer, one medic and the rest villagers.
    let rolesArray = ["werewolf", "seer", "medic"];
    while (rolesArray.length < numPlayers) {
        rolesArray.push("villager");
    }
    // Shuffle the roles randomly
    rolesArray = rolesArray.sort(() => Math.random() - 0.5);
    // Distribute roles and mark everyone as alive
    playerIds.forEach((id, index) => {
        players[id].role = rolesArray[index];
        players[id].alive = true;
        io.to(id).emit('role assigned', { role: rolesArray[index] });
    });
    io.emit('game message', "Roles have been assigned. Night falls...");
    gameState.phase = "night";
    broadcastStatus();
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Check if this connection is from an admin (moderator)
    if (socket.handshake.query && socket.handshake.query.adminKey === ADMIN_SECRET) {
        socket.isAdmin = true;
        console.log(`Admin connected: ${socket.id}`);
    } else {
        // Register as a player (set alive to true by default)
        players[socket.id] = { id: socket.id, name: `Player-${socket.id.substring(0, 4)}`, alive: true };
        broadcastStatus();
    }

    // Chat message handler for all clients
    socket.on('chat message', (msg) => {
        io.emit('chat message', { id: socket.id, msg });
    });

    // ------------------ Night Phase Events ------------------
    // Werewolf sends their vote (only one vote per night)
    socket.on('werewolf vote', (data) => {
        if (players[socket.id] && players[socket.id].role === 'werewolf' && gameState.phase === 'night' && players[socket.id].alive) {
            gameState.werewolfVote = data.targetId;
            socket.emit('game message', `Werewolf vote recorded for ${data.targetId}`);
        }
    });

    // Seer sends their investigation choice
    socket.on('seer vote', (data) => {
        if (players[socket.id] && players[socket.id].role === 'seer' && gameState.phase === 'night' && players[socket.id].alive) {
            gameState.seerVote = data.targetId;
            // Immediately send result privately to the seer
            const targetRole = players[data.targetId] ? players[data.targetId].role : "unknown";
            const result = (targetRole === 'werewolf') ? "Yes, they are the werewolf." : "No, they are not the werewolf.";
            socket.emit('seer result', { targetId: data.targetId, result });
        }
    });

    // Medic sends their save choice
    socket.on('medic vote', (data) => {
        if (players[socket.id] && players[socket.id].role === 'medic' && gameState.phase === 'night' && players[socket.id].alive) {
            gameState.medicVote = data.targetId;
            socket.emit('game message', `Medic vote recorded for ${data.targetId}`);
        }
    });

    // ------------------ Daytime Voting Event ------------------
    // During day phase, players can vote by clicking a player's name.
    socket.on('vote', (data) => {
        if (players[socket.id] && players[socket.id].alive && gameState.phase === 'day') {
            // Record vote: increase count for target
            gameState.votes[data.targetId] = (gameState.votes[data.targetId] || 0) + 1;
            io.emit('game message', `A vote was cast for ${data.targetId}`);
        }
    });

    // ------------------ Admin Commands ------------------
    socket.on('admin command', (data) => {
        if (!socket.isAdmin) return;
        if (data.action === 'start') {
            assignRoles();
        }
        // End Night: process the votes from werewolf, seer, medic
        if (data.action === 'endNight' && gameState.phase === 'night') {
            let victimId = gameState.werewolfVote;
            if (!victimId) {
                io.emit('game message', "No werewolf vote was cast. No victim tonight.");
            } else {
                if (gameState.medicVote === victimId) {
                    io.emit('game message', "Medic saved the victim! No one dies tonight.");
                } else {
                    // Mark the victim as dead
                    if (players[victimId]) {
                        players[victimId].alive = false;
                        io.emit('game message', `Player ${players[victimId].name} (${victimId.substring(0,4)}) died last night.`);
                    }
                }
            }
            // Reset night votes and move to day phase
            gameState.werewolfVote = null;
            gameState.seerVote = null;
            gameState.medicVote = null;
            gameState.votes = {};
            gameState.phase = "day";
            broadcastStatus();
        }
        // End Voting: tally votes and eliminate a player
        if (data.action === 'endVoting' && gameState.phase === 'day') {
            let maxVotes = 0, eliminated = null;
            for (let targetId in gameState.votes) {
                if (gameState.votes[targetId] > maxVotes) {
                    maxVotes = gameState.votes[targetId];
                    eliminated = targetId;
                }
            }
            if (eliminated && players[eliminated] && players[eliminated].alive) {
                players[eliminated].alive = false;
                let roleRevealed = players[eliminated].role;
                io.emit('game message', `Voting complete: ${players[eliminated].name} (${eliminated.substring(0,4)}) was eliminated. They were a ${roleRevealed}.`);
            } else {
                io.emit('game message', "Voting complete: No one was eliminated.");
            }
            // Reset votes and transition back to night phase if game continues
            gameState.votes = {};
            gameState.phase = "night";
            io.emit('game message', "Night falls again...");
            broadcastStatus();
        }
    });

    // ------------------ Handle Disconnections ------------------
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (!socket.isAdmin && players[socket.id]) {
            delete players[socket.id];
            broadcastStatus();
        }
    });
});

// Listen on all network interfaces
http.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
