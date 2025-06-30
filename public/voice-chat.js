class VoiceChat {
    constructor(socket) {
        this.socket = socket;
        this.peerConnection = null;
        this.localStream = null;
        this.isInCall = false;
        this.isMuted = false;
        this.currentCallPartner = null;
        this.isInitiator = false;
        this.isPrivateMode = false;
        this.privateCallTarget = null;
        this.connectionTimeout = null;
        this.iceGatheringTimeout = null;
        
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
    
    async createPeerConnection() {
        console.log('🔧 Creating peer connection with Metered.ca TURN servers...');
        
        // Option 1: Use hardcoded credentials (faster)
        this.peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Option 2: Fetch fresh credentials (more secure, uncomment if needed)
        // const iceConfig = await this.fetchTurnCredentials();
        // this.peerConnection = new RTCPeerConnection(iceConfig);
        
        this.setConnectionTimeout(30000); // 30 seconds should be enough now
        
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
            this.clearConnectionTimeout();
            this.updateCallStatus('Voice connected!', 'connected');
        };
        
        // ICE candidate handling
        let candidateCount = 0;
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                candidateCount++;
                console.log(`🧊 ICE Candidate #${candidateCount}:`, {
                    type: event.candidate.type,
                    protocol: event.candidate.protocol,
                    address: event.candidate.address?.substring(0, 15) + '...',
                    port: event.candidate.port,
                    priority: event.candidate.priority
                });
                
                this.socket.emit('webrtc-ice-candidate', {
                    candidate: event.candidate,
                    targetId: this.currentCallPartner
                });
                
                // Update status based on candidate type
                if (event.candidate.type === 'relay') {
                    this.updateCallStatus('🔄 Using Metered.ca relay...', 'connecting');
                    console.log('✅ TURN relay candidate found - cross-network connection possible!');
                } else if (event.candidate.type === 'srflx') {
                    this.updateCallStatus('🌐 Using STUN connection...', 'connecting');
                } else if (event.candidate.type === 'host') {
                    this.updateCallStatus('🏠 Trying direct connection...', 'connecting');
                }
            } else {
                console.log(`✅ ICE gathering completed. Found ${candidateCount} candidates`);
                this.clearIceGatheringTimeout();
            }
        };
        
        // Connection state monitoring
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 Connection state:', state);
            
            switch (state) {
                case 'connecting':
                    this.updateCallStatus('Connecting via Metered.ca...', 'connecting');
                    break;
                case 'connected':
                    console.log('🎉 Successfully connected via Metered.ca TURN servers!');
                    this.updateCallStatus('Connected', 'connected');
                    this.clearConnectionTimeout();
                    break;
                case 'failed':
                    console.error('❌ Connection failed even with paid TURN servers');
                    this.updateCallStatus('Connection failed', 'failed');
                    setTimeout(() => this.handleCallEnded(), 3000);
                    break;
                case 'disconnected':
                    this.updateCallStatus('Connection lost', 'disconnected');
                    setTimeout(() => {
                        if (this.peerConnection?.connectionState === 'disconnected') {
                            this.handleCallEnded();
                        }
                    }, 5000);
                    break;
                case 'closed':
                    this.handleCallEnded();
                    break;
            }
        };
        
        // ICE connection state
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 ICE connection state:', state);
            
            switch (state) {
                case 'checking':
                    this.updateCallStatus('Testing connection paths...', 'connecting');
                    break;
                case 'connected':
                case 'completed':
                    console.log('✅ ICE connection established successfully!');
                    this.updateCallStatus('Voice connected', 'connected');
                    this.clearConnectionTimeout();
                    break;
                case 'failed':
                    console.error('❌ ICE connection failed');
                    this.updateCallStatus('Connection failed', 'failed');
                    break;
                case 'disconnected':
                    this.updateCallStatus('Reconnecting...', 'reconnecting');
                    break;
            }
        };
        
        // ICE gathering state
        this.peerConnection.onicegatheringstatechange = () => {
            const state = this.peerConnection.iceGatheringState;
            console.log('🧊 ICE gathering state:', state);
            
            if (state === 'gathering') {
                this.updateCallStatus('Finding best connection...', 'connecting');
                this.iceGatheringTimeout = setTimeout(() => {
                    console.warn('⚠️ ICE gathering taking longer than expected');
                    if (this.peerConnection?.iceGatheringState === 'gathering') {
                        this.updateCallStatus('Connection timeout', 'failed');
                        setTimeout(() => this.handleCallEnded(), 3000);
                    }
                }, 15000); // 15 seconds for paid TURN servers
            } else if (state === 'complete') {
                console.log('✅ ICE gathering completed with Metered.ca servers');
                this.clearIceGatheringTimeout();
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
        
        this.socket.on('webrtc-offer', (data) => {
            this.handleOffer(data);
        });
        
        this.socket.on('webrtc-answer', (data) => {
            this.handleAnswer(data);
        });
        
        this.socket.on('webrtc-ice-candidate', (data) => {
            this.handleIceCandidate(data);
        });
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
            this.voiceCallBtn.textContent = '🎤 Start Voice Chat';
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
        } else {
            targetUser = this.getSelectedUser();
        }
        
        if (!targetUser && !this.isPrivateMode) {
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
            this.socket.emit('accept-voice-call', { callerId: this.currentCallPartner });
            await this.createPeerConnection();
            this.isInCall = true;
            this.toggleCallButtons();
        } catch (error) {
            console.error('Error accepting call:', error);
            alert('Could not accept call. Please check microphone permissions.');
        }
    }
    
    rejectCall() {
        this.incomingCallModal.classList.add('hidden');
        this.socket.emit('reject-voice-call', { callerId: this.currentCallPartner });
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
        console.log('📥 Received offer, setting up connection...');
        try {
            await this.peerConnection.setRemoteDescription(data.offer);
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                answer: answer,
                targetId: data.senderId
            });
        } catch (error) {
            console.error('❌ Error handling offer:', error);
            this.updateCallStatus('Failed to answer call', 'failed');
            setTimeout(() => this.handleCallEnded(), 3000);
        }
    }
    
    async handleAnswer(data) {
        console.log('📥 Received answer');
        try {
            await this.peerConnection.setRemoteDescription(data.answer);
        } catch (error) {
            console.error('❌ Error handling answer:', error);
        }
    }
    
    async handleIceCandidate(data) {
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(data.candidate);
                console.log('✅ Added ICE candidate:', data.candidate.type);
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
        
        this.clearConnectionTimeout();
        this.clearIceGatheringTimeout();
        
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
} 