(() => {
  if (document.getElementById('bob-acr-overlay-root')) return;

  const host = document.createElement('div');
  host.id = 'bob-acr-overlay-root';
  host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'BOB Conformité';
  btn.style.cssText = 'background:#4f46e5;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(15,23,42,0.25);cursor:pointer;';

  const panel = document.createElement('div');
  panel.style.cssText = 'display:none;position:fixed;right:20px;bottom:72px;width:410px;height:620px;max-height:82vh;background:#fff;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 20px 45px rgba(15,23,42,0.3);overflow:hidden;';

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('index.html');
  iframe.style.cssText = 'width:100%;height:100%;border:0;';
  panel.appendChild(iframe);

  btn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  host.appendChild(btn);
  host.appendChild(panel);
  document.body.appendChild(host);
})();
