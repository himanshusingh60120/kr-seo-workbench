'use strict';
/* Starts the app once every script is loaded. */
(function () {
  const KR = window.KR;

  function start() {
    const name = KR.$('#userName');
    name.value = KR.store.get('kr_user', '');
    name.addEventListener('input', () => KR.store.set('kr_user', name.value.trim()));
    KR.initIcons();
    KR.initTabs();
    KR.initSettings();
    KR.initKeywords();
    KR.initRd();
    KR.initDm();
    KR.initLive();
    if (!name.value) setTimeout(() => KR.toast('Add your name at the top right so your work is logged against it.'), 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
