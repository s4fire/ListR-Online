/* First-party icon pass for consistent, dependency-free UI icons. */
const iconPaths = {
  home: '<path d="m3 10 9-7 9 7"></path><path d="M5 9.5V21h14V9.5"></path><path d="M9 21v-6h6v6"></path>',
  clock: '<circle cx="12" cy="12" r="8.5"></circle><path d="M12 7v5l3.2 2"></path>',
  check: '<path d="m5 12 4.2 4.2L19 6.5"></path>',
  star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  search: '<circle cx="10.8" cy="10.8" r="6.6"></circle><path d="m16 16 4.3 4.3"></path>',
  refresh: '<path d="M20 11a8.2 8.2 0 0 0-14.4-4.9L4 8.2"></path><path d="M4 4v4.2h4.2"></path><path d="M4 13a8.2 8.2 0 0 0 14.4 4.9l1.6-2.1"></path><path d="M20 20v-4.2h-4.2"></path>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.3a2 2 0 0 0 0-4h-.9a2.4 2.4 0 0 1 0-4.8h1.9a6.7 6.7 0 0 0 6.7-6.7A8.5 8.5 0 0 0 12 3.5Z"></path><circle cx="7.5" cy="9" r=".8" fill="currentColor" stroke="none"></circle><circle cx="10.5" cy="6.8" r=".8" fill="currentColor" stroke="none"></circle><circle cx="14.6" cy="6.5" r=".8" fill="currentColor" stroke="none"></circle>',
  volume: '<path d="M5 9v6h3l4 3.5V5.5L8 9H5Z"></path><path d="M16 9.2a4.2 4.2 0 0 1 0 5.6"></path><path d="M18.7 6.8a7.7 7.7 0 0 1 0 10.4"></path>',
  list: '<path d="M6 7h13M6 12h13M6 17h13"></path><circle cx="3.5" cy="7" r=".8" fill="currentColor" stroke="none"></circle><circle cx="3.5" cy="12" r=".8" fill="currentColor" stroke="none"></circle><circle cx="3.5" cy="17" r=".8" fill="currentColor" stroke="none"></circle>',
  users: '<path d="M16 20v-1.3a4.7 4.7 0 0 0-4.7-4.7H7.7A4.7 4.7 0 0 0 3 18.7V20"></path><circle cx="9.5" cy="7" r="3.3"></circle><path d="M15.2 4.2a3.3 3.3 0 0 1 0 6.2"></path><path d="M16 14.4a4.7 4.7 0 0 1 4 4.6v1"></path>',
  play: '<path d="m9 6 9 6-9 6V6Z"></path>',
  spark: '<path d="m12 3 1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6L12 3Z"></path>',
  database: '<ellipse cx="12" cy="5.2" rx="7" ry="3"></ellipse><path d="M5 5.2v6.6c0 1.7 3.1 3 7 3s7-1.3 7-3V5.2"></path><path d="M5 11.8v6.5c0 1.7 3.1 3 7 3s7-1.3 7-3v-6.5"></path>'
};

function setIcon(element, name) {
  if (!element || !iconPaths[name] || element.dataset.uiIcon === name) return;
  element.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + iconPaths[name] + '</svg>';
  element.dataset.uiIcon = name;
}

function enhanceIcons(root = document) {
  root.querySelectorAll('.nav-icon').forEach((el) => {
    const view = el.closest('[data-view]')?.dataset.view;
    setIcon(el, view === 'home' ? 'home' : view === 'watching' ? 'clock' : view === 'completed' ? 'check' : 'star');
  });
  root.querySelectorAll('.top-add > span[aria-hidden="true"]').forEach((el) => setIcon(el, 'plus'));
  root.querySelectorAll('.field-with-icon > span[aria-hidden="true"]').forEach((el) => setIcon(el, 'search'));
  root.querySelectorAll('.refresh-icon').forEach((el) => setIcon(el, 'refresh'));
  root.querySelectorAll('.appearance-menu-link > span[aria-hidden="true"]').forEach((el) => setIcon(el, 'palette'));
  root.querySelectorAll('.sound-toggle-icon').forEach((el) => setIcon(el, 'volume'));
  root.querySelectorAll('.account-mark').forEach((el) => setIcon(el, 'database'));
  root.querySelectorAll('.shortcut-symbol-library').forEach((el) => setIcon(el, 'list'));
  root.querySelectorAll('.shortcut-symbol-discover').forEach((el) => setIcon(el, 'search'));
  root.querySelectorAll('.shortcut-symbol-social').forEach((el) => setIcon(el, 'users'));
  root.querySelectorAll('.empty-orbit').forEach((el) => setIcon(el, 'spark'));
  root.querySelectorAll('.home-orbit-core > span').forEach((el) => setIcon(el, 'spark'));
  root.querySelectorAll('.episode-icon').forEach((el) => setIcon(el, 'play'));
  root.querySelectorAll('.panel-star').forEach((el) => setIcon(el, 'spark'));
  root.querySelectorAll('.hero-spark').forEach((el) => setIcon(el, 'spark'));
  root.querySelectorAll('.watch-next-symbol').forEach((el) => setIcon(el, 'play'));
}

enhanceIcons();

const iconObserver = new MutationObserver(() => {
  if (iconObserver.scheduled) return;
  iconObserver.scheduled = true;
  requestAnimationFrame(() => {
    iconObserver.scheduled = false;
    enhanceIcons();
  });
});
iconObserver.observe(document.body, { subtree: true, childList: true });