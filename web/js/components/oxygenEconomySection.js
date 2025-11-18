import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip, normalizeName } from "../utils.js";

export function createOxygenEconomySection({ chartEl, noteEl }) {
  function update({ dataset, data = [], movement = [], propulsion = {}, splitDistance = 50 } = {}) {
    renderOxygenChart(chartEl, {
      data,
      movement,
      propulsion,
      splitDistance,
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

function renderOxygenChart(containerEl, { data, movement, propulsion, splitDistance }) {
  if (!containerEl) {
    return;
  }
  containerEl.textContent = "";
  const rows = buildEconomyRows({ data, movement, propulsion, splitDistance });
  if (!rows.length) {
    containerEl.textContent = "Oxygen economy data unavailable for this dataset.";
    return;
  }

  const width = containerEl.clientWidth || 900;
  const height = 420;
  const margin = { top: 30, right: 24, bottom: 56, left: 64 };
  const xDomain = d3.extent(rows, (row) => row.actualDistance);
  const yDomain = d3.extent(rows, (row) => row.predictedDistance);
  const xScale = d3.scaleLinear().domain(padDomain(xDomain)).range([margin.left, width - margin.right]);
  const yScale = d3.scaleLinear().domain(padDomain(yDomain)).range([height - margin.bottom, margin.top]);
  const svg = d3
    .select(containerEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Realised vs oxygen-limited distance");
  const tooltip = createChartTooltip(d3.select(containerEl));

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(d3.axisBottom(xScale).ticks(6).tickFormat((value) => `${value.toFixed(0)} m`));

  svg.append("text").attr("x", width / 2).attr("y", height - 8).attr("text-anchor", "middle").text("Realised distance");

  svg
    .append("g")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(d3.axisLeft(yScale).ticks(6).tickFormat((value) => `${value.toFixed(0)} m`));

  svg
    .append("text")
    .attr("x", -(height / 2))
    .attr("y", 16)
    .attr("text-anchor", "middle")
    .attr("transform", "rotate(-90)")
    .text("Predicted distance from STA budget");

  drawDiagonal(svg, xScale, yScale);

  const points = svg
    .append("g")
    .selectAll("circle")
    .data(rows)
    .enter()
    .append("circle")
    .attr("cx", (row) => xScale(row.actualDistance))
    .attr("cy", (row) => yScale(row.predictedDistance))
    .attr("r", 6)
    .attr("fill", "#0ea5e9")
    .attr("opacity", 0.85);

  points
    .on("mouseenter", (event, row) => {
      tooltip?.show(
        event,
        `
          <strong>${row.name}</strong>
          <div>Realised: ${row.actualDistance?.toFixed(0)} m</div>
          <div>Predicted: ${row.predictedDistance?.toFixed(0)} m</div>
          <div>STA budget: ${row.budget?.toFixed(0)} s</div>
          <div>O₂ per 50 m: ${row.splitCost?.toFixed(1)} s</div>
          <div>Pulls/Kicks: ${row.armPulls}/${row.legKicks}</div>
        `
      );
    })
    .on("mousemove", (event) => tooltip?.move(event))
    .on("mouseleave", () => tooltip?.hide());

  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", margin.top - 10)
    .text("Oxygen economy: realised vs predicted distance");
}

function buildEconomyRows({ data = [], movement = [], propulsion = {}, splitDistance = 50 }) {
  const parameters = propulsion?.parameters;
  const attempts = propulsion?.attempts || [];
  if (!parameters || !attempts.length || !movement.length) {
    return [];
  }
  const techniqueMap = new Map();
  movement.forEach((entry) => {
    const key = normalizeName(entry.name || entry.Name);
    if (!key) {
      return;
    }
    const pulls = Number(entry.arm_pulls);
    const kicks = Number(entry.leg_kicks);
    if (Number.isFinite(pulls) && Number.isFinite(kicks)) {
      techniqueMap.set(key, { arm_pulls: pulls, leg_kicks: kicks });
    }
  });
  if (!techniqueMap.size) {
    return [];
  }

  const distanceLookup = buildDistanceLookup(data);
  const rows = [];
  attempts.forEach((attempt) => {
    const key = normalizeName(attempt.name);
    if (!key) {
      return;
    }
    const technique = techniqueMap.get(key);
    if (!technique) {
      return;
    }
    const budget = Number(attempt.sta_budget_s);
    const actual = Number.isFinite(distanceLookup[key]) ? distanceLookup[key] : Number(attempt.distance_m);
    if (!Number.isFinite(actual) || !Number.isFinite(budget) || budget <= 0) {
      return;
    }
    const splitCost = computeSplitCost(technique, parameters);
    if (!Number.isFinite(splitCost) || splitCost <= 0) {
      return;
    }
    const predictedDistance = (budget / splitCost) * splitDistance;
    if (!Number.isFinite(predictedDistance)) {
      return;
    }
    rows.push({
      name: attempt.name,
      actualDistance: actual,
      predictedDistance,
      budget,
      splitCost,
      armPulls: technique.arm_pulls,
      legKicks: technique.leg_kicks,
    });
  });
  return rows;
}

function computeSplitCost(technique, parameters) {
  const armCost = Number(parameters?.arm_o2_cost) || 0;
  const legCost = Number(parameters?.leg_o2_cost) || 0;
  const wallCost = Number(parameters?.wall_push_o2_cost) || 0;
  const pulls = Number(technique?.arm_pulls);
  const kicks = Number(technique?.leg_kicks);
  if (!Number.isFinite(pulls) || !Number.isFinite(kicks)) {
    return NaN;
  }
  const wallPushesPerSplit = 1; // Single turn per 50 m split for pool dynamics.
  return pulls * armCost + kicks * legCost + wallPushesPerSplit * wallCost;
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

function drawDiagonal(svg, xScale, yScale) {
  const [xMin, xMax] = xScale.domain();
  const [yMin, yMax] = yScale.domain();
  const start = Math.max(0, Math.min(xMin, yMin));
  const end = Math.max(xMax, yMax);
  svg
    .append("line")
    .attr("x1", xScale(start))
    .attr("y1", yScale(start))
    .attr("x2", xScale(end))
    .attr("y2", yScale(end))
    .attr("stroke", "#94a3b8")
    .attr("stroke-dasharray", "4 4");
}
