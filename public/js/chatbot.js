const KNOWLEDGE = [
  { keys: ['create', 'start', 'new meeting', 'host'], answer: 'Open Start a meeting, name it, pick an expiry and generate your passcode and link.', links: [{ label: 'Create a meeting', href: '/create' }] },
  { keys: ['join', 'passcode', 'code', 'enter'], answer: 'Enter the passcode you were given, or open the link directly.', links: [{ label: 'Join a meeting', href: '/join' }] },
  { keys: ['expire', 'expiry', 'how long', 'time'], answer: 'Rooms last 60 minutes by default. Hosts can choose from 5 minutes to 24 hours, and decide whether guests can see the countdown.', links: [{ label: 'Set expiry', href: '/create' }] },
  { keys: ['screen', 'present', 'share'], answer: 'Use the screen icon in the meeting toolbar to share a tab, window or your whole screen.', links: [] },
  { keys: ['image', 'photo', 'picture', 'file', 'pdf', 'video', 'attachment'], answer: 'Use the attachment icon next to chat to share PNG, JPEG, GIF, or WebP images (up to 4.5 MB), PDFs (up to 4 MB), or MP4/WebM videos (up to 5 MB).', links: [] },
  { keys: ['video', 'voice', 'call', 'camera', 'mic'], answer: 'Use the mic and camera buttons in the toolbar. Turn the camera off for a voice-only call.', links: [] },
  { keys: ['price', 'free', 'cost', 'account', 'sign'], answer: 'connectme is free and needs no account.', links: [{ label: 'FAQ', href: '/#faq' }] },
  { keys: ['hi', 'hello', 'hey'], answer: 'Hi! I can help you create or join a meeting, or explain any feature.', links: [] },
];
const FALLBACK = { answer: "I'm not sure about that yet. These pages may help.", links: [{ label: 'FAQ', href: '/#faq' }, { label: 'Create a meeting', href: '/create' }] };

const elements = {
  toggle: document.getElementById('bot-toggle'), panel: document.getElementById('bot-panel'),
  header: document.querySelector('.bot-header'),
  close: document.getElementById('bot-close'), messages: document.getElementById('bot-messages'),
  form: document.getElementById('bot-form'), input: document.getElementById('bot-input'),
  mic: document.getElementById('bot-mic'), sound: document.getElementById('bot-sound'),
  voice: document.getElementById('bot-voice'), suggestions: document.getElementById('bot-suggestions'),
};

const transcriptKey = 'connectme-chatbot-transcript';
const navigationEntry = performance.getEntriesByType('navigation')[0];
const isPageRefresh = navigationEntry
  ? navigationEntry.type === 'reload'
  : performance.navigation && performance.navigation.type === 1;

if (isPageRefresh) sessionStorage.removeItem(transcriptKey);

let transcript = [];
try {
  const savedTranscript = sessionStorage.getItem(transcriptKey);
  if (savedTranscript) {
    const parsedTranscript = JSON.parse(savedTranscript);
    if (Array.isArray(parsedTranscript) && parsedTranscript.every((record) =>
      record && (record.role === 'user' && typeof record.text === 'string' && Number.isInteger(record.id)
        || record.role === 'assistant' && record.answer && typeof record.answer.answer === 'string')
    )) {
      transcript = parsedTranscript;
    } else {
      console.warn('Ignoring invalid saved chat transcript.');
      sessionStorage.removeItem(transcriptKey);
    }
  }
} catch (error) {
  console.warn('Could not restore the saved chat transcript.', error);
  sessionStorage.removeItem(transcriptKey);
}

let nextMessageId = transcript.reduce((nextId, record) =>
  record.role === 'user' ? Math.max(nextId, record.id + 1) : nextId, 1);
const saveTranscript = () => sessionStorage.setItem(transcriptKey, JSON.stringify(transcript));

const findAnswer = (question) => {
  const text = question.toLowerCase();
  return KNOWLEDGE.find((item) => item.keys.some((key) => text.includes(key))) || FALLBACK;
};

let soundEnabled = true;
let voiceEnabled = true;
let audioContext;
const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

if (!speechSupported) {
  elements.voice.hidden = true;
  voiceEnabled = false;
}

const playTone = (incoming = false) => {
  if (!soundEnabled) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioContext ||= new AudioContext();
  const play = () => {
    const now = audioContext.currentTime;
    const frequencies = incoming ? [587, 784] : [740];
    frequencies.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + index * 0.11;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.17);
    });
  };

  if (audioContext.state === 'suspended') {
    audioContext.resume().then(play).catch((error) => {
      console.warn('Could not resume chat audio.', error);
    });
  } else {
    play();
  }
};

const addMessage = (content, mine = false) => {
  const node = document.createElement('div');
  node.className = `bot-message${mine ? ' mine' : ''}`;
  const avatar = Object.assign(document.createElement('img'), {
    className: 'bot-message-avatar',
    src: mine ? '/images/user-avatar.svg' : '/images/botPhoto.png',
    alt: '',
  });
  const messageContent = document.createElement('div');
  messageContent.className = 'bot-message-content';
  const sender = Object.assign(document.createElement('strong'), {
    className: 'bot-message-sender',
    textContent: mine ? 'You' : 'Nick',
  });
  const bubble = document.createElement('div');
  bubble.className = `msg${mine ? ' mine' : ''}`;
  if (typeof content === 'string') bubble.textContent = content;
  else bubble.append(content);
  messageContent.append(sender, bubble);
  if (mine) node.append(messageContent, avatar);
  else node.append(avatar, messageContent);
  elements.messages.append(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return { node, bubble };
};

const buildReply = ({ answer, links }) => {
  const wrapper = document.createElement('span');
  wrapper.append(answer);
  links.forEach(({ label, href }) => {
    const anchor = Object.assign(document.createElement('a'), { href, textContent: label });
    wrapper.append(document.createElement('br'), anchor);
  });
  return wrapper;
};

const addUserMessage = (text, id) => {
  transcript.push({ role: 'user', id, text });
  saveTranscript();
  addMessage(text, true);
};

const addAssistantMessage = (answer, id) => {
  const record = { role: 'assistant', answer };
  if (id !== undefined) record.id = id;
  transcript.push(record);
  saveTranscript();
  addMessage(buildReply(answer));
};

const reply = (question, id, shouldSpeak = true) => {
  const typing = addMessage(Object.assign(document.createElement('span'), { className: 'typing', innerHTML: '<i></i><i></i><i></i>' }));
  const answer = findAnswer(question);
  const answerLength = answer.answer.length;
  const delay = Math.min(2300, 900 + answerLength * 14 + Math.random() * 500);
  setTimeout(() => {
    typing.node.remove();
    addAssistantMessage(answer, id);
    playTone(true);
    if (shouldSpeak) speakReply(answer);
  }, delay);
};

const speakReply = ({ answer, links = [] }) => {
  if (!voiceEnabled || !speechSupported) return;
  window.speechSynthesis.cancel();
  const linkText = links.map(({ label }) => label).join('. ');
  const utterance = new SpeechSynthesisUtterance(linkText ? `${answer}. ${linkText}` : answer);
  utterance.lang = 'en-US';
  utterance.onerror = (event) => console.warn('Could not speak the assistant reply.', event.error);
  window.speechSynthesis.speak(utterance);
};

const sendQuestion = (question) => {
  const text = question.trim();
  if (!text) return;
  const id = nextMessageId++;
  addUserMessage(text, id);
  playTone();
  elements.suggestions.hidden = true;
  reply(text, id);
};

const togglePanel = (open) => {
  elements.panel.hidden = !open;
  if (open && !transcript.length) {
    const greeting = { answer: 'Hi, I’m Nick. I’m online and ready to help — what’s on your mind?', links: [] };
    transcript.push({ role: 'assistant', answer: greeting });
    saveTranscript();
    addMessage(buildReply(greeting));
    elements.suggestions.hidden = false;
    speakReply(greeting);
  }
  if (open && transcript.some((record) => record.role === 'user')) elements.suggestions.hidden = true;
  if (open) elements.input.focus();
};

elements.toggle.addEventListener('click', () => togglePanel(elements.panel.hidden));
elements.close.addEventListener('click', () => togglePanel(false));
elements.sound.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  elements.sound.textContent = soundEnabled ? 'Sound on' : 'Sound off';
  elements.sound.setAttribute('aria-pressed', String(soundEnabled));
});
elements.voice.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  elements.voice.textContent = voiceEnabled ? 'Voice on' : 'Voice off';
  elements.voice.setAttribute('aria-pressed', String(voiceEnabled));
  if (!voiceEnabled && speechSupported) window.speechSynthesis.cancel();
});
elements.suggestions.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  sendQuestion(button.textContent);
});
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  sendQuestion(elements.input.value);
  elements.input.value = '';
});

transcript.forEach((record) => {
  if (record.role === 'user') addMessage(record.text, true);
  else addMessage(buildReply(record.answer));
});

if (transcript.length) {
  elements.suggestions.hidden = transcript.some((record) => record.role === 'user');
  const answeredIds = new Set(transcript
    .filter((record) => record.role === 'assistant' && Number.isInteger(record.id))
    .map((record) => record.id));
  transcript
    .filter((record) => record.role === 'user' && !answeredIds.has(record.id))
    .forEach((record) => reply(record.text, record.id, false));
}

let dragStart;
elements.header.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) return;
  const rect = elements.panel.getBoundingClientRect();
  dragStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: rect.left,
    top: rect.top,
  };
  elements.header.setPointerCapture(event.pointerId);
});

elements.header.addEventListener('pointermove', (event) => {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  const maxLeft = Math.max(8, window.innerWidth - elements.panel.offsetWidth - 8);
  const maxTop = Math.max(8, window.innerHeight - elements.panel.offsetHeight - 8);
  const left = Math.min(maxLeft, Math.max(8, dragStart.left + event.clientX - dragStart.x));
  const top = Math.min(maxTop, Math.max(8, dragStart.top + event.clientY - dragStart.y));
  elements.panel.style.left = `${left}px`;
  elements.panel.style.top = `${top}px`;
  elements.panel.style.right = 'auto';
  elements.panel.style.bottom = 'auto';
});

const stopDragging = (event) => {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  if (elements.header.hasPointerCapture(event.pointerId)) elements.header.releasePointerCapture(event.pointerId);
  dragStart = null;
};

elements.header.addEventListener('pointerup', stopDragging);
elements.header.addEventListener('pointercancel', stopDragging);

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) elements.mic.hidden = true;
else {
  const recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.onresult = (event) => { elements.input.value = event.results[0][0].transcript; };
  recognition.onend = () => elements.mic.classList.remove('listening');
  elements.mic.addEventListener('click', () => {
    elements.mic.classList.add('listening');
    try {
      recognition.start();
    } catch (error) {
      elements.mic.classList.remove('listening');
      console.warn('Could not start voice input.', error);
    }
  });
}
