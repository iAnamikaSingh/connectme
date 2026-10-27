(() => {
  const page = document.getElementById('call-page');
  const code = page.dataset.code;
  const $ = (id) => document.getElementById(id);
  const socket = io();
  const peers = new Map();
  const participants = new Map();
  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const nameKey = `connectme:name:${code}`;
  let autoJoinPending = new URLSearchParams(window.location.search).has('join');
  let joinedName = localStorage.getItem(nameKey);
  let selfId = null;
  let selfMemberId = null;
  let isAdmin = false;
  let call = null;
  let joined = false;
  let roomJoined = false;
  let mediaMode = null;
  let localStream = new MediaStream();
  let micTrack = null;
  let cameraTrack = null;
  let screenTrack = null;
  let modeBeforeScreenShare = 'audio';

  const getMemberId = () => {
    let id = localStorage.getItem('connectme:member');
    if (!id) {
      id = window.crypto?.randomUUID?.() || `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('connectme:member', id);
    }
    return id;
  };

  const showError = (message) => {
    $('call-error').textContent = message;
    $('call-error').hidden = false;
  };

  const clearError = () => {
    $('call-error').textContent = '';
    $('call-error').hidden = true;
  };

  const setControl = (button, enabled, onIcon, offIcon, label) => {
    button.classList.toggle('off', !enabled);
    const use = button.querySelector('use');
    if (use) use.setAttribute('href', `#i-${enabled ? onIcon : offIcon}`);
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('.ctl-caption small').textContent = enabled ? 'On' : 'Off';
    button.querySelector('.ctl-caption > span').textContent = label;
  };

  const renderControls = () => {
    $('end-meeting').hidden = !isAdmin;
    $('end-meeting').disabled = !socket.connected || !roomJoined;
    $('leave-meeting').disabled = !socket.connected || !roomJoined;
    $('call-join').hidden = joined;
    $('call-join').disabled = !call || !socket.connected || !roomJoined;
    $('call-join').textContent = call ? `Join ${call.type} call` : 'Waiting for call';
    $('call-mic').hidden = !joined;
    $('call-camera').hidden = !joined;
    $('call-screen').hidden = !joined;
    $('call-leave').hidden = !joined;
    $('call-watch').hidden = joined || !call;
    if (joined) {
      const micEnabled = Boolean(micTrack?.enabled);
      setControl($('call-mic'), micEnabled, 'mic', 'mic-off', 'Microphone');
      setControl($('call-camera'), mediaMode === 'video', 'video', 'video-off', 'Camera');
      $('call-mic').disabled = !micTrack || !socket.connected;
      $('call-camera').disabled = !socket.connected;
    }
  };

  const createTile = (participant) => {
    const tile = document.createElement('article');
    tile.className = 'call-tile';
    tile.dataset.id = participant.id;
    const video = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: participant.id === selfId });
    const audioAvatar = document.createElement('div');
    audioAvatar.className = 'audio-avatar';
    audioAvatar.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-phone"/></svg>';
    const caption = document.createElement('div');
    caption.className = 'call-tile-caption';
    const name = Object.assign(document.createElement('span'), { className: 'call-tile-name', textContent: participant.id === selfId ? `${participant.name} (you)` : participant.name });
    caption.append(name);
    if (participant.isAdmin) {
      const badge = Object.assign(document.createElement('span'), { className: 'admin-badge', textContent: 'Admin' });
      caption.append(badge);
    }
    tile.append(video, audioAvatar, caption);
    $('call-tiles').append(tile);
    return { tile, video };
  };

  const renderParticipant = (participant) => {
    let state = peers.get(participant.id);
    if (!state) {
      const tile = createTile(participant);
      state = { ...tile, pc: null, remote: new MediaStream() };
      peers.set(participant.id, state);
    }
    state.tile.querySelector('.call-tile-name').textContent = participant.id === selfId ? `${participant.name} (you)` : participant.name;
    state.tile.classList.toggle('audio-only', participant.mode !== 'video');
    state.tile.querySelector('video').hidden = participant.mode !== 'video';
    state.tile.querySelector('.audio-avatar').hidden = participant.mode === 'video';
    let badge = state.tile.querySelector('.admin-badge');
    if (participant.isAdmin && !badge) {
      badge = Object.assign(document.createElement('span'), { className: 'admin-badge', textContent: 'Admin' });
      state.tile.querySelector('.call-tile-caption').append(badge);
    } else if (!participant.isAdmin) {
      badge?.remove();
    }
    $('call-count').textContent = `${participants.size} ${participants.size === 1 ? 'participant' : 'participants'}`;
  };

  const updateParticipant = (participant) => {
    participants.set(participant.id, participant);
    renderParticipant(participant);
  };

  const removePeer = (id) => {
    const peer = peers.get(id);
    if (!peer) return;
    peer.pc?.close();
    peer.tile.remove();
    peers.delete(id);
    participants.delete(id);
    $('call-count').textContent = `${participants.size} ${participants.size === 1 ? 'participant' : 'participants'}`;
  };

  const resetConnection = () => {
    joined = false;
    roomJoined = false;
    mediaMode = null;
    [...peers.keys()].forEach(removePeer);
    if (screenTrack) {
      screenTrack.onended = null;
      screenTrack.stop();
    }
    screenTrack = null;
    localStream.getTracks().forEach((track) => track.stop());
    localStream = new MediaStream();
    micTrack = null;
    cameraTrack = null;
    renderControls();
  };

  const setLocalTracks = async (pc) => {
    const audio = pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === 'audio');
    const video = pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === 'video');
    if (audio) await audio.sender.replaceTrack(micTrack);
    if (video) await video.sender.replaceTrack(screenTrack || cameraTrack);
  };

  const negotiate = async (id, state) => {
    const pc = state.pc;
    if (!pc || pc.signalingState === 'closed' || state.negotiating) return;
    if (pc.signalingState !== 'stable') {
      state.needsNegotiation = true;
      return;
    }
    state.needsNegotiation = false;
    state.negotiating = true;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      socket.emit('signal', { to: id, data: { description: pc.localDescription } });
    } finally {
      state.negotiating = false;
    }
  };

  const createPeer = (participant, initiator, observer) => {
    const existing = peers.get(participant.id);
    if (existing?.pc && existing.pc.signalingState !== 'closed') return existing.pc;
    const state = existing || (() => {
      const tile = createTile(participant);
      return { ...tile, remote: new MediaStream(), pc: null };
    })();
    const pc = new RTCPeerConnection(rtcConfig);
    state.pc = pc;
    state.initiator = initiator;
    state.negotiating = false;
    state.needsNegotiation = false;
    state.pendingCandidates = [];
    state.video.srcObject = state.remote;
    peers.set(participant.id, state);

    if (observer) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
      setLocalTracks(pc).catch((error) => showError(`Could not connect your audio or video: ${error.message}`));
    }

    pc.onicecandidate = ({ candidate }) => candidate && socket.emit('signal', { to: participant.id, data: { candidate } });
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable' && state.needsNegotiation) {
        negotiate(participant.id, state).catch((error) => showError(`Could not connect to ${participant.name}: ${error.message}`));
      }
    };
    pc.ontrack = ({ track }) => {
      if (!state.remote.getTracks().some((current) => current.id === track.id)) state.remote.addTrack(track);
    };
    if (initiator) {
      pc.onnegotiationneeded = () => negotiate(participant.id, state)
        .catch((error) => showError(`Could not connect to ${participant.name}: ${error.message}`));
    }
    return pc;
  };

  const upgradePeer = async (id, renegotiate) => {
    const peer = peers.get(id);
    if (!peer?.pc || peer.pc.signalingState === 'closed') return;
    peer.pc.getTransceivers().forEach((transceiver) => {
      transceiver.direction = 'sendrecv';
    });
    await setLocalTracks(peer.pc);
    if (renegotiate) await negotiate(id, peer);
  };

  const receiveSignal = async ({ from, data }) => {
    const participant = participants.get(from) || { id: from, name: 'Participant', mode: 'audio' };
    let pc = peers.get(from)?.pc;
    if (!pc || pc.signalingState === 'closed') {
      pc = createPeer(participant, false, !joined);
    }
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      for (const candidate of peers.get(from).pendingCandidates.splice(0)) {
        await pc.addIceCandidate(candidate);
      }
      if (data.description.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('signal', { to: from, data: { description: pc.localDescription } });
      } else if (peers.get(from).needsNegotiation) {
        await negotiate(from, peers.get(from));
      }
    } else if (data.candidate) {
      const state = peers.get(from);
      if (!pc.remoteDescription) state.pendingCandidates.push(data.candidate);
      else await pc.addIceCandidate(data.candidate);
    }
  };

  socket.on('signal', (message) => {
    receiveSignal(message).catch((error) => showError(`Call connection failed: ${error.message}`));
  });

  $('leave-meeting').addEventListener('click', () => {
    socket.emit('meeting-leave', (res) => {
      if (res?.error) showError(res.error);
      else window.location.href = '/';
    });
  });

  $('end-meeting').addEventListener('click', () => {
    if (!window.confirm('End this meeting for everyone? This cannot be undone.')) return;
    socket.emit('meeting-end', (res) => {
      if (res?.error) showError(res.error);
      else window.location.href = '/';
    });
  });

  socket.on('meeting-left', () => {
    window.location.href = '/';
  });

  socket.on('call-member-joined', (participant) => {
    if (!participant || participant.id === socket.id) return;
    updateParticipant(participant);
    if (joined) {
      if (peers.has(participant.id)) {
        upgradePeer(participant.id, false).catch((error) => showError(error.message));
      } else {
        createPeer(participant, false, false);
      }
    } else if (!peers.get(participant.id)?.pc) {
      createPeer(participant, true, true);
    }
  });

  socket.on('call-member-updated', (participant) => {
    if (participant && participant.id !== socket.id) updateParticipant(participant);
  });

  socket.on('call-member-left', ({ id }) => {
    if (id !== socket.id) removePeer(id);
  });

  const setCallState = (nextCall) => {
    call = nextCall;
    $('call-page-status').textContent = call ? `${call.type === 'video' ? 'Video' : 'Audio'} call in progress` : 'No call is active';
    $('call-title').textContent = call ? `${call.type === 'video' ? 'Video' : 'Audio'} call` : 'Waiting for a call';
    $('call-description').textContent = call
      ? 'Join the conversation or view the participants without joining.'
      : 'The admin has not started an audio or video call yet. You can stay on this page and join when it begins.';
    renderControls();
    if (!call) {
      joined = false;
      mediaMode = null;
      [...peers.keys()].forEach(removePeer);
      localStream.getTracks().forEach((track) => track.stop());
      localStream = new MediaStream();
      if (screenTrack) {
        screenTrack.onended = null;
        screenTrack.stop();
      }
      screenTrack = null;
      micTrack = null;
      cameraTrack = null;
    }
  };

  socket.on('call-state', setCallState);
  socket.on('room-expired', () => {
    setCallState(null);
    $('expired-overlay').hidden = false;
  });

  const acquireMedia = async () => {
    let lastError;
    const constraintsList = call.type === 'video'
      ? [{ audio: true, video: true }, { audio: true }, { video: true }]
      : [{ audio: true }];
    for (const constraints of constraintsList) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(lastError?.message || 'Allow microphone or camera access to join the call.');
  };

  const joinCall = async () => {
    clearError();
    if (!call) return;
    if (!socket.connected || !roomJoined) {
      showError('The connection is being restored. Try joining again in a moment.');
      return;
    }
    $('call-join').disabled = true;
    try {
      localStream = await acquireMedia();
      [micTrack] = localStream.getAudioTracks();
      [cameraTrack] = localStream.getVideoTracks();
      mediaMode = call.type === 'video' && cameraTrack ? 'video' : 'audio';
      if (cameraTrack) cameraTrack.enabled = mediaMode === 'video';

      socket.emit('call-join', { mode: mediaMode }, (res) => {
        $('call-join').disabled = false;
        if (res.error) {
          localStream.getTracks().forEach((track) => track.stop());
          showError(res.error);
          return;
        }
        joined = true;
        const selfParticipant = { id: socket.id, memberId: selfMemberId, name: localStorage.getItem(nameKey), isAdmin, mode: mediaMode };
        updateParticipant(selfParticipant);
        peers.get(socket.id).video.srcObject = localStream;
        res.participants.forEach((participant) => {
          updateParticipant(participant);
          if (peers.get(participant.id)?.pc) {
            upgradePeer(participant.id, true).catch((error) => showError(error.message));
          } else {
            createPeer(participant, true, false);
          }
        });
        renderControls();
      });
    } catch (error) {
      $('call-join').disabled = false;
      showError(`Could not access a microphone or camera. Check browser permissions and try again. (${error.message})`);
    }
  };

  $('call-join').addEventListener('click', joinCall);
  $('call-mic').addEventListener('click', () => {
    if (!micTrack) return;
    micTrack.enabled = !micTrack.enabled;
    setControl($('call-mic'), micTrack.enabled, 'mic', 'mic-off', 'Microphone');
  });

  const setVideoMode = async (mode) => {
    if (mode === 'video' && !cameraTrack) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        [cameraTrack] = stream.getVideoTracks();
        localStream.addTrack(cameraTrack);
      } catch (error) {
        showError(`Could not access your camera. Check browser permissions and try again. (${error.message})`);
        return;
      }
    }
    if (screenTrack) await stopScreenShare();
    if (cameraTrack) cameraTrack.enabled = mode === 'video';
    mediaMode = mode;
    for (const [id, peer] of peers) {
      if (id !== socket.id && peer.pc) {
        const video = peer.pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === 'video');
        if (video) await video.sender.replaceTrack(cameraTrack);
      }
    }
    socket.emit('call-mode', { mode }, (res) => {
      if (res.error) showError(res.error);
    });
    const selfParticipant = participants.get(socket.id);
    if (selfParticipant) updateParticipant({ ...selfParticipant, mode });
    renderControls();
  };

  $('call-camera').addEventListener('click', () => {
    setVideoMode(mediaMode === 'video' ? 'audio' : 'video').catch((error) => showError(error.message));
  });

  const stopScreenShare = async () => {
    if (!screenTrack) return;
    screenTrack.onended = null;
    screenTrack.stop();
    screenTrack = null;
    for (const [id, peer] of peers) {
      if (id !== socket.id && peer.pc) {
        const video = peer.pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === 'video');
        if (video) await video.sender.replaceTrack(cameraTrack);
      }
    }
    mediaMode = modeBeforeScreenShare;
    if (cameraTrack) cameraTrack.enabled = mediaMode === 'video';
    const selfTile = peers.get(socket.id);
    if (selfTile) selfTile.video.srcObject = localStream;
    socket.emit('call-mode', { mode: mediaMode });
    const selfParticipant = participants.get(socket.id);
    if (selfParticipant) updateParticipant({ ...selfParticipant, mode: mediaMode });
    $('call-screen').classList.remove('off');
    $('call-screen').querySelector('.ctl-caption small').textContent = 'Start';
    $('call-screen').setAttribute('aria-pressed', 'false');
  };

  $('call-screen').addEventListener('click', async () => {
    if (screenTrack) {
      await stopScreenShare();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenTrack = stream.getVideoTracks()[0];
      modeBeforeScreenShare = mediaMode;
      screenTrack.onended = () => stopScreenShare().catch((error) => showError(error.message));
      for (const [id, peer] of peers) {
        if (id !== socket.id && peer.pc) {
          const video = peer.pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === 'video');
          if (video) await video.sender.replaceTrack(screenTrack);
        }
      }
      const selfTile = peers.get(socket.id);
      if (selfTile) selfTile.video.srcObject = stream;
      mediaMode = 'video';
      if (cameraTrack) cameraTrack.enabled = false;
      socket.emit('call-mode', { mode: 'video' });
      const selfParticipant = participants.get(socket.id);
      if (selfParticipant) updateParticipant({ ...selfParticipant, mode: 'video' });
      $('call-screen').classList.add('off');
      $('call-screen').querySelector('.ctl-caption small').textContent = 'Sharing';
      $('call-screen').setAttribute('aria-pressed', 'true');
      renderControls();
    } catch (error) {
      if (error.name !== 'NotAllowedError') showError(`Could not share your screen: ${error.message}`);
    }
  });

  $('call-leave').addEventListener('click', () => {
    socket.emit('call-leave', () => {
      joined = false;
      [...peers.keys()].forEach(removePeer);
      localStream.getTracks().forEach((track) => track.stop());
      if (screenTrack) {
        screenTrack.onended = null;
        screenTrack.stop();
      }
      screenTrack = null;
      window.location.href = `/room/${encodeURIComponent(code)}`;
    });
  });

  $('call-watch').addEventListener('click', () => {
    window.location.href = `/room/${encodeURIComponent(code)}`;
  });

  const connectToRoom = (name) => {
    joinedName = name;
    if (!socket.connected) return;
    socket.emit('join', {
      code,
      name,
      memberId: getMemberId(),
      adminToken: sessionStorage.getItem(`connectme:admin:${code}`),
      view: 'call',
    }, (res) => {
      if (res.error) {
        showError(res.error);
        return;
      }
      selfId = socket.id;
      selfMemberId = res.id;
      isAdmin = res.isAdmin;
      roomJoined = true;
      call = res.call;
      $('call-name-overlay').hidden = true;
      $('call-page-status').textContent = call ? `${call.type === 'video' ? 'Video' : 'Audio'} call in progress` : 'Waiting for the admin';
      setCallState(call);
      renderControls();
      if (call) {
        res.participants.forEach((participant) => {
          updateParticipant(participant);
          createPeer(participant, true, true);
        });
      }
      renderControls();
      const shouldAutoJoin = autoJoinPending;
      autoJoinPending = false;
      if (shouldAutoJoin && call) joinCall();
    });
  };

  socket.on('connect', () => {
    if (joinedName) connectToRoom(joinedName);
  });
  socket.on('disconnect', () => {
    resetConnection();
    $('call-page-status').textContent = 'Connection lost. Reconnecting…';
  });

  const savedName = joinedName;
  if (savedName) {
    if (socket.connected) connectToRoom(savedName);
  } else {
    $('call-name-overlay').hidden = false;
    $('call-name-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = $('call-name-input').value.trim();
      localStorage.setItem(nameKey, name);
      joinedName = name;
      connectToRoom(name);
    });
  }
})();
