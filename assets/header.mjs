// Shared top bar for the demo and About pages: Share, avatar menu (Settings, Help, About),
// and the settings panel (document language, theme). Language is persisted for the demo.
const SHARE_URL = 'https://aka.ms/foundryiq-demo';
// On the demo page, a non-default industry or scenario is shared as a link to that exact view.
const shareUrl = () => {
  if (location.pathname !== '/') return SHARE_URL;
  const current = new URLSearchParams(location.search);
  const params = new URLSearchParams();
  for (const name of ['industry', 'scenario']) if (/^[a-zA-Z0-9-]{1,32}$/.test(current.get(name) || '')) params.set(name, current.get(name));
  return params.size ? `${location.origin}/?${params}` : SHARE_URL;
};
/** Industry demos are English-only: the document language applies to the Zava store demo only. */
export function setLanguageLocked(locked) {
  for (const input of languageInputs()) input.disabled = locked;
  const note = element('language-note');
  if (note) note.hidden = !locked;
}
const element = id => document.getElementById(id);
export const languageInputs = () => [...document.querySelectorAll('input[name="document-language"]')];
export const currentLanguage = () => languageInputs().find(input => input.checked)?.value || 'en';
export const currentLanguageLabel = () => languageInputs().find(input => input.checked)?.parentElement.textContent.trim() || 'English';

let toastTimer;
export function toast(message) {
  const box = element('toast');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 4000);
}

export function initHeader({ onLanguageChange } = {}) {
  const profileButton = element('profile-button');
  const profileMenu = element('profile-menu');
  const settingsPanel = element('settings-panel');
  const menuItems = () => [...profileMenu.querySelectorAll('[role="menuitem"]')];
  const closeMenu = (focusButton = false) => {
    if (profileMenu.hidden) return;
    profileMenu.hidden = true;
    profileButton.setAttribute('aria-expanded', 'false');
    if (focusButton) profileButton.focus();
  };
  const closeSettings = (focusButton = false) => {
    if (settingsPanel.hidden) return;
    settingsPanel.hidden = true;
    if (focusButton) profileButton.focus();
  };
  const openMenu = (focusIndex = 0) => {
    closeSettings();
    profileMenu.hidden = false;
    profileButton.setAttribute('aria-expanded', 'true');
    menuItems()[focusIndex]?.focus();
  };
  const openSettings = () => {
    closeMenu();
    for (const input of document.querySelectorAll('input[name="theme"]')) input.checked = input.value === (window.fiqTheme?.get() || 'system');
    settingsPanel.hidden = false;
    (languageInputs().find(input => input.checked && !input.disabled) || [...settingsPanel.querySelectorAll('input')].find(input => !input.disabled))?.focus();
  };

  element('share').addEventListener('click', async () => {
    const link = shareUrl();
    const data = { title: 'Foundry IQ Demo Studio', text: 'Compare Foundry IQ retrieval patterns side by side with real queries and citations.', url: link };
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try { await navigator.share(data); return; } catch (error) { if (error?.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast(`Link copied: ${link}`);
    } catch {
      toast(`Copy this link: ${link}`);
    }
  });
  profileButton.addEventListener('click', () => (profileMenu.hidden ? openMenu(0) : closeMenu()));
  profileButton.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      openMenu(event.key === 'ArrowUp' ? menuItems().length - 1 : 0);
    }
  });
  profileMenu.addEventListener('keydown', event => {
    const items = menuItems();
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') closeMenu();
  });
  element('menu-settings').addEventListener('click', openSettings);
  for (const link of [element('menu-help'), element('menu-about')]) link.addEventListener('click', () => closeMenu());
  element('settings-close').addEventListener('click', () => closeSettings(true));
  settingsPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeSettings(true); }
  });
  for (const input of document.querySelectorAll('input[name="theme"]')) {
    input.checked = input.value === (window.fiqTheme?.get() || 'system');
    input.addEventListener('change', () => { if (input.checked) window.fiqTheme?.set(input.value); });
  }
  try {
    const saved = localStorage.getItem('fiq-language');
    const match = languageInputs().find(input => input.value === saved);
    if (match) match.checked = true;
  } catch { /* storage unavailable */ }
  for (const input of languageInputs()) input.addEventListener('change', () => {
    try { localStorage.setItem('fiq-language', currentLanguage()); } catch { /* storage unavailable */ }
    if (onLanguageChange) onLanguageChange(currentLanguage());
    else toast(`Document language set to ${currentLanguageLabel()}. It applies when you open the demo.`);
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.menu-anchor')) { closeMenu(); closeSettings(); }
  });
  return { closeAll: () => { closeMenu(); closeSettings(); } };
}
