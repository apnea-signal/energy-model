const DATA_URL = "../data/derived/dnf_style.json";
const STA_URL = "../data/aida_greece_2025/STA_PB.csv";

const DEFAULT_PARAMETERS = {
  wall_push_force: 1.0,
  wall_push_o2_cost: 0.05,
  post_push_kick_force: 0.35,
  post_push_kick_o2_cost: 0.03,
  arm_stroke_force: 0.8,
  arm_o2_cost: 0.05,
  stroke_kick_force: 0.25,
  stroke_kick_o2_cost: 0.03,
  dolphin_kick_force: 0.12,
  dolphin_o2_cost: 0.02,
  reference_pace_mps: 1.0,
  pace_force_exponent: 1.2,
  static_rate_base: 1.0,
  static_reference_sta: 480.0,
  heart_rate_reference: 45.0,
  heart_rate_slope: 0.01,
  rest_hr: 40.0,
  peak_hr: 120.0,
  anaerobic_leg_threshold: 80.0,
  anaerobic_leg_multiplier: 0.5,
};

const DEFAULT_MODIFIER = {
  wall_push_scale: 1.0,
  stroke_scale: 1.0,
  kick_scale: 1.0,
  dolphin_scale: 1.0,
  static_rate_scale: 1.0,
};

const state = {
  attempts: [],
  staLookup: new Map(),
  selectedIndex: 0,
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    const [styleData, staCsv] = await Promise.all([fetchJson(DATA_URL), fetchText(STA_URL)]);
    state.attempts = styleData?.attempts ?? [];
    state.staLookup = buildStaLookup(staCsv);
    populateAttemptSelect();
    renderParameters();
    renderCurrentAttempt();
  } catch (error) {
    console.error("Failed to initialize propulsion view", error);
    showError("Unable to load propulsion data. Please refresh or rebuild derived files.");
  }
}

function showError(message) {
  const summary = document.getElementById("summaryCards");
  summary.textContent = message;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.text();
}

function buildStaLookup(csvText) {
  const lookup = new Map();
  if (!csvText) {
    return lookup;
  }

  const lines = csvText.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header) {
    return lookup;
  }
  const headers = header.split(",");
  const nameIndex = headers.findIndex((col) => col.toLowerCase() === "name");
  const staIndex = headers.findIndex((col) => col.toLowerCase() === "sta");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const name = normalizeName(cells[nameIndex]);
    const staValue = cells[staIndex];
    const seconds = parseTimeToSeconds(staValue);
    if (name && seconds) {
      lookup.set(name, seconds);
    }
  }
  return lookup;
}

function populateAttemptSelect() {
  const select = document.getElementById("attemptSelect");
  select.innerHTML = "";
  state.attempts.forEach((attempt, index) => {
    const option = document.createElement("option");
    const name = attempt.name || "Unknown";
    option.value = String(index);
    option.textContent = `${name} · ${formatDistance(attempt.distance_m)} m`;
    select.appendChild(option);
  });
  select.addEventListener("change", (event) => {
    state.selectedIndex = Number(event.target.value) || 0;
    renderCurrentAttempt();
  });
}

function renderParameters() {
  const tbody = document.querySelector("#parameterTable tbody");
  tbody.innerHTML = "";
  Object.entries(DEFAULT_PARAMETERS).forEach(([key, value]) => {
    const row = document.createElement("tr");
    const keyCell = document.createElement("td");
    keyCell.textContent = key;
    const valueCell = document.createElement("td");
    valueCell.textContent = typeof value === "number" ? value.toFixed(3) : String(value);
    row.append(keyCell, valueCell);
    tbody.appendChild(row);
  });
}

function renderCurrentAttempt() {
  const attempt = state.attempts[state.selectedIndex];
  if (!attempt) {
    showError("No attempts available. Regenerate derived data if needed.");
    return;
  }
  const staSeconds = state.staLookup.get(normalizeName(attempt.name));
  const result = evaluateAttempt(attempt, staSeconds);
  renderSummary(result);
  renderSplitTable(result.splits);
  renderComponentTotals(result);
}

function renderSummary(result) {
  const summary = document.getElementById("summaryCards");
  summary.innerHTML = "";

  const cards = [
    {
      title: "Propulsion",
      value: `${formatNumber(result.total_propulsion)} vs ${formatNumber(result.total_propulsion_demand)}`,
      detail: `Surplus ${formatNumber(result.propulsion_surplus)}`,
    },
    {
      title: "O₂ Static",
      value: formatNumber(result.oxygen_static),
      detail: "heart & core demand",
    },
    {
      title: "O₂ Movement",
      value: formatNumber(result.oxygen_movement),
      detail: "strokes & kicks",
    },
    {
      title: "Total O₂",
      value: formatNumber(result.oxygen_total),
      detail: `STA reference: ${result.sta_seconds ? formatSeconds(result.sta_seconds) : "n/a"}`,
    },
  ];

  cards.forEach((card) => {
    const div = document.createElement("div");
    div.className = "summary-card";
    const title = document.createElement("p");
    title.className = "summary-title";
    title.textContent = card.title;
    const value = document.createElement("strong");
    value.className = "summary-value";
    value.textContent = card.value;
    const detail = document.createElement("span");
    detail.className = "summary-detail";
    detail.textContent = card.detail;
    div.append(title, value, detail);
    summary.appendChild(div);
  });
}

function renderSplitTable(splits) {
  const tbody = document.querySelector("#splitTable tbody");
  tbody.innerHTML = "";
  if (!splits.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.textContent = "No split data available.";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  splits.forEach((split) => {
    const row = document.createElement("tr");
    row.appendChild(buildCell(split.split_label || "-"));
    row.appendChild(buildCell(formatNumber(split.segment_distance_m)));
    row.appendChild(buildCell(formatNumber(split.segment_time_s)));
    row.appendChild(buildCell(formatNumber(split.segment_pace_mps, 3)));
    row.appendChild(buildCell(formatNumber(split.propulsion_demand)));
    row.appendChild(buildCell(formatNumber(split.propulsion_supply)));
    row.appendChild(buildCell(formatNumber(split.propulsion_surplus)));
    row.appendChild(buildCell(formatNumber(split.oxygen_static)));
    row.appendChild(buildCell(formatNumber(split.oxygen_movement)));
    const componentCell = document.createElement("td");
    componentCell.appendChild(buildComponentList(split));
    row.appendChild(componentCell);
    tbody.appendChild(row);
  });
}

function buildCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function buildComponentList(split) {
  const wrapper = document.createElement("div");
  wrapper.className = "component-list";
  const components = split.components || {};
  const entries = Object.entries(components);
  entries.forEach(([key, stats]) => {
    const item = document.createElement("div");
    item.className = "component-item";

    const label = document.createElement("span");
    label.textContent = key.replace(/_/g, " ");
    label.className = "component-label";

    const bar = document.createElement("div");
    bar.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    const demand = split.propulsion_demand || 1;
    const ratio = Math.min(1.2, (stats.propulsion || 0) / demand);
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    if (ratio >= 1) {
      fill.classList.add("surplus");
    }
    bar.appendChild(fill);

    const detail = document.createElement("span");
    detail.className = "component-detail";
    detail.textContent = `${formatNumber(stats.propulsion)} prop · ${formatNumber(stats.oxygen)} O₂`;

    item.append(label, bar, detail);
    wrapper.appendChild(item);
  });
  return wrapper;
}

function renderComponentTotals(result) {
  const totals = aggregateComponents(result.splits);
  const container = document.getElementById("componentTotals");
  container.innerHTML = "";
  Object.entries(totals).forEach(([key, stats]) => {
    const card = document.createElement("div");
    card.className = "component-card";
    const title = document.createElement("strong");
    title.textContent = key.replace(/_/g, " ");
    const prop = document.createElement("span");
    prop.textContent = `Propulsion: ${formatNumber(stats.propulsion)}`;
    const o2 = document.createElement("span");
    o2.textContent = `O₂: ${formatNumber(stats.oxygen)}`;
    card.append(title, prop, o2);
    container.appendChild(card);
  });
}

function aggregateComponents(splits) {
  const totals = {};
  splits.forEach((split) => {
    const components = split.components || {};
    Object.entries(components).forEach(([key, stats]) => {
      if (!totals[key]) {
        totals[key] = { propulsion: 0, oxygen: 0 };
      }
      totals[key].propulsion += stats.propulsion || 0;
      totals[key].oxygen += stats.oxygen || 0;
    });
  });
  return totals;
}

function evaluateAttempt(attempt, staSeconds) {
  const splits = attempt.split_details || [];
  const totalSegments = splits.filter((split) => (split.segment_distance_m || 0) > 0).length;
  let totalPropulsion = 0;
  let totalDemand = 0;
  let totalStaticO2 = 0;
  let totalMovementO2 = 0;
  let cumulativeLegKicks = 0;

  const evaluatedSplits = splits
    .filter((split) => (split.segment_distance_m || 0) > 0)
    .map((split, index) => {
      const distance = toNumber(split.segment_distance_m);
      const segmentTime = toNumber(split.segment_time_s);
      const pace = toNumber(split.segment_pace_mps);
      const demand = propulsionDemand(distance, pace);
      const heartRate = heartRateFor(index, totalSegments);
      const staticRate = staticRateFor(staSeconds, heartRate);
      const staticO2 = segmentTime && staticRate ? segmentTime * staticRate : 0;

      const wall = computeWallPush();
      const postPush = computePostPushKicks(toNumber(split.wall_kicks));
      const strokeKicks = computeStrokeKicks(toNumber(split.stroke_leg_kicks));
      const armStrokes = computeArmStrokes(toNumber(split.arm_cycles));
      const dolphin = computeDolphinKicks(toNumber(split.dolphin_kicks));

      const legMultiplier = legO2Multiplier(cumulativeLegKicks);
      postPush.oxygen *= legMultiplier;
      strokeKicks.oxygen *= legMultiplier;
      cumulativeLegKicks += (postPush.count || 0) + (strokeKicks.count || 0);

      const segmentPropulsion = wall.propulsion + postPush.propulsion + strokeKicks.propulsion + armStrokes.propulsion + dolphin.propulsion;
      const movementO2 = wall.oxygen + postPush.oxygen + strokeKicks.oxygen + armStrokes.oxygen + dolphin.oxygen;

      totalPropulsion += segmentPropulsion;
      totalDemand += demand;
      totalStaticO2 += staticO2;
      totalMovementO2 += movementO2;

      return {
        ...split,
        heart_rate_bpm: heartRate,
        propulsion_demand: demand,
        propulsion_supply: segmentPropulsion,
        propulsion_surplus: segmentPropulsion - demand,
        oxygen_static: staticO2,
        oxygen_movement: movementO2,
        components: {
          wall_push: { propulsion: wall.propulsion, oxygen: wall.oxygen },
          post_push_kicks: { propulsion: postPush.propulsion, oxygen: postPush.oxygen },
          stroke_kicks: { propulsion: strokeKicks.propulsion, oxygen: strokeKicks.oxygen },
          arm_strokes: { propulsion: armStrokes.propulsion, oxygen: armStrokes.oxygen },
          dolphin_kicks: { propulsion: dolphin.propulsion, oxygen: dolphin.oxygen },
        },
      };
    });

  return {
    name: attempt.name,
    sta_seconds: staSeconds,
    total_propulsion: totalPropulsion,
    total_propulsion_demand: totalDemand,
    propulsion_surplus: totalPropulsion - totalDemand,
    oxygen_static: totalStaticO2,
    oxygen_movement: totalMovementO2,
    oxygen_total: totalStaticO2 + totalMovementO2,
    splits: evaluatedSplits,
  };
}

function propulsionDemand(distance, pace) {
  if (!pace || pace <= 0) {
    return distance || 0;
  }
  const ratio = pace / (DEFAULT_PARAMETERS.reference_pace_mps || 1);
  return (distance || 0) * Math.pow(ratio, DEFAULT_PARAMETERS.pace_force_exponent);
}

function heartRateFor(splitIndex, totalSegments) {
  if (totalSegments <= 1) {
    return DEFAULT_PARAMETERS.peak_hr;
  }
  const fraction = splitIndex / (totalSegments - 1);
  return DEFAULT_PARAMETERS.rest_hr + (DEFAULT_PARAMETERS.peak_hr - DEFAULT_PARAMETERS.rest_hr) * fraction;
}

function staticRateFor(staSeconds, heartRate) {
  let base = DEFAULT_PARAMETERS.static_rate_base;
  if (staSeconds && staSeconds > 0) {
    base *= DEFAULT_PARAMETERS.static_reference_sta / staSeconds;
  }
  const hrAdj = 1 + DEFAULT_PARAMETERS.heart_rate_slope * (heartRate - DEFAULT_PARAMETERS.heart_rate_reference);
  return base * hrAdj * DEFAULT_MODIFIER.static_rate_scale;
}

function legO2Multiplier(cumulativeLegKicks) {
  if (cumulativeLegKicks >= DEFAULT_PARAMETERS.anaerobic_leg_threshold) {
    return DEFAULT_PARAMETERS.anaerobic_leg_multiplier;
  }
  return 1;
}

function computeWallPush() {
  return {
    propulsion: DEFAULT_PARAMETERS.wall_push_force * DEFAULT_MODIFIER.wall_push_scale,
    oxygen: DEFAULT_PARAMETERS.wall_push_o2_cost * DEFAULT_MODIFIER.wall_push_scale,
  };
}

function computePostPushKicks(count = 0) {
  return {
    count,
    propulsion: count * DEFAULT_PARAMETERS.post_push_kick_force * DEFAULT_MODIFIER.kick_scale,
    oxygen: count * DEFAULT_PARAMETERS.post_push_kick_o2_cost * DEFAULT_MODIFIER.kick_scale,
  };
}

function computeStrokeKicks(count = 0) {
  return {
    count,
    propulsion: count * DEFAULT_PARAMETERS.stroke_kick_force * DEFAULT_MODIFIER.kick_scale,
    oxygen: count * DEFAULT_PARAMETERS.stroke_kick_o2_cost * DEFAULT_MODIFIER.kick_scale,
  };
}

function computeArmStrokes(count = 0) {
  return {
    propulsion: count * DEFAULT_PARAMETERS.arm_stroke_force * DEFAULT_MODIFIER.stroke_scale,
    oxygen: count * DEFAULT_PARAMETERS.arm_o2_cost * DEFAULT_MODIFIER.stroke_scale,
  };
}

function computeDolphinKicks(count = 0) {
  return {
    propulsion: count * DEFAULT_PARAMETERS.dolphin_kick_force * DEFAULT_MODIFIER.dolphin_scale,
    oxygen: count * DEFAULT_PARAMETERS.dolphin_o2_cost * DEFAULT_MODIFIER.dolphin_scale,
  };
}

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function formatDistance(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(1);
}

function parseTimeToSeconds(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed || trimmed === "-") return null;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0];
}

function formatSeconds(totalSeconds) {
  const total = Math.round(totalSeconds || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
