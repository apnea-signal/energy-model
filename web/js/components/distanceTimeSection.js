import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip, findVideoColumn, formatSeconds, parseTimeToSeconds } from "../utils.js";
import { createDataTable } from "./baseTable.js";

export function createDistanceTimeSection({
  athleteSelect,
  timeTableEl,
  distanceTimeChartEl,
  legendEl,
  splitStatsEl,
}) {
  const chartSelection = distanceTimeChartEl ? d3.select(distanceTimeChartEl) : null;
  const legendSelection = legendEl ? d3.select(legendEl) : null;
  const state = {
    data: [],
    dataset: "",
    modelParams: {},
    selectedAthlete: "",
  };
  const timeTable = createDataTable({ container: timeTableEl });

  if (athleteSelect) {
    athleteSelect.addEventListener("change", (event) => {
      setSelectedAthlete(event.target.value);
    });
  }

  function update({ data = [], dataset = "", modelParams = {} }) {
    state.data = Array.isArray(data) ? data : [];
    state.dataset = dataset;
    state.modelParams = modelParams || {};
    populateAthleteSelect();
    renderTimeTable();
    renderDistanceTimeChart();
    renderSplitStats();
  }

  function populateAthleteSelect() {
    if (!athleteSelect) {
      return;
    }
    const names = Array.from(
      new Set(
        state.data
          .map((row, idx) => row.Name || `Athlete ${idx + 1}`)
          .filter((name) => Boolean(name))
      )
    ).sort((a, b) => a.localeCompare(b));
    const previous = state.selectedAthlete;
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
    const nextSelection = previous && names.includes(previous) ? previous : "";
    athleteSelect.value = nextSelection;
    state.selectedAthlete = nextSelection;
  }

  function setSelectedAthlete(name = "", { toggle = false } = {}) {
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

  function renderTimeTable() {
    const columns = Object.keys(state.data[0] || {});
    const videoColumn = findVideoColumn(columns);
    const timeColumns = selectTimeColumns(columns, videoColumn);
    const columnDefs = buildTimeColumnDefs(timeColumns, videoColumn);
    const distIndex = columnDefs.findIndex((column) => column.id === "Dist");
    timeTable.render({
      columns: columnDefs,
      rows: state.data,
      defaultSort: distIndex >= 0 ? { column: distIndex, direction: "desc" } : null,
      emptyMessage: "No columns available for this view.",
    });
  }

  function renderDistanceTimeChart() {
    if (!chartSelection) {
      return;
    }
    chartSelection.selectAll("*").remove();
    if (legendSelection) {
      legendSelection.selectAll("*").remove();
    }

    const trajectories = buildTrajectories();
    if (!trajectories.length) {
      chartSelection.append("div").attr("class", "alert").text("No split data available for this dataset.");
      return;
    }

    const allPoints = trajectories.flatMap((athlete) => athlete.points);
    const splitDistances = getSplitDistances();
    const containerNode = chartSelection.node();
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

    const svg = chartSelection.append("svg").attr("viewBox", `0 0 ${width} ${height}`);
    const distanceTooltip = createChartTooltip(chartSelection);

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

  function renderLegend(trajectories, color) {
    if (!legendSelection) {
      return;
    }
    const selected = state.selectedAthlete;
    const items = legendSelection.selectAll("div").data(trajectories, (d) => d.name);

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

    legendSelection.selectAll(".legend-item").on("click", (event, d) => {
      setSelectedAthlete(d.name, { toggle: true });
    });
  }

  function renderSplitStats() {
    if (!splitStatsEl) {
      return;
    }
    splitStatsEl.innerHTML = "";
    const dataset = state.dataset;
    const splits = state.modelParams?.[dataset]?.splits || [];
    if (!splits.length) {
      const fallback = document.createElement("p");
      fallback.textContent = "Weighted split stats unavailable. Run build_split_stats.py.";
      splitStatsEl.appendChild(fallback);
      return;
    }
    const intro = document.createElement("p");
    intro.className = "note-lede";
    intro.textContent = `${dataset} weighted split targets from the longest-distance athletes:`;
    splitStatsEl.appendChild(intro);
    const list = document.createElement("dl");
    splits.forEach((split) => {
      const dt = document.createElement("dt");
      dt.textContent = `${split.split_label} (${split.split_distance_m} m)`;
      const dd = document.createElement("dd");
      dd.textContent = split.weighted_time_str;
      list.appendChild(dt);
      list.appendChild(dd);
    });
    splitStatsEl.appendChild(list);
  }

  function buildTrajectories() {
    const splitDistances = getSplitDistances();
    const timeColumn = getPrimaryTimeColumn();
    return state.data
      .map((row, index) => {
        const name = row.Name || `Athlete ${index + 1}`;
        const points = [{ distance: 0, time: 0, name }];
        splitDistances.forEach((distance) => {
          const time = parseTimeToSeconds(row[`T${distance}`]);
          if (Number.isFinite(time)) {
            points.push({ distance, time, name });
          }
        });
        const finalDistance = Number(row.Dist);
        const finalTime = parseTimeToSeconds(row[timeColumn]);
        if (Number.isFinite(finalDistance) && Number.isFinite(finalTime)) {
          if (!points.length || points[points.length - 1].distance !== finalDistance) {
            points.push({ distance: finalDistance, time: finalTime, name });
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
        return { name, points: filtered };
      })
      .filter((athlete) => athlete.points.length >= 2);
  }

function selectTimeColumns(columns, videoColumn) {
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
    if (videoColumn && col === videoColumn) {
      return;
    }
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

function buildTimeColumnDefs(timeColumns, videoColumn) {
  const defs = [];
  if (timeColumns.includes("Name")) {
    defs.push(createDataColumn("Name"));
    if (videoColumn) {
      defs.push(createVideoColumn(videoColumn));
    }
  }
  timeColumns.forEach((col) => {
    if (col === "Name" || col === videoColumn) {
      return;
    }
    defs.push(createDataColumn(col));
  });
  return defs;
}

function createDataColumn(columnId) {
  const lower = columnId.toLowerCase();
  return {
    id: columnId,
    name: columnId,
    accessor: (row) => row[columnId],
    renderCell: createColumnRenderer(lower),
    cellAttributes: (value) => ({
      className: lower.includes("style") ? "style-col" : undefined,
      title: typeof value === "string" ? value : undefined,
    }),
  };
}

function createVideoColumn(columnId) {
  return {
    id: `${columnId}_video_link`,
    name: "Video",
    accessor: (row) => row[columnId],
    renderCell: renderVideoLink,
    cellAttributes: () => ({ className: "video-col" }),
  };
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
    const splits = state.modelParams?.[state.dataset]?.splits || [];
    splits.forEach((split) => {
      if (Number.isFinite(split?.split_distance_m) && Number.isFinite(split?.weighted_time_s)) {
        baseline.push({ distance: split.split_distance_m, time: split.weighted_time_s });
      }
    });
    return baseline;
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

  function labelWidth(text) {
    const padding = 8;
    const charWidth = 6;
    return Math.max(32, padding + text.length * charWidth);
  }

function createColumnRenderer(lower) {
  return (value) => (value ?? "");
}

function renderVideoLink(value) {
  if (!value) {
    return "";
  }
  const link = document.createElement("a");
  link.href = value;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "[video]";
  link.className = "video-link";
  return link;
}

  return {
    update,
  };
}
