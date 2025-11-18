import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { normalizeName } from "../utils.js";
import { appendChartTitle, extendBandSamplesToDomain, renderBandScatterChart } from "./chartWithBands.js";

export function createMovementQuadrantSection({ chartEl, noteEl }) {
  function update({ dataset, movement = [], data = [], bands = {} } = {}) {
    renderCharts(chartEl, movement, data, bands, dataset);
    if (noteEl) {
      noteEl.textContent = "Leg vs Arm work bias = leg work divided by arm work. Values above 1.0 indicate leg-heavy attempts; values below 1.0 indicate arm-heavy attempts.";
    }
  }

  return {
    update,
  };
}

function renderCharts(containerEl, movementEntries, datasetRows, bands, dataset) {
  if (!containerEl) {
    return;
  }
  containerEl.textContent = "";
  const distanceLookup = buildDistanceLookup(datasetRows);
  let rows = (movementEntries || [])
    .map((entry) => ({
      name: entry.name || entry.Name || "",
      movementIntensity: numberOrNaN(entry.movement_intensity),
      distance: distanceLookup[normalizeName(entry.name || entry.Name)] ?? NaN,
      armWork: numberOrNaN(entry.arm_work_total),
      legWork: numberOrNaN(entry.leg_work_total),
      legArmWorkRatio: numberOrNaN(entry.leg_arm_work_ratio),
    }))
    .filter(
      (row) =>
        row.name &&
        Number.isFinite(row.movementIntensity) &&
        Number.isFinite(row.armWork) &&
        Number.isFinite(row.legWork) &&
        Number.isFinite(row.distance)
    );

  if (!rows.length) {
    containerEl.textContent = "Movement intensity data unavailable.";
    return;
  }

  rows.forEach((row) => {
    const directRatio = Number.isFinite(row.legArmWorkRatio) && row.legArmWorkRatio >= 0 ? row.legArmWorkRatio : NaN;
    const computedRatio = row.armWork > 0 ? row.legWork / row.armWork : NaN;
    const ratio = Number.isFinite(directRatio) ? directRatio : computedRatio;
    row.workBias = Number.isFinite(ratio) ? ratio : NaN;
  });

  rows = rows.filter((row) => Number.isFinite(row.workBias));

  if (!rows.length) {
    containerEl.textContent = "Movement intensity data unavailable.";
    return;
  }

  const intensityChart = document.createElement("div");
  intensityChart.className = "chart";
  containerEl.appendChild(intensityChart);
  drawIntensityVsDistance(intensityChart, rows, bands?.movement_intensity_band);

  const balanceChart = document.createElement("div");
  balanceChart.className = "chart";
  containerEl.appendChild(balanceChart);
  drawWorkBiasVsDistance(balanceChart, rows, bands?.work_bias_band);
}

function drawIntensityVsDistance(container, rows, band) {
  const distanceDomain = getPaddedDomain(rows.map((row) => row.distance));
  const chart = renderBandScatterChart({
    containerEl: container,
    data: rows,
    xAccessor: (row) => row.distance,
    yAccessor: (row) => row.movementIntensity,
    xDomain: distanceDomain,
    yDomain: expandDomain(d3.extent(rows, (row) => row.movementIntensity)),
    xTickFormat: (value) => `${value.toFixed(0)} m`,
    ariaLabel: "Movement intensity vs distance",
    getPointColor: () => "#2563eb",
    getPointRadius: () => 6,
    band: prepareBandConfig(band, distanceDomain, {
      fill: "#bfdbfe",
      stroke: "#60a5fa",
      fillOpacity: 0.3,
    }),
    tooltipFormatter: (row) => `
          <strong>${row.name}</strong>
          <div>Distance: ${row.distance?.toFixed(0) ?? ""} m</div>
          <div>Movement intensity: ${row.movementIntensity?.toFixed(2) ?? ""}</div>
        `,
  });

  appendChartTitle(chart, "Movement intensity vs distance");
}

function drawWorkBiasVsDistance(container, rows, band) {
  const distanceDomain = getPaddedDomain(rows.map((row) => row.distance));
  const yDomain = buildRatioDomain(rows.map((row) => row.workBias));
  const chart = renderBandScatterChart({
    containerEl: container,
    data: rows,
    xAccessor: (row) => row.distance,
    yAccessor: (row) => row.workBias,
    xDomain: distanceDomain,
    yDomain,
    xTickFormat: (value) => `${value.toFixed(0)} m`,
    ariaLabel: "Leg/arm work ratio vs distance",
    getPointColor: () => "#16a34a",
    getPointRadius: () => 6,
    band: prepareBandConfig(band, distanceDomain, {
      fill: "#bbf7d0",
      stroke: "#22c55e",
      fillOpacity: 0.35,
    }),
    referenceLines: [
      {
        type: "horizontal",
        value: 1,
        stroke: "#94a3b8",
        strokeDasharray: "4 4",
      },
    ],
    tooltipFormatter: (row) => `
          <strong>${row.name}</strong>
          <div>Distance: ${row.distance?.toFixed(0) ?? ""} m</div>
          <div>Leg ÷ arm work: ${row.workBias?.toFixed(2) ?? ""}</div>
        `,
  });

  appendChartTitle(chart, "Leg vs arm work ratio vs distance");
}

function prepareBandConfig(band, domain, overrides = {}) {
  if (!band?.samples?.length || !domain) {
    return undefined;
  }
  const samples = extendBandSamplesToDomain(band.samples, band.metadata, domain);
  return {
    samples,
    fill: overrides.fill || "#bfdbfe",
    stroke: overrides.stroke || "#60a5fa",
    fillOpacity: overrides.fillOpacity ?? 0.3,
    strokeWidth: overrides.strokeWidth || 1.5,
  };
}

function getPaddedDomain(values) {
  const rawExtent = d3.extent(values);
  const padding = computeAxisPadding(values);
  return applyDomainPadding(rawExtent, padding);
}

function numberOrNaN(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function buildDistanceLookup(rows) {
  const lookup = {};
  (rows || []).forEach((row) => {
    const key = normalizeName(row.Name || row.name || row.Athlete);
    if (!key) {
      return;
    }
    const dist = Number(row.Dist || row.dist || row.Distance || row.distance_m);
    if (Number.isFinite(dist)) {
      lookup[key] = dist;
    }
  });
  return lookup;
}

function expandDomain(domain) {
  let [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0.5, 1.5];
  }
  if (min === max) {
    const pad = Math.max(0.05, Math.abs(min) * 0.1 || 0.1);
    min -= pad;
    max += pad;
  }
  const padding = (max - min) * 0.1 || 0.05;
  return [min - padding, max + padding];
}

function buildRatioDomain(values) {
  const filtered = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!filtered.length) {
    return [0.4, 1.6];
  }
  let min = Math.min(...filtered);
  let max = Math.max(...filtered);
  if (min === max) {
    const pad = Math.max(0.05, min * 0.1 || 0.1);
    min = Math.max(0, min - pad);
    max += pad;
  }
  const padding = (max - min) * 0.1 || 0.05;
  min = Math.max(0, min - padding);
  max += padding;
  min = Math.min(min, 1 - padding);
  max = Math.max(max, 1 + padding);
  return [Math.max(0, min), Math.max(max, 0.2)];
}

function computeAxisPadding(values) {
  const numericValues = values.filter((value) => Number.isFinite(value));
  if (numericValues.length < 2) {
    return 5;
  }
  const sorted = numericValues.slice().sort((a, b) => a - b);
  let smallestGap = Infinity;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1];
    if (Number.isFinite(gap) && gap > 0) {
      smallestGap = Math.min(smallestGap, gap);
    }
  }
  if (!Number.isFinite(smallestGap) || smallestGap === Infinity) {
    const span = sorted[sorted.length - 1] - sorted[0];
    return Math.max(5, span * 0.05);
  }
  return Math.max(5, smallestGap * 0.5);
}

function applyDomainPadding(domain, padding) {
  if (!domain || domain.length !== 2) {
    return domain;
  }
  const [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return domain;
  }
  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  if (!pad) {
    return domain;
  }
  return [min - pad, max + pad];
}
