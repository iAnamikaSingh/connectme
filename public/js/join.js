const form = document.getElementById('join-form');
const error = document.getElementById('join-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = new FormData(form).get('code').trim().toUpperCase();
  const { exists } = await (await fetch(`/api/rooms/${encodeURIComponent(code)}`)).json();
  if (exists) window.location.href = `/room/${code}`;
  else error.hidden = false;
});
