// Builds the "javascript:" bookmarklet URI from a single, ordinary function
// (via Function.prototype.toString()) so there's one canonical, always-in-sync
// source of truth instead of a hand-minified copy that can drift.
//
// This function runs on an arbitrary third-party product page (not on our
// site), so it can't import config.js/firebase-rest.js — it only scrapes the
// page and hands off to admin.html via URL query params. The actual Firestore
// write still goes through the normal, already-logged-in admin session in
// admin.html, same as every other add path.
function toysForJanekBookmarklet() {
  function extractImageValue(image) {
    if (!image) return null;
    if (typeof image === 'string') return image;
    if (Array.isArray(image)) {
      for (var i = 0; i < image.length; i++) {
        var found = extractImageValue(image[i]);
        if (found) return found;
      }
      return null;
    }
    if (typeof image === 'object') {
      if (typeof image.url === 'string') return image.url;
      if (typeof image.contentUrl === 'string') return image.contentUrl;
    }
    return null;
  }

  function meta(name) {
    var el =
      document.querySelector('meta[property="' + name + '"]') ||
      document.querySelector('meta[name="' + name + '"]');
    return el ? (el.content || '').trim() : null;
  }

  function parsePrice(raw) {
    if (raw === null || raw === undefined) return null;
    var cleaned = String(raw).replace(/[^\d.,]/g, '').replace(/\s/g, '');
    if (!cleaned) return null;
    var normalized =
      cleaned.indexOf(',') !== -1 && cleaned.indexOf('.') === -1
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,(?=\d{3}(\D|$))/g, '');
    var num = parseFloat(normalized);
    return isFinite(num) ? num : null;
  }

  function fromJsonLd() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var data;
      try {
        data = JSON.parse(scripts[i].textContent);
      } catch (e) {
        continue;
      }
      var candidates = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (var j = 0; j < candidates.length; j++) {
        var item = candidates[j];
        if (!item) continue;
        var type = item['@type'];
        var isProduct = type === 'Product' || (Array.isArray(type) && type.indexOf('Product') !== -1);
        if (!isProduct) continue;
        var offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        return {
          name: item.name || null,
          image: extractImageValue(item.image),
          price: offers ? parsePrice(offers.price || offers.lowPrice) : null,
          currency: offers ? offers.priceCurrency || null : null,
        };
      }
    }
    return null;
  }

  function fromOpenGraph() {
    return {
      name: meta('og:title'),
      image: meta('og:image:secure_url') || meta('og:image') || meta('twitter:image'),
      price: parsePrice(meta('product:price:amount') || meta('og:price:amount')),
      currency: meta('product:price:currency') || meta('og:price:currency'),
    };
  }

  function fromFallback() {
    var imgs = document.getElementsByTagName('img');
    var best = null;
    var bestArea = 0;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var rect = img.getBoundingClientRect();
      var w = img.naturalWidth || rect.width;
      var h = img.naturalHeight || rect.height;
      if (w >= 150 && h >= 150 && w * h > bestArea) {
        best = img;
        bestArea = w * h;
      }
    }
    var priceRegex =
      /(?:zł|PLN|€|EUR|\$|USD)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?(?:zł|PLN|€|EUR|\$|USD)/i;
    var bodyMatch = document.body.innerText.match(priceRegex);
    return {
      name: document.title || null,
      image: best ? best.currentSrc || best.src : null,
      price: bodyMatch ? parsePrice(bodyMatch[0]) : null,
      currency: bodyMatch && /zł|PLN/i.test(bodyMatch[0]) ? 'PLN' : null,
    };
  }

  var jsonLd = fromJsonLd() || {};
  var og = fromOpenGraph();
  var fallback = fromFallback();

  var name = jsonLd.name || og.name || fallback.name || '';
  var image = jsonLd.image || og.image || fallback.image || '';
  var price = jsonLd.price || og.price || fallback.price || '';
  var currency = jsonLd.currency || og.currency || fallback.currency || 'PLN';

  if (image) {
    try {
      image = new URL(image, location.href).href;
    } catch (e) {
      image = '';
    }
  }

  var params =
    'prefillName=' +
    encodeURIComponent(name) +
    '&prefillImage=' +
    encodeURIComponent(image) +
    '&prefillPrice=' +
    encodeURIComponent(price) +
    '&prefillCurrency=' +
    encodeURIComponent(currency) +
    '&prefillLink=' +
    encodeURIComponent(location.href);

  window.open('https://jakubmaciag.github.io/toys_for_Janek/admin.html?' + params, '_blank');
}

const bookmarkletCode = 'javascript:' + encodeURIComponent('(' + toysForJanekBookmarklet.toString() + ')();');

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
