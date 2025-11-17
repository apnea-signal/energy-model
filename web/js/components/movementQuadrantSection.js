import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip, normalizeName } from "../utils.js";

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
  const width = container.clientWidth || 900;
  const height = 380;
  const margin = { top: 30, right: 30, bottom: 56, left: 60 };
  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Movement intensity vs distance");

  const xDomain = d3.extent(rows, (row) => row.distance);
  const yDomain = expandDomain(d3.extent(rows, (row) => row.movementIntensity));

  const xScale = d3.scaleLinear().domain(xDomain).range([margin.left, width - margin.right]);
  const yScale = d3.scaleLinear().domain(yDomain).range([height - margin.bottom, margin.top]);
  const tooltip = createChartTooltip(d3.select(container));

  const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat((value) => `${value.toFixed(0)} m`);
  const yAxis = d3.axisLeft(yScale).ticks(6);

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margin.bottom})`)
    .call(xAxis);

  svg
    .append("g")
    .attr("transform", `translate(${margin.left}, 0)`)
    .call(yAxis);

  if (band?.samples?.length) {
    drawBand(svg, xScale, yScale, band.samples, "#bfdbfe");
  }

  const points = svg
    .append("g")
    .selectAll("circle")
    .data(rows)
    .enter()
    .append("circle")
    .attr("cx", (row) => xScale(row.distance))
    .attr("cy", (row) => yScale(row.movementIntensity))
    .attr("r", 6)
    .attr("fill", "#2563eb")
    .attr("opacity", 0.85);

  points
    .on("mouseenter", (event, row) => {
      tooltip?.show(
        event,
        `
          <strong>${row.name}</strong>
          <div>Distance: ${row.distance?.toFixed(0) ?? ""} m</div>
          <div>Movement intensity: ${row.movementIntensity?.toFixed(2) ?? ""}</div>
        `
      );
    })
    .on("mousemove", (event) => tooltip?.move(event))
    .on("mouseleave", () => tooltip?.hide());

  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", margin.top - 10)
    .text("Movement intensity vs distance");
}

function drawWorkBiasVsDistance(container, rows, band) {
  const width = container.clientWidth || 900;
  const height = 380;
  const margin = { top: 30, right: 30, bottom: 56, left: 60 };
  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Leg/arm work ratio vs distance");

  const xDomain = d3.extent(rows, (row) => row.distance);
  const yDomain = buildRatioDomain(rows.map((row) => row.workBias));

  const xScale = d3.scaleLinear().domain(xDomain).range([margin.left, width - margin.right]);
  const yScale = d3.scaleLinear().domain(yDomain).range([height - margin.bottom, margin.top]);
  const tooltip = createChartTooltip(d3.select(container));

  const xAxis = d3.axisBottom(xScale).ticks(6).tickFormat((value) => `${value.toFixed(0)} m`);
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
    .append("line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", yScale(1))
    .attr("y2", yScale(1))
    .attr("stroke", "#94a3b8")
    .attr("stroke-dasharray", "4 4");

  if (band?.samples?.length) {
    drawBand(svg, xScale, yScale, band.samples, "#bbf7d0");
  }

  const points = svg
    .append("g")
    .selectAll("circle")
    .data(rows)
    .enter()
    .append("circle")
    .attr("cx", (row) => xScale(row.distance))
    .attr("cy", (row) => yScale(row.workBias))
    .attr("r", 6)
    .attr("fill", "#16a34a")
    .attr("opacity", 0.85);

  points
    .on("mouseenter", (event, row) => {
      tooltip?.show(
        event,
        `
          <strong>${row.name}</strong>
          <div>Distance: ${row.distance?.toFixed(0) ?? ""} m</div>
          <div>Leg ÷ arm work: ${row.workBias?.toFixed(2) ?? ""}</div>
        `
      );
    })
    .on("mousemove", (event) => tooltip?.move(event))
    .on("mouseleave", () => tooltip?.hide());

  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", margin.top - 10)
    .text("Leg vs arm work ratio vs distance");
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

function drawBand(svg, xScale, yScale, samples, color) {
  const areaGenerator = d3
    .area()
    .x((d) => xScale(d.x))
    .y0((d) => yScale(d.lower))
    .y1((d) => yScale(d.upper))
    .curve(d3.curveMonotoneX);

  svg
    .append("path")
    .datum(samples)
    .attr("fill", color)
    .attr("opacity", 0.3)
    .attr("d", areaGenerator);

  const lineGenerator = d3
    .line()
    .x((d) => xScale(d.x))
    .y((d) => yScale(d.center))
    .curve(d3.curveMonotoneX);

  svg
    .append("path")
    .datum(samples)
    .attr("fill", "none")
    .attr("stroke", color)
    .attr("stroke-width", 1.5)
    .attr("d", lineGenerator);
}
