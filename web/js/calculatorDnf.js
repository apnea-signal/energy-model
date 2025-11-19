import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip, formatSeconds, parseTimeToSeconds } from "./utils.js";
import {
  PARAMETER_ORDER,
  PARAMETER_LABELS,
  FORMULA_ROWS,
  evaluateSplitCost,
  projectDistanceFromSplitCost,
} from "./models/dnfPerformanceModel.js";

const CACHE_BUST_TOKEN = Date.now().toString(36);
const DATA_URL = withCacheBust("../data/dashboard_data/05_propulsion_fit.json");
const MOVEMENT_URL = withCacheBust("../data/dashboard_data/03_movement_intensity.json");
const DEFAULT_DATASET = "DNF";
const BASELINE_SCENARIO_ID = "balanced";
const INTENSITY_SCENARIOS = [
  { id: "eighty", label: "0.8×", defaultValue: 0.8, note: "Tempo conservation", color: "#0ea5e9" },
  { id: "ninety", label: "0.9×", defaultValue: 0.9, note: "Relaxed glide", color: "#14b8a6" },
  { id: "balanced", label: "1.0×", defaultValue: 1.0, note: "Reference race pace", color: "#10b981" },
  { id: "oneTen", label: "1.1×", defaultValue: 1.1, note: "Focused push", color: "#f97316" },
  { id: "oneTwenty", label: "1.2×", defaultValue: 1.2, note: "High-intensity exit", color: "#dc2626" },
];
const DEFAULT_INPUTS = {
  staSeconds: 420,
  splitDistance: Number.NaN,
  legKicksPerArm: 1,
  extraKicksPerSplit: 0,
};

const state = {
  datasetName: DEFAULT_DATASET,
  parameters: null,
  attempts: [],
  movementMetadata: {},
  inputs: { ...DEFAULT_INPUTS },
  baseSplitDistance: 50,
  baseSplitTimeSeconds: 55,
  baselineIntensity: 1,
  baseArmPulls: 6,
  baseCounts: { wallPushesPerSplit: 1, dolphinKicksPerSplit: 0 },
  results: [],
};

const datasetLabelEl = document.getElementById("datasetLabel");
const formulaNoteEl = document.getElementById("formulaNote");
const formulaParametersEl = document.getElementById("formulaParameters");
const parameterTableEl = document.getElementById("parameterTable");
const simulationStatusEl = document.getElementById("simulationStatus");
const simulationNoteEl = document.getElementById("simulationNote");
const scenarioSummaryEl = document.getElementById("scenarioSummary");
const simulationChartEl = document.getElementById("simulationChart");

init();

async function init() {
  try {
    const [propulsionPayload, movementPayload] = await Promise.all([fetchJson(DATA_URL), fetchJson(MOVEMENT_URL)]);
    const dataset = propulsionPayload?.[DEFAULT_DATASET];
    if (!dataset) {
      renderError(`Dataset ${DEFAULT_DATASET} missing in ${DATA_URL}`);
      return;
    }
    state.datasetName = dataset.dataset || DEFAULT_DATASET;
    state.parameters = dataset.parameters || {};
    state.attempts = Array.isArray(dataset.attempts) ? dataset.attempts : [];
    state.movementMetadata = movementPayload?.[DEFAULT_DATASET]?.metadata || {};
    applyDatasetDefaults();
    hydrateInputs();
    renderModelReference();
    updateSimulation();
  } catch (error) {
    renderError(`Failed to load calculator data: ${error.message}`);
  }
}

function applyDatasetDefaults() {
  const movementMeta = state.movementMetadata || {};
  const resolvedSplitDistance = sanitizePositive(movementMeta.split_distance_m) || state.baseSplitDistance;
  state.baseSplitDistance = resolvedSplitDistance;
  if (!Number.isFinite(state.inputs.splitDistance) || state.inputs.splitDistance <= 0) {
    state.inputs.splitDistance = resolvedSplitDistance;
  }
  const attemptStats = computeAttemptSplitStats(state.attempts, resolvedSplitDistance);
  state.baseSplitTimeSeconds =
    sanitizePositive(movementMeta.split_time_s_median) || attemptStats.splitTime || state.baseSplitTimeSeconds;
  state.baselineIntensity = sanitizePositive(movementMeta.movement_intensity_median) || 1;
  const armPulls = sanitizePositive(movementMeta.arm_pulls_median) || attemptStats.armPulls || state.baseArmPulls;
  state.baseArmPulls = armPulls;
  const legKicks = sanitizePositive(movementMeta.leg_kicks_median) || attemptStats.legKicks || armPulls;
  state.inputs.legKicksPerArm = armPulls > 0 ? legKicks / armPulls : state.inputs.legKicksPerArm;
  state.inputs.extraKicksPerSplit = 0;
  state.baseCounts = {
    wallPushesPerSplit: attemptStats.wallPushes || 1,
    dolphinKicksPerSplit: attemptStats.dolphinKicks || 0,
  };
}

function hydrateInputs() {
  const staInput = document.getElementById("staInput");
  const splitDistanceInput = document.getElementById("splitDistanceInput");
  const kicksPerArmInput = document.getElementById("kicksPerArmInput");
  const extraKicksInput = document.getElementById("extraKicksInput");

  if (staInput) {
    staInput.value = formatSeconds(state.inputs.staSeconds);
    staInput.addEventListener("input", () => {
      state.inputs.staSeconds = parseTimeToSeconds(staInput.value.trim());
      updateSimulation();
    });
  }
  if (splitDistanceInput) {
    splitDistanceInput.value = state.inputs.splitDistance;
    splitDistanceInput.addEventListener("input", () => {
      const value = Number(splitDistanceInput.value);
      state.inputs.splitDistance = Number.isFinite(value) && value > 0 ? value : Number.NaN;
      updateDatasetLabel();
      updateSimulation();
    });
  }
  if (kicksPerArmInput) {
    kicksPerArmInput.value = state.inputs.legKicksPerArm;
    kicksPerArmInput.addEventListener("input", () => {
      const value = Number(kicksPerArmInput.value);
      state.inputs.legKicksPerArm = Number.isFinite(value) && value >= 0 ? value : Number.NaN;
      updateSimulation();
    });
  }
  if (extraKicksInput) {
    extraKicksInput.value = state.inputs.extraKicksPerSplit;
    extraKicksInput.addEventListener("input", () => {
      const value = Number(extraKicksInput.value);
      state.inputs.extraKicksPerSplit = Number.isFinite(value) && value >= 0 ? value : Number.NaN;
      updateSimulation();
    });
  }

  updateDatasetLabel();
}

function updateSimulation() {
  if (!state.parameters) {
    return;
  }
  const sta = Number(state.inputs.staSeconds);
  const splitDistance = Number(state.inputs.splitDistance);
  const kicksPerArm = Number(state.inputs.legKicksPerArm);
  const extraKicks = Number(state.inputs.extraKicksPerSplit);

  const missing = [];
  if (!Number.isFinite(sta) || sta <= 0) {
    missing.push("STA PB");
  }
  if (!Number.isFinite(splitDistance) || splitDistance <= 0) {
    missing.push("split distance");
  }
  if (!Number.isFinite(kicksPerArm) || kicksPerArm < 0) {
    missing.push("leg kicks per arm");
  }
  if (!Number.isFinite(extraKicks) || extraKicks < 0) {
    missing.push("additional kicks");
  }

  if (missing.length) {
    renderSimulationStatus(`Enter ${missing[0]} to project splits.`);
    scenarioSummaryEl.textContent = "";
    simulationChartEl.textContent = "Provide the required inputs above.";
    simulationNoteEl.textContent = "";
    state.results = [];
    updateDatasetLabel();
    return;
  }

  const baseSplitTime = getDerivedSplitTime();
  const baseIntensity = Number(state.baselineIntensity) || 1;
  const baseArmPulls = Number(state.baseArmPulls);
  if (!Number.isFinite(baseArmPulls) || baseArmPulls <= 0) {
    renderSimulationStatus("Baseline arm pulls missing; rerun the movement intensity builder.");
    scenarioSummaryEl.textContent = "";
    simulationChartEl.textContent = "No baseline propulsion counts available.";
    simulationNoteEl.textContent = "";
    state.results = [];
    updateDatasetLabel();
    return;
  }
  const legRatio = Number.isFinite(kicksPerArm) ? kicksPerArm : 0;
  const wallPushes = Number(state.baseCounts.wallPushesPerSplit) || 1;
  const dolphinKicks = Math.max(0, Number(state.baseCounts.dolphinKicksPerSplit) || 0);

  state.results = INTENSITY_SCENARIOS.map((scenario) => {
    const intensity = Number(scenario.defaultValue);
    if (!Number.isFinite(intensity) || intensity <= 0) {
      return { ...scenario, valid: false };
    }
    const scenarioSplitTime = adjustSplitTime(baseSplitTime, baseIntensity, intensity);
    const scenarioArmPullsRaw = deriveArmPulls(intensity, baseArmPulls, baseIntensity);
    if (!Number.isFinite(scenarioArmPullsRaw) || scenarioArmPullsRaw <= 0) {
      return { ...scenario, intensity, valid: false };
    }
    const rawCounts = {
      movementIntensity: intensity,
      wallPushes,
      armPulls: scenarioArmPullsRaw,
      legKicks: Math.max(0, scenarioArmPullsRaw * legRatio + extraKicks),
      dolphinKicks,
      swimTime: scenarioSplitTime,
    };
    const { total: rawSplitCost } = evaluateSplitCost(state.parameters, rawCounts);

    const scenarioArmPulls = Math.max(1, Math.floor(scenarioArmPullsRaw));
    let legKicksPerSplit = Math.max(0, scenarioArmPulls * legRatio + extraKicks);
    let counts = {
      movementIntensity: intensity,
      wallPushes,
      armPulls: scenarioArmPulls,
      legKicks: legKicksPerSplit,
      dolphinKicks,
      swimTime: scenarioSplitTime,
    };
    let { total: splitCost } = evaluateSplitCost(state.parameters, counts);

    if (Number.isFinite(rawSplitCost) && Number.isFinite(splitCost) && rawSplitCost - splitCost > 0) {
      const withExtraKick = { ...counts, legKicks: legKicksPerSplit + 1 };
      const { total: extraCost } = evaluateSplitCost(state.parameters, withExtraKick);
      if (Number.isFinite(extraCost) && extraCost <= rawSplitCost + 1e-6) {
        legKicksPerSplit += 1;
        counts = withExtraKick;
        splitCost = extraCost;
      }
    }

    const projection = projectDistanceFromSplitCost(sta, splitCost, splitDistance);
    const totalTime = Number.isFinite(projection.split_count) ? projection.split_count * scenarioSplitTime : Number.NaN;
    return {
      ...scenario,
      intensity,
      splitTime: scenarioSplitTime,
      splitCost,
      predictedDistance: projection.distance_m,
      splitCount: projection.split_count,
      totalTime,
      splitDistance,
      armPulls: scenarioArmPulls,
      legKicks: legKicksPerSplit,
      valid:
        Number.isFinite(splitCost) &&
        splitCost > 0 &&
        Number.isFinite(projection.distance_m) &&
        projection.distance_m > 0 &&
        Number.isFinite(scenarioSplitTime) &&
        scenarioSplitTime > 0,
    };
  });

  renderScenarioSummary();
  renderSimulationChart();
  const message = `Baseline ${formatSeconds(baseSplitTime)} split assumes ${formatNumber(
    state.baseArmPulls,
    0
  )} arm pulls @ intensity ${formatNumber(baseIntensity, 2)} with ${formatNumber(
    state.baseArmPulls * legRatio + extraKicks,
    1
  )} leg kicks per ${splitDistance.toFixed(0)} m.`;
  renderSimulationStatus(message);
  simulationNoteEl.innerHTML =
    "Distance projection uses the oxygen identity <code>distance = (STA / split O₂ cost) × split distance</code>.";
}

function renderScenarioSummary() {
  if (!scenarioSummaryEl) {
    return;
  }
  scenarioSummaryEl.textContent = "";
  const rows = (state.results || []).filter((row) => row.valid);
  if (!rows.length) {
    scenarioSummaryEl.textContent = "Adjust the inputs to generate a valid scenario.";
    return;
  }
  const table = document.createElement("table");
  table.className = "standard-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th scope="col">Scenario</th>
      <th scope="col">Intensity</th>
      <th scope="col">Arm pulls / split</th>
      <th scope="col">Leg kicks / split</th>
      <th scope="col">Split time</th>
      <th scope="col">Split O₂ cost</th>
      <th scope="col">Projected distance</th>
      <th scope="col">Total time</th>
    </tr>
  `;
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.label}</td>
      <td style="text-align:right">${formatNumber(row.intensity, 2)}</td>
      <td style="text-align:right">${formatNumber(row.armPulls, 0)}</td>
      <td style="text-align:right">${formatNumber(row.legKicks, 1)}</td>
      <td style="text-align:right">${formatSeconds(row.splitTime)}</td>
      <td style="text-align:right">${formatNumber(row.splitCost, 1, "s")}</td>
      <td style="text-align:right">${formatNumber(row.predictedDistance, 0, "m")}</td>
      <td style="text-align:right">${formatSeconds(row.totalTime)}</td>
    `;
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  scenarioSummaryEl.appendChild(table);
}

function renderSimulationChart() {
  if (!simulationChartEl) {
    return;
  }
  simulationChartEl.textContent = "";
  const validSeries = (state.results || [])
    .filter((row) => row.valid && Number.isFinite(row.splitCount) && row.splitCount > 0 && Number.isFinite(row.splitTime))
    .map((row) => ({ ...row, points: buildScenarioPoints(row) }))
    .filter((row) => row.points.length >= 2);

  if (!validSeries.length) {
    simulationChartEl.textContent = "Insufficient data to draw the split chart.";
    return;
  }

  const width = simulationChartEl.clientWidth || 900;
  const height = 320;
  const margin = { top: 20, right: 24, bottom: 52, left: 68 };
  const allDistances = validSeries.flatMap((series) => series.points.map((point) => point.distance));
  const allTimes = validSeries.flatMap((series) => series.points.map((point) => point.time));
  const xScale = d3.scaleLinear().domain(expandDomain(allDistances)).range([margin.left, width - margin.right]);
  const yScale = d3.scaleLinear().domain(expandDomain(allTimes)).range([height - margin.bottom, margin.top]);

  const svg = d3
    .select(simulationChartEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Split simulation chart");

  const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat((value) => `${value} m`);
  const yAxis = d3.axisLeft(yScale).ticks(6).tickFormat((value) => formatSeconds(value));

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(xAxis);

  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .attr("class", "axis-label")
    .text("Distance (m)");

  svg
    .append("g")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(yAxis);

  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", 18)
    .attr("text-anchor", "middle")
    .attr("class", "axis-label")
    .text("Elapsed time");

  const tooltip = createChartTooltip(d3.select(simulationChartEl));

  validSeries.forEach((series) => {
    const line = d3
      .line()
      .x((point) => xScale(point.distance))
      .y((point) => yScale(point.time));
    svg
      .append("path")
      .datum(series.points)
      .attr("fill", "none")
      .attr("stroke", series.color)
      .attr("stroke-width", 2)
      .attr("d", line);

    svg
      .append("g")
      .selectAll("circle")
      .data(series.points)
      .enter()
      .append("circle")
      .attr("cx", (point) => xScale(point.distance))
      .attr("cy", (point) => yScale(point.time))
      .attr("r", (point) => (point.isTerminal ? 5 : 3))
      .attr("fill", series.color)
      .attr("opacity", 0.85)
      .on("mouseenter", (event, point) => {
        tooltip?.show(
          event,
          `
            <strong>${series.label}</strong>
            <div>Distance: ${formatNumber(point.distance, 0, "m")}</div>
            <div>Elapsed: ${formatSeconds(point.time)}</div>
          `
        );
      })
      .on("mousemove", (event) => tooltip?.move(event))
      .on("mouseleave", () => tooltip?.hide());
  });
}

function renderModelReference() {
  if (formulaNoteEl) {
    formulaNoteEl.innerHTML = `
      <p class="note-lede">Equation</p>
      <p>
        <code>O₂_{total} = I \times (P_w N_w + P_a N_a + P_l N_l + P_d N_d + P_i T) + R_s T - P_{ar} T</code>
      </p>
      <p>Movement intensity from Step&nbsp;1 scales every propulsion count before adding the static metabolic draw.</p>
    `;
  }
  if (formulaParametersEl) {
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
  renderParameterTable();
}

function renderParameterTable() {
  if (!parameterTableEl) {
    return;
  }
  parameterTableEl.textContent = "";
  const params = state.parameters || {};
  const table = document.createElement("table");
  table.className = "standard-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th scope="col">Parameter</th>
      <th scope="col">Value</th>
    </tr>
  `;
  const tbody = document.createElement("tbody");
  PARAMETER_ORDER.forEach((key) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${PARAMETER_LABELS[key] || key}</td>
      <td style="text-align:right">${formatNumber(params[key], 4)}</td>
    `;
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  parameterTableEl.appendChild(table);
}

function buildScenarioPoints(row) {
  const splitDistance = row.splitDistance;
  const splitCount = row.splitCount;
  if (!Number.isFinite(splitDistance) || !Number.isFinite(splitCount) || splitDistance <= 0 || splitCount <= 0) {
    return [];
  }
  const points = [{ distance: 0, time: 0, isTerminal: false }];
  const fullSplits = Math.floor(splitCount);
  for (let idx = 1; idx <= fullSplits; idx += 1) {
    points.push({ distance: idx * splitDistance, time: idx * row.splitTime, isTerminal: false });
  }
  const remainder = splitCount - fullSplits;
  if (remainder > 0) {
    points.push({ distance: splitCount * splitDistance, time: splitCount * row.splitTime, isTerminal: true });
  } else if (points.length) {
    points[points.length - 1].isTerminal = true;
  }
  return points;
}

function computeAttemptSplitStats(attempts = [], splitDistance = 50) {
  if (!Number.isFinite(splitDistance) || splitDistance <= 0) {
    splitDistance = 50;
  }
  const ratio = splitDistance;
  const rows = (attempts || [])
    .map((attempt) => {
      const distance = Number(attempt?.distance_m);
      const totalTime = Number(attempt?.total_time_s);
      const intensity = Number(attempt?.movement_intensity) || 1;
      const features = attempt?.features || {};
      if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(totalTime) || totalTime <= 0 || intensity <= 0) {
        return null;
      }
      const splits = distance / ratio;
      if (!Number.isFinite(splits) || splits <= 0) {
        return null;
      }
      const perSplit = (value) => (Number.isFinite(value) ? value / splits : Number.NaN);
      const rawCount = (key) => {
        const value = Number(features[key]);
        if (!Number.isFinite(value)) {
          return Number.NaN;
        }
        return value / intensity;
      };
      return {
        splitTime: totalTime / splits,
        armPulls: perSplit(rawCount("arm_o2_cost")),
        legKicks: perSplit(rawCount("leg_o2_cost")),
        wallPushes: perSplit(rawCount("wall_push_o2_cost")),
        dolphinKicks: perSplit(rawCount("dolphin_o2_cost")),
      };
    })
    .filter(Boolean);
  const medianValue = (accessor) => median(rows.map(accessor));
  return {
    splitTime: medianValue((row) => row.splitTime) || Number.NaN,
    armPulls: medianValue((row) => row.armPulls) || Number.NaN,
    legKicks: medianValue((row) => row.legKicks) || Number.NaN,
    wallPushes: medianValue((row) => row.wallPushes) || Number.NaN,
    dolphinKicks: medianValue((row) => row.dolphinKicks) || Number.NaN,
  };
}

function adjustSplitTime(baseSplitTime, baselineIntensity, scenarioIntensity) {
  if (!Number.isFinite(baseSplitTime) || baseSplitTime <= 0) {
    return Number.NaN;
  }
  if (!Number.isFinite(baselineIntensity) || baselineIntensity <= 0) {
    return baseSplitTime;
  }
  if (!Number.isFinite(scenarioIntensity) || scenarioIntensity <= 0) {
    return Number.NaN;
  }
  return baseSplitTime * (baselineIntensity / scenarioIntensity);
}

function deriveArmPulls(intensity, baseArmPulls, baselineIntensity) {
  if (!Number.isFinite(baseArmPulls) || baseArmPulls <= 0) {
    return Number.NaN;
  }
  const baseIntensity = Number(baselineIntensity) || 1;
  if (!Number.isFinite(intensity) || intensity <= 0) {
    return Number.NaN;
  }
  if (!Number.isFinite(baseIntensity) || baseIntensity <= 0) {
    return baseArmPulls;
  }
  return (baseArmPulls * baseIntensity) / intensity;
}

function getDerivedSplitTime() {
  const baseDistance = Number(state.baseSplitDistance);
  const baseTime = Number(state.baseSplitTimeSeconds);
  const targetDistance = Number(state.inputs.splitDistance);
  if (
    !Number.isFinite(baseDistance) ||
    baseDistance <= 0 ||
    !Number.isFinite(baseTime) ||
    baseTime <= 0 ||
    !Number.isFinite(targetDistance) ||
    targetDistance <= 0
  ) {
    return baseTime;
  }
  const baseSpeed = baseDistance / baseTime;
  return targetDistance / baseSpeed;
}

function updateDatasetLabel() {
  if (!datasetLabelEl) {
    return;
  }
  const parts = [state.datasetName];
  if (Number.isFinite(state.inputs.splitDistance)) {
    parts.push(`${state.inputs.splitDistance} m splits`);
  }
  const derived = getDerivedSplitTime();
  if (Number.isFinite(derived)) {
    parts.push(`${formatSeconds(derived)} split pace`);
  }
  datasetLabelEl.textContent = parts.join(" · ");
}

function renderSimulationStatus(message) {
  if (simulationStatusEl) {
    simulationStatusEl.textContent = message;
  }
}

function formatNumber(value, decimals = 2, suffix = "") {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const formatted = Number(value).toFixed(decimals);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function sanitizePositive(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

function median(values = []) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) {
    return Number.NaN;
  }
  const sorted = filtered.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function expandDomain(values = []) {
  const extent = d3.extent(values);
  if (!extent || !Number.isFinite(extent[0]) || !Number.isFinite(extent[1])) {
    return [0, 1];
  }
  const padding = (extent[1] - extent[0]) * 0.08 || 5;
  return [extent[0] - padding, extent[1] + padding];
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function withCacheBust(url) {
  if (!url) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}cb=${CACHE_BUST_TOKEN}`;
}

function renderError(message) {
  renderSimulationStatus(message);
  if (scenarioSummaryEl) {
    scenarioSummaryEl.textContent = message;
  }
  if (simulationChartEl) {
    simulationChartEl.textContent = message;
  }
  if (parameterTableEl) {
    parameterTableEl.textContent = message;
  }
}
