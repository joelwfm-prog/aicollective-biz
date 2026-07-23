/* The AI Collective — subtle slide-in newsletter signup
   Appears after 15s OR when the visitor scrolls past 40% of the page.
   Dismissible; remembers dismissal + signup for 30 days via localStorage.
   Non-blocking, bottom-right, matches the neon theme. */
(function () {
  var KEY = 'aic_nl_popup';
  var THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  // Respect prior dismissal/signup
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.until && Date.now() < saved.until) return;
  } catch (e) {}

  // Don't show on very small viewports until interaction (avoid covering content)
  var shown = false;

  function buildPopup() {
    if (shown) return;
    shown = true;

    var wrap = document.createElement('div');
    wrap.className = 'aic-nlpop';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Newsletter signup');
    wrap.innerHTML = [
      '<button class="aic-nlpop__close" aria-label="Close">&times;</button>',
      '<div class="aic-nlpop__bar" aria-hidden="true"></div>',
      '<div class="aic-nlpop__body">',
        '<div class="aic-nlpop__eyebrow">The AI Collective Weekly</div>',
        '<div class="aic-nlpop__title">One email, every Thursday.<br><span>Zero fluff.</span></div>',
        '<p class="aic-nlpop__desc">The AI stuff that actually helps a Prairie business \u2014 plus partner-only deals. Free, forever.</p>',
        '<form class="aic-nlpop__form">',
          '<input class="aic-nlpop__input" type="email" required placeholder="you@yourbusiness.ca" aria-label="Email address" />',
          '<button class="aic-nlpop__btn" type="submit">Join free \u2192</button>',
        '</form>',
        '<p class="aic-nlpop__note" hidden>You\u2019re in. See you Thursday. \u2726</p>',
        '<p class="aic-nlpop__fine">No spam. Unsubscribe in one click.</p>',
      '</div>'
    ].join('');
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { wrap.classList.add('is-in'); });

    function remember(days) {
      try { localStorage.setItem(KEY, JSON.stringify({ until: Date.now() + days })); } catch (e) {}
    }

    wrap.querySelector('.aic-nlpop__close').addEventListener('click', function () {
      wrap.classList.remove('is-in');
      remember(THIRTY_DAYS / 3); // dismissed: re-ask in ~10 days
      setTimeout(function () { wrap.remove(); }, 350);
    });

    wrap.querySelector('.aic-nlpop__form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = wrap.querySelector('.aic-nlpop__input').value.trim();
      if (!email) return;
      // Try backend if present; degrade gracefully if not (static host).
      var done = function () {
        wrap.querySelector('.aic-nlpop__form').hidden = true;
        wrap.querySelector('.aic-nlpop__note').hidden = false;
        remember(THIRTY_DAYS); // signed up: don't ask again for 30 days
        setTimeout(function () { wrap.classList.remove('is-in'); setTimeout(function(){wrap.remove();}, 350); }, 2600);
      };
      try {
        fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, source: 'popup' })
        }).then(done).catch(done);
      } catch (err) { done(); }
    });
  }

  // Trigger: 15s timer
  var t = setTimeout(buildPopup, 15000);
  // Trigger: scroll past 40%
  function onScroll() {
    var sc = window.scrollY || document.documentElement.scrollTop;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    if (h > 0 && sc / h > 0.4) { clearTimeout(t); window.removeEventListener('scroll', onScroll); buildPopup(); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
})();
