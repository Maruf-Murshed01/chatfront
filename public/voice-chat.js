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
        
        // STUN and TURN servers for NAT traversal and cross-network connectivity
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // Free TURN servers for cross-network connectivity
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
                }
            ]
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
        this.peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Add local stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }
        
        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            const [remoteStream] = event.streams;
            this.remoteAudio.srcObject = remoteStream;
        };
        
        // Enhanced ICE candidate handling with logging
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE candidate type:', event.candidate.type, 'Protocol:', event.candidate.protocol);
                this.socket.emit('webrtc-ice-candidate', {
                    candidate: event.candidate,
                    targetId: this.currentCallPartner
                });
            }
        };
        
        // Enhanced connection state changes with better status updates
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            
            switch (this.peerConnection.connectionState) {
                case 'connecting':
                    this.updateCallStatus('Connecting...', 'connecting');
                    break;
                case 'connected':
                    this.updateCallStatus('Connected', 'connected');
                    break;
                case 'disconnected':
                case 'failed':
                    this.handleCallEnded();
                    break;
            }
        };
        
        // Add ICE connection state logging for debugging
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', this.peerConnection.iceConnectionState);
            
            if (this.peerConnection.iceConnectionState === 'checking') {
                this.updateCallStatus('Establishing connection...', 'connecting');
            } else if (this.peerConnection.iceConnectionState === 'failed') {
                console.error('ICE connection failed - may need better TURN servers');
                this.updateCallStatus('Connection failed', 'failed');
            }
        };
        
        // Add ICE gathering state logging
        this.peerConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', this.peerConnection.iceGatheringState);
        };
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
        this.currentCallPartner = data.accepterId;
        this.createPeerConnection();
        
        try {
            // Create and send offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('webrtc-offer', {
                offer: offer,
                targetId: this.currentCallPartner
            });
            
            this.isInCall = true;
            this.toggleCallButtons();
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }
    
    async handleOffer(data) {
        try {
            await this.peerConnection.setRemoteDescription(data.offer);
            
            // Create and send answer
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                answer: answer,
                targetId: data.senderId
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }
    
    async handleAnswer(data) {
        try {
            await this.peerConnection.setRemoteDescription(data.answer);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
    
    async handleIceCandidate(data) {
        try {
            await this.peerConnection.addIceCandidate(data.candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
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
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
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