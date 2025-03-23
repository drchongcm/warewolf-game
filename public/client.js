const socket = io();

// DOM Elements
const loginForm = document.getElementById("loginForm");
const gameArea = document.getElementById("gameArea");
const joinBtn = document.getElementById("joinBtn");
const loginError = document.getElementById("loginError");
const nicknameInput = document.getElementById("nickname");
const studentIdInput = document.getElementById("studentId");
const passcodeInput = document.getElementById("passcode");

const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChat = document.getElementById("sendChat");
const playersUl = document.getElementById("playersUl");
const phaseDisplay = document.getElementById("phaseDisplay");
const actionArea = document.getElementById("actionArea");

const phaseMusic = document.getElementById("phaseMusic");
const volumeControl = document.getElementById("volumeControl");
volumeControl.addEventListener("input", () => {
    phaseMusic.volume = volumeControl.value;
});

// Attempt to play music (may require user interaction)
phaseMusic.play();

let myId = null;
let myRole = null;
let currentPhase = null;

// Join game on button click
joinBtn.addEventListener("click", () => {
    const nickname = nicknameInput.value.trim();
    const studentId = studentIdInput.value.trim();
    const passcode = passcodeInput.value.trim();
    if (!nickname || !passcode) {
        loginError.textContent = "Please enter nickname and room passcode.";
        return;
    }
    socket.emit("join", { nickname, studentId, passcode });
});

socket.on("join success", (data) => {
    myId = data.id;
    loginForm.classList.add("hidden");
    gameArea.classList.remove("hidden");
});

socket.on("join error", (msg) => {
    loginError.textContent = msg;
});

// Send chat message
sendChat.addEventListener("click", () => {
    const message = chatInput.value.trim();
    if (message) {
        let room = "global";
        // If in I phase and you are a pathogen, send to pathogen chat
        if (currentPhase === "I" && myRole === "pathogen") {
            room = "pathogen";
        }
        socket.emit("chat message", { message, room });
        chatInput.value = "";
    }
});

socket.on("chat message", (data) => {
    const li = document.createElement("li");
    li.textContent = `[${data.room}] ${data.sender}: ${data.message}`;
    chatMessages.appendChild(li);
});

// Update game state and player list
socket.on("game state", (data) => {
    currentPhase = data.phase;
    phaseDisplay.textContent = `Current Phase: ${data.phase}`;
    playersUl.innerHTML = "";
    data.players.forEach(player => {
        const li = document.createElement("li");
        li.textContent = player.nickname + (player.id === myId ? " (You)" : "");
        if (!player.alive) {
            li.style.textDecoration = "line-through";
        }
        playersUl.appendChild(li);
    });
    updateActionButtons();
});

// Display game messages
socket.on("game message", (msg) => {
    const li = document.createElement("li");
    li.style.fontWeight = "bold";
    li.textContent = `[Game]: ${msg}`;
    chatMessages.appendChild(li);
});

// Receive role assignment
socket.on("role assigned", (data) => {
    myRole = data.role;
    const li = document.createElement("li");
    li.style.color = "blue";
    li.textContent = `Your role is: ${data.role}`;
    chatMessages.appendChild(li);
    updateActionButtons();
});

// If macrophage inspects, receive result
socket.on("macrophage inspect result", (data) => {
    const li = document.createElement("li");
    li.style.color = "green";
    li.textContent = `Inspection of ${data.targetId}: ${data.result}`;
    chatMessages.appendChild(li);
});

// Show role-specific action buttons based on phase and role
function updateActionButtons() {
    actionArea.innerHTML = "";
    if (currentPhase === "I") {
        if (myRole === "granulocyte") {
            const btn = document.createElement("button");
            btn.textContent = "Inflame (enter target ID)";
            btn.addEventListener("click", () => {
                const targetId = prompt("Enter target player's ID:");
                if (targetId) {
                    socket.emit("granulocyte action", { targetId });
                }
            });
            actionArea.appendChild(btn);
        }
        if (myRole === "macrophage") {
            const btnInspect = document.createElement("button");
            btnInspect.textContent = "Inspect (enter target ID)";
            btnInspect.addEventListener("click", () => {
                const targetId = prompt("Enter target player's ID to inspect:");
                if (targetId) {
                    socket.emit("macrophage action", { action: "inspect", targetId });
                }
            });
            const btnKill = document.createElement("button");
            btnKill.textContent = "Kill (enter target ID)";
            btnKill.addEventListener("click", () => {
                const targetId = prompt("Enter target player's ID to kill:");
                if (targetId) {
                    socket.emit("macrophage action", { action: "kill", targetId });
                }
            });
            actionArea.appendChild(btnInspect);
            actionArea.appendChild(btnKill);
        }
        if (myRole === "pathogen") {
            const btnPathVote = document.createElement("button");
            btnPathVote.textContent = "Pathogen Vote (enter target ID)";
            btnPathVote.addEventListener("click", () => {
                const targetId = prompt("Enter target player's ID for pathogen vote:");
                if (targetId) {
                    socket.emit("pathogen vote", { targetId });
                }
            });
            actionArea.appendChild(btnPathVote);
        }
    }
    if (currentPhase === "H") {
        const btnVote = document.createElement("button");
        btnVote.textContent = "Vote to Eliminate (enter target ID)";
        btnVote.addEventListener("click", () => {
            const targetId = prompt("Enter target player's ID to vote for elimination:");
            if (targetId) {
                socket.emit("vote", { targetId });
            }
        });
        actionArea.appendChild(btnVote);
    }
}
