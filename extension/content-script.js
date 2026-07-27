// Injected on demand (via chrome.scripting.executeScript, triggered by the
// user clicking "Scan page" in the popup) to guess the current page's
// product name/image/price. Returns a best-effort guess — the popup always
// shows it in an editable form before saving, never auto-submits.
//
// This file must return a plain JSON-serializable object (it's the return
// value of an injected function), so no DOM nodes / functions in the result.
(function scrapeProduct() {
  function textOf(el) {
    return el && el.content ? el.content.trim() : el && el.textContent ? el.textContent.trim() : null;
  }

  function meta(name) {
    const el =
      document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
    return textOf(el);
  }

  function parsePrice(raw) {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).replace(/[^\d.,]/g, '').replace(/\s/g, '');
    if (!cleaned) return null;
    // Normalize "1.234,56" / "1234,56" style decimal commas to a JS float.
    const normalized =
      cleaned.includes(',') && !cleaned.includes('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,(?=\d{3}(\D|$))/g, '');
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : null;
  }

  function fromJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const candidates = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const item of candidates) {
        if (!item) continue;
        const type = item['@type'];
        const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
        if (!isProduct) continue;
        const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        return {
          name: item.name || null,
          image: Array.isArray(item.image) ? item.image[0] : item.image || null,
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
      image: meta('og:image'),
      price: parsePrice(meta('product:price:amount') || meta('og:price:amount')),
      currency: meta('product:price:currency') || meta('og:price:currency'),
    };
  }

  function fromFallback() {
    const firstBigImage = Array.from(document.images)
      .filter((img) => img.naturalWidth >= 200 && img.naturalHeight >= 200)
      .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];

    const priceRegex = /(?:zł|PLN|€|EUR|\$|USD)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?(?:zł|PLN|€|EUR|\$|USD)/i;
    const bodyMatch = document.body.innerText.match(priceRegex);

    return {
      name: document.title || null,
      image: firstBigImage ? firstBigImage.src : null,
      price: bodyMatch ? parsePrice(bodyMatch[0]) : null,
      currency: bodyMatch && /zł|PLN/i.test(bodyMatch[0]) ? 'PLN' : bodyMatch ? null : null,
    };
  }

  const jsonLd = fromJsonLd();
  const og = fromOpenGraph();
  const fallback = fromFallback();

  const merged = {
    name: (jsonLd && jsonLd.name) || og.name || fallback.name || '',
    imageUrl: (jsonLd && jsonLd.image) || og.image || fallback.image || '',
    price: (jsonLd && jsonLd.price) || og.price || fallback.price || null,
    currency: (jsonLd && jsonLd.currency) || og.currency || fallback.currency || 'PLN',
    link: location.href,
  };

  // Resolve relative image URLs against the page's own location.
  if (merged.imageUrl) {
    try {
      merged.imageUrl = new URL(merged.imageUrl, location.href).href;
    } catch {
      // leave as-is; the popup form lets the user fix/clear it
    }
  }

  return merged;
})();
