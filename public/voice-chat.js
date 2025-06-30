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
        
        // Enhanced ICE servers with multiple reliable options
        this.iceServers = {
            iceServers: [
                // Google STUN servers
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                
                // Multiple free TURN servers for better reliability
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                
                // Additional backup TURN servers
                {
                    urls: 'turn:relay1.expressturn.com:3478',
                    username: 'efJHYRDGALGWGAUNCQ',
                    credential: 'JZEOETFSDkfnfdhngdnfh04n'
                }
            ],
            iceCandidatePoolSize: 10
        };
        
        this.initializeElements();
        this.initializeSocketEvents();
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
    
    createPeerConnection() {
        console.log('Creating peer connection with ICE servers:', this.iceServers);
        this.peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Set connection timeout
        this.setConnectionTimeout();
        
        // Add local stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('Adding local track:', track.kind);
                this.peerConnection.addTrack(track, this.localStream);
            });
        }
        
        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);
            const [remoteStream] = event.streams;
            this.remoteAudio.srcObject = remoteStream;
            this.clearConnectionTimeout();
        };
        
        // Enhanced ICE candidate handling
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 ICE Candidate:', {
                    type: event.candidate.type,
                    protocol: event.candidate.protocol,
                    address: event.candidate.address,
                    port: event.candidate.port,
                    priority: event.candidate.priority
                });
                
                this.socket.emit('webrtc-ice-candidate', {
                    candidate: event.candidate,
                    targetId: this.currentCallPartner
                });
            } else {
                console.log('🧊 ICE gathering completed');
            }
        };
        
        // Connection state monitoring
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 Connection state:', state);
            
            switch (state) {
                case 'new':
                    this.updateCallStatus('Initializing...', 'connecting');
                    break;
                case 'connecting':
                    this.updateCallStatus('Connecting...', 'connecting');
                    break;
                case 'connected':
                    this.updateCallStatus('Connected', 'connected');
                    this.clearConnectionTimeout();
                    break;
                case 'disconnected':
                    this.updateCallStatus('Disconnected', 'disconnected');
                    setTimeout(() => this.handleCallEnded(), 2000);
                    break;
                case 'failed':
                    console.error('❌ Connection failed');
                    this.updateCallStatus('Connection failed', 'failed');
                    setTimeout(() => this.handleCallEnded(), 2000);
                    break;
                case 'closed':
                    this.handleCallEnded();
                    break;
            }
        };
        
        // ICE connection state monitoring
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 ICE connection state:', state);
            
            switch (state) {
                case 'checking':
                    this.updateCallStatus('Finding connection path...', 'connecting');
                    break;
                case 'connected':
                case 'completed':
                    console.log('✅ ICE connection established');
                    this.updateCallStatus('Voice connected', 'connected');
                    this.clearConnectionTimeout();
                    break;
                case 'failed':
                    console.error('❌ ICE connection failed - trying TURN servers');
                    this.updateCallStatus('Connection failed', 'failed');
                    // Don't immediately end call, let connection state handle it
                    break;
                case 'disconnected':
                    this.updateCallStatus('Connection lost', 'disconnected');
                    break;
                case 'closed':
                    this.handleCallEnded();
                    break;
            }
        };
        
        // ICE gathering state monitoring
        this.peerConnection.onicegatheringstatechange = () => {
            const state = this.peerConnection.iceGatheringState;
            console.log('🧊 ICE gathering state:', state);
            
            if (state === 'gathering') {
                this.updateCallStatus('Preparing connection...', 'connecting');
                // Set timeout for ICE gathering
                this.iceGatheringTimeout = setTimeout(() => {
                    console.warn('⚠️ ICE gathering timeout');
                    if (this.peerConnection && this.peerConnection.iceGatheringState === 'gathering') {
                        this.updateCallStatus('Connection timeout', 'failed');
                        setTimeout(() => this.handleCallEnded(), 2000);
                    }
                }, 15000); // 15 second timeout
            } else if (state === 'complete') {
                console.log('✅ ICE gathering completed');
                this.clearIceGatheringTimeout();
            }
        };
        
        // Data channel for connection testing (optional)
        const dataChannel = this.peerConnection.createDataChannel('test', { ordered: true });
        dataChannel.onopen = () => {
            console.log('📡 Data channel opened');
            dataChannel.send('ping');
        };
        dataChannel.onmessage = (event) => {
            console.log('📡 Data channel message:', event.data);
        };
    }
    
    setConnectionTimeout() {
        this.clearConnectionTimeout();
        this.connectionTimeout = setTimeout(() => {
            console.error('⏰ Connection timeout after 30 seconds');
            this.updateCallStatus('Connection timeout', 'failed');
            setTimeout(() => this.handleCallEnded(), 2000);
        }, 30000); // 30 second timeout
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
            this.createPeerConnection();
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
        console.log('📞 Call accepted by:', data.accepterId);
        this.currentCallPartner = data.accepterId;
        this.createPeerConnection();
        
        try {
            console.log('📤 Creating offer...');
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            
            console.log('📤 Setting local description...');
            await this.peerConnection.setLocalDescription(offer);
            
            console.log('📤 Sending offer...');
            this.socket.emit('webrtc-offer', {
                offer: offer,
                targetId: this.currentCallPartner
            });
            
            this.isInCall = true;
            this.toggleCallButtons();
        } catch (error) {
            console.error('❌ Error creating offer:', error);
            this.updateCallStatus('Failed to create call', 'failed');
            setTimeout(() => this.handleCallEnded(), 2000);
        }
    }
    
    async handleOffer(data) {
        console.log('📥 Received offer from:', data.senderId);
        try {
            console.log('📥 Setting remote description...');
            await this.peerConnection.setRemoteDescription(data.offer);
            
            console.log('📤 Creating answer...');
            const answer = await this.peerConnection.createAnswer();
            
            console.log('📤 Setting local description...');
            await this.peerConnection.setLocalDescription(answer);
            
            console.log('📤 Sending answer...');
            this.socket.emit('webrtc-answer', {
                answer: answer,
                targetId: data.senderId
            });
        } catch (error) {
            console.error('❌ Error handling offer:', error);
            this.updateCallStatus('Failed to answer call', 'failed');
            setTimeout(() => this.handleCallEnded(), 2000);
        }
    }
    
    async handleAnswer(data) {
        console.log('📥 Received answer from:', data.senderId);
        try {
            await this.peerConnection.setRemoteDescription(data.answer);
            console.log('✅ Answer processed successfully');
        } catch (error) {
            console.error('❌ Error handling answer:', error);
            this.updateCallStatus('Failed to establish call', 'failed');
            setTimeout(() => this.handleCallEnded(), 2000);
        }
    }
    
    async handleIceCandidate(data) {
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(data.candidate);
                console.log('✅ ICE candidate added:', data.candidate.type);
            } else {
                console.warn('⚠️ Received ICE candidate before remote description');
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
                console.log('🛑 Stopped track:', track.kind);
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