import { api } from './api.js';
const message = document.querySelector('#loginMessage');
async function enter() {
  window.ORIA = await api('/api/bootstrap');
  document.querySelector('#loginPanel').hidden = true;
  document.querySelector('main').hidden = false;
  document.querySelector('.notice').textContent =
    `Google 已驗證 · ${window.ORIA.user.name} · ${window.ORIA.role === 'dm' ? 'DM' : window.ORIA.role === 'player' ? '玩家' : '只讀訪客'}`;
  await import('./app.js');
}
try {
  await enter();
} catch (error) {
  if (error.status !== 401) {
    message.textContent = error.message;
    throw error;
  }
  try {
    const config = await api('/api/auth/config');
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      google.accounts.id.initialize({
        client_id: config.clientId,
        nonce: config.nonce,
        callback: async (result) => {
          message.textContent = '正在驗證 Google 身分…';
          try {
            await api('/api/auth/google', {
              method: 'POST',
              body: { credential: result.credential, nonce: config.nonce },
            });
            location.reload();
          } catch (e) {
            message.textContent = e.message + '；請重新整理再試。';
          }
        },
      });
      google.accounts.id.renderButton(document.querySelector('#googleButton'), {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
      });
    };
    script.onerror = () => (message.textContent = '未能載入 Google 登入，請檢查網絡後重新整理。');
    document.head.append(script);
    message.textContent = '使用 Google 帳號登入。未列名帳號只可閱讀目前戰役。';
  } catch (e) {
    message.textContent = e.message;
  }
}
