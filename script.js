// ============================================
//  EVEN/ODD DOMINANCE SCANNER
//  Scans 120 ticks per market across 10 volatility indices
//  Signals only when top 2 are same parity AND bottom 2 are opposite parity
// ============================================

const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public`;
const TICKS_TO_FETCH = 120;

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

let ws = null;
let reqId = 1;
let isScanning = false;
const tickBuffers = {};
const pendingCounts = {};
let wsReady = false;
const wsReadyCallbacks = [];

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

// ---- FETCH HISTORY ----
function fetchMarketHistory(symbol) {
  return new Promise((resolve) => {
    tickBuffers[symbol] = [];
    pendingCounts[symbol] = 1;

    const timeout = setTimeout(() => {
      pendingCounts[symbol] = 0;
      resolve(tickBuffers[symbol]);
    }, 4000);

    const poll = setInterval(() => {
      if (pendingCounts[symbol] === 0) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve(tickBuffers[symbol]);
      }
    }, 100);

    ws.send(JSON.stringify({
      ticks_history: symbol,
      count: TICKS_TO_FETCH,
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

// ---- DIGIT EXTRACTION ----
function getLastDigit(quote, decimals) {
  const str = parseFloat(quote).toFixed(decimals);
  return parseInt(str.slice(-1), 10);
}

// ---- ANALYSIS ----
// Returns the digit frequency distribution and the analysis
function analyzeMarket(prices, decimals) {
  if (!prices || prices.length < 20) return null;

  const freq = new Array(10).fill(0);
  for (const p of prices) {
    const d = getLastDigit(p, decimals);
    if (Number.isInteger(d) && d >= 0 && d <= 9) freq[d]++;
  }

  const total = freq.reduce((a, b) => a + b, 0);
  if (total < 20) return null;

  // Sort digits by frequency (descending)
  const sorted = freq
    .map((count, digit) => ({ digit, count, pct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count || a.digit - b.digit);

  const top2 = sorted.slice(0, 2);
  const bottom2 = sorted.slice(-2).reverse(); // least frequent first

  // Determine parity
  const isEven = (d) => d % 2 === 0;
  const isOdd = (d) => d % 2 === 1;

  const topAllEven = top2.every((x) => isEven(x.digit));
  const topAllOdd = top2.every((x) => isOdd(x.digit));
  const bottomAllEven = bottom2.every((x) => isEven(x.digit));
  const bottomAllOdd = bottom2.every((x) => isOdd(x.digit));

  let signal = null;
  let reason = "";

  if (topAllEven && bottomAllOdd) {
    signal = "under";
    reason = `Top 2 digits (${top2.map(x => x.digit).join(", ")}) are all Even. Bottom 2 digits (${bottom2.map(x => x.digit).join(", ")}) are all Odd. → UNDER signal.`;
  } else if (topAllOdd && bottomAllEven) {
    signal = "over";
    reason = `Top 2 digits (${top2.map(x => x.digit).join(", ")}) are all Odd. Bottom 2 digits (${bottom2.map(x => x.digit).join(", ")}) are all Even. → OVER signal.`;
  }

  return {
    freq,
    total,
    sorted,
    top2,
    bottom2,
    signal,
    reason,
  };
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
    scanStatus.textContent = `Fetching ${m.short} history…`;
    const ticks = await fetchMarketHistory(m.symbol);
    histories[m.symbol] = ticks;
    await sleep(80);
  }

  scanStatus.textContent = "Analyzing…";
  await sleep(300);
  scanningStage.classList.remove("show");

  // Analyze each market
  const results = [];
  for (const m of MARKETS) {
    const ticks = histories[m.symbol] || [];
    const analysis = analyzeMarket(ticks, m.decimals);
    if (analysis) {
      results.push({ market: m, analysis });
    }
  }

  displayResults(results);

  isScanning = false;
  scanBtn.disabled = false;
  scanBtn.querySelector(".scan-text").textContent = "SCAN AGAIN";
  scanSub.textContent = `Scanned ${results.length} markets · ${new Date().toLocaleTimeString()}`;
}

// ---- DISPLAY RESULTS ----
function displayResults(results) {
  const signals = results.filter((r) => r.analysis.signal !== null);

  // Show results stage
  resultsStage.classList.add("show");
  breakdownSection.classList.add("show");

  // Update count
  resultsCount.textContent = signals.length;

  // Render signals grid
  if (signals.length === 0) {
    signalsGrid.innerHTML = "";
    noSignals.style.display = "block";
  } else {
    noSignals.style.display = "none";
    signalsGrid.innerHTML = signals.map((r) => {
      const sig = r.analysis;
      const isOver = sig.signal === "over";
      const sigClass = isOver ? "over" : "under";
      const sigLabel = isOver ? "OVER" : "UNDER";

      const topDigits = sig.top2.map((x) =>
        `<span class="digit-pill top ${x.digit % 2 === 0 ? "even" : "odd"}">${x.digit} · ${x.pct.toFixed(1)}%</span>`
      ).join("");
      const bottomDigits = sig.bottom2.map((x) =>
        `<span class="digit-pill ${x.digit % 2 === 0 ? "even" : "odd"}">${x.digit} · ${x.pct.toFixed(1)}%</span>`
      ).join("");

      return `
        <div class="signal-card ${sigClass}">
          <div class="signal-market">${r.market.short}</div>
          <div class="signal-market-sub">${r.market.name}</div>
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

  // Render breakdown
  breakdownGrid.innerHTML = results.map((r) => {
    const sig = r.analysis;
    const cardClass = sig.signal === "over" ? "signal-over" : sig.signal === "under" ? "signal-under" : "";

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
        ${sig.signal ? `<div style="font-size:0.75rem; color: ${sig.signal === 'over' ? 'var(--green)' : 'var(--red)'}; font-weight:700; margin-top:0.4rem;">⚡ ${sig.signal.toUpperCase()} SIGNAL</div>` : ''}
      </div>
    `;
  }).join("");
}

// ---- BOOT ----
connect();
scanBtn.addEventListener("click", runScan);