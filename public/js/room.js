(() => {
  const roomEl = document.getElementById('room');
  const code = roomEl.dataset.code;
  const $ = (id) => document.getElementById(id);
  const socket = io();
  const peers = new Map();
  const localStream = new MediaStream();
  const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  let cameraTrack = null;
  let micTrack = null;
  let screenTrack = null;
  let selfId = null;

  const createTile = (id, name) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const video = Object.assign(document.createElement('video'), { autoplay: true, playsInline: true, muted: id === 'self' });
    const label = Object.assign(document.createElement('span'), { textContent: id === 'self' ? `${name} (you)` : name });
    tile.append(video, label);
    $('tiles').append(tile);
    return { tile, video };
  };

  const kindSender = (pc, kind) => pc.getTransceivers().find((t) => t.receiver.track.kind === kind).sender;

  const createPeer = (id, name, initiator) => {
    const pc = new RTCPeerConnection(rtcConfig);
    const { tile, video } = createTile(id, name);
    const remote = new MediaStream();
    video.srcObject = remote;
    peers.set(id, { pc, tile });

    [['audio', micTrack], ['video', cameraTrack]].forEach(([kind, track]) =>
      track ? pc.addTrack(track, localStream) : pc.addTransceiver(kind));

    pc.onicecandidate = ({ candidate }) => candidate && socket.emit('signal', { to: id, data: { candidate } });
    pc.ontrack = ({ track }) => remote.addTrack(track);
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        await pc.setLocalDescription(await pc.createOffer());
        socket.emit('signal', { to: id, data: { description: pc.localDescription } });
      };
    }
    return pc;
  };

  const removePeer = (id) => {
    const peer = peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.tile.remove();
    peers.delete(id);
  };

  socket.on('signal', async ({ from, data }) => {
    const pc = peers.get(from)?.pc || createPeer(from, 'Guest', false);
    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('signal', { to: from, data: { description: pc.localDescription } });
      }
    } else if (data.candidate) {
      await pc.addIceCandidate(data.candidate).catch(() => {});
    }
  });

  socket.on('peer-joined', ({ id, name }) => {
    const peer = peers.get(id);
    if (peer) peer.tile.querySelector('span').textContent = name;
    else createPeer(id, name, false);
  });
  socket.on('peer-left', ({ id }) => removePeer(id));

  const addChat = ({ from, name, text, dataUrl }) => {
    const mine = from === selfId;
    const node = document.createElement('div');
    node.className = `msg${mine ? ' mine' : ''}`;
    const author = Object.assign(document.createElement('small'), { textContent: mine ? 'You' : name });
    node.append(author);
    if (dataUrl) node.append(Object.assign(document.createElement('img'), { src: dataUrl, alt: 'Shared image' }));
    else node.append(text);
    $('chat-log').append(node);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  };
  socket.on('chat', addChat);
  socket.on('image', addChat);

  $('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('chat-input').value.trim();
    if (text) socket.emit('chat', { text });
    $('chat-input').value = '';
  });

  $('image-input').addEventListener('change', ({ target }) => {
    const [file] = target.files;
    if (!file || file.size > 4.5e6) return alert('Please choose an image under 4.5 MB.');
    const reader = new FileReader();
    reader.onload = () => socket.emit('image', { dataUrl: reader.result, fileName: file.name });
    reader.readAsDataURL(file);
    target.value = '';
  });

  const updateTrackControl = (track, button, onIcon, offIcon, label, stateId) => {
    const enabled = Boolean(track && track.enabled);
    const action = track ? `Turn ${label.toLowerCase()} ${enabled ? 'off' : 'on'}` : `${label} unavailable`;
    button.classList.toggle('off', !enabled);
    button.querySelector('use').setAttribute('href', `#i-${enabled ? onIcon : offIcon}`);
    button.title = action;
    button.setAttribute('aria-label', action);
    button.setAttribute('aria-pressed', String(enabled));
    $(stateId).textContent = track ? (enabled ? 'On' : 'Off') : 'Unavailable';
  };
  const toggleTrack = (track, button, onIcon, offIcon, label, stateId) => {
    if (!track) return;
    track.enabled = !track.enabled;
    updateTrackControl(track, button, onIcon, offIcon, label, stateId);
  };
  $('btn-mic').addEventListener('click', () => toggleTrack(micTrack, $('btn-mic'), 'mic', 'mic-off', 'microphone', 'mic-state'));
  $('btn-cam').addEventListener('click', () => toggleTrack(cameraTrack, $('btn-cam'), 'video', 'video-off', 'camera', 'cam-state'));

  const setVideoTrack = (track, previewStream) => {
    peers.forEach(({ pc }, id) => id !== 'self' && kindSender(pc, 'video').replaceTrack(track));
    peers.get('self').tile.querySelector('video').srcObject = previewStream;
  };

  const stopScreenShare = () => {
    screenTrack?.stop();
    screenTrack = null;
    $('btn-screen').classList.remove('off');
    $('btn-screen').title = 'Share your screen';
    $('btn-screen').setAttribute('aria-label', 'Share your screen');
    $('btn-screen').setAttribute('aria-pressed', 'false');
    $('screen-state').textContent = 'Start';
    setVideoTrack(cameraTrack, localStream);
  };

  $('btn-screen').addEventListener('click', async () => {
    if (screenTrack) return stopScreenShare();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenTrack = stream.getVideoTracks()[0];
      screenTrack.onended = stopScreenShare;
      $('btn-screen').classList.add('off');
      $('btn-screen').title = 'Stop sharing your screen';
      $('btn-screen').setAttribute('aria-label', 'Stop sharing your screen');
      $('btn-screen').setAttribute('aria-pressed', 'true');
      $('screen-state').textContent = 'Sharing';
      setVideoTrack(screenTrack, stream);
    } catch { /* user cancelled */ }
  });

  const startTimer = (expiresAt) => {
    $('timer').hidden = false;
    const tick = () => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      $('timer-text').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    };
    tick();
    setInterval(tick, 1000);
  };

  socket.on('room-expired', () => {
    peers.forEach((_, id) => removePeer(id));
    $('expired-overlay').hidden = false;
  });

  const getMedia = async () => {
    const attempts = [{ audio: true, video: true }, { audio: true }];
    for (const constraints of attempts) {
      try { return await navigator.mediaDevices.getUserMedia(constraints); } catch { /* try next */ }
    }
    return new MediaStream();
  };

  $('name-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const stream = await getMedia();
    [micTrack] = stream.getAudioTracks();
    [cameraTrack] = stream.getVideoTracks();
    stream.getTracks().forEach((track) => localStream.addTrack(track));

    const name = $('name-input').value.trim();
    const adminToken = sessionStorage.getItem(`connectme:admin:${code}`);
    socket.emit('join', { code, name, adminToken }, (res) => {
      if (res.error) return alert(res.error);
      selfId = res.id;
      $('join-overlay').hidden = true;
      const { video } = createTile('self', name);
      video.srcObject = localStream;
      peers.set('self', { pc: { close() {}, getTransceivers: () => [] }, tile: video.parentElement });
      res.peers.forEach((peer) => createPeer(peer.id, peer.name, true));
      if (res.expiresAt) startTimer(res.expiresAt);
      updateTrackControl(micTrack, $('btn-mic'), 'mic', 'mic-off', 'microphone', 'mic-state');
      updateTrackControl(cameraTrack, $('btn-cam'), 'video', 'video-off', 'camera', 'cam-state');
      if (!cameraTrack) $('btn-cam').disabled = true;
      if (!micTrack) $('btn-mic').disabled = true;
    });
  });
})();
