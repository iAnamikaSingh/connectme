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

  $('image-input').addEventListener('change', ({ target }) => {
    const [file] = target.files;
    if (!file) return;
    if (file.size > 4.5e6) {
      alert('Please choose an image under 4.5 MB.');
      target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => socket.emit('image', { dataUrl: reader.result, fileName: file.name });
    reader.readAsDataURL(file);
    target.value = '';
  });
})();
