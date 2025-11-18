import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { appendChartTitle, extendBandSamplesToDomain, renderBandScatterChart } from "./chartWithBands.js";

export function createOxygenEconomySection({ chartEl, noteEl }) {
  function update({ dataset, propulsion = {}, splitDistance = 50, band } = {}) {
    renderOxygenChart(chartEl, {
      propulsion,
      splitDistance,
      band,
    });
    if (noteEl) {
      noteEl.textContent =
        "Points above the diagonal suggest the swimmer under-used their STA oxygen bank; points below show swims that exceeded the simplified model's budget.";
    }
  }

  return {
    update,
  };
}

function renderOxygenChart(containerEl, { propulsion, splitDistance, band }) {
  if (!containerEl) {
    return;
  }
  containerEl.textContent = "";
  const rows = buildEconomyRows({ propulsion, splitDistance });
  if (!rows.length) {
    containerEl.textContent = "Oxygen economy data unavailable for this dataset.";
    return;
  }

  const baseBandSamples = Array.isArray(band?.samples) ? band.samples : [];
  const dataExtent = d3.extent(rows, (row) => row.actualDistance);
  const bandTargetDomain = buildBandTargetDomain(band, dataExtent);
  const initialBandSamples = extendBandSamplesToDomain(baseBandSamples, band?.metadata, bandTargetDomain);
  const xValues = rows
    .map((row) => row.actualDistance)
    .concat(initialBandSamples.map((sample) => sample.x))
    .concat(bandTargetDomain || []);
  const yValues = rows
    .map((row) => row.predictedDistance)
    .concat(initialBandSamples.flatMap((sample) => [sample.lower, sample.upper]));
  const xDomain = applyDomainPadding(buildTightDomain(xValues), computeAxisPadding(xValues));
  const yDomain = buildTightDomain(yValues);
  const diagonalReference = buildDiagonalReference(xDomain, yDomain);
  const bandSamples = extendBandSamplesToDomain(baseBandSamples, band?.metadata, xDomain);

  const chart = renderBandScatterChart({
    containerEl,
    data: rows,
    xAccessor: (row) => row.actualDistance,
    yAccessor: (row) => row.predictedDistance,
    xDomain,
    yDomain,
    height: 420,
    xTickFormat: (value) => `${value.toFixed(0)} m`,
    yTickFormat: (value) => `${value.toFixed(0)} m`,
    xLabel: "Realised distance",
    yLabel: "Predicted distance from STA budget",
    ariaLabel: "Realised vs oxygen-limited distance",
    getPointColor: () => "#0ea5e9",
    getPointRadius: () => 6,
    band: bandSamples.length
      ? {
          samples: bandSamples,
          fill: "#fde68a",
          stroke: "#f59e0b",
          fillOpacity: 0.35,
          strokeWidth: 2,
        }
      : undefined,
    referenceLines: diagonalReference ? [diagonalReference] : [],
    tooltipFormatter: (row) => `
          <strong>${row.name}</strong>
          <div>Realised: ${row.actualDistance?.toFixed(0)} m</div>
          <div>Predicted: ${row.predictedDistance?.toFixed(0)} m</div>
          <div>STA budget: ${row.budget?.toFixed(0)} s</div>
          <div>O₂ per 50 m: ${row.splitCost?.toFixed(1)} s</div>
          <div>Split count: ${row.splitCount?.toFixed(1)}</div>
        `,
  });

  appendChartTitle(chart, "Oxygen economy: realised vs predicted distance");
}

function buildEconomyRows({ propulsion = {}, splitDistance = 50 }) {
  const attempts = propulsion?.attempts || [];
  if (!attempts.length) {
    return [];
  }
  const rows = [];
  attempts.forEach((attempt) => {
    const name = attempt.name || attempt.Name;
    if (!name) {
      return;
    }
    const budget = Number(attempt.sta_budget_s);
    const actualDistance = Number(attempt.distance_m);
    const splitCost = Number(attempt.split_o2_cost);
    if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(actualDistance) || actualDistance <= 0) {
      return;
    }
    const predictedDistance = computePredictedDistanceFromSplit({ splitCost, budget, splitDistance });
    if (!Number.isFinite(predictedDistance)) {
      return;
    }
    const splitCount = actualDistance / splitDistance;
    rows.push({
      name,
      actualDistance,
      predictedDistance,
      budget,
      splitCost,
      splitCount,
    });
  });
  return rows;
}

function computePredictedDistanceFromSplit({ splitCost, budget, splitDistance }) {
  if (!Number.isFinite(splitCost) || splitCost <= 0 || !Number.isFinite(budget) || budget <= 0) {
    return NaN;
  }
  return (budget / splitCost) * splitDistance;
}

function padDomain([min, max] = [], extraValues = []) {
  return buildTightDomain([min, max, ...extraValues]);
}

function padDomainFromData([min, max] = [], extraValues = []) {
  return buildTightDomain([min, max, ...extraValues]);
}

function buildTightDomain(values = []) {
  const numericValues = values.filter((value) => Number.isFinite(value));
  if (!numericValues.length) {
    return [0, 1];
  }
  let min = Math.min(...numericValues);
  let max = Math.max(...numericValues);
  if (min === max) {
    const pad = Math.max(5, Math.abs(min) * 0.05 || 5);
    min -= pad;
    max += pad;
  }
  return [Math.max(0, min), max];
}

function buildDiagonalReference(xDomain, yDomain) {
  if (!isValidDomain(xDomain) || !isValidDomain(yDomain)) {
    return null;
  }
  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;
  const start = Math.max(0, Math.min(xMin, yMin));
  const end = Math.max(xMax, yMax);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return {
    type: "segment",
    x1: start,
    y1: start,
    x2: end,
    y2: end,
    stroke: "#94a3b8",
    strokeDasharray: "4 4",
  };
}

function isValidDomain(domain) {
  return Array.isArray(domain) && domain.length === 2 && domain.every((value) => Number.isFinite(value));
}

function buildBandTargetDomain(band, fallbackDomain) {
  const samples = Array.isArray(band?.samples) ? band.samples : [];
  const metaMin = Number(band?.metadata?.x_min);
  const metaMax = Number(band?.metadata?.x_max);
  const sampleXs = samples.map((sample) => Number(sample.x)).filter((value) => Number.isFinite(value));
  const fallbackValues = Array.isArray(fallbackDomain) ? fallbackDomain.filter((value) => Number.isFinite(value)) : [];
  const candidates = [];
  if (Number.isFinite(metaMin)) {
    candidates.push(metaMin);
  }
  if (Number.isFinite(metaMax)) {
    candidates.push(metaMax);
  }
  candidates.push(...sampleXs, ...fallbackValues);
  if (!candidates.length) {
    return null;
  }
  const min = Math.min(...candidates);
  const max = Math.max(...candidates);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return [min, max];
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
  return [Math.max(0, min - pad), max + pad];
}
