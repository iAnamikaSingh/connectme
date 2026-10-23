const faqs = [
  { q: 'What is connectme?', a: 'connectme is a free web app for instant meetings. Create a room, share the passcode or link, and chat, call, share your screen and send images in one place.' },
  { q: 'Do I need an account to join a meeting?', a: 'No. Anyone with the passcode or link can join from a browser, with no sign-up or install.' },
  { q: 'How long does a meeting room last?', a: 'Rooms last 60 minutes by default. The host can choose a different time, from 5 minutes up to 24 hours.' },
  { q: 'Can the host hide the expiry time from guests?', a: 'Yes. When creating a room, the host chooses whether everyone or only the host can see the countdown.' },
  { q: 'Can I share my screen?', a: 'Yes. Select Share screen in the meeting toolbar to present a window, tab or your entire screen.' },
];

const features = [
  { id: 'chat', title: 'Group chat', text: 'Message everyone in the room in real time.', img: 'Chatting.webp', alt: 'People chatting on a phone' },
  { id: 'video', title: 'Video calls', text: 'Face-to-face meetings right in your browser.', img: 'VideoCall.webp', alt: 'Person on a video call' },
  { id: 'phone', title: 'Voice calls', text: 'Turn the camera off and just talk.', img: 'VoiceChat.webp', alt: 'Person on a voice call with headphones' },
  { id: 'screen', title: 'Screen sharing', text: 'Present slides, demos or documents live.', img: 'screenShare.webp', alt: 'Screen being shared during a meeting' },
  { id: 'image', title: 'File sharing', text: 'Drop images into the chat for the whole group.', img: 'FileUpload.webp', alt: 'Files being shared between devices' },
];

module.exports = { faqs, features };
