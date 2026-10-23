const IMAGE_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,/;
const MAX_IMAGE_LENGTH = 6.5e6;
const clean = (value, max) => String(value || '').trim().slice(0, max);

module.exports = (io, rooms) => {
  rooms.onExpire = (code) => {
    io.to(code).emit('room-expired');
    io.in(code).disconnectSockets(true);
  };

  io.on('connection', (socket) => {
    let current = null;

    socket.on('join', ({ code, name, adminToken }, ack) => {
      const room = rooms.get(code);
      if (!room) return ack({ error: 'This meeting has expired or does not exist.' });

      const displayName = clean(name, 40) || 'Guest';
      const isAdmin = adminToken === room.adminToken;
      const peers = [...room.members].map(([id, n]) => ({ id, name: n }));

      current = room.code;
      room.members.set(socket.id, displayName);
      socket.join(current);
      socket.to(current).emit('peer-joined', { id: socket.id, name: displayName });

      const showExpiry = isAdmin || room.expiryVisibleTo === 'everyone';
      ack({ id: socket.id, isAdmin, peers, expiresAt: showExpiry ? room.expiresAt : null, roomName: room.name });
    });

    socket.on('signal', ({ to, data }) => io.to(to).emit('signal', { from: socket.id, data }));

    const broadcast = (event, payload) => {
      const room = rooms.get(current);
      if (!room) return;
      io.to(current).emit(event, { from: socket.id, name: room.members.get(socket.id), at: Date.now(), ...payload });
    };

    socket.on('chat', ({ text }) => {
      const message = clean(text, 2000);
      if (message) broadcast('chat', { text: message });
    });

    socket.on('image', ({ dataUrl, fileName }) => {
      if (typeof dataUrl !== 'string' || !IMAGE_PATTERN.test(dataUrl) || dataUrl.length > MAX_IMAGE_LENGTH) return;
      broadcast('image', { dataUrl, fileName: clean(fileName, 80) });
    });

    socket.on('disconnect', () => {
      const room = rooms.get(current);
      if (!room) return;
      room.members.delete(socket.id);
      socket.to(current).emit('peer-left', { id: socket.id });
    });
  });
};
