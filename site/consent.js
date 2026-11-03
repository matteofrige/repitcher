// RePitch — consenso cookie e Google Analytics 4 (modalità "basic").
// Prima del consenso non parte nessuna richiesta a Google. Senza JavaScript: niente banner e niente GA.
const KEY = 'repitch-analytics';

const TEXT = {
  it: {
    label: 'Preferenze cookie',
    body: 'Vorrei contare le visite con Google Analytics, che usa dei cookie. Lo attivo solo se sei d’accordo.',
    more: 'Dettagli', accept: 'Accetta', decline: 'Rifiuta',
  },
  en: {
    label: 'Cookie preferences',
    body: 'I’d like to count visits with Google Analytics, which uses cookies. It only runs if you agree.',
    more: 'Details', accept: 'Accept', decline: 'Decline',
  },
};

function readChoice() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function saveChoice(v) {
  try { localStorage.setItem(KEY, v); } catch { /* storage non disponibile: nessuna scelta salvata */ }
}

export function initConsent(gaId) {
  let loaded = false;
  let banner = null;

  function loadGA() {
    window['ga-disable-' + gaId] = false; // prima del return: riaccettare dopo una revoca deve riattivare GA
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', gaId);
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
    document.head.appendChild(s);
  }

  function revoke() {
    window['ga-disable-' + gaId] = true;
    const host = location.hostname;
    const bare = host.replace(/^www\./, '');
    const gone = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    const names = document.cookie.split(';').map((c) => c.split('=')[0].trim())
      .filter((n) => n === '_ga' || n.startsWith('_ga_'));
    names.forEach((n) => {
      document.cookie = `${n}=; ${gone}`;
      document.cookie = `${n}=; ${gone}; domain=${host}`;
      document.cookie = `${n}=; ${gone}; domain=.${bare}`;
    });
  }

  function closeBanner() {
    if (!banner) return;
    const hadFocus = banner.contains(document.activeElement);
    banner.remove();
    banner = null;
    if (hadFocus) document.body.focus();
  }

  function showBanner() {
    if (banner) return banner;
    const t = (document.documentElement.lang || '').toLowerCase().startsWith('en') ? TEXT.en : TEXT.it;
    banner = document.createElement('section');
    banner.className = 'consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', t.label);
    banner.innerHTML = `<p></p><div class="consent-actions"><button type="button" class="btn btn-solid" data-act="y"></button><button type="button" class="btn consent-decline" data-act="n"></button></div>`;
    const p = banner.querySelector('p');
    p.append(`${t.body} `);
    const a = document.createElement('a');
    a.href = 'privacy.html#sito';
    a.textContent = t.more;
    p.append(a);
    banner.querySelector('[data-act=y]').textContent = t.accept;
    banner.querySelector('[data-act=n]').textContent = t.decline;
    banner.querySelector('[data-act=y]').addEventListener('click', () => {
      saveChoice('granted'); loadGA(); closeBanner();
    });
    banner.querySelector('[data-act=n]').addEventListener('click', () => {
      saveChoice('denied'); revoke(); closeBanner();
    });
    document.body.appendChild(banner);
    return banner;
  }

  document.querySelectorAll('[data-consent-open]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      showBanner().querySelector('button').focus();
    });
  });

  const choice = readChoice();
  if (choice === 'granted') loadGA();
  else if (choice !== 'denied') showBanner();
}
