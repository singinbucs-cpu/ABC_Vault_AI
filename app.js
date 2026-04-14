import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(React.createElement);
const STORAGE_KEY = "abc-vault-live-scanner:last-scan:v1";
const AUTO_REFRESH_SECONDS = 30;

function createEmptyChangeFeed() {
  return {
    added: [],
    changed: [],
    removed: [],
  };
}

function mergeChangeItems(existingItems, incomingItems, getKey) {
  const merged = new Map(existingItems.map((item) => [getKey(item), item]));

  incomingItems.forEach((item) => {
    merged.set(getKey(item), item);
  });

  return Array.from(merged.values());
}

function buildAddedItems(items, detectedAt) {
  return items.map((item) => ({
    productId: item.productId || item.productName,
    productName: item.productName,
    detectedAt,
  }));
}

function playNotificationSound(audioContextRef) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    const audioContext = audioContextRef.current || new AudioContextClass();
    audioContextRef.current = audioContext;

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const startAt = audioContext.currentTime;
    [0, 0.12].forEach((offset, index) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(index === 0 ? 880 : 1174, startAt + offset);
      gainNode.gain.setValueAtTime(0.0001, startAt + offset);
      gainNode.gain.exponentialRampToValueAtTime(0.08, startAt + offset + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.18);

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start(startAt + offset);
      oscillator.stop(startAt + offset + 0.2);
    });
  } catch {
    // Ignore browser audio restrictions and keep the app functional.
  }
}

function formatChangedFieldLabel(field) {
  const labels = {
    productName: "Product name updated",
    category: "Category changed",
    bottleSizeDisplay: "Bottle size changed",
    price: "Price changed",
    newBadge: "New badge changed",
    sourcedCertifiedBadge: "Sourced & Certified badge changed",
    isPurchasableFromListingPage: "Purchasable status changed",
    soldOutIndicatorPresent: "Sold-out status changed",
    buttonStatesShown: "Buttons shown changed",
  };

  return labels[field] || field;
}

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

function isHotItem(hotItems, productId) {
  return hotItems.some((item) => item.productId === productId);
}

function App() {
  const [data, setData] = useState(null);
  const [previousSnapshot, setPreviousSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("Preparing first scan...");
  const [lastCompletedScanAt, setLastCompletedScanAt] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [purchasableFilter, setPurchasableFilter] = useState("All");
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [changeAlert, setChangeAlert] = useState(null);
  const [changeFeed, setChangeFeed] = useState(createEmptyChangeFeed());
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const [hotItems, setHotItems] = useState([]);
  const [hotStorageConfigured, setHotStorageConfigured] = useState(false);
  const [hotStorageMessage, setHotStorageMessage] = useState("");
  const [activePage, setActivePage] = useState("listings");
  const [hotFilter, setHotFilter] = useState("All");
  const loadingRef = useRef(false);
  const dataRef = useRef(null);
  const runScanRef = useRef(null);
  const audioContextRef = useRef(null);
  const previousAlertSignatureRef = useRef("");

  const runScan = async (mode = "manual") => {
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError("");
    setCountdown(AUTO_REFRESH_SECONDS);
    setStatusMessage(
      dataRef.current
        ? mode === "auto"
          ? "Automatic refresh running..."
          : "Refreshing live shop data..."
        : "Running first live scan...",
    );

    try {
      const previous = readPreviousSnapshot();
      const response = await fetch("/api/scan", { cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      let payload;

      if (contentType.includes("application/json")) {
        payload = await response.json();
      } else {
        const text = await response.text();
        throw new Error(`Scan endpoint returned non-JSON content: ${text.slice(0, 160)}`);
      }

      if (!response.ok) {
        throw new Error(payload.message || "Scan failed.");
      }

      const currentData = dataRef.current;
      const detectedAt = payload.scannedAt || new Date().toISOString();

      if (!currentData?.products?.length) {
        if (payload.products?.length) {
          setChangeFeed((previousFeed) => ({
            ...previousFeed,
            added: mergeChangeItems(
              previousFeed.added,
              buildAddedItems(payload.products, detectedAt),
              (item) => item.productId,
            ),
          }));

          setChangeAlert({
            detectedAt,
            added: payload.products.length,
            removed: 0,
            changed: 0,
            totalChanges: payload.products.length,
          });
        }
      } else {
        const liveDiff = diffSnapshots(currentData.products || [], payload.products || []);
        const totalChanges = liveDiff.added.length + liveDiff.removed.length + liveDiff.changed.length;

        if (totalChanges > 0) {
          setChangeFeed((previousFeed) => ({
            added: mergeChangeItems(
              previousFeed.added,
              buildAddedItems(liveDiff.added, detectedAt),
              (item) => item.productId,
            ),
            changed: mergeChangeItems(
              previousFeed.changed,
              liveDiff.changed.map((item) => ({
                productId: item.productName,
                productName: item.productName,
                fields: item.fields,
                detectedAt,
              })),
              (item) => item.productId,
            ),
            removed: mergeChangeItems(
              previousFeed.removed,
              liveDiff.removed.map((item) => ({
                productId: item.productId || item.productName,
                productName: item.productName,
                detectedAt,
              })),
              (item) => item.productId,
            ),
          }));
        }

        if (totalChanges > 0) {
          setChangeAlert({
            detectedAt,
            added: liveDiff.added.length,
            removed: liveDiff.removed.length,
            changed: liveDiff.changed.length,
            totalChanges,
          });
        }
      }

      setPreviousSnapshot(previous);
      setData(payload);
      saveSnapshot(payload);
      setLastCompletedScanAt(payload.scannedAt || new Date().toISOString());
      setStatusMessage("Scan complete. Results refreshed.");
    } catch (scanError) {
      setError(scanError.message || "Scan failed.");
      setStatusMessage("Scan failed. Showing the most recent available data.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const loadHotItems = async () => {
    const response = await fetch("/api/hot-items", { cache: "no-store" });
    const payload = await response.json();

    setHotStorageConfigured(Boolean(payload.storageConfigured));
    setHotStorageMessage(payload.message || "");
    setHotItems(payload.items || []);

    if (!response.ok) {
      throw new Error(payload.message || "Unable to load hot items.");
    }
  };

  const syncHotItem = async (item, shouldBeHot) => {
    const response = await fetch("/api/hot-items", {
      method: shouldBeHot ? "POST" : "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        shouldBeHot
          ? {
              productId: item.productId || item.productName,
              productName: item.productName,
              category: item.category,
              bottleSizeDisplay: item.bottleSizeDisplay,
              price: item.price,
              isPurchasableFromListingPage: item.isPurchasableFromListingPage,
            }
          : {
              productId: item.productId || item.productName,
            },
      ),
    });

    const payload = await response.json();
    setHotStorageConfigured(Boolean(payload.storageConfigured));
    setHotStorageMessage(payload.message || "");
    setHotItems(payload.items || []);

    if (!response.ok) {
      throw new Error(payload.message || "Failed to update hot items.");
    }
  };

  useEffect(() => {
    runScan();
    loadHotItems().catch((loadError) => {
      setHotStorageConfigured(false);
      setHotStorageMessage(loadError.message || "Unable to load hot items.");
    });
  }, []);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    runScanRef.current = runScan;
  }, [data, loading, changeFeed]);

  useEffect(() => {
    if (!changeAlert) {
      previousAlertSignatureRef.current = "";
      return;
    }

    const signature = JSON.stringify(changeAlert);
    if (signature !== previousAlertSignatureRef.current) {
      playNotificationSound(audioContextRef);
      previousAlertSignatureRef.current = signature;
    }
  }, [changeAlert]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdown((previousValue) => {
        if (loadingRef.current) {
          return previousValue;
        }

        if (previousValue <= 1) {
          if (runScanRef.current) {
            runScanRef.current("auto");
          }
          return AUTO_REFRESH_SECONDS;
        }

        return previousValue - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const categories = useMemo(() => {
    if (!data?.products) {
      return [];
    }

    return Array.from(
      new Set(
        data.products
          .map((item) => item.category)
          .filter((value) => value && value !== "Not Shown"),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }, [data]);

  const filteredProducts = useMemo(() => {
    const products = data?.products || [];

    return products.filter((item) => {
      const matchesCategory = categoryFilter === "All" || item.category === categoryFilter;
      const matchesPurchasable =
        purchasableFilter === "All" ||
        (purchasableFilter === "Yes" && item.isPurchasableFromListingPage) ||
        (purchasableFilter === "No" && !item.isPurchasableFromListingPage);
      const itemKey = item.productId || item.productName;
      const matchesHot =
        hotFilter === "All" ||
        (hotFilter === "Hot" && hotItems.some((hotItem) => hotItem.productId === itemKey)) ||
        (hotFilter === "Not Hot" && !hotItems.some((hotItem) => hotItem.productId === itemKey));

      return matchesCategory && matchesPurchasable && matchesHot;
    });
  }, [categoryFilter, purchasableFilter, hotFilter, data, hotItems]);

  const notPurchasableCount = useMemo(() => {
    return (data?.products || []).filter((item) => !item.isPurchasableFromListingPage).length;
  }, [data]);

  const hotProducts = useMemo(() => {
    return hotItems;
  }, [hotItems]);

  const changeCounts = useMemo(
    () => ({
      added: changeFeed.added.length,
      changed: changeFeed.changed.length,
      removed: changeFeed.removed.length,
    }),
    [changeFeed],
  );

  const dismissChangeItem = (section, productId) => {
    setChangeFeed((previousFeed) => ({
      ...previousFeed,
      [section]: previousFeed[section].filter((item) => item.productId !== productId),
    }));
  };

  const clearChangeSection = (section) => {
    setChangeFeed((previousFeed) => ({
      ...previousFeed,
      [section]: [],
    }));
  };

  const clearAllChanges = () => {
    setChangeFeed(createEmptyChangeFeed());
    setChangeAlert(null);
  };

  const toggleHotItem = (item) => {
    const itemKey = item.productId || item.productName;
    const alreadyHot = hotItems.some((hotItem) => hotItem.productId === itemKey);

    syncHotItem(item, !alreadyHot).catch((syncError) => {
      setError(syncError.message || "Failed to update hot items.");
    });
  };

  const openChanges = () => {
    const target = document.getElementById("what-changed");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return html`
    <main className="app-shell">
      ${changeAlert
        ? html`
            <div className="change-toast" role="status" aria-live="polite">
              <button className="change-toast-close" onClick=${() => setChangeAlert(null)} aria-label="Close alert">
                Close
              </button>
              <div className="change-toast-title">Changes detected in the latest scan</div>
              <div className="change-toast-copy">
                ${changeAlert.totalChanges} update${changeAlert.totalChanges === 1 ? "" : "s"} found:
                ${changeAlert.added} added, ${changeAlert.changed} changed, ${changeAlert.removed} removed.
              </div>
              <div className="change-toast-actions">
                <button className="button button-secondary" onClick=${openChanges}>View changes</button>
                <button className="button button-primary" onClick=${clearAllChanges}>Mark as read</button>
              </div>
            </div>
          `
        : null}
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
            <button
              className="button button-secondary"
              onClick=${() => setActivePage(activePage === "listings" ? "hot-manager" : "listings")}
            >
              ${activePage === "listings" ? "Manage hot items" : "Back to listings"}
            </button>
            <a className="button button-secondary" href="https://theabcvault.com/shop/" target="_blank" rel="noreferrer">
              Open source page
            </a>
          </div>
          <div className="scan-meta">
            <div className=${`scan-status ${loading ? "scan-status-running" : "scan-status-idle"}`}>
              <span className="scan-status-dot"></span>
              <span>${statusMessage}</span>
            </div>
            <div className="countdown-row">
              <strong>Next auto refresh:</strong>
              <span>${loading ? "Waiting for current scan..." : `${countdown}s`}</span>
            </div>
            <div><strong>Current scan:</strong> ${formatScanTime(data?.scannedAt)}</div>
            <div><strong>Previous snapshot:</strong> ${formatScanTime(previousSnapshot?.scannedAt)}</div>
            <div><strong>Last completed refresh:</strong> ${formatScanTime(lastCompletedScanAt)}</div>
            <div><strong>Source:</strong> ${data?.sourceUrl || "https://theabcvault.com/shop/"}</div>
            <div><strong>Hot item storage:</strong> ${hotStorageConfigured ? "Connected to Postgres" : "Not connected"}</div>
            ${hotStorageMessage ? html`<div><strong>Hot item note:</strong> ${hotStorageMessage}</div>` : null}
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">${data?.productCount ?? "0"}</div>
            <div className="stat-label">Products currently listed</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">${hotItems.length}</div>
            <div className="stat-label">Hot items</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">${notPurchasableCount}</div>
            <div className="stat-label">Not purchasable on listing page</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">${changeCounts.added}</div>
            <div className="stat-label">Unread added items</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">${changeCounts.changed + changeCounts.removed}</div>
            <div className="stat-label">Unread changed or removed</div>
          </div>
        </div>
      </section>

      ${error ? html`<section className="surface"><div className="error-state">${error}</div></section>` : null}

      <section className="surface changes-surface" id="what-changed">
        <div className="surface-header">
          <div>
            <h2 className="section-title">What Changed</h2>
            <p className="section-note">New items stay here until the user dismisses them individually or clears a section.</p>
          </div>
          <div className="changes-actions">
            <button className="button button-secondary" onClick=${() => setChangesCollapsed((value) => !value)}>
              ${changesCollapsed ? "Expand" : "Collapse"}
            </button>
            <button className="button button-secondary" onClick=${clearAllChanges}>Mark all as read</button>
          </div>
        </div>
        ${changesCollapsed
          ? html`<div className="empty-state">Change inbox collapsed. Expand to review added, changed, and removed items.</div>`
          : changeCounts.added || changeCounts.changed || changeCounts.removed
            ? html`
                <div className="diff-columns">
                  <div className="diff-column">
                    <div className="change-column-header">
                      <h3>Added</h3>
                      <button className="text-button" onClick=${() => clearChangeSection("added")}>Clear all</button>
                    </div>
                    ${changeFeed.added.length
                      ? html`
                          <ul className="plain-list plain-list-tight">
                            ${changeFeed.added.map(
                              (item) => html`
                                <li className="change-item-row">
                                  <div className="change-item-content">
                                    <strong>${item.productName}</strong>
                                    <div className="change-item-meta">${formatScanTime(item.detectedAt)}</div>
                                  </div>
                                  <button
                                    className="text-button"
                                    onClick=${() => dismissChangeItem("added", item.productId)}
                                  >
                                    Mark read
                                  </button>
                                </li>
                              `,
                            )}
                          </ul>
                        `
                      : html`<div className="empty-state">No unread added listings.</div>`}
                  </div>
                  <div className="diff-column">
                    <div className="change-column-header">
                      <h3>Changed</h3>
                      <button className="text-button" onClick=${() => clearChangeSection("changed")}>Clear all</button>
                    </div>
                    ${changeFeed.changed.length
                      ? html`
                          <ul className="plain-list plain-list-tight">
                            ${changeFeed.changed.map(
                              (item) => html`
                                <li className="change-item-row">
                                  <div className="change-item-content">
                                    <strong>${item.productName}</strong>
                                    <div className="change-item-meta">
                                      ${formatScanTime(item.detectedAt)} | ${item.fields
                                        .map((field) => formatChangedFieldLabel(field))
                                        .join(", ")}
                                    </div>
                                  </div>
                                  <button
                                    className="text-button"
                                    onClick=${() => dismissChangeItem("changed", item.productId)}
                                  >
                                    Mark read
                                  </button>
                                </li>
                              `,
                            )}
                          </ul>
                        `
                      : html`<div className="empty-state">No unread field-level changes.</div>`}
                  </div>
                  <div className="diff-column">
                    <div className="change-column-header">
                      <h3>Removed</h3>
                      <button className="text-button" onClick=${() => clearChangeSection("removed")}>Clear all</button>
                    </div>
                    ${changeFeed.removed.length
                      ? html`
                          <ul className="plain-list plain-list-tight">
                            ${changeFeed.removed.map(
                              (item) => html`
                                <li className="change-item-row">
                                  <div className="change-item-content">
                                    <strong>${item.productName}</strong>
                                    <div className="change-item-meta">${formatScanTime(item.detectedAt)}</div>
                                  </div>
                                  <button
                                    className="text-button"
                                    onClick=${() => dismissChangeItem("removed", item.productId)}
                                  >
                                    Mark read
                                  </button>
                                </li>
                              `,
                            )}
                          </ul>
                        `
                      : html`<div className="empty-state">No unread removals.</div>`}
                  </div>
                </div>
              `
            : html`<div className="empty-state">Changes will appear here after later scans detect something new.</div>`}
      </section>

      ${activePage === "hot-manager"
        ? html`
            <section className="surface manager-surface">
              <div className="surface-header">
                <div>
                  <h2 className="section-title">Hot Item Manager</h2>
                  <p className="section-note">
                    Mark products as hot here or from the current listings page. Hot status is stored in Vercel
                    Postgres when the database is connected.
                  </p>
                  ${hotStorageMessage ? html`<p className="section-note">${hotStorageMessage}</p>` : null}
                </div>
              </div>
              ${hotProducts.length
                ? html`
                    <div className="manager-list">
                      ${hotProducts.map(
                        (item) => html`
                          <article className="manager-card" key=${`hot-${item.productId || item.productName}`}>
                            <div className="manager-card-head">
                              <div>
                                <div className="manager-kicker">Hot item</div>
                                <h3 className="manager-title">${item.productName}</h3>
                              </div>
                              <button className="button button-secondary" onClick=${() => toggleHotItem(item)} disabled=${!hotStorageConfigured}>
                                Remove hot
                              </button>
                            </div>
                            <div className="manager-meta">
                              <span>${item.category || "Not shown"}</span>
                              <span>${item.bottleSizeDisplay || "Not shown"}</span>
                              <span>${item.price || "Not shown"}</span>
                              <span>${item.isPurchasableFromListingPage ? "Purchasable" : "Not purchasable"}</span>
                            </div>
                          </article>
                        `,
                      )}
                    </div>
                  `
                : html`<div className="empty-state">${hotStorageConfigured ? "No hot items yet. Mark items as hot from the current listings page." : "Connect Vercel Postgres to start saving hot items permanently."}</div>`}
            </section>
          `
        : html`
            <section className="table-shell">
        ${loading
          ? html`
              <div className="loading-banner">
                <div className="loading-banner-title">Live scan in progress</div>
                <div className="loading-banner-copy">
                  ${data
                    ? "Keeping the current table visible while the latest results load."
                    : "Pulling the first live dataset from the shop page now."}
                </div>
              </div>
            `
          : null}
        <div className="table-toolbar">
          <div>
            <h2 className="section-title">Current Listings</h2>
            <p className="section-note">
              Showing ${filteredProducts.length} of ${data?.products?.length || 0} products from the latest scan.
            </p>
          </div>
          <div className="filters">
            <label className="filter-control">
              <span className="filter-label">Category</span>
              <select value=${categoryFilter} onChange=${(event) => setCategoryFilter(event.target.value)}>
                <option value="All">All</option>
                ${categories.map((category) => html`<option value=${category}>${category}</option>`)}
              </select>
            </label>
            <label className="filter-control">
              <span className="filter-label">Purchasable</span>
              <select value=${purchasableFilter} onChange=${(event) => setPurchasableFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </label>
            <label className="filter-control">
              <span className="filter-label">Hot Items</span>
              <select value=${hotFilter} onChange=${(event) => setHotFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Hot">Hot only</option>
                <option value="Not Hot">Not hot</option>
              </select>
            </label>
          </div>
        </div>
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
                <th>Hot</th>
              </tr>
            </thead>
            <tbody>
              ${filteredProducts.map(
                (item) => html`
                  <tr key=${item.productId || `${item.pageNumber}-${item.lineItemNumber}`}>
                    <td>${item.pageNumber}</td>
                    <td>${item.lineItemNumber}</td>
                    <td className="name-cell">
                      <div className="product-name-wrap">
                        <span>${item.productName}</span>
                        ${isHotItem(hotItems, item.productId || item.productName) ? html`<span className="hot-badge" aria-label="Hot item">🔥</span>` : null}
                      </div>
                    </td>
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
                    <td>
                      <button className="button button-secondary button-small" onClick=${() => toggleHotItem(item)} disabled=${!hotStorageConfigured}>
                        ${isHotItem(hotItems, item.productId || item.productName) ? "Remove hot" : "Mark hot"}
                      </button>
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-listings">
          ${filteredProducts.map(
            (item) => html`
              <article className="mobile-card" key=${`mobile-${item.productId || `${item.pageNumber}-${item.lineItemNumber}`}`}>
                <div className="mobile-card-top">
                    <div>
                      <div className="mobile-card-kicker">Page ${item.pageNumber} | Item ${item.lineItemNumber}</div>
                    <h3 className="mobile-card-title">
                      ${item.productName}
                      ${isHotItem(hotItems, item.productId || item.productName) ? html`<span className="hot-badge" aria-label="Hot item">🔥</span>` : null}
                    </h3>
                  </div>
                  ${truthyTag(item.isPurchasableFromListingPage)}
                </div>
                <div className="mobile-card-grid">
                  <div className="mobile-field">
                    <span className="mobile-field-label">Category</span>
                    <span>${item.category || "Not shown"}</span>
                  </div>
                  <div className="mobile-field">
                    <span className="mobile-field-label">Bottle Size</span>
                    <span>${item.bottleSizeMl ?? item.bottleSizeDisplay}</span>
                  </div>
                  <div className="mobile-field">
                    <span className="mobile-field-label">Price</span>
                    <span>${item.price || "Not shown"}</span>
                  </div>
                  <div className="mobile-field">
                    <span className="mobile-field-label">Purchasable</span>
                    <span>${item.isPurchasableFromListingPage ? "Yes" : "No"}</span>
                  </div>
                </div>
                <div className="mobile-card-actions">
                  <button className="button button-secondary button-small" onClick=${() => toggleHotItem(item)} disabled=${!hotStorageConfigured}>
                    ${isHotItem(hotItems, item.productId || item.productName) ? "Remove hot" : "Mark hot"}
                  </button>
                </div>
              </article>
            `,
          )}
        </div>
        <div className="footer-note">
          Fresh runs always hit the live shop endpoint through the server, and the local diff compares only against the
          last successful scan saved in this browser.
        </div>
      </section>
          `}
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);


