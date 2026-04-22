const cheerio = require("cheerio");

const SHOP_URL = "https://theabcvault.com/shop/";
const VAULT_HOME_URL = "https://theabcvault.com/";
const CLOSED_TEXT = "The Vault is Now Closed";
const CLOSED_REDIRECT_SNIPPETS = ['window.location.href="/closed"', "window.location.href='/closed'"];

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseBottleSizeMl(rawValue) {
  const match = normalizeText(rawValue).match(/(\d+(?:\.\d+)?)\s*mL/i);
  return match ? Number(match[1]) : null;
}

function extractProducts($, { pageNumber = 1, pageUrl = SHOP_URL } = {}) {
  return $("li.product article.card")
    .map((index, articleNode) => {
      const article = $(articleNode);
      const productHref = article.find(".card-title a").first().attr("href") || "";
      const image = article.find("img.card-image, img").first();
      const imageSrc = image.attr("src") || image.attr("data-src") || image.attr("data-lazy") || "";
      const unitBits = article
        .find(".card-text--unit span")
        .map((_, span) => normalizeText($(span).text()))
        .get()
        .filter(Boolean);
      const buttonStates = [];
      article.find(".card-footer .button, .card-bulkOrder-action .button").each((_, node) => {
        const label = normalizeText($(node).text());
        if (["View Product", "Buy Now", "Add to Cart"].includes(label) && !buttonStates.includes(label)) {
          buttonStates.push(label);
        }
      });

      const articleText = normalizeText(article.text()).toLowerCase();
      const hasDisabledButton =
        article.find("button[disabled], a[aria-disabled='true'], .button.disabled, .button[disabled]").length > 0;
      const soldOutIndicatorPresent =
        articleText.includes("sold out") || articleText.includes("out of stock") || hasDisabledButton;

      return {
        productId: article.attr("data-product-id") || null,
        pageNumber,
        lineItemNumber: index + 1,
        productName: normalizeText(article.find(".card-title a").first().text()) || "Unavailable",
        productUrl: productHref ? new URL(productHref, pageUrl).toString() : null,
        imageUrl: imageSrc ? new URL(imageSrc, pageUrl).toString() : null,
        imageAlt: normalizeText(image.attr("alt")) || null,
        imageSrcset: image.attr("srcset") || null,
        category: unitBits[0] || "Not Shown",
        bottleSizeMl: parseBottleSizeMl(unitBits[1]),
        bottleSizeDisplay: unitBits[1] || "Not Shown",
        price: normalizeText(
          article.find(".card-text--price [data-product-price-without-tax].price--main").first().text(),
        ) || "Not Shown",
        newBadge: article.find(".sale-text").filter((_, node) => normalizeText($(node).text()) === "New").length > 0,
        sourcedCertifiedBadge:
          article.find("*")
            .toArray()
            .some((node) => normalizeText($(node).text()) === "Sourced & Certified"),
        buttonStatesShown: buttonStates,
        isPurchasableFromListingPage: buttonStates.includes("Buy Now") || buttonStates.includes("Add to Cart"),
        soldOutIndicatorPresent,
        inventoryQuantity: "Not Shown",
        summary: normalizeText(article.find(".card-text--summary").first().text()) || "Not Shown",
      };
    })
    .get();
}

function getProductKey(product) {
  return product?.productId || product?.productUrl || product?.productName || "";
}

function discoverShopPageUrls($) {
  const urls = new Map([[1, SHOP_URL]]);

  $("a[href]").each((_, node) => {
    const href = $(node).attr("href") || "";
    const label = normalizeText($(node).text());

    try {
      const url = new URL(href, SHOP_URL);
      if (url.origin !== new URL(SHOP_URL).origin || !url.pathname.replace(/\/+$/, "").endsWith("/shop")) {
        return;
      }

      const pageFromQuery = Number(url.searchParams.get("page"));
      const pageFromLabel = /^\d+$/.test(label) ? Number(label) : null;
      const pageNumber = pageFromQuery || pageFromLabel;

      if (pageNumber && pageNumber > 1) {
        urls.set(pageNumber, url.toString());
      }
    } catch {
      // Ignore malformed links and continue scanning visible pagination.
    }
  });

  // ABC/BigCommerce sometimes omits pagination links when the HTML is gated.
  // Probe page 2 so any newly exposed second page is included without guessing beyond it.
  urls.set(2, new URL("?page=2", SHOP_URL).toString());

  return Array.from(urls.entries())
    .sort(([leftPage], [rightPage]) => leftPage - rightPage)
    .map(([pageNumber, url]) => ({ pageNumber, url }));
}

async function extractProductsFromShopPages(firstPageHtml) {
  const firstPage = cheerio.load(firstPageHtml);
  const pageUrls = discoverShopPageUrls(firstPage);
  const seenProducts = new Set();
  const products = [];
  const scannedPages = [];

  for (const { pageNumber, url } of pageUrls) {
    let pageHtml = firstPageHtml;

    if (pageNumber !== 1) {
      try {
        pageHtml = await fetchHtml(url);
      } catch (error) {
        scannedPages.push({
          pageNumber,
          url,
          productCount: 0,
          skipped: true,
          reason: error.message,
        });
        continue;
      }
    }

    const $ = pageNumber === 1 ? firstPage : cheerio.load(pageHtml);
    const pageProducts = extractProducts($, { pageNumber, pageUrl: url });
    let addedFromPage = 0;

    pageProducts.forEach((product) => {
      const productKey = getProductKey(product);

      if (productKey && seenProducts.has(productKey)) {
        return;
      }

      if (productKey) {
        seenProducts.add(productKey);
      }

      products.push(product);
      addedFromPage += 1;
    });

    scannedPages.push({
      pageNumber,
      url,
      productCount: pageProducts.length,
      addedProductCount: addedFromPage,
      skipped: false,
    });
  }

  return {
    $: firstPage,
    products,
    scannedPages,
  };
}

function findParagraphsContaining($, matcher) {
  return $("p")
    .map((_, node) => normalizeText($(node).text()))
    .get()
    .filter((text) => matcher(text.toLowerCase()));
}

function findListItemsContaining($, matcher) {
  return $("li")
    .map((_, node) => normalizeText($(node).text()))
    .get()
    .filter((text) => matcher(text.toLowerCase()));
}

function extractMetadata($) {
  const modalMessages = unique([
    ...findParagraphsContaining($, (text) => text.includes("you may only purchase one vault item")),
    ...findParagraphsContaining($, (text) => text.includes("four (4) minutes to complete your purchase")),
    ...findParagraphsContaining($, (text) => text.includes("reserved for 4 minutes")),
    ...findParagraphsContaining($, (text) => text.includes("not available at the new store location")),
  ]);

  const shippingRestrictions = unique([
    ...findParagraphsContaining($, (text) => text.includes("same-day delivery")),
    ...findParagraphsContaining($, (text) => text.includes("ship")),
    ...findListItemsContaining($, (text) => text.includes("same-day delivery")),
    ...findListItemsContaining($, (text) => text.includes("ship")),
    ...findListItemsContaining($, (text) => text.includes("instacart")),
    ...findListItemsContaining($, (text) => text.includes("spirits and beer are not eligible for shipping")),
  ]);

  const timerMentions = findParagraphsContaining(
    $,
    (text) => text.includes("four (4) minutes") || text.includes("reserved for 4 minutes"),
  );

  const purchaseLimits = findParagraphsContaining(
    $,
    (text) => text.includes("limit one purchase per person") || text.includes("only purchase one vault item"),
  );

  const globalFlags = {
    activeCartTimerVisible: normalizeText($("body").text()).includes("complete your purchase."),
    addAllToCartVisible: $("body").text().includes("Add all to cart"),
    vaultKeyGateVisible: normalizeText($("body").text()).includes("Vault Key"),
  };

  return {
    purchaseLimits,
    reservationTimers: timerMentions,
    modalAndBannerMessaging: modalMessages,
    shippingOrDeliveryRestrictions: shippingRestrictions,
    globalFlags,
  };
}

function getRequestHeaders() {
  return {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml",
    "cache-control": "no-cache",
    pragma: "no-cache",
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: getRequestHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Live scan failed for ${url} with HTTP ${response.status}`);
  }

  return response.text();
}

function extractVaultStatus(html) {
  const normalizedHtml = normalizeText(html);
  const isClosed =
    normalizedHtml.includes(CLOSED_TEXT) ||
    CLOSED_REDIRECT_SNIPPETS.some((snippet) => normalizedHtml.includes(snippet));

  return {
    status: isClosed ? "closed" : "open",
    label: isClosed ? "Closed" : "Open",
    checkedAt: new Date().toISOString(),
    sourceUrl: VAULT_HOME_URL,
    matchedClosedText: isClosed,
    rule: `Closed only when the page contains "${CLOSED_TEXT}"`,
  };
}

async function scanShop() {
  const [shopHtml, vaultHomeHtml] = await Promise.all([
    fetchHtml(SHOP_URL),
    fetchHtml(VAULT_HOME_URL).catch(() => null),
  ]);
  const { $, products, scannedPages } = await extractProductsFromShopPages(shopHtml);
  const metadata = extractMetadata($);
  metadata.scannedPages = scannedPages;
  metadata.vaultStatus = vaultHomeHtml
    ? extractVaultStatus(vaultHomeHtml)
    : {
        status: "unknown",
        label: "Unknown",
        checkedAt: new Date().toISOString(),
        sourceUrl: VAULT_HOME_URL,
        matchedClosedText: false,
        rule: `Closed only when the page contains "${CLOSED_TEXT}"`,
      };

  return {
    scannedAt: new Date().toISOString(),
    sourceUrl: SHOP_URL,
    productCount: products.length,
    products,
    metadata,
  };
}

module.exports = {
  SHOP_URL,
  VAULT_HOME_URL,
  scanShop,
};
