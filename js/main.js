// ---- Theme toggle ----
(function () {
  const t = document.querySelector('[data-theme-toggle]'),
    r = document.documentElement;
  const sun = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  const moon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', d);
  const render = () => { if (t) t.innerHTML = d === 'dark' ? sun : moon; };
  render();
  if (t) t.addEventListener('click', () => {
    d = d === 'dark' ? 'light' : 'dark';
    r.setAttribute('data-theme', d);
    t.setAttribute('aria-label', 'Switch to ' + (d === 'dark' ? 'light' : 'dark') + ' mode');
    render();
  });
})();

// ---- Header scroll shadow ----
(function () {
  const h = document.getElementById('header');
  const onScroll = () => h.classList.toggle('header--scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// ---- Scroll reveal (IntersectionObserver) ----
(function () {
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = document.querySelectorAll('.reveal');
  if (prefersReduced || !('IntersectionObserver' in window) || !items.length) return;
  document.documentElement.classList.add('reveal-armed');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  items.forEach((el) => io.observe(el));
  // Safety: reveal everything after 1.2s in case observer never fires
  setTimeout(() => items.forEach((el) => el.classList.add('is-visible')), 1200);
})();

// ---- Mobile nav ----
(function () {
  const open = document.getElementById('menuToggle');
  const close = document.getElementById('mobileClose');
  const nav = document.getElementById('mobileNav');
  if (!open || !nav) return;
  const set = (o) => { nav.classList.toggle('open', o); open.setAttribute('aria-expanded', o); document.body.style.overflow = o ? 'hidden' : ''; };
  open.addEventListener('click', () => set(true));
  close.addEventListener('click', () => set(false));
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => set(false)));
})();
