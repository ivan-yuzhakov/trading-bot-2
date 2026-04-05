document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = e.target.querySelector('input[name="password"]').value;
  const errorEl = document.getElementById('error');

  try {
    const res = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (data.error) {
      errorEl.textContent = data.error;
    } else if (data.status) {
      window.location.reload();
    }
  } catch (err) {
    errorEl.textContent = 'Connection error';
  }
});
