const form = document.getElementById('create-form');
const result = document.getElementById('result');

const copyText = async (selector) => navigator.clipboard.writeText(document.querySelector(selector).textContent);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const room = await response.json();

  sessionStorage.setItem(`connectme:admin:${room.code}`, room.adminToken);
  document.getElementById('out-code').textContent = room.code;
  document.getElementById('out-link').textContent = room.link;
  document.getElementById('out-start').href = `/room/${room.code}`;
  form.hidden = true;
  result.hidden = false;
});

document.querySelectorAll('[data-copy]').forEach((button) =>
  button.addEventListener('click', () => copyText(button.dataset.copy)));
