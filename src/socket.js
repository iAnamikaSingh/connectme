const crypto = require('crypto');

const IMAGE_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,/;
const MAX_IMAGE_LENGTH = 6.5e6;
const FILE_LIMITS = {
  'application/pdf': 4_000_000,
  'video/mp4': 5_000_000,
  'video/webm': 5_000_000,
  'audio/webm': 5_000_000,
  'audio/ogg': 5_000_000,
  'audio/mp4': 5_000_000,
};
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const clean = (value, max) => String(value || '').trim().slice(0, max);
const safeFileName = (value) => clean(value, 100).replace(/[\\/]/g, '_') || 'shared-file';

const getDataUrlSize = (dataUrl, mimeType, maxBytes) => {
  if (typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const dataMime = /^data:([^;,]+)(?:;[^,]*)?;base64$/.exec(header)?.[1]?.toLowerCase();
  if (dataMime !== mimeType) return null;
  const encoded = dataUrl.slice(comma + 1);
  if (!encoded || encoded.length % 4 !== 0) return null;
  if (encoded.length > Math.ceil(maxBytes / 3) * 4) return maxBytes + 1;
  const chunkSize = 8192;
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    const finalChunk = offset + chunkSize >= encoded.length;
    const pattern = finalChunk
      ? /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
      : /^[A-Za-z0-9+/]*$/;
    if (!pattern.test(chunk)) return null;
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.floor(encoded.length * 3 / 4) - padding;
};

const memberList = (room) => [...room.members.values()].map(({ id, name, isAdmin, callSocketId, mediaMode }) => ({
  id,
  name,
  isAdmin,
  inCall: Boolean(callSocketId),
  mediaMode: callSocketId ? mediaMode : null,
}));

const callParticipants = (room) => [...room.members.values()]
  .filter((member) => member.callSocketId)
  .map(({ id, name, isAdmin, callSocketId, mediaMode }) => ({
    id: callSocketId,
    memberId: id,
    name,
    isAdmin,
    mode: mediaMode,
  }));

const callViewers = (room) => [...room.members.values()]
  .filter((member) => member.callViewSocketId && member.callViewSocketId !== member.callSocketId)
  .map(({ id, name, isAdmin, callViewSocketId }) => ({
    id: callViewSocketId,
    memberId: id,
    name,
    isAdmin,
  }));

module.exports = (io, rooms) => {
  rooms.onExpire = (code) => {
    io.to(code).emit('room-expired');
    io.in(code).disconnectSockets(true);
  };

  io.on('connection', (socket) => {
    let room = null;
    let member = null;
    let isCallView = false;
    let isSocketAdmin = false;

    const publishMembers = () => {
      if (room) io.to(room.code).emit('member-list', memberList(room));
    };

    socket.on('join', ({ code, name, adminToken, memberId, view }, ack) => {
      room = rooms.get(code);
      if (!room) return ack?.({ error: 'This meeting has expired or does not exist.' });

      const requestedId = String(memberId || '');
      const id = /^[a-zA-Z0-9-]{8,80}$/.test(requestedId) ? requestedId : crypto.randomUUID();
      isSocketAdmin = adminToken === room.adminToken;
      member = room.members.get(id);
      if (!member) {
        member = { id, name: clean(name, 40) || 'Guest', isAdmin: false, adminSocketIds: new Set(), sockets: new Set(), callSocketId: null, callViewSocketId: null, mediaMode: null };
        room.members.set(id, member);
      } else {
        member.name = clean(name, 40) || member.name;
      }

      isCallView = view === 'call';
      member.sockets.add(socket.id);
      if (isSocketAdmin) member.adminSocketIds.add(socket.id);
      member.isAdmin = member.adminSocketIds.size > 0;
      if (isCallView) member.callViewSocketId = socket.id;
      socket.join(room.code);

      const showExpiry = member.isAdmin || room.expiryVisibleTo === 'everyone';
      ack?.({
        id: member.id,
        isAdmin: member.isAdmin,
        members: memberList(room),
        call: room.call,
        participants: callParticipants(room),
        viewers: callViewers(room),
        inCall: member.callSocketId === socket.id,
        expiresAt: showExpiry ? room.expiresAt : null,
        roomName: room.name,
      });
      publishMembers();
    });

    socket.on('call-start', ({ type }, ack) => {
      if (!room || !isSocketAdmin) return ack?.({ error: 'Only the meeting admin can start a call.' });
      if (!['audio', 'video'].includes(type)) return ack?.({ error: 'Choose an audio or video call.' });
      if (room.call) return ack?.({ error: 'A call is already in progress.' });
      room.call = { type, startedAt: Date.now() };
      io.to(room.code).emit('call-state', room.call);
      ack?.({ call: room.call });
    });

    socket.on('call-end', (ack) => {
      if (!room || !isSocketAdmin) return ack?.({ error: 'Only the meeting admin can end the call.' });
      if (!room.call) return ack?.({ error: 'There is no active call to end.' });
      room.call = null;
      room.members.forEach((participant) => {
        participant.callSocketId = null;
        participant.mediaMode = null;
      });
      io.to(room.code).emit('call-state', null);
      publishMembers();
      ack?.({ ok: true });
    });

    socket.on('call-join', ({ mode }, ack) => {
      if (!room || !member || !isCallView) return ack?.({ error: 'Open the call page before joining.' });
      if (!room.call) return ack?.({ error: 'There is no active call.' });
      if (!['audio', 'video'].includes(mode)) return ack?.({ error: 'Choose audio or video.' });
      if (member.callSocketId && member.callSocketId !== socket.id) return ack?.({ error: 'This member is already in the call in another tab.' });
      member.callSocketId = socket.id;
      member.mediaMode = mode;
      const participants = callParticipants(room).filter((participant) => participant.id !== socket.id);
      const participant = callParticipants(room).find((item) => item.id === socket.id);
      io.to(room.code).emit('call-member-joined', participant);
      publishMembers();
      ack?.({ participants, call: room.call });
    });

    socket.on('call-leave', (ack) => {
      if (!room || !member || member.callSocketId !== socket.id) return ack?.({ ok: true });
      member.callSocketId = null;
      member.mediaMode = null;
      io.to(room.code).emit('call-member-left', { id: socket.id, memberId: member.id });
      publishMembers();
      ack?.({ ok: true });
    });

    socket.on('call-mode', ({ mode }, ack) => {
      if (!room || !member || member.callSocketId !== socket.id) return ack?.({ error: 'Join the call to change your audio or video mode.' });
      if (!['audio', 'video'].includes(mode)) return ack?.({ error: 'Choose audio or video.' });
      member.mediaMode = mode;
      const participant = callParticipants(room).find((item) => item.id === socket.id);
      io.to(room.code).emit('call-member-updated', participant);
      publishMembers();
      ack?.({ ok: true });
    });

    socket.on('signal', ({ to, data }) => {
      if (!room || !member || (member.callViewSocketId !== socket.id && member.callSocketId !== socket.id)) return;
      const target = [...room.members.values()].some((candidate) =>
        candidate.callSocketId === to || candidate.callViewSocketId === to);
      if (target) io.to(to).emit('signal', { from: socket.id, data });
    });

    const broadcast = (event, payload) => {
      if (!room || !member) return;
      io.to(room.code).emit(event, { from: member.id, name: member.name, at: Date.now(), ...payload });
    };

    socket.on('chat', ({ text }) => {
      const message = clean(text, 2000);
      if (message) broadcast('chat', { text: message });
    });

    socket.on('image', ({ dataUrl, fileName }) => {
      if (typeof dataUrl !== 'string' || !IMAGE_PATTERN.test(dataUrl) || dataUrl.length > MAX_IMAGE_LENGTH) return;
      broadcast('image', { dataUrl, fileName: clean(fileName, 80) });
    });

    socket.on('file-share', (payload, ack) => {
      const fail = (error) => ack?.({ error });
      if (!room || !member) return fail('Join the meeting before sharing a file.');
      if (!payload || typeof payload !== 'object') return fail('The shared file could not be read.');

      const { dataUrl, fileName, mimeType } = payload;
      const image = IMAGE_TYPES.has(mimeType);
      const maxBytes = image
        ? 4_500_000
        : Object.prototype.hasOwnProperty.call(FILE_LIMITS, mimeType) ? FILE_LIMITS[mimeType] : null;
      if (!maxBytes) return fail('Only PNG, JPEG, GIF, WebP, PDF, MP4, WebM, and recorded voice notes can be shared.');

      const size = getDataUrlSize(dataUrl, mimeType, maxBytes);
      if (size === null) return fail('The file data is invalid or does not match its file type.');
      if (size > maxBytes) {
        const limit = image ? '4.5 MB' : mimeType === 'application/pdf' ? '4 MB' : '5 MB';
        return fail(`That file is too large. The maximum size is ${limit}.`);
      }

      broadcast('file-share', {
        dataUrl,
        fileName: safeFileName(fileName),
        mimeType,
        fileKind: image ? 'image' : mimeType === 'application/pdf' ? 'pdf' : mimeType.startsWith('audio/') ? 'audio' : 'video',
      });
      ack?.({ ok: true });
    });

    socket.on('meeting-leave', (ack) => {
      if (!room || !member) return ack?.({ error: 'You are not in a meeting.' });
      if (member.callSocketId) {
        io.to(room.code).emit('call-member-left', { id: member.callSocketId, memberId: member.id });
      }

      const sockets = [...member.sockets];
      room.members.delete(member.id);
      member.sockets.clear();
      member.adminSocketIds.clear();
      member.callSocketId = null;
      member.callViewSocketId = null;
      member.leaving = true;
      publishMembers();
      ack?.({ ok: true });

      sockets.forEach((socketId) => {
        const memberSocket = io.sockets.sockets.get(socketId);
        if (memberSocket) memberSocket.emit('meeting-left');
      });
      setTimeout(() => {
        sockets.forEach((socketId) => io.sockets.sockets.get(socketId)?.disconnect(true));
      }, 100);
    });

    socket.on('meeting-end', (ack) => {
      if (!room || !isSocketAdmin) return ack?.({ error: 'Only the meeting admin can end this meeting.' });
      const code = room.code;
      ack?.({ ok: true });
      rooms.expire(code);
    });

    socket.on('disconnect', () => {
      if (!room || !member || member.leaving) return;
      member.sockets.delete(socket.id);
      member.adminSocketIds.delete(socket.id);
      member.isAdmin = member.adminSocketIds.size > 0;
      if (member.callSocketId === socket.id) {
        member.callSocketId = null;
        member.mediaMode = null;
        io.to(room.code).emit('call-member-left', { id: socket.id, memberId: member.id });
      }
      if (member.callViewSocketId === socket.id) member.callViewSocketId = null;
      if (!member.sockets.size) {
        room.members.delete(member.id);
      }
      publishMembers();
    });
  });
};
