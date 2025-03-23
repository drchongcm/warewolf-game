const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');

const ADMIN_SECRET = "adminpass";  // Change as needed
const ROOM_PASSCODE = "roompass";    // Change as needed
const port = process.env.PORT || 3000;

// Serve static files from the public folder
app.use(express.static('public'));

// Endpoint for admin to download logs (accessed via /downloadLogs?key=adminpass)
app.get('/downloadLogs', (req, res) => {
    const key = req.query.key;
    if (key !== ADMIN_SECRET) {
        return res.status(403).send("Forbidden: Incorrect secret key.");
    }
    const logs = { chatLogs, gameLogs };
    res.setHeader('Content-disposition', 'attachment; filename=logs.json');
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(logs, null, 2));
});

// Data structures
let players = {};  // { socket.id: { id, nickname, studentId, role, alive, muted, activated, ... } }
let gameState = {
    phase: "I",  // "I" (Immune-pathological) or "H" (Homeostasis)
    votes: {}    // For H phase voting: { targetId: voteCount }
};
let chatLogs = []; // Array of { timestamp, sender, message, room }
let gameLogs = []; // Array of { timestamp, event, details }

// Utility logging functions
function logChat(sender, message, room = "global") {
    const entry = { timestamp: new Date(), sender, message, room };
    chatLogs.push(entry);
    console.log("[Chat]", entry);
}
function logGame(event, details) {
    const entry = { timestamp: new Date(), event, details };
    gameLogs.push(entry);
    console.log("[Game]", entry);
}

// Broadcast current game state to all clients
function broadcastState() {
    io.emit('game state', { phase: gameState.phase, players: Object.values(players) });
}

// Send a global game message (and log it)
function sendGlobalMessage(message) {
    io.emit('game message', message);
    logGame("global message", message);
}

// Transition phase (admin-triggered)
function transitionToPhase(phase) {
    gameState.phase = phase;
    gameState.votes = {};
    broadcastState();
    sendGlobalMessage(`Phase changed to ${phase} phase.`);
}

// Admin command: assign roles manually based on provided numbers
// Expected data: { roles: { granulocyte: x, macrophage: y, pathogen: z, egc: w, host: u } }
function assignRoles(rolesAssignment) {
    let alivePlayers = Object.values(players).filter(p => p.alive);
    alivePlayers.sort(() => Math.random() - 0.5);
    let totalAssigned = 0;
    for (let role in rolesAssignment) {
        totalAssigned += rolesAssignment[role];
    }
    if (totalAssigned > alivePlayers.length) {
        sendGlobalMessage("Not enough players for the given assignment.");
        return;
    }
    let assignedCount = 0;
    for (let role in rolesAssignment) {
        let count = rolesAssignment[role];
        for (let i = 0; i < count; i++) {
            alivePlayers[assignedCount].role = role;
            // For pathogens, add them to a private room
            if (role === "pathogen") {
                io.sockets.sockets.get(alivePlayers[assignedCount].id)?.join("pathogenRoom");
            }
            io.to(alivePlayers[assignedCount].id).emit('role assigned', { role });
            logGame("role assigned", { player: alivePlayers[assignedCount].nickname, role });
            assignedCount++;
        }
    }
    // Remaining players become "host" (default)
    for (let i = assignedCount; i < alivePlayers.length; i++) {
        alivePlayers[i].role = "host";
        io.to(alivePlayers[i].id).emit('role assigned', { role: "host" });
        logGame("role assigned", { player: alivePlayers[i].nickname, role: "host" });
    }
    broadcastState();
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log("New connection:", socket.id);

    // When a client joins, they must emit a "join" event with { passcode, nickname, studentId }
    socket.on('join', (data) => {
        if (data.passcode !== ROOM_PASSCODE) {
            socket.emit('join error', "Incorrect room passcode.");
            return;
        }
        players[socket.id] = {
            id: socket.id,
            nickname: data.nickname || `Player-${socket.id.substring(0,4)}`,
            studentId: data.studentId || "",
            role: null,
            alive: true,
            muted: false,
            activated: false // For macrophage action
        };
        socket.join("global");
        socket.emit('join success', { id: socket.id });
        broadcastState();
        logGame("player joined", { id: socket.id, nickname: players[socket.id].nickname });
    });

    // Mark admin connections (via query parameter)
    if (socket.handshake.query && socket.handshake.query.adminKey === ADMIN_SECRET) {
        socket.isAdmin = true;
        console.log("Admin connected:", socket.id);
    }

    // Chat message handling – data: { message, room }
    socket.on('chat message', (data) => {
        let room = data.room || "global";
        // Global chat allowed only during H phase and for non-muted players
        if (room === "global") {
            if (gameState.phase !== "H") {
                socket.emit('game message', "Global chat is only available during Homeostasis (H) phase.");
                return;
            }
            if (players[socket.id] && players[socket.id].muted) {
                socket.emit('game message', "You are muted this phase.");
                return;
            }
        } else if (room === "pathogen") {
            // Pathogen chat allowed only during I phase for players with role "pathogen"
            if (!players[socket.id] || players[socket.id].role !== "pathogen" || gameState.phase !== "I") {
                socket.emit('game message', "You are not permitted to chat in this room at this time.");
                return;
            }
        }
        logChat(players[socket.id]?.nickname || socket.id, data.message, room);
        io.to(room).emit('chat message', { sender: players[socket.id]?.nickname, message: data.message, room });
    });

    // Granulocyte action during I phase: choose a target to inflame
    socket.on('granulocyte action', (data) => {
        if (!players[socket.id] || players[socket.id].role !== "granulocyte" || gameState.phase !== "I" || !players[socket.id].alive) {
            socket.emit('game message', "Action not permitted.");
            return;
        }
        players[socket.id].granAction = data.targetId;
        logGame("granulocyte action", { granulocyte: players[socket.id].nickname, target: data.targetId });
        // Apply effects based on target’s role
        let target = players[data.targetId];
        if (target) {
            if (target.role === "macrophage") {
                target.activated = true; // Macrophage can now act
                io.to(target.id).emit('game message', "You have been inflamed and are now activated.");
            }
            if (target.role === "egc") {
                target.noAlarm = true; // EGC cannot trigger alarm
            }
            if (target.role === "pathogen") {
                // Block all pathogen kills this I phase
                Object.values(players).forEach(p => {
                    if (p.role === "pathogen") {
                        p.pathBlocked = true;
                    }
                });
            }
            if (target.role === "host") {
                target.muted = true; // Host cell muted during H phase
            }
        }
        socket.emit('game message', `Granulocyte action recorded on target ${data.targetId}`);
    });

    // Macrophage action during I phase: inspect or kill (only if activated)
    socket.on('macrophage action', (data) => {
        // data: { action: "inspect" or "kill", targetId }
        if (!players[socket.id] || players[socket.id].role !== "macrophage" || gameState.phase !== "I" || !players[socket.id].alive) {
            socket.emit('game message', "Action not permitted.");
            return;
        }
        if (!players[socket.id].activated) {
            socket.emit('game message', "You were not inflamed and cannot act this phase.");
            return;
        }
        players[socket.id].macAction = data.action;
        players[socket.id].macTarget = data.targetId;
        if (data.action === "inspect") {
            let target = players[data.targetId];
            if (target) {
                let result = (target.role === "pathogen") ? "bad" : "good";
                socket.emit('macrophage inspect result', { targetId: data.targetId, result });
                logGame("macrophage inspect", { macrophage: players[socket.id].nickname, target: target.nickname, result });
            }
        } else if (data.action === "kill") {
            logGame("macrophage kill action", { macrophage: players[socket.id].nickname, target: data.targetId });
            socket.emit('game message', `Macrophage kill action recorded on target ${data.targetId}`);
        }
    });

    // Pathogen vote during I phase: each pathogen votes for a target to kill
    socket.on('pathogen vote', (data) => {
        if (!players[socket.id] || players[socket.id].role !== "pathogen" || gameState.phase !== "I" || !players[socket.id].alive) {
            socket.emit('game message', "Action not permitted.");
            return;
        }
        // Record pathogen vote (for simplicity, each pathogen’s vote is stored on their object)
        players[socket.id].pathVote = data.targetId;
        logGame("pathogen vote", { pathogen: players[socket.id].nickname, target: data.targetId });
        socket.emit('game message', `Your vote recorded for target ${data.targetId}`);
    });

    // Voting during H phase: all alive players can vote to eliminate a suspect
    socket.on('vote', (data) => {
        if (!players[socket.id] || !players[socket.id].alive || gameState.phase !== "H") {
            socket.emit('game message', "You cannot vote at this time.");
            return;
        }
        gameState.votes[data.targetId] = (gameState.votes[data.targetId] || 0) + 1;
        logGame("vote cast", { voter: players[socket.id].nickname, target: data.targetId });
        io.emit('game message', `${players[socket.id].nickname} voted for ${data.targetId}`);
    });

    // Admin commands
    socket.on('admin command', (data) => {
        if (!socket.isAdmin) return;
        if (data.action === "assignRoles") {
            // data.roles: { granulocyte, macrophage, pathogen, egc, host }
            assignRoles(data.roles);
        }
        if (data.action === "nextPhase") {
            // data.phase should be "I" or "H"
            transitionToPhase(data.phase);
        }
    });

    // Handle disconnects
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            logGame("player disconnected", { id: socket.id, nickname: players[socket.id].nickname });
            delete players[socket.id];
            broadcastState();
        }
    });
});

// Start the server
http.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
