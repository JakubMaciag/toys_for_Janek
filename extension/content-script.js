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

  // schema.org "image" can be a plain URL string, an array of either, or an
  // ImageObject ({"@type":"ImageObject","url":"..."}/"contentUrl") — pull a
  // usable URL string out of whatever shape shows up.
  function extractImageValue(image) {
    if (!image) return null;
    if (typeof image === 'string') return image;
    if (Array.isArray(image)) {
      for (const item of image) {
        const found = extractImageValue(item);
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
      image: meta('og:image:secure_url') || meta('og:image') || meta('twitter:image') || meta('twitter:image:src'),
      price: parsePrice(meta('product:price:amount') || meta('og:price:amount')),
      currency: meta('product:price:currency') || meta('og:price:currency'),
    };
  }

  // Microdata (schema.org via itemprop, no JSON-LD): the element carrying
  // itemprop="image" can be an <img>, <meta>, or <link>.
  function fromMicrodata() {
    const el = document.querySelector('[itemprop="image"]');
    if (!el) return null;
    let image = null;
    if (el.tagName === 'IMG') image = el.currentSrc || el.getAttribute('src');
    else if (el.tagName === 'META') image = el.getAttribute('content');
    else if (el.tagName === 'LINK') image = el.getAttribute('href');
    else image = el.getAttribute('content') || el.getAttribute('src');
    return image ? { image } : null;
  }

  function fromFallback() {
    // Real image source, accounting for lazy-loading (src is often a tiny
    // placeholder until the image scrolls into view, with the real URL
    // sitting in a data-* attribute instead).
    function realSrc(img) {
      const candidates = [
        img.currentSrc,
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-original'),
        img.src,
      ].filter(Boolean);
      return candidates.find((s) => !/^data:image\/gif/i.test(s)) || candidates[0] || null;
    }

    // Prefer natural (loaded) dimensions, but fall back to the rendered box
    // size so lazy-loaded-but-not-yet-fetched images still count.
    function size(img) {
      const rect = img.getBoundingClientRect();
      return {
        w: img.naturalWidth || rect.width,
        h: img.naturalHeight || rect.height,
      };
    }

    const best = Array.from(document.images)
      .map((img) => ({ img, ...size(img) }))
      .filter((c) => c.w >= 150 && c.h >= 150)
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];

    const priceRegex = /(?:zł|PLN|€|EUR|\$|USD)\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s?(?:zł|PLN|€|EUR|\$|USD)/i;
    const bodyMatch = document.body.innerText.match(priceRegex);

    return {
      name: document.title || null,
      image: best ? realSrc(best.img) : null,
      price: bodyMatch ? parsePrice(bodyMatch[0]) : null,
      currency: bodyMatch && /zł|PLN/i.test(bodyMatch[0]) ? 'PLN' : bodyMatch ? null : null,
    };
  }

  const jsonLd = fromJsonLd();
  const og = fromOpenGraph();
  const microdata = fromMicrodata();
  const fallback = fromFallback();

  const merged = {
    name: (jsonLd && jsonLd.name) || og.name || fallback.name || '',
    imageUrl: (jsonLd && jsonLd.image) || og.image || (microdata && microdata.image) || fallback.image || '',
    price: (jsonLd && jsonLd.price) || og.price || fallback.price || null,
    currency: (jsonLd && jsonLd.currency) || og.currency || fallback.currency || 'PLN',
    link: location.href,
  };

  // Resolve relative/protocol-relative image URLs against the page's own location.
  if (merged.imageUrl) {
    try {
      merged.imageUrl = new URL(merged.imageUrl, location.href).href;
    } catch {
      merged.imageUrl = '';
    }
  }

  return merged;
})();
