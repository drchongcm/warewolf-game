const socket = io();
let currentPhase = "waiting";

// Update players list when the server sends updated data
socket.on('players', function(players) {
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    players.forEach(player => {
        let li = document.createElement('li');
        li.textContent = player.name;
        li.dataset.id = player.id;
        // Mark dead players with a strike-through
        if (!player.alive) {
            li.classList.add('dead');
        }
        // Allow voting during day for alive players
        li.addEventListener('click', function() {
            if (currentPhase === 'day' && !player.dead && player.alive) {
                socket.emit('vote', { targetId: player.id });
                alert(`You voted for ${player.name}`);
            }
        });
        playerList.appendChild(li);
    });
});

// Handle chat message form submission
const form = document.getElementById('messageForm');
const input = document.getElementById('messageInput');
const messages = document.getElementById('messages');

form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (input.value) {
        socket.emit('chat message', input.value);
        input.value = '';
    }
});

// Listen for incoming chat messages and display them
socket.on('chat message', function(data) {
    const item = document.createElement('li');
    item.textContent = `${data.id.substring(0, 4)}: ${data.msg}`;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
});

// Listen for game messages and phase changes
socket.on('game message', function(msg) {
    const statusDiv = document.getElementById('gameStatus');
    statusDiv.textContent = msg;
});
socket.on('phase changed', function(data) {
    currentPhase = data.phase;
    const statusDiv = document.getElementById('gameStatus');
    statusDiv.textContent = `Current phase: ${currentPhase}`;
});
