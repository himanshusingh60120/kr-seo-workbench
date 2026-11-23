'use strict';
/* Starts the app once every script is loaded: loads the sign-in, issue-decision, in-house keyword, check results,
   API credits and keyword ideas scripts, asks the person to sign in, finds out what they may do (run checks,
   see the credit counter), and only then opens the tool. The name box at the top right shows the signed-in email. */
(function () {
  const KR = window.KR;

  // Change this whenever the checks change. RD results saved in the browser by an older version of the checks
  // are thrown away, so an updated tool never replays old findings.
  const CHECKS_VERSION = '2026-11-23-a';

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
      await loadScript('js/results.js');
      await loadScript('js/credits.js');
      await loadScript('js/explorer.js');
      const email = await KR.requireLogin();
      const name = KR.$('#userName');
      name.value = email;
      name.readOnly = true;
      name.title = 'Signed in as ' + email;
      KR.store.set('kr_user', email);
      // What this person may do. If the server cannot be asked, the buttons stay visible; the server still
      // refuses check actions from anyone outside the check team.
      try {
        KR.me = await KR.api('history', 'me');
      } catch (e) {
        KR.me = { email, checker: true, creditViewer: false, checkers: [] };
      }
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
      KR.initResults();
      KR.initCredits();
      KR.initExplorer();
      KR.applyRoles();
    } catch (e) {
      document.body.insertAdjacentHTML('afterbegin', '<p style="margin:0;padding:12px 16px;background:#FDE8E8;color:#B42318;font-family:Roboto,Arial,sans-serif">' + KR.esc(e.message) + '</p>');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
