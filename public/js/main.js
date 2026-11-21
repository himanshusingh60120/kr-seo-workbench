'use strict';
/* Starts the app once every script is loaded: loads the sign-in, issue-decision and in-house keyword scripts,
   asks the person to sign in, and only then opens the tool. The name box at the top right shows the signed-in email. */
(function () {
  const KR = window.KR;

  // Change this whenever the checks change. RD results saved in the browser by an older version of the checks
  // are thrown away, so an updated tool never replays old findings.
  const CHECKS_VERSION = '2026-11-22-d';

  function dropOldSavedResults() {
    if (KR.store.get('kr_checks_version', '') === CHECKS_VERSION) return;
    KR.store.set('kr_rd_last', '');
    KR.store.set('kr_checks_version', CHECKS_VERSION);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src + '. Refresh the page.'));
      document.head.appendChild(s);
    });
  }

  async function start() {
    try {
      dropOldSavedResults();
      await loadScript('js/auth.js');
      await loadScript('js/review.js');
      await loadScript('js/inhouse.js');
      const email = await KR.requireLogin();
      const name = KR.$('#userName');
      name.value = email;
      name.readOnly = true;
      name.title = 'Signed in as ' + email;
      KR.store.set('kr_user', email);
      KR.initIcons();
      KR.initTabs();
      KR.initSettings();
      KR.initKeywords();
      KR.initRd();
      KR.initDm();
      KR.initLive();
      KR.initAccountBar();
      KR.initReview();
      KR.initInhouse();
    } catch (e) {
      document.body.insertAdjacentHTML('afterbegin', '<p style="margin:0;padding:12px 16px;background:#FDE8E8;color:#B42318;font-family:Roboto,Arial,sans-serif">' + KR.esc(e.message) + '</p>');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();