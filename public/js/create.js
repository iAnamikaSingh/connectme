const form = document.getElementById('create-form');
const result = document.getElementById('result');

const readCopyValue = (element) => element.value ?? element.textContent;
const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const copyField = document.createElement('textarea');
  copyField.value = text;
  copyField.setAttribute('readonly', '');
  copyField.style.position = 'fixed';
  copyField.style.opacity = '0';
  document.body.append(copyField);
  copyField.select();
  const copied = document.execCommand('copy');
  copyField.remove();
  if (!copied) throw new Error('Clipboard access is unavailable.');
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('create-error');
  const submitButton = form.querySelector('button[type="submit"], button:not([type])');
  error.hidden = true;
  submitButton.disabled = true;
  const body = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const room = await response.json();
    if (!response.ok) throw new Error(room.error || 'Could not create the meeting. Please try again.');

    sessionStorage.setItem(`connectme:admin:${room.code}`, room.adminToken);
    document.getElementById('out-code').value = room.code;
    document.getElementById('out-link').value = room.link;
    document.getElementById('out-start').href = `/room/${room.code}`;
    form.hidden = true;
    result.hidden = false;
  } catch (requestError) {
    error.textContent = requestError.message || 'Could not create the meeting. Please try again.';
    error.hidden = false;
    submitButton.disabled = false;
  }
});

document.querySelectorAll('[data-copy]').forEach((button) =>
  button.addEventListener('click', async () => {
    const target = document.querySelector(button.dataset.copy);
    const feedbackId = button.dataset.copy === '#out-code' ? 'code-copy-feedback' : 'link-copy-feedback';
    const feedback = document.getElementById(feedbackId);
    const label = button.dataset.copyLabel;
    try {
      await copyText(readCopyValue(target));
      button.querySelector('span').textContent = 'Copied!';
      feedback.textContent = `${label.replace('Copy ', '')} copied to clipboard.`;
    } catch {
      feedback.textContent = 'Copy failed. Select the text and copy it manually.';
    }
    window.setTimeout(() => {
      button.querySelector('span').textContent = 'Copy';
    }, 2000);
  }));
