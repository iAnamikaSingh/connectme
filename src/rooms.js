const crypto = require('crypto');

const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 24 * 60;
const store = new Map();

const rooms = {
  onExpire: () => {},

  create({ name, minutes, expiryVisibleTo }) {
    const mins = Math.min(Math.max(Number(minutes) || DEFAULT_MINUTES, 5), MAX_MINUTES);
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const room = {
      code,
      name: String(name || 'Untitled meeting').slice(0, 60),
      adminToken: crypto.randomBytes(16).toString('hex'),
      expiryVisibleTo: expiryVisibleTo === 'admin' ? 'admin' : 'everyone',
      expiresAt: Date.now() + mins * 60000,
      members: new Map(),
      call: null,
    };
    room.timer = setTimeout(() => rooms.expire(code), mins * 60000);
    store.set(code, room);
    return room;
  },

  get: (code) => store.get(String(code || '').toUpperCase()),

  expire(code) {
    const room = store.get(code);
    if (!room) return;
    clearTimeout(room.timer);
    store.delete(code);
    rooms.onExpire(code);
  },
};

module.exports = rooms;
