import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip } from "./utils.js";

const DATA_URL = "../data/dashboard_data/03_movement_intensity.json";

const datasetMenu = document.getElementById("datasetMenu");
const datasetLabelEl = document.getElementById("datasetLabel");
const metadataStatsEl = document.getElementById("metadataStats");
const metadataNoteEl = document.getElementById("metadataNote");
const scatterEl = document.getElementById("intensityScatter");
const scatterNoteEl = document.getElementById("scatterNote");
const leaderboardGridEl = document.getElementById("leaderboardGrid");
const tableContainer = document.getElementById("athleteTable");
const highlightSelect = document.getElementById("highlightSelect");

const state = {
  payload: {},
  datasets: [],
  dataset: null,
  athletes: [],
  metadata: {},
};

let tableSort = { key: "arm_stroke_intensity", direction: "descending" };

if (highlightSelect) {
  highlightSelect.addEventListener("change", () => {
    highlightPoints(highlightSelect.value);
  });
}

init();

async function init() {
  try {
    const payload = await fetchJson(DATA_URL);
    state.payload = payload || {};
    state.datasets = Object.keys(state.payload).sort();
    if (!state.datasets.length) {
      renderError("No datasets found in 03_movement_intensity.json");
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
  state.athletes = Array.isArray(entry.athletes) ? entry.athletes : [];
  state.metadata = entry.metadata || {};
  updateDatasetNavState();
  renderSummary();
  renderLeaderboards();
  renderTable();
  renderScatter();
  populateHighlightSelect();
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
  const athletes = state.athletes;
  const metadata = state.metadata;
  const labelParts = [];
  if (state.dataset) {
    labelParts.push(state.dataset);
  }
  if (athletes.length) {
    labelParts.push(`${athletes.length} athletes`);
  }
  datasetLabelEl.textContent = labelParts.join(" · ");

  const stats = [
    {
      label: "Split distance",
      value: formatNumber(metadata.split_distance_m, 1, "m"),
      detail: "Distance used for the first split regression",
    },
    {
      label: "Arm / leg ratio",
      value: formatNumber(metadata.arm_leg_ratio, 2),
      detail: "Scaling applied when splitting mechanical work",
    },
    {
      label: "Median arm work/pull",
      value: formatNumber(metadata.arm_work_per_pull_median, 3, "units"),
      detail: "Reference work per arm pull",
    },
    {
      label: "Median leg work/kick",
      value: formatNumber(metadata.leg_work_per_kick_median, 3, "units"),
      detail: "Reference work per leg kick",
    },
  ];

  metadataStatsEl.textContent = "";
  stats.forEach((stat) => {
    const card = document.createElement("article");
    card.className = "stat-card";

    const label = document.createElement("p");
    label.className = "stat-label";
    label.textContent = stat.label;

    const value = document.createElement("p");
    value.className = "stat-value";
    value.textContent = stat.value || "—";

    const detail = document.createElement("p");
    detail.className = "stat-detail";
    detail.textContent = stat.detail;

    card.append(label, value, detail);
    metadataStatsEl.appendChild(card);
  });

  const movementBaseline = metadata.movement_intensity_median ?? med(athletes.map((a) => a.movement_intensity));
  metadataNoteEl.innerHTML = `
    <p class="note-lede">Quick reference</p>
    <dl>
      <dt>Movement baseline</dt>
      <dd>${formatNumber(movementBaseline, 2)} intensity</dd>
      <dt>Median arm work</dt>
      <dd>${formatNumber(metadata.arm_work_total_median, 2)}</dd>
      <dt>Median leg work</dt>
      <dd>${formatNumber(metadata.leg_work_total_median, 2)}</dd>
      <dt>Coverage</dt>
      <dd>${athletes.length} athletes with valid rows</dd>
    </dl>
  `;
}

function renderLeaderboards() {
  if (!leaderboardGridEl) {
    return;
  }
  const athletes = state.athletes;
  leaderboardGridEl.textContent = "";
  if (!athletes.length) {
    leaderboardGridEl.textContent = "No athlete rows available.";
    return;
  }

  const highMovement = rankedList(athletes, (row) => row.movement_intensity);
  const economical = rankedList(
    athletes,
    (row) => (Number.isFinite(row.movement_intensity) ? -row.movement_intensity : NaN)
  );
  const balanced = athletes
    .filter((row) => Number.isFinite(row.arm_work_total) && Number.isFinite(row.leg_work_total))
    .sort(
      (a, b) =>
        Math.abs((a.arm_work_total || 0) - (a.leg_work_total || 0)) -
        Math.abs((b.arm_work_total || 0) - (b.leg_work_total || 0))
    )
    .slice(0, 5);

  const cards = [
    {
      title: "High movement load",
      description: "Highest movement intensity",
      items: highMovement,
      formatter: (item) => `${formatNumber(item.movement_intensity, 2)} intensity`,
    },
    {
      title: "Economical pacing",
      description: "Lowest movement intensity",
      items: economical,
      formatter: (item) => `${formatNumber(item.movement_intensity, 2)} intensity`,
    },
    {
      title: "Balanced templates",
      description: "Closest arm/leg match",
      items: balanced,
      formatter: (item) => `Δ ${(Math.abs((item.arm_work_total || 0) - (item.leg_work_total || 0))).toFixed(2)}`,
    },
  ];

  cards.forEach((card) => {
    const article = document.createElement("article");
    article.className = "leaderboard-card";

    const heading = document.createElement("h3");
    heading.textContent = card.title;

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = card.description;

    const list = document.createElement("ol");
    list.className = "leaderboard-list";

    card.items.forEach((row, index) => {
      const item = document.createElement("li");
      item.innerHTML = `<strong>${index + 1}. ${row.name}</strong><span>${card.formatter(row)}</span>`;
      list.appendChild(item);
    });

    article.append(heading, detail, list);
    leaderboardGridEl.appendChild(article);
  });
}

function renderTable() {
  if (!tableContainer) {
    return;
  }
  tableContainer.textContent = "";
  const athletes = [...state.athletes];
  if (!athletes.length) {
    tableContainer.textContent = "No athlete rows available.";
    return;
  }

  const columns = getTableColumns();
  const sortedRows = sortRows(athletes, tableSort.key, tableSort.direction);

  const table = document.createElement("table");
  table.className = "standard-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.dataset.key = column.key;
    th.setAttribute("aria-sort", tableSort.key === column.key ? tableSort.direction : "none");

    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<span>${column.label}</span><span class="sort-indicator">⇅</span>`;
    button.addEventListener("click", () => {
      const direction = tableSort.key === column.key && tableSort.direction === "ascending" ? "descending" : "ascending";
      tableSort = { key: column.key, direction };
      renderTable();
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
      const value = column.render ? column.render(row) : row[column.key];
      td.textContent = value ?? "—";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  tableContainer.appendChild(table);
}

function populateHighlightSelect() {
  if (!highlightSelect) {
    return;
  }
  highlightSelect.textContent = "";
  const blankOption = document.createElement("option");
  blankOption.value = "";
  blankOption.textContent = "None";
  highlightSelect.appendChild(blankOption);

  const sorted = [...state.athletes].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.name;
    option.textContent = row.name;
    highlightSelect.appendChild(option);
  });

  highlightSelect.value = "";
  highlightPoints("");
}

function renderScatter() {
  scatterEl.textContent = "";
  const rows = state.athletes.filter(
    (row) => Number.isFinite(row.arm_work_total) && Number.isFinite(row.leg_work_total)
  );
  if (!rows.length) {
    scatterEl.textContent = "No records with both arm and leg work values.";
    return;
  }

  const width = scatterEl.clientWidth || 900;
  const height = 420;
  const margin = { top: 20, right: 30, bottom: 52, left: 60 };
  const containerSelection = d3.select(scatterEl);
  const tooltip = createChartTooltip(containerSelection);
  const svg = containerSelection
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Total arm vs leg work scatter plot");

  const xDomain = expandDomain(d3.extent(rows, (d) => d.leg_work_total));
  const yDomain = expandDomain(d3.extent(rows, (d) => d.arm_work_total));
  const intensityDomain = d3.extent(rows, (d) => d.movement_intensity);
  if (!Number.isFinite(intensityDomain[0]) || !Number.isFinite(intensityDomain[1])) {
    intensityDomain[0] = 0.8;
    intensityDomain[1] = 1.2;
  }
  const speedDomain = expandDomain(d3.extent(rows, (d) => d.split_speed_m_s));

  const xScale = d3.scaleLinear().domain(xDomain).range([margin.left, width - margin.right]);
  const yScale = d3.scaleLinear().domain(yDomain).range([height - margin.bottom, margin.top]);
  const color = d3
    .scaleLinear()
    .domain(intensityDomain)
    .range(["#bfdbfe", "#1d4ed8"])
    .clamp(true);
  const radius = d3
    .scaleLinear()
    .domain(speedDomain)
    .range([4, 9])
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
    .attr("y", height - 8)
    .attr("text-anchor", "middle")
    .attr("class", "axis-label")
    .text("Total leg work per 50 m (arbitrary units)");

  svg
    .append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", 18)
    .attr("text-anchor", "middle")
    .attr("class", "axis-label")
    .text("Total arm work per 50 m (arbitrary units)");

  const ratio = Number(state.metadata?.arm_leg_ratio) || 1;
  const linePoints = computeRatioLinePoints(xDomain, yDomain, ratio);
  if (linePoints) {
    svg
      .append("line")
      .attr("x1", xScale(linePoints.x1))
      .attr("y1", yScale(linePoints.y1))
      .attr("x2", xScale(linePoints.x2))
      .attr("y2", yScale(linePoints.y2))
      .attr("stroke", "#94a3b8")
      .attr("stroke-dasharray", "6 6");
  }

  const points = svg
    .append("g")
    .attr("class", "scatter-points")
    .selectAll("circle")
    .data(rows)
    .enter()
    .append("circle")
    .attr("cx", (d) => xScale(d.leg_work_total))
    .attr("cy", (d) => yScale(d.arm_work_total))
    .attr("r", (d) => radius(d.split_speed_m_s))
    .attr("fill", (d) => color(d.movement_intensity))
    .attr("opacity", 0.85)
    .attr("data-athlete", (d) => d.name);

  points
    .on("mouseenter", (event, d) => {
      if (!tooltip) {
        return;
      }
      const movementIntensity = d.movement_intensity;
      tooltip.show(
        event,
        `
          <strong>${d.name}</strong>
          <div>Arm work: ${formatNumber(d.arm_work_total, 2)}</div>
          <div>Leg work: ${formatNumber(d.leg_work_total, 2)}</div>
          <div>Movement intensity: ${formatNumber(movementIntensity, 2)}</div>
          <div>T50: ${formatNumber(d.split_time_s, 2)} s</div>
        `
      );
    })
    .on("mousemove", (event) => {
      tooltip?.move(event);
    })
    .on("mouseleave", () => {
      tooltip?.hide();
    });

  scatterNoteEl.innerHTML = `
    <p class="note-lede">Reading the scatter</p>
    <dl>
      <dt>Reference line</dt>
      <dd>Marks the arm/leg ratio (${formatNumber(ratio, 2)}). Points on the line match the assumed split.</dd>
      <dt>Above the line</dt>
      <dd>Arm pulls absorb more total work than leg kicks.</dd>
      <dt>Below the line</dt>
      <dd>Leg kicks consume more total work than arms.</dd>
      <dt>Color</dt>
      <dd>Darker tones signify higher movement intensity.</dd>
    </dl>
  `;

  highlightPoints(highlightSelect?.value || "");
}

function highlightPoints(name) {
  const selector = `.scatter-points circle`;
  const circles = scatterEl.querySelectorAll(selector);
  circles.forEach((circle) => {
    const isMatch = name && circle.getAttribute("data-athlete") === name;
    circle.classList.toggle("is-highlighted", isMatch);
  });
}

function getTableColumns() {
  return [
    { key: "name", label: "Athlete" },
    { key: "samples", label: "Samples", align: "right", render: (row) => row.samples ?? 0 },
    { key: "split_time_s", label: "T50 (s)", align: "right", render: (row) => formatNumber(row.split_time_s, 2) },
    { key: "split_speed_m_s", label: "Speed (m/s)", align: "right", render: (row) => formatNumber(row.split_speed_m_s, 3) },
    { key: "arm_pulls", label: "Arm pulls", align: "right", render: (row) => formatNumber(row.arm_pulls, 2) },
    { key: "leg_kicks", label: "Leg kicks", align: "right", render: (row) => formatNumber(row.leg_kicks, 2) },
    {
      key: "arm_work_per_pull",
      label: "Arm work",
      align: "right",
      render: (row) => formatNumber(row.arm_work_per_pull, 3),
    },
    {
      key: "leg_work_per_kick",
      label: "Leg work",
      align: "right",
      render: (row) => formatNumber(row.leg_work_per_kick, 3),
    },
    {
      key: "arm_work_total",
      label: "Total arm work",
      align: "right",
      render: (row) => formatNumber(row.arm_work_total, 3),
    },
    {
      key: "leg_work_total",
      label: "Total leg work",
      align: "right",
      render: (row) => formatNumber(row.leg_work_total, 3),
    },
    {
      key: "movement_intensity",
      label: "Movement intensity",
      align: "right",
      render: (row) => formatNumber(row.movement_intensity, 3),
    },
  ];
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
        return a.name.localeCompare(b.name);
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

function rankedList(rows, accessor, limit = 5) {
  return rows
    .filter((row) => Number.isFinite(accessor(row)))
    .sort((a, b) => accessor(b) - accessor(a))
    .slice(0, limit);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function renderError(message) {
  if (metadataNoteEl) {
    metadataNoteEl.textContent = message;
  }
  if (scatterEl) {
    scatterEl.textContent = message;
  }
  if (tableContainer) {
    tableContainer.textContent = message;
  }
}

function formatNumber(value, decimals = 2, suffix = "") {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const formatted = Number(value).toFixed(decimals);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function med(values) {
  const cleaned = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!cleaned.length) {
    return NaN;
  }
  const mid = Math.floor(cleaned.length / 2);
  if (cleaned.length % 2 === 0) {
    return (cleaned[mid - 1] + cleaned[mid]) / 2;
  }
  return cleaned[mid];
}

function expandDomain([min, max]) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0.5, 1.5];
  }
  const padding = (max - min) * 0.1 || 0.05;
  return [min - padding, max + padding];
}

function computeRatioLinePoints(xDomain, yDomain, ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return null;
  }
  const xMin = Math.max(xDomain[0], yDomain[0] / ratio);
  const xMax = Math.min(xDomain[1], yDomain[1] / ratio);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax <= xMin) {
    return null;
  }
  return {
    x1: xMin,
    y1: ratio * xMin,
    x2: xMax,
    y2: ratio * xMax,
  };
}
