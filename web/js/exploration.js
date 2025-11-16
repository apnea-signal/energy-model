import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { Grid, html } from "https://cdn.jsdelivr.net/npm/gridjs/dist/gridjs.module.js";

const DATASETS = {
  DNF: "../data/aida_greece_2025/DNF.csv",
  DYNB: "../data/aida_greece_2025/DYNB.csv",
};
const STA_DATA_URL = "../data/aida_greece_2025/STA_PB.csv";

const datasetSelect = document.getElementById("datasetSelect");
const timeTableEl = document.getElementById("timeTable");
const techniqueTableEl = document.getElementById("techniqueTable");
const distanceTimeEl = d3.select("#distanceTimeChart");
const legendEl = d3.select("#distanceTimeLegend");
const noteShelfEl = document.getElementById("splitStats");
const athleteSelect = document.getElementById("athleteSelect");
const staTableEl = document.getElementById("staTable");
const staChartEl = d3.select("#staPerformanceChart");
const staTrainingNoteEl = document.getElementById("staTrainingNote");

const state = {
  dataset: "DNF",
  data: [],
  selectedAthlete: "",
};

let timeGrid = null;
let techniqueGrid = null;
let staGrid = null;
let MODEL_PARAMS = {};
let staRoster = [];

Object.keys(DATASETS).forEach((name) => {
  const option = document.createElement("option");
  option.value = name;
  option.textContent = name;
  datasetSelect.appendChild(option);
});

datasetSelect.value = state.dataset;
datasetSelect.addEventListener("change", () => loadDataset(datasetSelect.value));
athleteSelect.addEventListener("change", () => {
  setSelectedAthlete(athleteSelect.value);
});

init();

async function init() {
  await loadModelParams();
  await loadStaData();
  await loadDataset(state.dataset);
}

async function loadStaData() {
  try {
    const rows = await d3.csv(STA_DATA_URL);
    staRoster = rows
      .map((row) => {
        const name = (row.Name || "").trim();
        const sta = (row.STA || "").trim();
        const year = (row.STA_YEAR || "").trim();
        return {
          Name: name,
          STA: sta,
          STA_YEAR: year,
          key: normalizeName(name),
          seconds: parseTimeToSeconds(sta),
        };
      })
      .filter((row) => row.Name);
    renderStaTable();
    if (state.data.length) {
      renderStaCorrelationChart();
    }
  } catch (error) {
    console.warn("STA PB data unavailable", error);
    staRoster = [];
    if (staTableEl) {
      staTableEl.textContent = "STA PB data unavailable.";
    }
  }
}

async function loadDataset(dataset) {
  state.dataset = dataset;
  datasetSelect.value = dataset;
  const url = DATASETS[dataset];
  const data = await d3.csv(url, d3.autoType);
  state.data = data;
  populateAthleteSelect();
  renderTables();
  renderDistanceTimeChart();
  renderSplitStats();
  renderStaCorrelationChart();
}

async function loadModelParams() {
  try {
    const response = await fetch("./dashboard_data/model_params.json");
    if (!response.ok) {
      throw new Error("Failed to fetch model params");
    }
    MODEL_PARAMS = await response.json();
    window.MODEL_PARAMS = MODEL_PARAMS;
  } catch (error) {
    console.warn("Model params unavailable", error);
    MODEL_PARAMS = {};
    window.MODEL_PARAMS = MODEL_PARAMS;
  }
}

function setSelectedAthlete(name = "", options = {}) {
  const { toggle = false } = options;
  let nextSelection = name || "";
  if (toggle && nextSelection && state.selectedAthlete === nextSelection) {
    nextSelection = "";
  }
  if (athleteSelect) {
    athleteSelect.value = nextSelection;
  }
  if (state.selectedAthlete === nextSelection) {
    return;
  }
  state.selectedAthlete = nextSelection;
  renderDistanceTimeChart();
  renderSplitStats();
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

function renderStaTable() {
  if (!staTableEl) {
    return;
  }
  if (staGrid) {
    staGrid.destroy();
    staGrid = null;
  }

  if (!staRoster.length) {
    staTableEl.textContent = "No STA PB rows found.";
    return;
  }

  const grid = new Grid({
    columns: [
      { id: "Name", name: "Name", sort: true },
      { id: "STA", name: "STA PB" },
      { id: "STA_YEAR", name: "Year" },
    ],
    data: staRoster.map((row) => [row.Name, row.STA || "-", row.STA_YEAR || "-"]),
    sort: true,
    search: true,
    pagination: false,
    resizable: true,
    className: { table: "preview-grid" },
  });
  grid.render(staTableEl);
  staGrid = grid;
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

  const containerNode = distanceTimeEl.node();
  const width = containerNode?.clientWidth || 900;
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
  const distanceTooltip = createChartTooltip(distanceTimeEl);

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
    .on("mouseenter", (event, d) => {
      if (!distanceTooltip) {
        return;
      }
      distanceTooltip.show(event, `<strong>${d.name}</strong><div>${d.distance} m @ ${formatSeconds(d.time)}</div>`);
    })
    .on("mousemove", (event) => {
      distanceTooltip?.move(event);
    })
    .on("mouseleave", () => {
      distanceTooltip?.hide();
    })
    .on("click", (event, d) => {
      setSelectedAthlete(d.name, { toggle: true });
      event.stopPropagation();
    })
    .append("title")
    .text((d) => `${d.name}: ${d.distance} m @ ${formatSeconds(d.time)}`);

  svg.on("click", () => {
    if (state.selectedAthlete) {
      setSelectedAthlete("", { toggle: false });
    }
  });

  renderSelectedLabels(svg, trajectories, x, y);
  renderLegend(trajectories, color);
}

function renderStaCorrelationChart() {
  if (!staChartEl || !staChartEl.node()) {
    return;
  }
  const containerNode = staChartEl.node();
  staChartEl.selectAll("*").remove();

  if (!staRoster.length) {
    staChartEl.append("div").attr("class", "alert").text("STA PB data unavailable.");
    renderStaTrainingNote([]);
    return;
  }
  if (!state.data.length) {
    staChartEl.append("div").attr("class", "alert").text("Load a dataset to see the correlation plot.");
    renderStaTrainingNote([]);
    return;
  }

  const lookup = buildStaLookup();
  const points = state.data
    .map((row, idx) => {
      const name = row.Name || `Athlete ${idx + 1}`;
      const key = normalizeName(name);
      const staEntry = lookup.get(key);
      const distance = Number(row.Dist);
      if (!staEntry || !Number.isFinite(distance) || !Number.isFinite(staEntry.seconds)) {
        return null;
      }
      return {
        name,
        distance,
        staSeconds: staEntry.seconds,
        staDisplay: staEntry.STA,
        staYear: staEntry.STA_YEAR,
      };
    })
    .filter(Boolean);

  if (!points.length) {
    staChartEl
      .append("div")
      .attr("class", "alert")
      .text("No overlapping athletes with STA PB values for this dataset.");
    renderStaTrainingNote([]);
    return;
  }

  renderStaTrainingNote(points);

  const width = containerNode.clientWidth || 900;
  const height = 360;
  const margins = { top: 20, right: 30, bottom: 60, left: 80 };
  const [minSta, maxSta] = d3.extent(points, (d) => d.staSeconds);
  const maxDistance = d3.max(points, (d) => d.distance) || 0;
  const yDomainMax = Math.max(maxDistance, 110);

  if (!Number.isFinite(minSta) || !Number.isFinite(maxSta)) {
    staChartEl
      .append("div")
      .attr("class", "alert")
      .text("STA PB values are not parsable for this dataset.");
    return;
  }

  const x = d3
    .scaleLinear()
    .domain([minSta, maxSta])
    .nice()
    .range([margins.left, width - margins.right]);
  const y = d3
    .scaleLinear()
    .domain([100, yDomainMax])
    .nice()
    .range([height - margins.bottom, margins.top]);

  const svg = staChartEl.append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const staTooltip = createChartTooltip(staChartEl);

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margins.bottom})`)
    .call(d3.axisBottom(x).tickFormat((d) => formatSeconds(d)))
    .append("text")
    .attr("x", width / 2)
    .attr("y", 45)
    .attr("fill", "#0f172a")
    .text("Static PB (mm:ss)");

  svg
    .append("g")
    .attr("transform", `translate(${margins.left}, 0)`)
    .call(d3.axisLeft(y))
    .append("text")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -55)
    .attr("fill", "#0f172a")
    .text("Total performance (m)");

  renderStaTrendBand(svg, x, y);

  const circles = svg
    .append("g")
    .selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(d.staSeconds))
    .attr("cy", (d) => y(d.distance))
    .attr("r", 5)
    .attr("fill", (d) => (Number(d.staYear) >= 2024 ? "#0284c7" : "#94a3b8"))
    .attr("stroke", "#0f172a")
    .attr("stroke-width", 0.5)
    .attr("opacity", 0.9);

  circles
    .on("mouseenter", (event, d) => {
      if (!staTooltip) {
        return;
      }
      const staLine = `STA ${d.staDisplay || "-"}${d.staYear ? ` (${d.staYear})` : ""}`;
      staTooltip.show(event, `<strong>${d.name}</strong><div>${staLine}</div><div>${d.distance} m ${state.dataset}</div>`);
    })
    .on("mousemove", (event) => {
      staTooltip?.move(event);
    })
    .on("mouseleave", () => {
      staTooltip?.hide();
    })
    .append("title")
    .text(
      (d) => `${d.name}: STA ${d.staDisplay || "-"}${d.staYear ? ` (${d.staYear})` : ""} → ${d.distance} m ${state.dataset}`
    );
}

function renderStaTrendBand(svg, xScale, yScale) {
  const samples = MODEL_PARAMS?.[state.dataset]?.sta_band?.samples || [];
  if (!samples.length) {
    return;
  }

  const area = d3
    .area()
    .x((d) => xScale(d.x))
    .y0((d) => yScale(d.lower))
    .y1((d) => yScale(d.upper))
    .curve(d3.curveMonotoneX);

  svg
    .append("path")
    .datum(samples)
    .attr("class", "sta-band")
    .attr("fill", "rgba(14, 165, 233, 0.12)")
    .attr("stroke", "none")
    .attr("d", area);

  const line = d3
    .line()
    .x((d) => xScale(d.x))
    .y((d) => yScale(d.center))
    .curve(d3.curveMonotoneX);

  svg
    .append("path")
    .datum(samples)
    .attr("class", "sta-band-line")
    .attr("fill", "none")
    .attr("stroke", "#0284c7")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "6 4")
    .attr("d", line);
}

function renderStaTrainingNote(points) {
  if (!staTrainingNoteEl) {
    return;
  }
  staTrainingNoteEl.innerHTML = "";
  const datasetPoints = Array.isArray(points) ? points : [];

  const appendParagraph = (text, className = "") => {
    const p = document.createElement("p");
    p.textContent = text;
    if (className) {
      p.className = className;
    }
    staTrainingNoteEl.appendChild(p);
  };

  if (!staRoster.length || !state.data.length) {
    appendParagraph("Load a dataset with STA PB entries to surface standout athletes.");
    return;
  }

  const band = MODEL_PARAMS?.[state.dataset]?.sta_band;
  if (!band?.samples?.length) {
    appendParagraph(`${state.dataset}: STA projection band unavailable.`);
    return;
  }

  const highlights = findStaHighPerformers(datasetPoints);
  if (!highlights.length) {
    appendParagraph(`${state.dataset}: No athletes are significantly above the STA projection right now.`);
    return;
  }

  appendParagraph(`${state.dataset} STA efficiency targets`, "note-lede");
  appendParagraph("These athletes outperform the STA-based upper band; review their technique cues:");

  const list = document.createElement("dl");
  highlights.forEach((athlete) => {
    const dt = document.createElement("dt");
    dt.textContent = athlete.name;
    const staLabel = athlete.staDisplay
      ? `STA ${athlete.staDisplay}${athlete.staYear ? ` (${athlete.staYear})` : ""}`
      : "STA PB";
    const delta = Math.round(athlete.delta);
    const dd = document.createElement("dd");
    dd.textContent = `${athlete.distance} m (${delta}+ m above band, ${staLabel})`;
    list.appendChild(dt);
    list.appendChild(dd);
  });
  staTrainingNoteEl.appendChild(list);
}

function findStaHighPerformers(points) {
  const band = MODEL_PARAMS?.[state.dataset]?.sta_band;
  if (!band?.samples?.length) {
    return [];
  }
  const threshold = Math.max(5, Number(band.band_width || 0) * 0.25);
  return points
    .map((point) => {
      const staYear = Number(point.staYear);
      if (!Number.isFinite(staYear) || staYear < 2024) {
        return null;
      }
      const upper = interpolateStaBandValue(point.staSeconds, "upper");
      if (!Number.isFinite(upper)) {
        return null;
      }
      const delta = point.distance - upper;
      if (!Number.isFinite(delta)) {
        return null;
      }
      return { ...point, delta };
    })
    .filter((entry) => entry && entry.delta >= threshold)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);
}

function interpolateStaBandValue(seconds, key) {
  const band = MODEL_PARAMS?.[state.dataset]?.sta_band;
  const samples = band?.samples;
  if (!samples?.length) {
    return null;
  }
  if (seconds <= samples[0].x) {
    return samples[0]?.[key];
  }
  const last = samples[samples.length - 1];
  if (seconds >= last.x) {
    return last?.[key];
  }
  for (let i = 0; i < samples.length - 1; i += 1) {
    const current = samples[i];
    const next = samples[i + 1];
    if (seconds >= current.x && seconds <= next.x) {
      const span = next.x - current.x || 1;
      const ratio = (seconds - current.x) / span;
      const start = current?.[key];
      const end = next?.[key];
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      return start + (end - start) * ratio;
    }
  }
  return null;
}

function createChartTooltip(containerSelection) {
  if (!containerSelection || !containerSelection.node || !containerSelection.node()) {
    return null;
  }
  const containerNode = containerSelection.node();
  const tooltip = containerSelection
    .append("div")
    .attr("class", "chart-tooltip")
    .style("opacity", 0)
    .style("visibility", "hidden");

  const offset = 12;
  const reposition = (event) => {
    const [xPos, yPos] = d3.pointer(event, containerNode);
    const tooltipNode = tooltip.node();
    if (!tooltipNode) {
      return;
    }
    const tooltipWidth = tooltipNode.offsetWidth || 0;
    const tooltipHeight = tooltipNode.offsetHeight || 0;
    const { width: containerWidth = tooltipWidth, height: containerHeight = tooltipHeight } =
      containerNode.getBoundingClientRect();
    let left = xPos + offset;
    let top = yPos - tooltipHeight - offset;

    if (left + tooltipWidth > containerWidth - offset) {
      left = containerWidth - tooltipWidth - offset;
    }
    if (left < offset) {
      left = offset;
    }
    if (top < offset) {
      top = yPos + offset;
    }
    if (top + tooltipHeight > containerHeight - offset) {
      top = containerHeight - tooltipHeight - offset;
    }

    tooltip.style("transform", `translate(${left}px, ${top}px)`);
  };

  return {
    show(event, html) {
      tooltip.style("visibility", "visible").style("opacity", 1).html(html);
      reposition(event);
    },
    move(event) {
      reposition(event);
    },
    hide() {
      tooltip.style("opacity", 0).style("visibility", "hidden").style("transform", "translate(-9999px, -9999px)");
    },
  };
}

function renderSplitStats() {
  noteShelfEl.innerHTML = "";
  const dataset = state.dataset;
  const splits = MODEL_PARAMS?.[dataset]?.splits || [];
  if (!splits.length) {
    const fallback = document.createElement("p");
    fallback.textContent = "Weighted split stats unavailable. Run build_split_stats.py.";
    noteShelfEl.appendChild(fallback);
    return;
  }
  const intro = document.createElement("p");
  intro.className = "note-lede";
  intro.textContent = `${dataset} weighted split targets from the longest-distance athletes:`;
  noteShelfEl.appendChild(intro);
  const list = document.createElement("dl");
  splits.forEach((split) => {
    const dt = document.createElement("dt");
    dt.textContent = `${split.split_label} (${split.split_distance_m} m)`;
    const dd = document.createElement("dd");
    dd.textContent = split.weighted_time_str;
    list.appendChild(dt);
    list.appendChild(dd);
  });
  noteShelfEl.appendChild(list);
}

function renderSelectedLabels(svg, trajectories, x, y) {
  const points = getReferenceSplitPoints(trajectories);
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
    setSelectedAthlete(d.name, { toggle: true });
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
  if (typeof value === "string" && value.trim() === "") {
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
  return athlete.points.map((point) => ({ distance: point.distance, time: point.time }));
}

function getReferenceSplitPoints(trajectories) {
  const selectedPoints = computeSelectedSplitTimes(trajectories);
  if (selectedPoints.length) {
    return selectedPoints;
  }
  const baseline = [{ distance: 0, time: 0 }];
  const splits = MODEL_PARAMS?.[state.dataset]?.splits || [];
  splits.forEach((split) => {
    if (Number.isFinite(split?.split_distance_m) && Number.isFinite(split?.weighted_time_s)) {
      baseline.push({ distance: split.split_distance_m, time: split.weighted_time_s });
    }
  });
  return baseline;
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

function buildStaLookup() {
  const map = new Map();
  staRoster.forEach((row) => {
    if (row.key) {
      map.set(row.key, row);
    }
  });
  return map;
}

function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}
