// Applies the saved or system theme before first paint (classic blocking script; CSP forbids inline scripts).
(() => {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { preference = localStorage.getItem('fiq-theme') || 'system'; } catch { /* storage unavailable */ }
  if (!['system', 'light', 'dark'].includes(preference)) preference = 'system';
  const apply = value => {
    preference = value;
    root.dataset.themePreference = value;
    root.dataset.theme = value === 'system' ? (media.matches ? 'dark' : 'light') : value;
  };
  apply(preference);
  media.addEventListener('change', () => { if (preference === 'system') apply('system'); });
  window.fiqTheme = {
    get: () => preference,
    set: value => {
      if (!['system', 'light', 'dark'].includes(value)) return;
      try { localStorage.setItem('fiq-theme', value); } catch { /* storage unavailable */ }
      apply(value);
    },
  };
})();
