// ============================================
//  PARITY SCANNER — Dual Mode + Tick Selector
//  Fetches configurable ticks per market, applies selected mode filter
// ============================================

const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public`;

const MARKETS = [
  { symbol: "R_10",     name: "Volatility 10",      short: "V10",      decimals: 3 },
  { symbol: "R_25",     name: "Volatility 25",      short: "V25",      decimals: 3 },
  { symbol: "R_50",     name: "Volatility 50",      short: "V50",      decimals: 4 },
  { symbol: "R_75",     name: "Volatility 75",      short: "V75",      decimals: 4 },
  { symbol: "R_100",    name: "Volatility 100",     short: "V100",     decimals: 2 },
  { symbol: "1HZ10V",   name: "Volatility 10 (1s)", short: "V10 1s",   decimals: 2 },
  { symbol: "1HZ25V",   name: "Volatility 25 (1s)", short: "V25 1s",   decimals: 2 },
  { symbol: "1HZ50V",   name: "Volatility 50 (1s)", short: "V50 1s",   decimals: 2 },
  { symbol: "1HZ75V",   name: "Volatility 75 (1s)", short: "V75 1s",   decimals: 2 },
  { symbol: "1HZ100V",  name: "Volatility 100 (1s)", short: "V100 1s", decimals: 2 },
];

// DOM
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const scanBtn = document.getElementById("scanBtn");
const scanSub = document.getElementById("scanSub");
const scanningStage = document.getElementById("scanningStage");
const scanMarkets = document.getElementById("scanMarkets");
const scanStatus = document.getElementById("scanStatus");
const resultsStage = document.getElementById("resultsStage");
const signalsGrid = document.getElementById("signalsGrid");
const resultsCount = document.getElementById("resultsCount");
const noSignals = document.getElementById("noSignals");
const breakdownSection = document.getElementById("breakdownSection");
const breakdownGrid = document.getElementById("breakdownGrid");
const modeBtns = document.querySelectorAll(".mode-btn");
const modeDesc = document.getElementById("modeDesc");
const tickSelect = document.getElementById("tickSelect");
const brandTag = document.getElementById("brandTag");

let ws = null;
let reqId = 1;
let isScanning = false;
let currentMode = "overunder";
let currentTicks = 120;
const tickBuffers = {};
const pendingCounts = {};
let wsReady = false;
const wsReadyCallbacks = [];
let lastResults = null;

// ---- TICK SELECT ----
tickSelect.addEventListener("change", () => {
  currentTicks = parseInt(tickSelect.value, 10);
  brandTag.textContent = `${currentTicks}-tick scan · 10 markets`;
  scanSub.textContent = `Connects, fetches ${currentTicks} ticks per market, and applies the selected parity filter.`;
});

// ---- MODE SWITCH ----
modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;

    if (currentMode === "overunder") {
      modeDesc.innerHTML = "<strong>Over/Under Mode:</strong> Signal fires when the top 2 digits are all Even AND the bottom 2 are all Odd (→ UNDER), or the opposite (→ OVER).";
    } else {
      modeDesc.innerHTML = "<strong>Even/Odd Mode:</strong> Signal fires when BOTH the top 2 and bottom 2 digits are all Even (→ EVEN), or BOTH are all Odd (→ ODD).";
    }

    // Re-analyze last results without rescanning
    if (lastResults && lastResults.length > 0) {
      const reanalyzed = lastResults.map((r) => {
        const analysis = analyzeMarket(r.rawTicks, r.market.decimals);
        return { market: r.market, rawTicks: r.rawTicks, analysis };
      });
      displayResults(reanalyzed);
    }
  });
});

// ---- WEBSOCKET ----
function connect() {
  setStatus("connecting", "Connecting…");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("connected", "Ready");
    wsReady = true;
    wsReadyCallbacks.forEach((cb) => cb());
    wsReadyCallbacks.length = 0;
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
      console.warn("Deriv error:", data.error.message || data.error);
      return;
    }
    if (data.msg_type === "history" && data.history) {
      const symbol = data.echo_req.ticks_history;
      const prices = data.history.prices || [];
      if (tickBuffers[symbol]) {
        tickBuffers[symbol].push(...prices.map(parseFloat));
      }
      pendingCounts[symbol] = (pendingCounts[symbol] || 0) - 1;
      if (pendingCounts[symbol] === 0) markChipDone(symbol);
    }
  };

  ws.onerror = () => setStatus("error", "Connection error");
  ws.onclose = () => {
    setStatus("error", "Disconnected");
    wsReady = false;
    setTimeout(connect, 3000);
  };
}

function waitForWsReady() {
  return new Promise((resolve) => {
    if (wsReady && ws && ws.readyState === WebSocket.OPEN) resolve();
    else wsReadyCallbacks.push(resolve);
  });
}

function fetchMarketHistory(symbol, count) {
  return new Promise((resolve) => {
    tickBuffers[symbol] = [];
    pendingCounts[symbol] = 1;

    const timeout = setTimeout(() => {
      pendingCounts[symbol] = 0;
      resolve(tickBuffers[symbol]);
    }, 6000);

    const poll = setInterval(() => {
      if (pendingCounts[symbol] === 0) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve(tickBuffers[symbol]);
      }
    }, 100);

    ws.send(JSON.stringify({
      ticks_history: symbol,
      count: count,
      end: "latest",
      style: "ticks",
      req_id: reqId++,
    }));
  });
}

// ---- HELPERS ----
function setStatus(state, text) {
  statusText.textContent = text;
  statusDot.classList.remove("connected", "error");
  if (state === "connected") statusDot.classList.add("connected");
  if (state === "error") statusDot.classList.add("error");
}

function setChipActive(symbol) {
  const chip = document.getElementById(`chip-${symbol}`);
  if (chip) { chip.classList.add("active"); chip.classList.remove("done"); }
}

function markChipDone(symbol) {
  const chip = document.getElementById(`chip-${symbol}`);
  if (chip) { chip.classList.remove("active"); chip.classList.add("done"); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getLastDigit(quote, decimals) {
  const str = parseFloat(quote).toFixed(decimals);
  return parseInt(str.slice(-1), 10);
}

// ---- ANALYSIS ----
function analyzeMarket(prices, decimals) {
  if (!prices || prices.length < 20) return null;

  const freq = new Array(10).fill(0);
  for (const p of prices) {
    const d = getLastDigit(p, decimals);
    if (Number.isInteger(d) && d >= 0 && d <= 9) freq[d]++;
  }

  const total = freq.reduce((a, b) => a + b, 0);
  if (total < 20) return null;

  const sorted = freq
    .map((count, digit) => ({ digit, count, pct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count || a.digit - b.digit);

  const top2 = sorted.slice(0, 2);
  const bottom2 = sorted.slice(-2).reverse();

  const isEven = (d) => d % 2 === 0;
  const isOdd = (d) => d % 2 === 1;

  const topAllEven = top2.every((x) => isEven(x.digit));
  const topAllOdd = top2.every((x) => isOdd(x.digit));
  const bottomAllEven = bottom2.every((x) => isEven(x.digit));
  const bottomAllOdd = bottom2.every((x) => isOdd(x.digit));

  let signal = null;
  let reason = "";

  if (currentMode === "overunder") {
    if (topAllEven && bottomAllOdd) {
      signal = "under";
      reason = `Top 2 digits (${top2.map(x => x.digit).join(", ")}) are all Even. Bottom 2 (${bottom2.map(x => x.digit).join(", ")}) are all Odd. → UNDER signal.`;
    } else if (topAllOdd && bottomAllEven) {
      signal = "over";
      reason = `Top 2 digits (${top2.map(x => x.digit).join(", ")}) are all Odd. Bottom 2 (${bottom2.map(x => x.digit).join(", ")}) are all Even. → OVER signal.`;
    }
  } else {
    if (topAllEven && bottomAllEven) {
      signal = "even";
      reason = `Top 2 (${top2.map(x => x.digit).join(", ")}) AND bottom 2 (${bottom2.map(x => x.digit).join(", ")}) are all Even. → EVEN signal.`;
    } else if (topAllOdd && bottomAllOdd) {
      signal = "odd";
      reason = `Top 2 (${top2.map(x => x.digit).join(", ")}) AND bottom 2 (${bottom2.map(x => x.digit).join(", ")}) are all Odd. → ODD signal.`;
    }
  }

  return { freq, total, sorted, top2, bottom2, signal, reason };
}

// ---- MAIN SCAN ----
async function runScan() {
  if (isScanning) return;
  isScanning = true;
  scanBtn.disabled = true;
  scanBtn.querySelector(".scan-text").textContent = "SCANNING…";

  setStatus("connecting", "Scanning…");
  resultsStage.classList.remove("show");
  breakdownSection.classList.remove("show");
  scanningStage.classList.add("show");

  scanMarkets.innerHTML = MARKETS.map((m) =>
    `<div class="scan-chip" id="chip-${m.symbol}">${m.short}</div>`
  ).join("");

  await waitForWsReady();

  const histories = {};
  for (const m of MARKETS) {
    if (!ws || ws.readyState !== WebSocket.OPEN) break;
    setChipActive(m.symbol);
    scanStatus.textContent = `Fetching ${m.short} history (${currentTicks} ticks)…`;
    const ticks = await fetchMarketHistory(m.symbol, currentTicks);
    histories[m.symbol] = ticks;
    await sleep(80);
  }

  scanStatus.textContent = "Analyzing…";
  await sleep(300);
  scanningStage.classList.remove("show");

  const results = [];
  for (const m of MARKETS) {
    const ticks = histories[m.symbol] || [];
    const analysis = analyzeMarket(ticks, m.decimals);
    if (analysis) {
      results.push({ market: m, rawTicks: ticks, analysis });
    }
  }

  lastResults = results;
  displayResults(results);

  isScanning = false;
  scanBtn.disabled = false;
  scanBtn.querySelector(".scan-text").textContent = "SCAN AGAIN";
  scanSub.textContent = `Scanned ${results.length} markets · ${currentTicks} ticks · ${new Date().toLocaleTimeString()}`;
}

// ---- DISPLAY RESULTS ----
function displayResults(results) {
  const signals = results.filter((r) => r.analysis.signal !== null);

  resultsStage.classList.add("show");
  breakdownSection.classList.add("show");

  resultsCount.textContent = signals.length;

  if (signals.length === 0) {
    signalsGrid.innerHTML = "";
    noSignals.style.display = "block";
  } else {
    noSignals.style.display = "none";
    signalsGrid.innerHTML = signals.map((r) => {
      const sig = r.analysis;
      const sigClass = sig.signal;
      const sigLabel = sig.signal.toUpperCase();

      const topDigits = sig.top2.map((x) =>
        `<span class="digit-pill top ${x.digit % 2 === 0 ? "even" : "odd"}">${x.digit} · ${x.pct.toFixed(1)}%</span>`
      ).join("");
      const bottomDigits = sig.bottom2.map((x) =>
        `<span class="digit-pill ${x.digit % 2 === 0 ? "even" : "odd"}">${x.digit} · ${x.pct.toFixed(1)}%</span>`
      ).join("");

      return `
        <div class="signal-card ${sigClass}">
          <div class="signal-market">${r.market.short}</div>
          <div class="signal-market-sub">${r.market.name} · ${sig.total} ticks</div>
          <div class="signal-badge ${sigClass}">${sigLabel}</div>
          <div class="signal-digits">
            <span class="digit-pill" style="background: transparent; border: none; color: var(--muted); padding-left: 0;">Top:</span>
            ${topDigits}
          </div>
          <div class="signal-digits">
            <span class="digit-pill" style="background: transparent; border: none; color: var(--muted); padding-left: 0;">Low:</span>
            ${bottomDigits}
          </div>
          <div class="signal-reason">${sig.reason}</div>
        </div>
      `;
    }).join("");
  }

  breakdownGrid.innerHTML = results.map((r) => {
    const sig = r.analysis;
    const cardClass = sig.signal ? `signal-${sig.signal}` : "";

    const topDigits = sig.top2.map((x) =>
      `<span class="bd-digit ${x.digit % 2 === 0 ? "even" : "odd"}">${x.digit}</span>`
    ).join("");
    const bottomDigits = sig.bottom2.map((x) =>
      `<span class="bd-digit ${x.digit % 2 === 0 ? "even" : "odd"}">${x.digit}</span>`
    ).join("");

    return `
      <div class="breakdown-card ${cardClass}">
        <div class="bd-header">
          <span class="bd-market">${r.market.short}</span>
          <span class="bd-tick">${sig.total} ticks</span>
        </div>
        <div class="bd-row">
          <span class="bd-label">Top 2</span>
          <div class="bd-digits">${topDigits}</div>
        </div>
        <div class="bd-row">
          <span class="bd-label">Low 2</span>
          <div class="bd-digits">${bottomDigits}</div>
        </div>
        ${sig.signal ? `<div style="font-size:0.75rem; color: ${sig.signal === 'over' || sig.signal === 'even' ? 'var(--green)' : 'var(--red)'}; font-weight:700; margin-top:0.4rem;">⚡ ${sig.signal.toUpperCase()} SIGNAL</div>` : ''}
      </div>
    `;
  }).join("");
}

// ---- BOOT ----
connect();
scanBtn.addEventListener("click", runScan);