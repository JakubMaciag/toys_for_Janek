// The bookmarklet itself must be tiny — some mobile browsers (Samsung
// Internet included) cap the bookmark URL field at ~2048 characters, and the
// actual scraping logic is much longer than that. So the bookmarklet is just
// a "loader": it injects a <script> tag pointing at bookmarklet-payload.js,
// which does the real work in the product page's context. A cache-busting
// query param avoids the browser serving a stale cached payload after we
// update the logic.
//
// Known limitation: a handful of sites with a strict Content-Security-Policy
// (script-src not allowing our domain) will silently block the injected
// script. There's no bookmarklet-side fix for that; those sites just won't
// work with this approach.
function buildLoaderCode() {
  return (
    "javascript:(function(){var d=document,s=d.createElement('script');" +
    "s.src='https://jakubmaciag.github.io/toys_for_Janek/bookmarklet-payload.js?_='+Date.now();" +
    'd.body.appendChild(s);})();'
  );
}

const bookmarkletCode = buildLoaderCode();

const codeArea = document.getElementById('bookmarklet-code');
const copyBtn = document.getElementById('copy-btn');
const copyStatus = document.getElementById('copy-status');
const dragLink = document.getElementById('drag-link');

codeArea.value = bookmarkletCode;
dragLink.href = bookmarkletCode;

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(bookmarkletCode);
    copyStatus.textContent = 'Skopiowano! Wklej to jako adres URL zakładki.';
  } catch (err) {
    codeArea.focus();
    codeArea.select();
    copyStatus.textContent = 'Nie udało się skopiować automatycznie — zaznacz tekst powyżej i skopiuj ręcznie.';
  }
});
