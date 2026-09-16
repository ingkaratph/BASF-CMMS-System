// Apply the preference before the page paints; storage may be disabled.
(() => {
  let theme;
  try { theme = localStorage.getItem('cmms-theme'); } catch {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
