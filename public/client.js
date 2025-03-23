const socket = io();

// Update players list when server sends updated data
socket.on('players', function(players) {
    const playerList = document.getElementById('playerList');
    playerList.innerHTML = '';
    players.forEach(player => {
        let li = document.createElement('li');
        li.textContent = player.name;
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
    // Display the first 4 characters of the sender's ID as an identifier
    item.textContent = `${data.id.substring(0, 4)}: ${data.msg}`;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
});

