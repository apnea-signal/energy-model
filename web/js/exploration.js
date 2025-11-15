import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { Grid, html } from "https://cdn.jsdelivr.net/npm/gridjs/dist/gridjs.module.js";

const DATASETS = {
  DNF: "../data/aida_greece_2025/DNF.csv",
  DYNB: "../data/aida_greece_2025/DYNB.csv",
};

const datasetSelect = document.getElementById("datasetSelect");
const timeTableEl = document.getElementById("timeTable");
const techniqueTableEl = document.getElementById("techniqueTable");
const distanceTimeEl = d3.select("#distanceTimeChart");
const legendEl = d3.select("#distanceTimeLegend");
const athleteSelect = document.getElementById("athleteSelect");

const state = {
  dataset: "DNF",
  data: [],
  selectedAthlete: "",
};

let timeGrid = null;
let techniqueGrid = null;

Object.keys(DATASETS).forEach((name) => {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  datasetSelect.appendChild(option);
});

datasetSelect.value = state.dataset;
datasetSelect.addEventListener("change", () => loadDataset(datasetSelect.value));
athleteSelect.addEventListener("change", () => {
  state.selectedAthlete = athleteSelect.value;
  renderDistanceTimeChart();
});

loadDataset(state.dataset);

async function loadDataset(dataset) {
  state.dataset = dataset;
  datasetSelect.value = dataset;
  const url = DATASETS[dataset];
  const data = await d3.csv(url, d3.autoType);
  state.data = data;
  populateAthleteSelect();
  renderTables();
  renderDistanceTimeChart();
}

function populateAthleteSelect() {
  const names = Array.from(
    new Set(
      state.data
        .map((row, idx) => row.Name || `Athlete ${idx + 1}`)
        .filter((name) => Boolean(name))
    )
  ).sort((a, b) => a.localeCompare(b));
  const previous = state.selectedAthlete;
  const topAthlete = getTopAthleteName();
  athleteSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All athletes";
  athleteSelect.appendChild(allOption);
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    athleteSelect.appendChild(option);
  });
  let nextSelection = "";
  if (previous && names.includes(previous)) {
    nextSelection = previous;
  } else if (topAthlete && names.includes(topAthlete)) {
    nextSelection = topAthlete;
  }
  athleteSelect.value = nextSelection;
  state.selectedAthlete = nextSelection;
}

function renderTables() {
  const columns = Object.keys(state.data[0] || {});
  const timeColumns = selectTimeColumns(columns);
  const techniqueColumns = selectTechniqueColumns(columns);
  renderGridTable(timeColumns, timeTableEl, "time");
  renderGridTable(techniqueColumns, techniqueTableEl, "technique");
}

function renderGridTable(columns, container, type) {
  if (type === "time" && timeGrid) {
    timeGrid.destroy();
    timeGrid = null;
  }
  if (type === "technique" && techniqueGrid) {
    techniqueGrid.destroy();
    techniqueGrid = null;
  }

  container.innerHTML = "";
  if (!columns.length) {
    container.textContent = "No columns available for this view.";
    return;
  }

  const columnDefs = columns.map((col) => {
    const lower = col.toLowerCase();
    return {
      id: col,
      name: col,
      sort: true,
      formatter: createColumnFormatter(lower),
      attributes: (cell) => ({
        className: lower.includes("style") ? "style-col" : undefined,
        title: typeof cell === "string" ? cell : undefined,
      }),
    };
  });

  const data = state.data.map((row) => columns.map((col) => row[col] ?? ""));

  const grid = new Grid({
    columns: columnDefs,
    data,
    sort: true,
    search: false,
    pagination: false,
    resizable: true,
    className: {
      table: "preview-grid",
    },
  });

  grid.render(container);

  if (type === "time") {
    timeGrid = grid;
    setTimeout(() => {
      const distIndex = columns.indexOf("Dist");
      if (distIndex >= 0) {
        grid.updateConfig({ sort: { column: distIndex, direction: "desc" } }).forceRender();
      }
    }, 0);
  } else {
    techniqueGrid = grid;
  }
}

function renderDistanceTimeChart() {
  distanceTimeEl.selectAll("*").remove();
  legendEl.selectAll("*").remove();

  const trajectories = buildTrajectories();
  if (!trajectories.length) {
    distanceTimeEl.append("div").attr("class", "alert").text("No split data available for this dataset.");
    return;
  }

  const allPoints = trajectories.flatMap((athlete) => athlete.points);
  const splitDistances = getSplitDistances();

  const width = distanceTimeEl.node().clientWidth || 900;
  const height = 420;
  const margins = { top: 20, right: 30, bottom: 60, left: 80 };

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(allPoints, (d) => d.distance) || 0])
    .nice()
    .range([margins.left, width - margins.right]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(allPoints, (d) => d.time) || 0])
    .nice()
    .range([height - margins.bottom, margins.top]);

  const svg = distanceTimeEl.append("svg").attr("viewBox", `0 0 ${width} ${height}`);

  if (splitDistances.length) {
    svg
      .selectAll(".split-line")
      .data(splitDistances)
      .enter()
      .append("line")
      .attr("class", "split-line")
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("y1", y.range()[0])
      .attr("y2", y.range()[1])
      .attr("stroke", "#e2e8f0")
      .attr("stroke-dasharray", "4 4")
      .attr("stroke-width", 1);
  }

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margins.bottom})`)
    .call(d3.axisBottom(x))
    .append("text")
    .attr("x", width / 2)
    .attr("y", 45)
    .attr("fill", "#0f172a")
    .text("Distance (m)");

  svg
    .append("g")
    .attr("transform", `translate(${margins.left}, 0)`)
    .call(d3.axisLeft(y).tickFormat((d) => formatSeconds(d)))
    .append("text")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -55)
    .attr("fill", "#0f172a")
    .text("Time");

  const palette = [...d3.schemeTableau10, ...d3.schemeSet2, ...d3.schemeSet3];
  const color = d3.scaleOrdinal(palette).domain(trajectories.map((athlete) => athlete.name));

  const line = d3
    .line()
    .x((d) => x(d.distance))
    .y((d) => y(d.time));

  const selected = state.selectedAthlete;
  const highlightActive = Boolean(selected);

  svg
    .selectAll(".athlete-line")
    .data(trajectories)
    .enter()
    .append("path")
    .attr("class", "athlete-line")
    .attr("fill", "none")
    .attr("stroke", (d) => color(d.name))
    .attr("stroke-width", (d) => (selected === d.name ? 3.2 : 1.8))
    .attr("d", (d) => line(d.points))
    .attr("opacity", (d) => (highlightActive ? (d.name === selected ? 0.95 : 0.25) : 0.9));

  svg
    .selectAll(".athlete-points")
    .data(trajectories)
    .enter()
    .append("g")
    .attr("fill", (d) => color(d.name))
    .selectAll("circle")
    .data((d) => d.points)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(d.distance))
    .attr("cy", (d) => y(d.time))
    .attr("r", (d) => (highlightActive && d.name !== selected ? 2 : 3))
    .attr("opacity", (d) => (highlightActive && d.name !== selected ? 0.3 : 1))
    .append("title")
    .text((d) => `${d.name}: ${d.distance} m @ ${formatSeconds(d.time)}`);

  renderSelectedLabels(svg, trajectories, x, y);
  renderLegend(trajectories, color);
}

function renderSelectedLabels(svg, trajectories, x, y) {
  const points = computeSelectedSplitTimes(trajectories);
  const existingLabels = svg.selectAll(".selected-label");
  existingLabels.remove();
  if (!points.length) {
    return;
  }

  const line = d3
    .line()
    .x((d) => x(d.distance))
    .y((d) => y(d.time));

  svg
    .append("path")
    .datum(points)
    .attr("fill", "none")
    .attr("stroke", "#0f172a")
    .attr("stroke-dasharray", "6 4")
    .attr("stroke-width", 2)
    .attr("opacity", 0.9)
    .attr("d", line);

  const labels = svg
    .selectAll(".selected-label")
    .data(points)
    .enter()
    .append("g")
    .attr("class", "selected-label")
    .attr("transform", (d) => `translate(${x(d.distance) + 6}, ${y(d.time) - 10})`);

  labels
    .append("rect")
    .attr("rx", 4)
    .attr("ry", 4)
    .attr("width", (d) => labelWidth(formatSeconds(d.time)))
    .attr("height", 16)
    .attr("fill", "rgba(15, 23, 42, 0.85)")
    .attr("stroke", "#fff")
    .attr("stroke-width", 1);

  labels
    .append("text")
    .attr("x", 4)
    .attr("y", 11)
    .attr("fill", "#fff")
    .attr("font-size", "10px")
    .text((d) => formatSeconds(d.time));
}

function renderLegend(trajectories, color) {
  const selected = state.selectedAthlete;
  const items = legendEl.selectAll("div").data(trajectories, (d) => d.name);

  items.exit().remove();

  const enter = items
    .enter()
    .append("div")
    .attr("class", "legend-item");

  enter
    .append("span")
    .attr("class", "legend-swatch")
    .style("background", (d) => color(d.name));

  enter
    .append("span")
    .text((d) => d.name);

  enter.merge(items).classed("selected", (d) => selected && d.name === selected);

  legendEl.selectAll(".legend-item").on("click", (event, d) => {
    if (state.selectedAthlete === d.name) {
      state.selectedAthlete = "";
      athleteSelect.value = "";
    } else {
      state.selectedAthlete = d.name;
      athleteSelect.value = d.name;
    }
    renderDistanceTimeChart();
  });
}

function buildTrajectories() {
  const splitDistances = getSplitDistances();
  const timeColumn = getPrimaryTimeColumn();
  return state.data
    .map((row, index) => {
      const points = [];
      points.push({ distance: 0, time: 0, name: row.Name || `Athlete ${index + 1}` });
      splitDistances.forEach((distance) => {
        const time = parseTimeToSeconds(row[`T${distance}`]);
        if (Number.isFinite(time)) {
          points.push({ distance, time, name: row.Name || `Athlete ${index + 1}` });
        }
      });
      const finalDistance = Number(row.Dist);
      const finalTime = parseTimeToSeconds(row[timeColumn]);
      if (Number.isFinite(finalDistance) && Number.isFinite(finalTime)) {
        if (!points.length || points[points.length - 1].distance !== finalDistance) {
          points.push({ distance: finalDistance, time: finalTime, name: row.Name || `Athlete ${index + 1}` });
        }
      }
      const filtered = points.filter((point, idx, arr) => {
        if (!Number.isFinite(point.distance) || !Number.isFinite(point.time)) {
          return false;
        }
        if (idx > 0 && point.distance === arr[idx - 1].distance && point.time === arr[idx - 1].time) {
          return false;
        }
        return true;
      });
      return { name: row.Name || `Athlete ${index + 1}`, points: filtered };
    })
    .filter((athlete) => athlete.points.length >= 2);
}

function createColumnFormatter(lower) {
  if (lower.includes("video")) {
    return (cell) => (cell ? html(`<a href="${cell}" target="_blank" rel="noreferrer">Open video</a>`) : "");
  }
  return (cell) => cell;
}

function selectTimeColumns(columns) {
  const extras = ["Name", "Dist", "TT"];
  const ordered = [];
  const seen = new Set();

  extras.forEach((col) => {
    if (columns.includes(col) && !seen.has(col)) {
      ordered.push(col);
      seen.add(col);
    }
  });

  columns.forEach((col) => {
    const lower = col.toLowerCase();
    if ((/^t\d+$/i).test(col) || lower.includes("time")) {
      if (!seen.has(col)) {
        ordered.push(col);
        seen.add(col);
      }
    }
  });

  return ordered;
}

function selectTechniqueColumns(columns) {
  const keywords = ["fin", "kick", "pull", "arm", "st_", "tk", "tw", "glide", "dk", "wk"];
  const ordered = [];
  const seen = new Set();

  if (columns.includes("Name")) {
    ordered.push("Name");
    seen.add("Name");
  }

  columns.forEach((col) => {
    const lower = col.toLowerCase();
    if (lower === "additions" || lower.includes("style")) {
      return;
    }
    if (lower === "ta" || /^a[0-9_]+$/i.test(col)) {
      if (!seen.has(col)) {
        ordered.push(col);
        seen.add(col);
      }
      return;
    }
    if (keywords.some((keyword) => lower.includes(keyword))) {
      if (!seen.has(col)) {
        ordered.push(col);
        seen.add(col);
      }
    }
  });

  return ordered;
}

function parseTimeToSeconds(value) {
  if (value === undefined || value === null || value === "-") {
    return NaN;
  }
  if (typeof value === "number") {
    return value;
  }
  const parts = String(value).split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return NaN;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }
  return parts[0];
}

function formatSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) {
    return "-";
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getPrimaryTimeColumn() {
  const columns = Object.keys(state.data[0] || {});
  if (columns.includes("TT")) {
    return "TT";
  }
  const candidate = columns.find((col) => col.toLowerCase().includes("time"));
  return candidate || columns.find((col) => col.toLowerCase().startsWith("t")) || columns[0];
}

function getSplitDistances() {
  const columns = Object.keys(state.data[0] || {});
  return columns
    .map((col) => {
      const match = /^T(\d+)$/.exec(col);
      return match ? Number(match[1]) : null;
    })
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function computeSelectedSplitTimes(trajectories) {
  const selected = state.selectedAthlete;
  if (!selected) {
    return [];
  }
  const athlete = trajectories.find((item) => item.name === selected);
  if (!athlete) {
    return [];
  }
  return athlete.points;
}

function getTopAthleteName() {
  let topName = "";
  let topDistance = -Infinity;
  state.data.forEach((row, index) => {
    const distance = Number(row.Dist);
    if (Number.isFinite(distance) && distance > topDistance) {
      topDistance = distance;
      topName = row.Name || `Athlete ${index + 1}`;
    }
  });
  return topName;
}

function labelWidth(text) {
  const padding = 8;
  const charWidth = 6;
  return Math.max(32, padding + text.length * charWidth);
}
