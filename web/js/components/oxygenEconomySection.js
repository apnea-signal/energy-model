import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { appendChartTitle, renderBandScatterChart } from "./chartWithBands.js";

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

  const xDomain = padDomainFromData(d3.extent(rows, (row) => row.actualDistance));
  const yDomain = padDomain(d3.extent(rows, (row) => row.predictedDistance));
  const diagonalReference = buildDiagonalReference(xDomain, yDomain);

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
    band: band?.samples?.length
      ? {
          samples: band.samples,
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

function padDomain([min, max] = []) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  if (min === max) {
    const pad = Math.max(5, min * 0.05 || 5);
    min -= pad;
    max += pad;
  }
  const padding = (max - min) * 0.08 || 5;
  return [Math.max(0, min - padding), max + padding];
}

function padDomainFromData([min, max] = []) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  const span = Math.max(max - min, 1);
  const padding = span * 0.08 || 5;
  return [Math.max(0, min - padding), max + padding];
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
