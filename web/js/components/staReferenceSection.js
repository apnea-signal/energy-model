import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip, formatSeconds, normalizeName } from "../utils.js";
import { createDataTable } from "./baseTable.js";

export function createStaReferenceSection({ staTableEl, staChartEl, staTrainingNoteEl }) {
  const chartSelection = staChartEl ? d3.select(staChartEl) : null;
  const state = {
    roster: [],
    datasetRows: [],
    dataset: "",
    modelParams: {},
  };
  const staTable = createDataTable({ container: staTableEl });

  function updateRoster(roster = []) {
    state.roster = Array.isArray(roster) ? roster : [];
    renderStaTable();
    renderStaCorrelationChart();
  }

  function updateDataset({ data = [], dataset = "", modelParams = {} }) {
    state.datasetRows = Array.isArray(data) ? data : [];
    state.dataset = dataset;
    state.modelParams = modelParams || {};
    renderStaCorrelationChart();
  }

  function renderStaTable() {
    const columns = [
      { id: "Name", name: "Name", accessor: (row) => row.Name },
      { id: "STA", name: "STA PB", accessor: (row) => row.STA || "-" },
      { id: "STA_YEAR", name: "Year", accessor: (row) => row.STA_YEAR || "-" },
    ];
    staTable.render({
      columns: state.roster.length ? columns : [],
      rows: state.roster,
      emptyMessage: "No STA PB rows found.",
    });
  }

  function renderStaCorrelationChart() {
    if (!chartSelection) {
      return;
    }
    chartSelection.selectAll("*").remove();
    if (!state.roster.length) {
      chartSelection.append("div").attr("class", "alert").text("STA PB data unavailable.");
      renderStaTrainingNote([]);
      return;
    }
    if (!state.datasetRows.length) {
      chartSelection.append("div").attr("class", "alert").text("Load a dataset to see the correlation plot.");
      renderStaTrainingNote([]);
      return;
    }

    const lookup = buildStaLookup();
    const points = state.datasetRows
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
      chartSelection
        .append("div")
        .attr("class", "alert")
        .text("No overlapping athletes with STA PB values for this dataset.");
      renderStaTrainingNote([]);
      return;
    }

    renderStaTrainingNote(points);

    const containerNode = chartSelection.node();
    const width = containerNode?.clientWidth || 900;
    const height = 360;
    const margins = { top: 20, right: 30, bottom: 60, left: 80 };
    const [minSta, maxSta] = d3.extent(points, (d) => d.staSeconds);
    const maxDistance = d3.max(points, (d) => d.distance) || 0;
    const yDomainMax = Math.max(maxDistance, 110);

    if (!Number.isFinite(minSta) || !Number.isFinite(maxSta)) {
      chartSelection
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

    const svg = chartSelection.append("svg").attr("viewBox", `0 0 ${width} ${height}`);
    const staTooltip = createChartTooltip(chartSelection);

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
      .text((d) => `${d.name}: STA ${d.staDisplay || "-"}${d.staYear ? ` (${d.staYear})` : ""} → ${d.distance} m ${state.dataset}`);
  }

  function renderStaTrendBand(svg, xScale, yScale) {
    const samples = state.modelParams?.[state.dataset]?.sta_band?.samples || [];
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

    if (!state.roster.length || !state.datasetRows.length) {
      appendParagraph("Load a dataset with STA PB entries to surface standout athletes.");
      return;
    }

    const band = state.modelParams?.[state.dataset]?.sta_band;
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
    const band = state.modelParams?.[state.dataset]?.sta_band;
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
    const band = state.modelParams?.[state.dataset]?.sta_band;
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

  function buildStaLookup() {
    const map = new Map();
    state.roster.forEach((row) => {
      if (row.key) {
        map.set(row.key, row);
      }
    });
    return map;
  }

  return {
    updateRoster,
    updateDataset,
  };
}
