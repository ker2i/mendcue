const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

// The repair link works before JavaScript loads and if the popup cannot load.
const siteScriptURL = document.currentScript.src;
(async function () {
  try {
    const response = await fetch(new URL('mendcue-config.json', siteScriptURL), {
      cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return;
    const config = await response.json();
    const links = document.querySelectorAll('[data-mendcue-open]');
    if (config.enabled !== true) { links.forEach(link => { link.hidden = true; }); return; }
    const backend = new URL(config.backendOrigin);
    const local = ['localhost', '127.0.0.1'].includes(backend.hostname);
    if ((backend.protocol !== 'https:' && !(local && backend.protocol === 'http:')) ||
        backend.origin !== config.backendOrigin || typeof config.publicKey !== 'string' ||
        config.publicKey.length < 20) return;
    if (typeof config.tenantSlug === 'string' && /^[a-z0-9-]+$/.test(config.tenantSlug)) {
      links.forEach(link => { link.href = backend.origin + '/business/' + config.tenantSlug; });
    }
    // Serve the loader with the website to avoid a cross-origin script dependency.
    const script = document.createElement('script');
    script.src = new URL('mendcue-widget.js?v=20261101-3', siteScriptURL).href;
    script.setAttribute('data-platform', backend.origin);
    script.setAttribute('data-public-key', config.publicKey);
    script.setAttribute('data-color', '#102b45');
    script.setAttribute('data-label', 'Request a repair');
    script.onload = () => {
      links.forEach(link => {
        link.hidden = false;
        link.addEventListener('click', event => {
          // Preserve normal new-tab/window behavior for links.
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          window.dispatchEvent(new Event('mendcue.open'));
        });
      });
    };
    document.head.appendChild(script);
  } catch (_) {
    // The ordinary repair link and phone links remain usable.
  }
})();
