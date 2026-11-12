const statusText = document.getElementById('checkout-status');

async function checkAccount() {
  try {
    const response = await fetch('/checkout/status', { cache: 'no-store' });
    if (response.ok) {
      const status = await response.text();
      if (status === 'full' || status === 'pdf') {
        location.reload();
        return;
      }
      if (status === 'expired') {
        statusText.textContent = 'Ссылка устарела. Обнови страницу, чтобы открыть новую.';
        return;
      }
    }
  } catch {
    // A brief connection loss is common when switching back from Telegram.
  }
  setTimeout(checkAccount, document.hidden ? 5000 : 2500);
}

if (statusText) checkAccount();
