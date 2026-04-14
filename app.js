import React, { useEffect, useMemo, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const STORAGE_KEY = "abc-vault-live-scanner:last-scan:v1";

function readPreviousSnapshot() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function formatScanTime(value) {
  if (!value) {
    return "Not scanned yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function diffSnapshots(previousProducts, currentProducts) {
  const previousMap = new Map(previousProducts.map((item) => [item.productId || item.productName, item]));
  const currentMap = new Map(currentProducts.map((item) => [item.productId || item.productName, item]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, currentItem] of currentMap) {
    const previousItem = previousMap.get(key);
    if (!previousItem) {
      added.push(currentItem);
      continue;
    }

    const fieldChanges = [];
    for (const field of [
      "productName",
      "category",
      "bottleSizeDisplay",
      "price",
      "newBadge",
      "sourcedCertifiedBadge",
      "isPurchasableFromListingPage",
      "soldOutIndicatorPresent",
    ]) {
      if (JSON.stringify(previousItem[field]) !== JSON.stringify(currentItem[field])) {
        fieldChanges.push(field);
      }
    }

    if (JSON.stringify(previousItem.buttonStatesShown) !== JSON.stringify(currentItem.buttonStatesShown)) {
      fieldChanges.push("buttonStatesShown");
    }

    if (fieldChanges.length > 0) {
      changed.push({
        productName: currentItem.productName,
        fields: fieldChanges,
      });
    }
  }

  for (const [key, previousItem] of previousMap) {
    if (!currentMap.has(key)) {
      removed.push(previousItem);
    }
  }

  return { added, removed, changed };
}

function truthyTag(value) {
  return html`<span className=${`tag ${value ? "tag-yes" : "tag-no"}`}>${value ? "Yes" : "No"}</span>`;
}

function App() {
  const [data, setData] = useState(null);
  const [previousSnapshot, setPreviousSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const runScan = async () => {
    setLoading(true);
    setError("");

    try {
      const previous = readPreviousSnapshot();
      const response = await fetch("/api/scan", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message || "Scan failed.");
      }

      setPreviousSnapshot(previous);
      setData(payload);
      saveSnapshot(payload);
    } catch (scanError) {
      setError(scanError.message || "Scan failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runScan();
  }, []);

  const diff = useMemo(() => {
    if (!data) {
      return { added: [], removed: [], changed: [] };
    }
    return diffSnapshots(previousSnapshot?.products || [], data.products || []);
  }, [data, previousSnapshot]);

  return html`
    <main className="app-shell">
      <section className="hero">
        <div className="hero-panel">
          <div className="eyebrow">Fresh HTML scan + local diff memory</div>
          <h1>ABC Vault listing tracker</h1>
          <p className="hero-copy">
            This app runs a live server-side scan of the current shop HTML, converts visible listing data into a
            structured table, and compares the newest result against the last snapshot stored in this browser.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick=${runScan} disabled=${loading}>
              ${loading ? "Scanning live HTML..." : "Run fresh scan"}
            </button>
            <a className="button button-secondary" href="https://theabcvault.com/shop/" target="_blank" rel="noreferrer">
              Open source page
            </a>
          </div>
          <div className="scan-meta">
            <div><strong>Current scan:</strong> ${formatScanTime(data?.scannedAt)}</div>
            <div><strong>Previous snapshot:</strong> ${formatScanTime(previousSnapshot?.scannedAt)}</div>
            <div><strong>Source:</strong> ${data?.sourceUrl || "https://theabcvault.com/shop/"}</div>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">${data?.productCount ?? "0"}</div>
            <div className="stat-label">Products currently listed</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">${diff.added.length}</div>
            <div className="stat-label">Added since prior scan</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">${diff.changed.length}</div>
            <div className="stat-label">Changed rows or fields</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">${diff.removed.length}</div>
            <div className="stat-label">Removed since prior scan</div>
          </div>
        </div>
      </section>

      ${error ? html`<section className="surface"><div className="error-state">${error}</div></section>` : null}

      <section className="layout">
        <article className="surface">
          <div className="surface-header">
            <div>
              <h2 className="section-title">Metadata Notes</h2>
              <p className="section-note">Global behaviors lifted from the live HTML rather than inferred from memory.</p>
            </div>
          </div>
          ${data
            ? html`
                <div className="meta-list">
                  <span className="meta-item">`Buy Now` on a card means direct purchase is exposed on the listing page.</span>
                  <span className="meta-item">`View Product` only means the listing page itself does not show a purchase action.</span>
                  <span className="meta-item">Inventory quantity is reported as `Not Shown` unless the HTML explicitly exposes it.</span>
                  <span className="meta-item">Sold out is only marked when the listing HTML shows a stock-out signal.</span>
                </div>
                <div className="diff-columns">
                  <div className="diff-column">
                    <h3>Purchase limits</h3>
                    <ul className="plain-list">
                      ${(data.metadata.purchaseLimits || []).map((item) => html`<li>${item}</li>`)}
                    </ul>
                  </div>
                  <div className="diff-column">
                    <h3>Reservation timers</h3>
                    <ul className="plain-list">
                      ${(data.metadata.reservationTimers || []).map((item) => html`<li>${item}</li>`)}
                    </ul>
                  </div>
                  <div className="diff-column">
                    <h3>Shipping restrictions</h3>
                    <ul className="plain-list">
                      ${(data.metadata.shippingOrDeliveryRestrictions || []).map((item) => html`<li>${item}</li>`)}
                    </ul>
                  </div>
                </div>
                <div className="diff-columns">
                  <div className="diff-column">
                    <h3>Availability messages</h3>
                    <ul className="plain-list">
                      ${(data.metadata.modalAndBannerMessaging || []).map((item) => html`<li>${item}</li>`)}
                    </ul>
                  </div>
                  <div className="diff-column">
                    <h3>Global flags</h3>
                    <ul className="plain-list">
                      <li>Cart timer visible: ${data.metadata.globalFlags.activeCartTimerVisible ? "Yes" : "No"}</li>
                      <li>Add all to cart visible: ${data.metadata.globalFlags.addAllToCartVisible ? "Yes" : "No"}</li>
                      <li>Vault key gate visible: ${data.metadata.globalFlags.vaultKeyGateVisible ? "Yes" : "No"}</li>
                    </ul>
                  </div>
                  <div className="diff-column">
                    <h3>Interpretation rules</h3>
                    <ul className="plain-list">
                      <li>Missing quantity stays `Not Shown`.</li>
                      <li>Missing buy button does not automatically mean sold out.</li>
                      <li>Only explicit stock-out HTML marks a row as sold out.</li>
                    </ul>
                  </div>
                </div>
              `
            : html`<div className="empty-state">The first scan will populate notes here.</div>`}
        </article>

        <article className="surface">
          <div className="surface-header">
            <div>
              <h2 className="section-title">What Changed</h2>
              <p className="section-note">Diffed against the last successful scan stored locally in this browser.</p>
            </div>
          </div>
          ${data
            ? html`
                <div className="diff-columns">
                  <div className="diff-column">
                    <h3>Added</h3>
                    ${diff.added.length
                      ? html`<ul className="plain-list">${diff.added.map((item) => html`<li>${item.productName}</li>`)}</ul>`
                      : html`<div className="empty-state">No newly added listings detected.</div>`}
                  </div>
                  <div className="diff-column">
                    <h3>Changed</h3>
                    ${diff.changed.length
                      ? html`
                          <ul className="plain-list">
                            ${diff.changed.map(
                              (item) => html`<li><strong>${item.productName}</strong>: ${item.fields.join(", ")}</li>`,
                            )}
                          </ul>
                        `
                      : html`<div className="empty-state">No field-level changes detected.</div>`}
                  </div>
                  <div className="diff-column">
                    <h3>Removed</h3>
                    ${diff.removed.length
                      ? html`<ul className="plain-list">${diff.removed.map((item) => html`<li>${item.productName}</li>`)}</ul>`
                      : html`<div className="empty-state">No removals detected.</div>`}
                  </div>
                </div>
              `
            : html`<div className="empty-state">Run the first scan to start tracking deltas.</div>`}
        </article>
      </section>

      <section className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Line Item</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Bottle Size (mL)</th>
                <th>Price</th>
                <th>New</th>
                <th>Sourced & Certified</th>
                <th>Button States</th>
                <th>Purchasable</th>
                <th>Sold Out</th>
                <th>Inventory</th>
              </tr>
            </thead>
            <tbody>
              ${(data?.products || []).map(
                (item) => html`
                  <tr key=${item.productId || `${item.pageNumber}-${item.lineItemNumber}`}>
                    <td>${item.pageNumber}</td>
                    <td>${item.lineItemNumber}</td>
                    <td className="name-cell">${item.productName}</td>
                    <td>${item.category}</td>
                    <td>${item.bottleSizeMl ?? item.bottleSizeDisplay}</td>
                    <td>${item.price}</td>
                    <td>${truthyTag(item.newBadge)}</td>
                    <td>${truthyTag(item.sourcedCertifiedBadge)}</td>
                    <td>
                      <div className="button-state-list">
                        ${item.buttonStatesShown.length
                          ? item.buttonStatesShown.map((state) => html`<span className="button-state">${state}</span>`)
                          : html`<span className="button-state">None shown</span>`}
                      </div>
                    </td>
                    <td>${truthyTag(item.isPurchasableFromListingPage)}</td>
                    <td>${truthyTag(item.soldOutIndicatorPresent)}</td>
                    <td>${item.inventoryQuantity}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        <div className="footer-note">
          Fresh runs always hit the live shop endpoint through the server, and the local diff compares only against the
          last successful scan saved in this browser.
        </div>
      </section>
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
