const express = require('express');
const rooms = require('./rooms');
const { faqs, features } = require('./content');

const router = express.Router();
const SITE_URL = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const jsonLd = () => JSON.stringify([
  { '@context': 'https://schema.org', '@type': 'WebSite', name: 'connectme', url: SITE_URL },
  { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'connectme', description: 'Free browser-based meetings with video, voice, chat, screen sharing and image sharing. No sign-up or installation required.', applicationCategory: 'CommunicationApplication', operatingSystem: 'Any', url: SITE_URL, image: `${SITE_URL}/images/HeroImage.webp`, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, featureList: ['Video calls', 'Voice calls', 'Group chat', 'Screen sharing', 'Image sharing'] },
  { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
]);

const base = (req) => ({ siteUrl: SITE_URL, path: req.path, noindex: false, jsonLd: null, faqs, features });
const page = (view, meta) => (req, res) => res.render(view, { ...base(req), ...meta });

router.get('/', page('index', { title: 'connectme | Free Online Meetings with Video & Chat', description: 'Start secure browser-based meetings with video, voice, group chat, screen sharing and image sharing. Invite anyone with a link—no account or installation needed.', jsonLd: jsonLd() }));
router.get('/create', page('create', { title: 'Create a Free Online Meeting | connectme', description: 'Create a private online meeting in seconds. Choose an expiry time, then share the meeting link and passcode—no sign-up required.' }));
router.get('/join', page('join', { title: 'Join an Online Meeting | connectme', description: 'Join a connectme online meeting with a passcode. Meet in your browser with no account or software installation.' }));

router.post('/api/rooms', (req, res) => {
  const room = rooms.create(req.body || {});
  res.status(201).json({ code: room.code, adminToken: room.adminToken, link: `${SITE_URL}/room/${room.code}`, expiresAt: room.expiresAt });
});

router.get('/api/rooms/:code', (req, res) => res.json({ exists: Boolean(rooms.get(req.params.code)) }));

router.get('/room/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  const meta = { ...base(req), noindex: true };
  if (!room) return res.status(404).render('notfound', { ...meta, title: 'Meeting not found | connectme', description: 'This meeting has expired or does not exist.' });
  res.render('room', { ...meta, title: `${room.name} | connectme`, description: 'Private meeting room.', room });
});

router.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE_URL}/sitemap.xml\n`));
router.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/create', '/join'].map((p) => `<url><loc>${SITE_URL}${p}</loc></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

router.use((req, res) => res.status(404).render('notfound', { ...base(req), noindex: true, title: 'Page not found | connectme', description: 'The page you are looking for does not exist.' }));

module.exports = router;
