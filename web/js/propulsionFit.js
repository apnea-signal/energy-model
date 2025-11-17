import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip, formatSeconds } from "./utils.js";

const CACHE_BUST_TOKEN = Date.now().toString(36);
const DATA_URL = withCacheBust("../data/dashboard_data/05_propulsion_fit.json");
const PARAMETER_ORDER = [
  "wall_push_o2_cost",
  "arm_o2_cost",
  "leg_o2_cost",
  "dolphin_o2_cost",
  "static_o2_rate",
];
const PARAMETER_LABELS = {
  wall_push_o2_cost: "Wall push O₂ cost",
  arm_o2_cost: "Arm stroke O₂ cost",
  leg_o2_cost: "Leg kick O₂ cost",
  dolphin_o2_cost: "Dolphin O₂ cost",
  static_o2_rate: "Static metabolic rate",
};

const PARAMETER_SYMBOLS = {
  wall_push_o2_cost: "P_w",
  arm_o2_cost: "P_a",
  leg_o2_cost: "P_l",
  dolphin_o2_cost: "P_d",
  static_o2_rate: "R_s",
};

const PARAMETER_DESCRIPTIONS = {
  wall_push_o2_cost: "O₂ per intensity-scaled wall push (one per turn).",
  arm_o2_cost: "O₂ per arm cycle after intensity scaling.",
  leg_o2_cost: "O₂ per single-leg kick (stroke + post-push).",
  dolphin_o2_cost: "O₂ per stabilizing dolphin kick.",
  static_o2_rate: "Baseline O₂ draw multiplied by swim duration.",
};

const FORMULA_ROWS = [
  {
    symbol: "I",
    label: "Movement intensity",
    description: "Athlete-specific scalar from Step 1 applied to each propulsion count.",
  },
  ...PARAMETER_ORDER.map((key) => ({
    symbol: PARAMETER_SYMBOLS[key] || "",
    label: PARAMETER_LABELS[key] || key,
    description: PARAMETER_DESCRIPTIONS[key] || "",
  })),
  {
    symbol: "N_*",
    label: "Movement counts",
    description: "Per-attempt wall, arm, leg, and dolphin counts sourced from the DNF annotations.",
  },
  {
    symbol: "T",
    label: "Swim duration",
    description: "Total attempt time (seconds) used for the static metabolic term.",
  },
];

const datasetMenu = document.getElementById("datasetMenu");
const datasetLabelEl = document.getElementById("datasetLabel");
const formulaNoteEl = document.getElementById("formulaNote");
const formulaParametersEl = document.getElementById("formulaParameters");
const manualControlsEl = document.getElementById("manualControls");
const manualMetricsEl = document.getElementById("manualMetrics");
const metricsGridEl = document.getElementById("metricsGrid");
const metricsNoteEl = document.getElementById("metricsNote");
const parameterTableEl = document.getElementById("parameterTable");
const parameterNoteEl = document.getElementById("parameterNote");
const scatterEl = document.getElementById("fitScatter");
const scatterNoteEl = document.getElementById("scatterNote");
const attemptTableEl = document.getElementById("attemptTable");

const state = {
  payload: {},
  datasets: [],
  dataset: null,
  entry: null,
  attempts: [],
  manualParams: {},
  manualAttempts: [],
  manualMetrics: null,
};

let attemptSort = { key: "absResidual", direction: "descending" };

init();

async function init() {
  try {
    const payload = await fetchJson(DATA_URL);
    state.payload = payload || {};
    state.datasets = Object.keys(state.payload).sort();
    if (!state.datasets.length) {
      renderError(`No datasets found in ${DATA_URL}`);
      return;
    }
    renderDatasetNav();
    setDataset(state.datasets[0]);
  } catch (error) {
    renderError(`Failed to load ${DATA_URL}: ${error.message}`);
  }
}

function renderDatasetNav() {
  if (!datasetMenu) {
    return;
  }
  datasetMenu.textContent = "";
  state.datasets.forEach((dataset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dataset-link";
    button.dataset.dataset = dataset;
    button.textContent = dataset;
    button.addEventListener("click", () => {
      if (dataset !== state.dataset) {
        setDataset(dataset);
      }
    });
    datasetMenu.appendChild(button);
  });
}

function setDataset(dataset) {
  const entry = state.payload[dataset];
  if (!entry) {
    renderError(`Dataset ${dataset} missing in payload`);
    return;
  }
  state.dataset = dataset;
  state.entry = entry;
  state.attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
  updateDatasetNavState();
  renderFormula();
  renderSummary();
  renderParameters();
  initializeManualFit();
}

function updateDatasetNavState() {
  if (!datasetMenu) {
    return;
  }
  Array.from(datasetMenu.querySelectorAll(".dataset-link")).forEach((button) => {
    const isActive = button.dataset.dataset === state.dataset;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.setAttribute("tabindex", isActive ? "0" : "-1");
  });
}

function renderSummary() {
  const metrics = state.entry?.metrics || {};
  const attempts = state.attempts.length;
  const labelParts = [];
  if (state.dataset) {
    labelParts.push(state.dataset);
  }
  if (attempts) {
    labelParts.push(`${attempts} attempts`);
  }
  datasetLabelEl.textContent = labelParts.join(" · ");

  const stats = [
    {
      label: "Attempts",
      value: Number(metrics.attempts ?? attempts),
      detail: "Swims with STA + movement overlap",
      formatter: (value) => value || 0,
    },
    {
      label: "Mean abs error",
      value: metrics.mean_abs_error_s,
      detail: "Average |prediction - STA| (s)",
      formatter: (value) => formatNumber(value, 1, "s"),
    },
    {
      label: "Median abs error",
      value: metrics.median_abs_error_s,
      detail: "Median |prediction - STA| (s)",
      formatter: (value) => formatNumber(value, 1, "s"),
    },
    {
      label: "Max abs error",
      value: metrics.max_abs_error_s,
      detail: "Worst miss in the dataset",
      formatter: (value) => formatNumber(value, 1, "s"),
    },
    {
      label: "Mean abs % error",
      value: metrics.mean_abs_pct_error,
      detail: "Relative to the STA oxygen budget",
      formatter: (value) => formatPercent(value),
    },
  ];

  metricsGridEl.textContent = "";
  stats.forEach((stat) => {
    const card = document.createElement("article");
    card.className = "stat-card";

    const label = document.createElement("p");
    label.className = "stat-label";
    label.textContent = stat.label;

    const value = document.createElement("p");
    value.className = "stat-value";
    value.textContent = stat.formatter(stat.value);

    const detail = document.createElement("p");
    detail.className = "stat-detail";
    detail.textContent = stat.detail;

    card.append(label, value, detail);
    metricsGridEl.appendChild(card);
  });

  const negatives = countNegativeParameters(state.entry?.unconstrained_parameters || {});
  metricsNoteEl.innerHTML = `
    <p class="note-lede">How to read these numbers</p>
    <dl>
      <dt>Raw fit</dt>
      <dd>
        Ordinary least squares spanning wall pushes, arms, legs, dolphins, and swim time. ${
          negatives
            ? `${negatives} coefficient${negatives === 1 ? "" : "s"} went negative, suggesting the dataset needs more constraints.`
            : "All coefficients remained positive."
        }
      </dd>
      <dt>Constrained fit</dt>
      <dd>Enforces non-negative costs; these values drive the predictions used throughout the page.</dd>
      <dt>Residuals</dt>
      <dd>Errors stay in seconds; ${formatPercent(metrics.mean_abs_pct_error)} mean relative gap vs the STA PB.</dd>
      <dt>Refresh cadence</dt>
      <dd>Run <code>python 05_fit_DNF_oxygen_model.py</code> whenever STA or DNF annotations change.</dd>
    </dl>
  `;
}

function renderFormula() {
  if (formulaNoteEl) {
    formulaNoteEl.innerHTML = `
      <p class="note-lede">Equation</p>
      <p>
        <code>
          O₂_{total} = I * (P_w N_w + P_a N_a + P_l N_l + P_d N_d) + R_s * T
        </code>
      </p>
      <p>The Step 1 movement intensity multiplies every propulsion term before summing the static draw.</p>
    `;
  }

  if (!formulaParametersEl) {
    return;
  }
  formulaParametersEl.textContent = "";
  const table = document.createElement("table");
  table.className = "standard-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th scope="col">Symbol</th>
      <th scope="col">Parameter</th>
      <th scope="col">Definition</th>
    </tr>
  `;
  const tbody = document.createElement("tbody");
  FORMULA_ROWS.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.symbol}</td>
      <td>${row.label}</td>
      <td>${row.description}</td>
    `;
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  formulaParametersEl.appendChild(table);
}

function initializeManualFit() {
  const defaultParams = state.entry?.parameters || {};
  state.manualParams = { ...defaultParams };
  renderManualControls();
  updateManualFitViews();
}

function renderManualControls() {
  if (!manualControlsEl) {
    return;
  }
  manualControlsEl.textContent = "";
  const params = state.manualParams || {};
  if (!Object.keys(params).length) {
    manualControlsEl.textContent = "No parameters available for manual tuning.";
    return;
  }
  const controlGrid = document.createElement("div");
  controlGrid.className = "manual-control-grid";

  PARAMETER_ORDER.forEach((key) => {
    const wrapper = document.createElement("div");
    wrapper.className = "manual-control";

    const label = document.createElement("label");
    label.className = "manual-control-label";
    label.textContent = PARAMETER_LABELS[key] || key;

    const slider = document.createElement("input");
    slider.type = "range";
    const bounds = sliderBounds(key, params[key]);
    slider.min = bounds.min;
    slider.max = bounds.max;
    slider.step = bounds.step;
    slider.value = Number.isFinite(params[key]) ? params[key] : 0;

    const numberInput = document.createElement("input");
    numberInput.type = "number";
    numberInput.step = "0.01";
    numberInput.value = Number.isFinite(params[key]) ? params[key] : 0;

    slider.addEventListener("input", () => {
      numberInput.value = slider.value;
      updateManualParam(key, Number(slider.value));
    });

    numberInput.addEventListener("change", () => {
      let value = Number(numberInput.value);
      if (!Number.isFinite(value)) {
        value = params[key] || 0;
      }
      if (value < 0) {
        value = 0;
      }
      if (value > Number(slider.max)) {
        slider.max = String(value);
      }
      slider.value = value;
      numberInput.value = value;
      updateManualParam(key, value);
    });

    wrapper.append(label, slider, numberInput);
    controlGrid.appendChild(wrapper);
  });

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "Reset to dataset fit";
  resetButton.className = "button reset-button";
  resetButton.addEventListener("click", () => {
    state.manualParams = { ...(state.entry?.parameters || {}) };
    renderManualControls();
    updateManualFitViews();
  });

  manualControlsEl.append(controlGrid, resetButton);

}

function sliderBounds(key, value) {
  const base = Number.isFinite(value) && value > 0 ? value : 0;
  const min = 0;
  const max = Math.max(5, base * 3 || 10);
  return { min, max, step: 0.05 };
}

function updateManualParam(key, value) {
  if (!Number.isFinite(value)) {
    return;
  }
  state.manualParams = {
    ...state.manualParams,
    [key]: Math.max(0, value),
  };
  updateManualFitViews();
}

function updateManualFitViews() {
  const result = recomputeManualFit();
  state.manualAttempts = result.attempts;
  state.manualMetrics = result.metrics;
  renderManualMetrics();
  renderScatter();
  renderAttemptsTable();
}

function recomputeManualFit() {
  const manualAttempts = (state.attempts || []).map((attempt) => {
    const features = attempt.features || {};
    let prediction = 0;
    PARAMETER_ORDER.forEach((key) => {
      const coeff = Number(state.manualParams?.[key]) || 0;
      const featureValue = Number(features[key]) || 0;
      prediction += coeff * featureValue;
    });
    const residual = prediction - attempt.sta_budget_s;
    return {
      ...attempt,
      prediction_s: prediction,
      residual_s: residual,
    };
  });
  const metrics = computeManualMetrics(manualAttempts);
  return { attempts: manualAttempts, metrics };
}

function renderManualMetrics() {
  if (!manualMetricsEl) {
    return;
  }
  manualMetricsEl.textContent = "";
  const metrics = state.manualMetrics;
  if (!metrics) {
    manualMetricsEl.textContent = "Manual metrics unavailable.";
    return;
  }

  const cards = [
    {
      label: "Fitness (mean abs error)",
      value: formatNumber(metrics.mean_abs_error_s, 2, "s"),
      detail: "Lower is better",
    },
    {
      label: "Median abs error",
      value: formatNumber(metrics.median_abs_error_s, 2, "s"),
      detail: "Half the residuals fall below this",
    },
    {
      label: "Max abs error",
      value: formatNumber(metrics.max_abs_error_s, 2, "s"),
      detail: "Worst miss",
    },
    {
      label: "Mean abs % error",
      value: formatPercent(metrics.mean_abs_pct_error),
      detail: "Relative to STA budget",
    },
  ];

  cards.forEach((card) => {
    const article = document.createElement("article");
    article.className = "stat-card stat-card--compact";

    const label = document.createElement("p");
    label.className = "stat-label";
    label.textContent = card.label;

    const value = document.createElement("p");
    value.className = "stat-value";
    value.textContent = card.value;

    const detail = document.createElement("p");
    detail.className = "stat-detail";
    detail.textContent = card.detail;

    article.append(label, value, detail);
    manualMetricsEl.appendChild(article);
  });

}

function renderParameters() {
  if (!parameterTableEl) {
    return;
  }
  parameterTableEl.textContent = "";
  const raw = state.entry?.unconstrained_parameters || {};
  const constrained = state.entry?.parameters || {};
  const rows = PARAMETER_ORDER.map((key) => ({
    key,
    label: PARAMETER_LABELS[key] || key,
    raw: raw[key],
    fallback: constrained[key],
  }));

  const table = document.createElement("table");
  table.className = "standard-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th scope="col">Parameter</th>
      <th scope="col">Raw fit</th>
      <th scope="col">Constrained</th>
      <th scope="col">Δ</th>
    </tr>
  `;

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const delta = Number.isFinite(row.raw) && Number.isFinite(row.fallback) ? row.raw - row.fallback : NaN;
    tr.innerHTML = `
      <td>${row.label}</td>
      <td style="text-align:right">${formatNumber(row.raw, 4)}</td>
      <td style="text-align:right">${formatNumber(row.fallback, 4)}</td>
      <td style="text-align:right">${formatSignedNumber(delta, 4)}</td>
    `;
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  parameterTableEl.appendChild(table);

  if (parameterNoteEl) {
    const distinct = rows.filter((row) => Math.abs((row.raw || 0) - (row.fallback || 0)) > 1e-6).length;
    parameterNoteEl.innerHTML = `
      <p class="note-lede">Parameter notes</p>
      <dl>
        <dt>Raw vs constrained</dt>
        <dd>${distinct ? `${distinct} parameter(s) shift when enforcing non-negative costs.` : "Both fits match exactly."}</dd>
        <dt>Static rate</dt>
        <dd>The static rate multiplies swim duration directly and usually dominates the prediction.</dd>
        <dt>Component costs</dt>
        <dd>Arm/leg/dolphin coefficients apply to movement counts already scaled by Step 1 intensities.</dd>
      </dl>
    `;
  }
}

function renderScatter() {
  if (!scatterEl) {
    return;
  }
  scatterEl.textContent = "";
  const rows = state.manualAttempts?.length ? state.manualAttempts : state.attempts;
  if (!rows.length) {
    scatterEl.textContent = "No attempt rows available.";
    return;
  }
  const width = scatterEl.clientWidth || 900;
  const height = 420;
  const margin = { top: 20, right: 28, bottom: 56, left: 64 };
  const container = d3.select(scatterEl);
  const tooltip = createChartTooltip(container);
  const svg = container
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Prediction vs STA oxygen budgets");

  const actualDomain = expandDomain(d3.extent(rows, (d) => d.sta_budget_s));
  const predictedDomain = expandDomain(d3.extent(rows, (d) => d.prediction_s));
  const residualExtent = d3.extent(rows, (d) => d.residual_s);
  const distanceExtent = d3.extent(rows, (d) => d.distance_m);

  const xScale = d3.scaleLinear().domain(actualDomain).range([margin.left, width - margin.right]);
  const yScale = d3.scaleLinear().domain(predictedDomain).range([height - margin.bottom, margin.top]);
  const maxResidual = Math.max(Math.abs(residualExtent[0] || 0), Math.abs(residualExtent[1] || 0)) || 1;
  const color = d3
    .scaleLinear()
    .domain([-maxResidual, 0, maxResidual])
    .range(["#22d3ee", "#cbd5f5", "#f97316"])
    .clamp(true);
  const radius = d3
    .scaleLinear()
    .domain(distanceExtent)
    .range([4, 11])
    .clamp(true);

  const xAxis = d3.axisBottom(xScale).ticks(6);
  const yAxis = d3.axisLeft(yScale).ticks(6);

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(xAxis);
  svg
    .append("g")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(yAxis);

  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", height - 12)
    .attr("text-anchor", "middle")
    .attr("class", "axis-label")
    .text("STA PB budget (s)");

  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", 18)
    .attr("text-anchor", "middle")
    .attr("class", "axis-label")
    .text("Model prediction (s)");

  const diagonalStart = Math.max(actualDomain[0], predictedDomain[0]);
  const diagonalEnd = Math.min(actualDomain[1], predictedDomain[1]);
  if (Number.isFinite(diagonalStart) && Number.isFinite(diagonalEnd)) {
    svg
      .append("line")
      .attr("x1", xScale(diagonalStart))
      .attr("y1", yScale(diagonalStart))
      .attr("x2", xScale(diagonalEnd))
      .attr("y2", yScale(diagonalEnd))
      .attr("stroke", "#94a3b8")
      .attr("stroke-dasharray", "6 6");
  }

  svg
    .append("g")
    .attr("class", "scatter-points")
    .selectAll("circle")
    .data(rows)
    .enter()
    .append("circle")
    .attr("cx", (d) => xScale(d.sta_budget_s))
    .attr("cy", (d) => yScale(d.prediction_s))
    .attr("r", (d) => radius(d.distance_m))
    .attr("fill", (d) => color(d.residual_s))
    .attr("opacity", 0.85)
    .on("mouseenter", (event, d) => {
      tooltip?.show(
        event,
        `
          <strong>${d.name}</strong>
          <div>Distance: ${formatNumber(d.distance_m, 1)} m</div>
          <div>STA budget: ${formatSeconds(d.sta_budget_s)}</div>
          <div>Prediction: ${formatSeconds(d.prediction_s)}</div>
          <div>Residual: ${formatSignedNumber(d.residual_s, 1)} s</div>
        `
      );
    })
    .on("mousemove", (event) => tooltip?.move(event))
    .on("mouseleave", () => tooltip?.hide());

  scatterNoteEl.innerHTML = `
    <p class="note-lede">Scatter guide</p>
    <dl>
      <dt>Diagonal</dt>
      <dd>Exact match between the STA budget and the modeled spend.</dd>
      <dt>Color</dt>
      <dd>Blue = model predicts less oxygen than STA; orange = over budget. Neutral = near perfect.</dd>
      <dt>Circle size</dt>
      <dd>Scaled by achieved distance (longer dives draw larger circles).</dd>
      <dt>Goal</dt>
      <dd>Clusters around the diagonal signal that Step 1 intensities + shared parameters are consistent.</dd>
    </dl>
  `;
}

function renderAttemptsTable() {
  if (!attemptTableEl) {
    return;
  }
  attemptTableEl.textContent = "";
  const source = state.manualAttempts?.length ? state.manualAttempts : state.attempts;
  const rows = source.map((attempt) => ({
    ...attempt,
    absResidual: Math.abs(attempt.residual_s ?? 0),
  }));
  if (!rows.length) {
    attemptTableEl.textContent = "No attempt rows available.";
    return;
  }

  const columns = getAttemptColumns();
  const sortedRows = sortRows(rows, attemptSort.key, attemptSort.direction);

  const table = document.createElement("table");
  table.className = "standard-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.key = column.key;
    th.setAttribute("aria-sort", attemptSort.key === column.key ? attemptSort.direction : "none");

    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${column.label}</span><span class="sort-indicator">⇅</span>`;
    button.addEventListener("click", () => {
      const direction = attemptSort.key === column.key && attemptSort.direction === "ascending" ? "descending" : "ascending";
      attemptSort = { key: column.key, direction };
      renderAttemptsTable();
    });

    th.appendChild(button);
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  sortedRows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      if (column.align === "right") {
        td.style.textAlign = "right";
      }
      td.textContent = column.render ? column.render(row) : row[column.key];
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  attemptTableEl.appendChild(table);
}

function getAttemptColumns() {
  return [
    { key: "name", label: "Athlete" },
    { key: "distance_m", label: "Dist (m)", align: "right", render: (row) => formatNumber(row.distance_m, 1) },
    { key: "total_time_s", label: "TT", align: "right", render: (row) => formatSeconds(row.total_time_s) },
    { key: "sta_budget_s", label: "STA budget", align: "right", render: (row) => formatSeconds(row.sta_budget_s) },
    { key: "prediction_s", label: "Prediction", align: "right", render: (row) => formatSeconds(row.prediction_s) },
    {
      key: "residual_s",
      label: "Residual",
      align: "right",
      render: (row) => `${formatSignedNumber(row.residual_s, 1)} s`,
    },
    {
      key: "absResidual",
      label: "|Residual|",
      align: "right",
      render: (row) => formatNumber(row.absResidual, 1, "s"),
    },
    {
      key: "movement_intensity",
      label: "Movement intensity",
      align: "right",
      render: (row) => formatNumber(row.movement_intensity, 3),
    },
  ];
}

function countNegativeParameters(parameters) {
  return Object.values(parameters || {}).filter((value) => Number.isFinite(value) && value < 0).length;
}

function expandDomain([min, max]) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  const padding = (max - min) * 0.08 || 5;
  return [min - padding, max + padding];
}

function sortRows(rows, key, direction) {
  const sorted = [...rows];
  const multiplier = direction === "ascending" ? 1 : -1;
  sorted.sort((a, b) => {
    const aValue = a[key];
    const bValue = b[key];
    const aValid = Number.isFinite(aValue);
    const bValid = Number.isFinite(bValue);
    if (aValid && bValid) {
      if (aValue === bValue) {
        return a.name.localeCompare(b.name) * multiplier;
      }
      return (aValue - bValue) * multiplier;
    }
    if (aValid) {
      return -1;
    }
    if (bValid) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
  return sorted;
}

function computeManualMetrics(attempts = []) {
  if (!attempts.length) {
    return null;
  }
  const absResiduals = attempts.map((attempt) => Math.abs(attempt.residual_s ?? 0));
  const meanAbs = absResiduals.reduce((acc, value) => acc + value, 0) / absResiduals.length;
  const sorted = [...absResiduals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianAbs =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const maxAbs = Math.max(...absResiduals);
  const pctErrors = attempts
    .map((attempt) => (attempt.sta_budget_s > 0 ? Math.abs(attempt.residual_s ?? 0) / attempt.sta_budget_s : NaN))
    .filter((value) => Number.isFinite(value));
  const meanPct = pctErrors.length
    ? pctErrors.reduce((acc, value) => acc + value, 0) / pctErrors.length
    : NaN;
  return {
    mean_abs_error_s: meanAbs,
    median_abs_error_s: medianAbs,
    max_abs_error_s: maxAbs,
    mean_abs_pct_error: meanPct,
  };
}

function withCacheBust(url) {
  if (!url) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}cb=${CACHE_BUST_TOKEN}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function renderError(message) {
  if (metricsNoteEl) {
    metricsNoteEl.textContent = message;
  }
  if (parameterTableEl) {
    parameterTableEl.textContent = message;
  }
  if (scatterEl) {
    scatterEl.textContent = message;
  }
  if (attemptTableEl) {
    attemptTableEl.textContent = message;
  }
}

function formatNumber(value, decimals = 2, suffix = "") {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const formatted = Number(value).toFixed(decimals);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function formatSignedNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(decimals)}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(1)}%`;
}
