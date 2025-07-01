class VoiceChat {
    constructor(socket) {
        this.socket = socket;
        this.peerConnections = new Map(); // Map of userId -> peerConnection
        this.localStream = null;
        this.isInCall = false;
        this.isMuted = false;
        this.isInitiator = false;
        this.isPrivateMode = false;
        this.privateCallTarget = null;
        this.connectionTimeout = null;
        this.iceGatheringTimeout = null;
        this.pendingGroupCall = null;
        this.groupCallParticipants = new Set(); // Track group call participants
        
        // For backward compatibility with 1-on-1 calls
        this.currentCallPartner = null;
        this.peerConnection = null;
        
        // Metered.ca TURN servers - these are reliable and paid
        this.iceServers = {
            iceServers: [
                // STUN server
                {
                    urls: "stun:stun.relay.metered.ca:80"
                },
                // TURN servers with your credentials
                {
                    urls: "turn:global.relay.metered.ca:80",
                    username: "34c7fa2bfb03c62170a5054b",
                    credential: "uVpV4Y0Wn0a9Ue1y"
                },
                {
                    urls: "turn:global.relay.metered.ca:80?transport=tcp",
                    username: "34c7fa2bfb03c62170a5054b",
                    credential: "uVpV4Y0Wn0a9Ue1y"
                },
                {
                    urls: "turn:global.relay.metered.ca:443",
                    username: "34c7fa2bfb03c62170a5054b",
                    credential: "uVpV4Y0Wn0a9Ue1y"
                },
                {
                    urls: "turns:global.relay.metered.ca:443?transport=tcp",
                    username: "34c7fa2bfb03c62170a5054b",
                    credential: "uVpV4Y0Wn0a9Ue1y"
                }
            ],
            iceCandidatePoolSize: 10
        };
        
        this.initializeElements();
        this.initializeSocketEvents();
    }
    
    // Alternative: Dynamic TURN credential fetching (more secure)
    async fetchTurnCredentials() {
        try {
            const response = await fetch("https://chatappn.metered.live/api/v1/turn/credentials?apiKey=4bbb71458fd694e553688f6e0aa1c97cffa6");
            const iceServers = await response.json();
            console.log('✅ Fetched fresh TURN credentials:', iceServers);
            return { iceServers };
        } catch (error) {
            console.error('❌ Failed to fetch TURN credentials:', error);
            // Fallback to hardcoded credentials
            return this.iceServers;
        }
    }
    
    async createPeerConnectionForUser(userId) {
        console.log('🔧 Creating peer connection for user:', userId);
        
        const peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Add local stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('➕ Adding local track for user:', userId, track.kind);
                peerConnection.addTrack(track, this.localStream);
            });
        }
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log('📺 Received remote track from user:', userId, event.track.kind);
            const [remoteStream] = event.streams;
            
            // Create or get audio element for this user
            let audioElement = document.getElementById(`remote-audio-${userId}`);
            if (!audioElement) {
                audioElement = document.createElement('audio');
                audioElement.id = `remote-audio-${userId}`;
                audioElement.autoplay = true;
                audioElement.style.display = 'none';
                document.body.appendChild(audioElement);
            }
            audioElement.srcObject = remoteStream;
            
            this.updateCallStatus('Voice connected!', 'connected');
        };
        
        // ICE candidate handling
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`🧊 ICE Candidate for user ${userId}:`, event.candidate.type);
                
                this.socket.emit('webrtc-ice-candidate', {
                    candidate: event.candidate,
                    targetId: userId
                });
            }
        };
        
        // Connection state monitoring
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            console.log(`🔗 Connection state with user ${userId}:`, state);
            
            switch (state) {
                case 'connected':
                    console.log(`🎉 Successfully connected to user ${userId}!`);
                    this.updateCallStatus(`Connected to ${this.groupCallParticipants.size + 1} users`, 'connected');
                    break;
                case 'failed':
                case 'closed':
                    console.log(`❌ Connection with user ${userId} ended`);
                    this.removePeerConnection(userId);
                    break;
            }
        };
        
        this.peerConnections.set(userId, peerConnection);
        return peerConnection;
    }
    
    // Remove a peer connection
    removePeerConnection(userId) {
        const peerConnection = this.peerConnections.get(userId);
        if (peerConnection) {
            peerConnection.close();
            this.peerConnections.delete(userId);
            this.groupCallParticipants.delete(userId);
            
            // Remove audio element
            const audioElement = document.getElementById(`remote-audio-${userId}`);
            if (audioElement) {
                audioElement.remove();
            }
            
            console.log(`🗑️ Removed peer connection for user ${userId}`);
            
            // Update status
            if (this.groupCallParticipants.size > 0) {
                this.updateCallStatus(`Connected to ${this.groupCallParticipants.size} users`, 'connected');
            } else {
                this.updateCallStatus('Waiting for others to join...', 'calling');
            }
        }
    }
    
    // Modified createPeerConnection for backward compatibility
    async createPeerConnection() {
        if (this.isPrivateMode || !this.isInCall) {
            // For private calls, use the old single peer connection method
            return this.createSinglePeerConnection();
        } else {
            // For group calls, this shouldn't be called directly
            console.warn('⚠️ createPeerConnection called in group call mode');
        }
    }
    
    // Original single peer connection method for private calls
    async createSinglePeerConnection() {
        console.log('🔧 Creating single peer connection...');
        
        this.peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Add local stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('➕ Adding local track:', track.kind);
                this.peerConnection.addTrack(track, this.localStream);
            });
        }
        
        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            console.log('📺 Received remote track:', event.track.kind);
            const [remoteStream] = event.streams;
            this.remoteAudio.srcObject = remoteStream;
            this.updateCallStatus('Voice connected!', 'connected');
        };
        
        // ICE candidate handling
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('webrtc-ice-candidate', {
                    candidate: event.candidate,
                    targetId: this.currentCallPartner
                });
            }
        };
        
        // Connection state monitoring
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 Connection state:', state);
            
            switch (state) {
                case 'connected':
                    this.updateCallStatus('Connected', 'connected');
                    break;
                case 'failed':
                case 'closed':
                    this.handleCallEnded();
                    break;
            }
        };
    }
    
    setConnectionTimeout(timeout = 30000) {
        this.clearConnectionTimeout();
        this.connectionTimeout = setTimeout(() => {
            console.error('⏰ Connection timeout after', timeout/1000, 'seconds');
            this.updateCallStatus('Connection timeout', 'failed');
            setTimeout(() => this.handleCallEnded(), 3000);
        }, timeout);
    }
    
    clearConnectionTimeout() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
    }
    
    clearIceGatheringTimeout() {
        if (this.iceGatheringTimeout) {
            clearTimeout(this.iceGatheringTimeout);
            this.iceGatheringTimeout = null;
        }
    }
    
    initializeElements() {
        this.voiceCallBtn = document.getElementById('voice-call-btn');
        this.muteBtn = document.getElementById('mute-btn');
        this.endCallBtn = document.getElementById('end-call-btn');
        this.callStatus = document.getElementById('call-status');
        this.incomingCallModal = document.getElementById('incoming-call-modal');
        this.callerName = document.getElementById('caller-name');
        this.acceptCallBtn = document.getElementById('accept-call-btn');
        this.rejectCallBtn = document.getElementById('reject-call-btn');
        this.localAudio = document.getElementById('local-audio');
        this.remoteAudio = document.getElementById('remote-audio');
        
        // Event listeners
        this.voiceCallBtn.addEventListener('click', () => this.startVoiceCall());
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.endCallBtn.addEventListener('click', () => this.endCall());
        this.acceptCallBtn.addEventListener('click', () => this.acceptCall());
        this.rejectCallBtn.addEventListener('click', () => this.rejectCall());
    }
    
    initializeSocketEvents() {
        console.log('🔧 Setting up socket events...');
        
        this.socket.on('incoming-voice-call', (data) => {
            this.handleIncomingCall(data);
        });
        
        this.socket.on('voice-call-accepted', (data) => {
            this.handleCallAccepted(data);
        });
        
        this.socket.on('voice-call-rejected', () => {
            this.handleCallRejected();
        });
        
        this.socket.on('voice-call-ended', () => {
            this.handleCallEnded();
        });
        
        // Add group call events with debugging
        this.socket.on('group-call-available', (data) => {
            console.log('📞 Received group-call-available:', data);
            this.handleGroupCallAvailable(data);
        });
        
        this.socket.on('user-joined-group-call', (data) => {
            console.log('👥 Received user-joined-group-call:', data);
            this.handleUserJoinedGroupCall(data);
        });
        
        this.socket.on('webrtc-offer', (data) => {
            this.handleOffer(data);
        });
        
        this.socket.on('webrtc-answer', (data) => {
            this.handleAnswer(data);
        });
        
        this.socket.on('webrtc-ice-candidate', (data) => {
            this.handleIceCandidate(data);
        });
        
        console.log('✅ Socket events set up complete');
    }
    
    setPrivateMode(isPrivate, targetUsername = null) {
        this.isPrivateMode = isPrivate;
        this.privateCallTarget = targetUsername;
        
        if (isPrivate && targetUsername) {
            this.voiceCallBtn.textContent = `📞 Call ${targetUsername}`;
            this.voiceCallBtn.disabled = false;
        } else if (isPrivate) {
            this.voiceCallBtn.textContent = '📞 Private Call';
            this.voiceCallBtn.disabled = true;
        } else {
            this.voiceCallBtn.textContent = '🎤 Start Group Voice Chat';
            this.voiceCallBtn.disabled = false; // Enable group calls
        }
    }
    
    startPrivateCall(targetUsername) {
        this.privateCallTarget = targetUsername;
        this.isPrivateMode = true;
        this.setPrivateMode(true, targetUsername);
        this.startVoiceCall();
    }

    async startVoiceCall() {
        let targetUser;
        
        if (this.isPrivateMode && this.privateCallTarget) {
            targetUser = this.privateCallTarget;
        } else if (!this.isPrivateMode) {
            // This is a group call
            return this.startGroupCall();
        } else {
            targetUser = this.getSelectedUser();
        }
        
        if (!targetUser && this.isPrivateMode) {
            alert('Please select a user to call from the online users list');
            return;
        }
        
        try {
            await this.getUserMedia();
            
            if (this.isPrivateMode && this.privateCallTarget) {
                this.socket.emit('request-private-voice-call', { targetUsername: this.privateCallTarget });
                this.updateCallStatus('Calling ' + this.privateCallTarget + '...', 'calling');
            } else {
                this.socket.emit('request-voice-call', { targetUsername: targetUser });
                this.updateCallStatus('Calling ' + targetUser + '...', 'calling');
            }
            
            this.isInitiator = true;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Could not access microphone. Please check permissions and try again.');
        }
    }
    
    async getUserMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }, 
                video: false 
            });
            this.localAudio.srcObject = this.localStream;
            return this.localStream;
        } catch (error) {
            throw new Error('Microphone access denied or not available');
        }
    }
    
    async handleIncomingCall(data) {
        this.callerName.textContent = data.callerUsername;
        this.currentCallPartner = data.callerId;
        this.isInitiator = false;
        this.incomingCallModal.classList.remove('hidden');
    }
    
    async acceptCall() {
        this.incomingCallModal.classList.add('hidden');
        
        try {
            await this.getUserMedia();
            
            // Check if this is a group call
            if (this.pendingGroupCall) {
                console.log('✅ Accepting group call');
                
                // Create peer connection for the joiner
                this.currentCallPartner = this.pendingGroupCall.initiatorId;
                await this.createPeerConnection();
                
                this.socket.emit('join-group-voice-call', { 
                    initiatorId: this.pendingGroupCall.initiatorId,
                    initiatorUsername: this.pendingGroupCall.initiatorUsername 
                });
                this.updateCallStatus('Joining group call...', 'calling');
                this.isInCall = true;
                this.toggleCallButtons();
                this.pendingGroupCall = null; // Clear pending group call
            } else {
                console.log('✅ Accepting regular call');
                this.socket.emit('accept-voice-call', { callerId: this.currentCallPartner });
                await this.createPeerConnection();
                this.isInCall = true;
                this.toggleCallButtons();
            }
        } catch (error) {
            console.error('Error accepting call:', error);
            alert('Could not accept call. Please check microphone permissions.');
        }
    }
    
    rejectCall() {
        this.incomingCallModal.classList.add('hidden');
        
        if (this.pendingGroupCall) {
            console.log('❌ Rejecting group call');
            this.pendingGroupCall = null; // Clear pending group call
        } else {
            console.log('❌ Rejecting regular call');
            this.socket.emit('reject-voice-call', { callerId: this.currentCallPartner });
        }
        
        this.currentCallPartner = null;
    }
    
    async handleCallAccepted(data) {
        console.log('📞 Call accepted, setting up Metered.ca connection...');
        this.currentCallPartner = data.accepterId;
        await this.createPeerConnection();
        
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('webrtc-offer', {
                offer: offer,
                targetId: this.currentCallPartner
            });
            
            this.isInCall = true;
            this.toggleCallButtons();
            
        } catch (error) {
            console.error('❌ Error creating offer:', error);
            this.updateCallStatus('Failed to create call', 'failed');
            setTimeout(() => this.handleCallEnded(), 3000);
        }
    }
    
    async handleOffer(data) {
        console.log('📥 Received offer from:', data.senderId);
        
        try {
            // Get or create peer connection for this user
            let peerConnection = this.peerConnections.get(data.senderId);
            if (!peerConnection) {
                peerConnection = await this.createPeerConnectionForUser(data.senderId);
            }
            
            await peerConnection.setRemoteDescription(data.offer);
            console.log('✅ Remote description set for user:', data.senderId);
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            console.log('✅ Answer created for user:', data.senderId);
            
            this.socket.emit('webrtc-answer', {
                answer: answer,
                targetId: data.senderId
            });
            console.log('✅ Answer sent to user:', data.senderId);
            
        } catch (error) {
            console.error('❌ Error handling offer:', error);
        }
    }
    
    async handleAnswer(data) {
        console.log('📥 Received answer from:', data.senderId);
        try {
            const peerConnection = this.peerConnections.get(data.senderId);
            if (peerConnection) {
                await peerConnection.setRemoteDescription(data.answer);
                console.log('✅ Answer processed for user:', data.senderId);
            }
        } catch (error) {
            console.error('❌ Error handling answer:', error);
        }
    }
    
    async handleIceCandidate(data) {
        try {
            const peerConnection = this.peerConnections.get(data.senderId);
            if (peerConnection && peerConnection.remoteDescription) {
                await peerConnection.addIceCandidate(data.candidate);
                console.log('✅ Added ICE candidate for user:', data.senderId);
            }
        } catch (error) {
            console.error('❌ Error adding ICE candidate:', error);
        }
    }
    
    handleCallRejected() {
        this.updateCallStatus('Call rejected', 'rejected');
        this.cleanup();
    }
    
    handleCallEnded() {
        this.updateCallStatus('Call ended', 'ended');
        this.cleanup();
    }
    
    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.isMuted = !audioTrack.enabled;
                
                this.muteBtn.textContent = this.isMuted ? '🔊 Unmute' : '🔇 Mute';
                this.muteBtn.classList.toggle('muted', this.isMuted);
            }
        }
    }
    
    endCall() {
        this.socket.emit('end-voice-call', { targetId: this.currentCallPartner });
        this.handleCallEnded();
    }
    
    cleanup() {
        console.log('🧹 Cleaning up call resources...');
        
        // Close all peer connections
        this.peerConnections.forEach((peerConnection, userId) => {
            peerConnection.close();
            // Remove audio elements
            const audioElement = document.getElementById(`remote-audio-${userId}`);
            if (audioElement) {
                audioElement.remove();
            }
        });
        this.peerConnections.clear();
        this.groupCallParticipants.clear();
        
        // Close single peer connection (for private calls)
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
            });
            this.localStream = null;
        }
        
        this.localAudio.srcObject = null;
        this.remoteAudio.srcObject = null;
        
        this.isInCall = false;
        this.isMuted = false;
        this.currentCallPartner = null;
        this.isInitiator = false;
        
        this.toggleCallButtons();
        
        setTimeout(() => {
            this.updateCallStatus('', '');
        }, 3000);
    }
    
    toggleCallButtons() {
        if (this.isInCall) {
            this.voiceCallBtn.classList.add('hidden');
            this.muteBtn.classList.remove('hidden');
            this.endCallBtn.classList.remove('hidden');
        } else {
            this.voiceCallBtn.classList.remove('hidden');
            this.muteBtn.classList.add('hidden');
            this.endCallBtn.classList.add('hidden');
            this.muteBtn.textContent = '🔇 Mute';
            this.muteBtn.classList.remove('muted');
        }
    }
    
    updateCallStatus(status, className = '') {
        this.callStatus.textContent = status;
        this.callStatus.className = 'call-status ' + className;
    }
    
    enableVoiceCall() {
        if (!this.isPrivateMode) {
            this.voiceCallBtn.disabled = false;
        }
    }
    
    disableVoiceCall() {
        if (!this.isPrivateMode) {
            this.voiceCallBtn.disabled = true;
        }
    }
    
    getSelectedUser() {
        // This method is kept for backward compatibility with group calls
        // In practice, we'll use the private call functionality
        const users = Array.from(document.querySelectorAll('#users-list li'));
        return users.find(user => user.classList.contains('selected'))?.getAttribute('data-username');
    }
    
    // Add new method for group calls
    async startGroupCall() {
        console.log('🎤 Starting group call...');
        this.isPrivateMode = false;
        this.privateCallTarget = null;
        
        try {
            await this.getUserMedia();
            
            // Emit group call request
            console.log('📡 Emitting request-group-voice-call');
            this.socket.emit('request-group-voice-call');
            this.updateCallStatus('Group call started! Waiting for others to join...', 'calling');
            
            this.isInitiator = true;
            this.isInCall = true;
            this.toggleCallButtons();
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Could not access microphone. Please check permissions and try again.');
        }
    }
    
    // Add new group call handlers
    async handleGroupCallAvailable(data) {
        // Get current username from the DOM element
        const currentUser = document.getElementById('current-user').textContent;
        
        console.log('🔔 Group call available from:', data.initiatorUsername, 'Current user:', currentUser);
        console.log('🔔 Comparison result:', data.initiatorUsername !== currentUser);
        
        if (data.initiatorUsername !== currentUser) {
            // Use the existing modal for group call notification
            const callerNameElement = document.getElementById('caller-name');
            const incomingCallModal = document.getElementById('incoming-call-modal');
            const modalTitle = incomingCallModal.querySelector('h3');
            
            // Update modal content for group call
            modalTitle.textContent = 'Group Call Invitation';
            callerNameElement.textContent = data.initiatorUsername + ' started a group call';
            
            // Store group call data
            this.pendingGroupCall = {
                initiatorId: data.initiatorId,
                initiatorUsername: data.initiatorUsername
            };
            
            // Show the modal
            incomingCallModal.classList.remove('hidden');
            
            console.log('📱 Group call modal shown');
        } else {
            console.log('🚫 Not showing modal - user is the initiator');
        }
    }
    
    async handleUserJoinedGroupCall(data) {
        const currentUser = document.getElementById('current-user').textContent;
        
        console.log('👥 User joined group call:', data.username, 'Current user:', currentUser);
        console.log('👥 User ID:', data.userId, 'My socket ID:', this.socket.id);
        
        // Don't process our own join event
        if (data.userId === this.socket.id) {
            return;
        }
        
        // Add to participants
        this.groupCallParticipants.add(data.userId);
        
        // Show status update
        if (data.username !== currentUser) {
            this.updateCallStatus(`${data.username} joined the group call`, 'connected');
        }
        
        // Create peer connection for this user
        const peerConnection = await this.createPeerConnectionForUser(data.userId);
        
        if (this.isInitiator) {
            console.log('📞 Initiator creating offer for joiner:', data.username);
            try {
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false
                });
                
                await peerConnection.setLocalDescription(offer);
                
                this.socket.emit('webrtc-offer', {
                    offer: offer,
                    targetId: data.userId
                });
                
                console.log('✅ Offer sent to joiner:', data.username);
                
            } catch (error) {
                console.error('❌ Error creating offer for group call:', error);
            }
        }
    }
} 