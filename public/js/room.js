(() => {
  const roomEl = document.getElementById('room');
  const code = roomEl.dataset.code;
  const $ = (id) => document.getElementById(id);
  const socket = io();
  const nameKey = `connectme:name:${code}`;
  let selfId = null;
  let isAdmin = false;
  let call = null;
  let joinedName = null;
  let timerInterval = null;
  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceSize = 0;
  let voiceTooLarge = false;

  const getMemberId = () => {
    let id = localStorage.getItem('connectme:member');
    if (!id) {
      id = window.crypto?.randomUUID?.() || `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('connectme:member', id);
    }
    return id;
  };

  const startTimer = (expiresAt) => {
    $('timer').hidden = false;
    clearInterval(timerInterval);
    const tick = () => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      $('timer-text').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    };
    tick();
    timerInterval = setInterval(tick, 1000);
  };

  const renderCall = () => {
    const connected = socket.connected && Boolean(selfId);
    $('call-start-audio').hidden = !isAdmin || Boolean(call);
    $('call-start-video').hidden = !isAdmin || Boolean(call);
    $('call-end').hidden = !isAdmin || !call;
    $('end-meeting').hidden = !isAdmin;
    $('end-meeting').disabled = !connected;
    $('leave-meeting').disabled = !connected;
    $('call-start-audio').disabled = !connected;
    $('call-start-video').disabled = !connected;
    $('call-end').disabled = !connected;
    $('call-join').hidden = !call;
    $('call-view').hidden = !call;

    if (call) {
      const label = call.type === 'video' ? 'video' : 'audio';
      $('call-state-label').textContent = `A ${label} call is live`;
      $('call-state-help').textContent = 'Join the call or keep chatting. You can also view the call without joining.';
      $('call-join').href = `/room/${encodeURIComponent(code)}/call?join=1`;
      $('call-join').textContent = 'Join call';
      $('call-view').href = `/room/${encodeURIComponent(code)}/call`;
    } else {
      $('call-state-label').textContent = 'No call is active';
      $('call-state-help').textContent = isAdmin ? 'Start an audio or video call when the room is ready.' : 'The admin can start an audio or video call.';
    }
  };

  const renderMembers = (members) => {
    $('member-list').replaceChildren();
    $('member-count').textContent = `${members.length} ${members.length === 1 ? 'member' : 'members'}`;
    members.forEach((member) => {
      const item = document.createElement('li');
      item.className = 'member-item';
      const name = document.createElement('span');
      name.className = 'member-name';
      name.textContent = member.id === selfId ? `${member.name} (you)` : member.name;
      item.append(name);
      if (member.isAdmin) {
        const badge = document.createElement('span');
        badge.className = 'admin-badge';
        badge.textContent = 'Admin';
        item.append(badge);
      }
      if (member.inCall) {
        const status = document.createElement('span');
        status.className = 'call-member-status';
        status.textContent = 'In call';
        item.append(status);
      }
      $('member-list').append(item);
    });
  };

  const addChat = ({ from, name, text, dataUrl }) => {
    const mine = from === selfId;
    const node = document.createElement('div');
    node.className = `msg${mine ? ' mine' : ''}`;
    const author = Object.assign(document.createElement('small'), { textContent: mine ? 'You' : name });
    node.append(author);
    if (dataUrl) node.append(Object.assign(document.createElement('img'), { src: dataUrl, alt: 'Shared image' }));
    else node.append(document.createTextNode(text));
    $('chat-log').append(node);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  };

  const addSharedFile = ({ from, name, dataUrl, fileName, mimeType, fileKind }) => {
    const mine = from === selfId;
    const node = document.createElement('div');
    node.className = `msg${mine ? ' mine' : ''}`;
    node.append(Object.assign(document.createElement('small'), { textContent: mine ? 'You' : name }));

    $('chat-log').append(node);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
    fetch(dataUrl).then((response) => response.blob()).then((blob) => {
      const fileUrl = URL.createObjectURL(blob);
      window.addEventListener('pagehide', () => URL.revokeObjectURL(fileUrl), { once: true });
      const attachment = document.createElement('section');
      attachment.className = 'shared-attachment';
      const title = Object.assign(document.createElement('strong'), { className: 'shared-attachment-name', textContent: fileName, title: fileName });
      const actions = document.createElement('div');
      actions.className = 'shared-attachment-actions';
      const preview = Object.assign(document.createElement('a'), { href: fileUrl, target: '_blank', rel: 'noopener', textContent: 'Preview' });
      const download = Object.assign(document.createElement('a'), { href: fileUrl, download: fileName, textContent: 'Download' });
      actions.append(preview, download);
      attachment.append(title);
      if (fileKind === 'image') {
        attachment.prepend(Object.assign(document.createElement('img'), { src: fileUrl, alt: fileName }));
      } else if (fileKind === 'video') {
        attachment.prepend(Object.assign(document.createElement('video'), { src: fileUrl, controls: true, preload: 'metadata' }));
      } else if (fileKind === 'audio') {
        attachment.prepend(Object.assign(document.createElement('audio'), { src: fileUrl, controls: true, preload: 'metadata' }));
      }
      attachment.append(actions);
      node.append(attachment);
      $('chat-log').scrollTop = $('chat-log').scrollHeight;
    }).catch(() => {
      node.append(Object.assign(document.createElement('span'), { textContent: 'Could not preview this file.' }));
    });
  };

  const leaveMeeting = () => {
    socket.emit('meeting-leave', (res) => {
      if (res?.error) alert(res.error);
      else window.location.href = '/';
    });
  };

  $('leave-meeting').addEventListener('click', leaveMeeting);
  $('end-meeting').addEventListener('click', () => {
    if (!window.confirm('End this meeting for everyone? This cannot be undone.')) return;
    socket.emit('meeting-end', (res) => {
      if (res?.error) alert(res.error);
      else window.location.href = '/';
    });
  });
  socket.on('meeting-left', () => {
    window.location.href = '/';
  });

  const joinRoom = () => {
    if (!joinedName || !socket.connected) return;
    socket.emit('join', {
      code,
      name: joinedName,
      memberId: getMemberId(),
      adminToken: sessionStorage.getItem(`connectme:admin:${code}`),
    }, (res) => {
      if (res.error) return alert(res.error);
      selfId = res.id;
      isAdmin = res.isAdmin;
      call = res.call;
      $('join-overlay').hidden = true;
      renderMembers(res.members);
      renderCall();
      if (res.expiresAt) startTimer(res.expiresAt);
    });
  };

  socket.on('connect', joinRoom);
  socket.on('disconnect', () => {
    selfId = null;
    renderCall();
    $('call-state-help').textContent = 'Connection lost. Reconnecting…';
  });

  $('name-input').value = localStorage.getItem(nameKey) || '';
  $('name-form').addEventListener('submit', (event) => {
    event.preventDefault();
    joinedName = $('name-input').value.trim();
    localStorage.setItem(nameKey, joinedName);
    joinRoom();
  });

  socket.on('member-list', renderMembers);
  socket.on('call-state', (state) => {
    call = state;
    renderCall();
  });
  socket.on('chat', addChat);
  socket.on('image', addChat);
  socket.on('file-share', addSharedFile);
  socket.on('room-expired', () => {
    $('expired-overlay').hidden = false;
  });

  $('call-start-audio').addEventListener('click', () => {
    socket.emit('call-start', { type: 'audio' }, (res) => {
      if (res.error) alert(res.error);
    });
  });
  $('call-start-video').addEventListener('click', () => {
    socket.emit('call-start', { type: 'video' }, (res) => {
      if (res.error) alert(res.error);
    });
  });
  $('call-end').addEventListener('click', () => {
    if (window.confirm('End the call for everyone?')) {
      socket.emit('call-end', (res) => {
        if (res.error) alert(res.error);
      });
    }
  });

  $('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('chat-input').value.trim();
    if (text) socket.emit('chat', { text });
    $('chat-input').value = '';
  });

  const shareFile = (file, target) => {
    if (!file) return;

    const extensionType = {
      pdf: 'application/pdf',
      mp4: 'video/mp4',
      webm: 'video/webm',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    }[file.name.split('.').pop().toLowerCase()];
    const mimeType = file.type || extensionType;
    const supportedTypes = new Set([
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'application/pdf', 'video/mp4', 'video/webm',
    ]);

    if (!supportedTypes.has(mimeType)) {
      alert('Choose a PNG, JPEG, GIF, WebP, PDF, MP4, or WebM file.');
      target.value = '';
      return;
    }

    const fileKind = mimeType === 'application/pdf' ? 'pdf' : mimeType.startsWith('video/') ? 'video' : 'image';
    const limits = { image: 4_500_000, pdf: 4_000_000, video: 5_000_000 };
    if (file.size > limits[fileKind]) {
      const limit = fileKind === 'image' ? '4.5 MB' : fileKind === 'pdf' ? '4 MB' : '5 MB';
      alert(`Please choose a ${fileKind} file no larger than ${limit}.`);
      target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('file-share', { dataUrl: reader.result, fileName: file.name, mimeType }, (res) => {
        if (res?.error) alert(res.error);
      });
    };
    reader.onerror = () => alert('Could not read that file. Please try again.');
    reader.readAsDataURL(file);
    target.value = '';
  };

  $('attach-menu').querySelectorAll('[data-accept]').forEach((option) => {
    option.addEventListener('click', () => {
      const input = $('image-input');
      input.accept = option.dataset.accept;
      input.click();
      $('attach-menu').open = false;
    });
  });

  $('image-input').addEventListener('change', ({ target }) => {
    const [file] = target.files;
    shareFile(file, target);
  });

  const setVoiceStatus = (message) => {
    $('voice-note-status').textContent = message;
    $('voice-note-status').hidden = !message;
  };

  const resetVoiceRecorder = () => {
    voiceStream?.getTracks().forEach((track) => track.stop());
    voiceStream = null;
    voiceRecorder = null;
    voiceChunks = [];
    voiceSize = 0;
    $('record-voice').classList.remove('recording');
    $('record-voice').setAttribute('aria-pressed', 'false');
    $('record-voice').title = 'Record a voice message';
    $('record-voice').setAttribute('aria-label', 'Record a voice message');
  };

  const sendVoiceNote = (blob, mimeType) => {
    if (blob.size > 5_000_000) {
      alert('Voice messages must be no larger than 5 MB.');
      return;
    }
    const extension = mimeType === 'audio/ogg' ? 'ogg' : mimeType === 'audio/mp4' ? 'm4a' : 'webm';
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('file-share', {
        dataUrl: reader.result,
        fileName: `voice-message-${Date.now()}.${extension}`,
        mimeType,
      }, (res) => {
        if (res?.error) alert(res.error);
        else setVoiceStatus('Voice message sent.');
      });
    };
    reader.onerror = () => alert('Could not read the voice message. Please try again.');
    reader.readAsDataURL(blob);
  };

  $('record-voice').addEventListener('click', async () => {
    if (voiceRecorder?.state === 'recording') {
      voiceRecorder.stop();
      $('record-voice').disabled = true;
      setVoiceStatus('Sending voice message…');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus('Voice recording is not supported by this browser.');
      return;
    }
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm', 'audio/ogg', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      voiceRecorder = new MediaRecorder(voiceStream, mimeType ? { mimeType } : undefined);
      voiceChunks = [];
      voiceSize = 0;
      voiceTooLarge = false;
      voiceRecorder.addEventListener('dataavailable', ({ data }) => {
        if (!data.size) return;
        voiceSize += data.size;
        if (voiceSize > 5_000_000) {
          voiceTooLarge = true;
          voiceRecorder.stop();
          return;
        }
        voiceChunks.push(data);
      });
      voiceRecorder.addEventListener('stop', () => {
        const recordingType = voiceRecorder.mimeType.split(';')[0];
        const recording = new Blob(voiceChunks, { type: recordingType });
        if (voiceTooLarge) alert('Voice messages must be no larger than 5 MB.');
        else if (!recording.size) setVoiceStatus('No audio was recorded. Try again and check your microphone.');
        else sendVoiceNote(recording, recordingType);
        resetVoiceRecorder();
        $('record-voice').disabled = false;
      }, { once: true });
      voiceRecorder.start(1000);
      $('record-voice').classList.add('recording');
      $('record-voice').setAttribute('aria-pressed', 'true');
      $('record-voice').title = 'Stop recording and send voice message';
      $('record-voice').setAttribute('aria-label', 'Stop recording and send voice message');
      setVoiceStatus('Recording… select the microphone again to send.');
    } catch (error) {
      resetVoiceRecorder();
      setVoiceStatus(`Could not access your microphone: ${error.message}`);
    }
  });
})();
