// Connect to backend server
const socket = io('http://localhost:3000');

// DOM elements
const loginContainer = document.getElementById('login-container');
const chatContainer = document.getElementById('chat-container');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const leaveBtn = document.getElementById('leave-btn');
const backToGroupBtn = document.getElementById('back-to-group-btn');
const chatTitle = document.getElementById('chat-title');
const currentUserSpan = document.getElementById('current-user');
const usersList = document.getElementById('users-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const typingIndicator = document.getElementById('typing-indicator');

let currentUsername = '';
let currentPrivateChat = null; // null for group chat, username for private chat
let typingTimer;
let voiceChat;
let privateMessages = new Map(); // Store private messages

// Event listeners
joinBtn.addEventListener('click', joinChat);
leaveBtn.addEventListener('click', leaveChat);
backToGroupBtn.addEventListener('click', switchToGroupChat);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', handleMessageInput);
messageInput.addEventListener('input', handleTyping);
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinChat();
});

// Functions
function joinChat() {
    const username = usernameInput.value.trim();
    if (username) {
        currentUsername = username;
        currentUserSpan.textContent = username;
        
        // Hide login, show chat
        loginContainer.classList.add('hidden');
        chatContainer.classList.remove('hidden');
        
        // Emit user joined event
        socket.emit('user-joined', username);
        
        // Focus message input
        messageInput.focus();
        
        // Initialize voice chat after joining
        voiceChat = new VoiceChat(socket);
    }
}

function leaveChat() {
    // Show login, hide chat
    chatContainer.classList.add('hidden');
    loginContainer.classList.remove('hidden');
    
    // Clear inputs and data
    usernameInput.value = '';
    messageInput.value = '';
    messagesContainer.innerHTML = '';
    usersList.innerHTML = '';
    currentPrivateChat = null;
    privateMessages.clear();
    
    // Reset UI
    chatTitle.textContent = 'Group Chat';
    backToGroupBtn.classList.add('hidden');
    
    // Disconnect socket
    socket.disconnect();
    
    // Reconnect for next session
    setTimeout(() => {
        socket.connect();
    }, 100);
}

function switchToGroupChat() {
    currentPrivateChat = null;
    chatTitle.textContent = 'Group Chat';
    backToGroupBtn.classList.add('hidden');
    messageInput.placeholder = 'Type your message...';
    
    // Clear messages and load group messages
    messagesContainer.innerHTML = '';
    loadGroupMessages();
    
    // Update users list styling
    updateUsersListStyling();
    
    // Update voice chat for group
    if (voiceChat) {
        voiceChat.setPrivateMode(false);
    }
}

function switchToPrivateChat(username) {
    if (username === currentUsername) return;
    
    currentPrivateChat = username;
    chatTitle.textContent = `Private Chat with ${username}`;
    backToGroupBtn.classList.remove('hidden');
    messageInput.placeholder = `Send a private message to ${username}...`;
    
    // Clear messages and load private messages
    messagesContainer.innerHTML = '';
    loadPrivateMessages(username);
    
    // Update users list styling
    updateUsersListStyling();
    
    // Update voice chat for private mode
    if (voiceChat) {
        voiceChat.setPrivateMode(true, username);
    }
    
    // Focus message input
    messageInput.focus();
}

function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        if (currentPrivateChat) {
            // Send private message
            socket.emit('send-private-message', { 
                targetUsername: currentPrivateChat, 
                message 
            });
        } else {
            // Send group message
            socket.emit('send-message', { message });
        }
        messageInput.value = '';
        socket.emit('stop-typing');
    }
}

function handleMessageInput(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
}

function handleTyping() {
    if (currentPrivateChat) {
        socket.emit('private-typing', { targetUsername: currentPrivateChat });
    } else {
        socket.emit('typing');
    }
    
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        if (currentPrivateChat) {
            socket.emit('private-stop-typing', { targetUsername: currentPrivateChat });
        } else {
            socket.emit('stop-typing');
        }
    }, 1000);
}

function addMessage(data, isOwnMessage = false, isPrivate = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwnMessage ? 'own-message' : 'other-message'} ${isPrivate ? 'private-message' : ''}`;
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">${data.username}</span>
            <span class="message-timestamp">${data.timestamp}</span>
        </div>
        <div class="message-text">${escapeHtml(data.message)}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Store message for later retrieval
    if (isPrivate) {
        const chatKey = getChatKey(data.username, currentUsername);
        if (!privateMessages.has(chatKey)) {
            privateMessages.set(chatKey, []);
        }
        privateMessages.get(chatKey).push({...data, isOwnMessage});
    }
}

function addSystemMessage(message) {
    const systemDiv = document.createElement('div');
    systemDiv.className = 'system-message';
    systemDiv.textContent = message;
    messagesContainer.appendChild(systemDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateUsersList(users) {
    usersList.innerHTML = '';
    users.forEach(username => {
        const li = document.createElement('li');
        li.setAttribute('data-username', username);
        
        if (username === currentUsername) {
            li.classList.add('current-user');
            li.innerHTML = `${username} (You)`;
        } else {
            li.innerHTML = `
                ${username}
                <div class="user-actions">
                    <button class="action-btn" onclick="switchToPrivateChat('${username}')">💬</button>
                    <button class="action-btn call-btn" onclick="startPrivateCall('${username}')">📞</button>
                </div>
            `;
            li.addEventListener('click', () => switchToPrivateChat(username));
        }
        
        usersList.appendChild(li);
    });
    
    updateUsersListStyling();
    
    // Enable/disable voice call based on available users
    if (voiceChat) {
        if (users.length > 1) {
            voiceChat.enableVoiceCall();
        } else {
            voiceChat.disableVoiceCall();
        }
    }
}

function updateUsersListStyling() {
    const userItems = usersList.querySelectorAll('li');
    userItems.forEach(li => {
        const username = li.getAttribute('data-username');
        li.classList.remove('private-chat-active');
        if (username === currentPrivateChat) {
            li.classList.add('private-chat-active');
        }
    });
}

function startPrivateCall(username) {
    if (voiceChat) {
        voiceChat.startPrivateCall(username);
    }
}

function loadGroupMessages() {
    // Group messages are loaded in real-time, so we don't need to do anything here
    // In a real application, you might want to load message history from the server
}

function loadPrivateMessages(username) {
    const chatKey = getChatKey(username, currentUsername);
    const messages = privateMessages.get(chatKey) || [];
    
    messages.forEach(message => {
        addMessage(message, message.isOwnMessage, true);
    });
}

function getChatKey(user1, user2) {
    return [user1, user2].sort().join('-');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Socket event listeners
socket.on('user-connected', (username) => {
    if (!currentPrivateChat) {
        addSystemMessage(`${username} joined the chat`);
    }
});

socket.on('user-disconnected', (username) => {
    if (!currentPrivateChat) {
        addSystemMessage(`${username} left the chat`);
    }
});

socket.on('users-list', (users) => {
    updateUsersList(users);
});

socket.on('receive-message', (data) => {
    if (!currentPrivateChat) {
        const isOwnMessage = data.username === currentUsername;
        addMessage(data, isOwnMessage);
    }
});

socket.on('receive-private-message', (data) => {
    const isOwnMessage = data.username === currentUsername;
    const chatPartner = isOwnMessage ? data.targetUsername : data.username;
    
    // Store the message
    const chatKey = getChatKey(data.username, data.targetUsername);
    if (!privateMessages.has(chatKey)) {
        privateMessages.set(chatKey, []);
    }
    privateMessages.get(chatKey).push({...data, isOwnMessage});
    
    // Show message if currently in this private chat
    if (currentPrivateChat === chatPartner) {
        addMessage(data, isOwnMessage, true);
    }
});

socket.on('user-typing', (username) => {
    if (!currentPrivateChat) {
        typingIndicator.textContent = `${username} is typing...`;
    }
});

socket.on('user-stop-typing', () => {
    if (!currentPrivateChat) {
        typingIndicator.textContent = '';
    }
});

socket.on('private-user-typing', (data) => {
    if (currentPrivateChat === data.username) {
        typingIndicator.textContent = `${data.username} is typing...`;
    }
});

socket.on('private-user-stop-typing', (data) => {
    if (currentPrivateChat === data.username) {
        typingIndicator.textContent = '';
    }
});

// Handle connection events
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

// Make functions globally available
window.switchToPrivateChat = switchToPrivateChat;
window.startPrivateCall = startPrivateCall; 