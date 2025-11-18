import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { formatSeconds, normalizeName } from "../utils.js";
import { createDataTable } from "./baseTable.js";
import { appendChartTitle, renderBandScatterChart } from "./chartWithBands.js";

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
    if (!containerNode) {
      return;
    }

    const xDomain = buildDistanceDomain(points);
    const yDomain = buildStaDomain(points);
    if (!xDomain || !yDomain) {
      chartSelection.append("div").attr("class", "alert").text("STA PB values are not parsable for this dataset.");
      return;
    }

    const band = state.modelParams?.[state.dataset]?.sta_band;
    const normalizedSamples = normalizeBandSamples(band?.samples || [], yDomain, band);

    const chart = renderBandScatterChart({
      containerEl: containerNode,
      data: points,
      xAccessor: (row) => row.distance,
      yAccessor: (row) => row.staSeconds,
      xDomain,
      yDomain,
      height: 360,
      xTickFormat: (value) => `${value.toFixed(0)} m`,
      yTickFormat: (value) => formatSeconds(value),
      xLabel: "Total performance (m)",
      yLabel: "Static PB (mm:ss)",
      ariaLabel: "STA PB vs total performance",
      getPointColor: (row) => (Number(row.staYear) >= 2024 ? "#0284c7" : "#94a3b8"),
      getPointRadius: () => 5,
      getPointStroke: () => "#0f172a",
      getPointStrokeWidth: () => 0.5,
      band: normalizedSamples.length
        ? {
            samples: normalizedSamples,
            orientation: "horizontal",
            fill: "#bfdbfe",
            stroke: "#60a5fa",
            fillOpacity: 0.3,
            strokeWidth: 1.5,
            strokeDasharray: "6 4",
          }
        : undefined,
      tooltipFormatter: (row) => {
        const staLine = `STA ${row.staDisplay || "-"}${row.staYear ? ` (${row.staYear})` : ""}`;
        return `<strong>${row.name}</strong><div>${row.distance} m ${state.dataset}</div><div>${staLine}</div>`;
      },
    });

    appendChartTitle(chart, "STA PB vs total performance");

    chart.points
      ?.append("title")
      .text((d) => `${d.name}: ${d.distance} m ${state.dataset} ← STA ${d.staDisplay || "-"}${d.staYear ? ` (${d.staYear})` : ""}`);
  }
  function normalizeBandSamples(samples, domain = [], band) {
    const sorted = (samples || []).slice().sort((a, b) => a.x - b.x);
    if (!sorted.length) {
      return [];
    }
    const [domainStart, domainEnd] = domain;
    const staMin = Number.isFinite(domainStart) ? domainStart : sorted[0].x;
    const staMax = Number.isFinite(domainEnd) ? domainEnd : sorted[sorted.length - 1].x;
    insertBoundarySample(sorted, staMin, band);
    insertBoundarySample(sorted, staMax, band);
    return sorted.sort((a, b) => a.x - b.x);
  }

  function insertBoundarySample(collection, targetSeconds, band) {
    if (!Number.isFinite(targetSeconds) || !collection.length) {
      return collection;
    }
    const epsilon = 0.001;
    if (collection.some((sample) => Math.abs(sample.x - targetSeconds) <= epsilon)) {
      return collection;
    }
    const projected = buildProjectedSample(targetSeconds, band, collection);
    if (projected) {
      collection.push(projected);
    }
    return collection;
  }

  function buildProjectedSample(seconds, band, collection) {
    const meta = band?.metadata || {};
    const slope = Number(meta.slope);
    const offset = Number(meta.offset_seconds);
    const baseline = Number(meta.baseline);
    let halfWidth = Number(band?.band_width) / 2;
    if (!Number.isFinite(halfWidth) || halfWidth <= 0) {
      const ref = collection[0];
      const span = Number(ref?.upper) - Number(ref?.center);
      halfWidth = Number.isFinite(span) ? Math.abs(span) : 15;
    }
    if (Number.isFinite(slope) && Number.isFinite(offset) && Number.isFinite(baseline)) {
      const center = slope * (seconds - offset) + baseline;
      return {
        x: seconds,
        center,
        lower: center - halfWidth,
        upper: center + halfWidth,
      };
    }
    if (collection.length < 2) {
      const center = collection[0]?.center ?? 0;
      return { x: seconds, center, lower: center - halfWidth, upper: center + halfWidth };
    }
    const ordered = collection.slice().sort((a, b) => a.x - b.x);
    let before = ordered[0];
    let after = ordered[ordered.length - 1];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = ordered[i];
      const next = ordered[i + 1];
      if (seconds >= current.x && seconds <= next.x) {
        before = current;
        after = next;
        break;
      }
    }
    const span = after.x - before.x || 1;
    const ratio = (seconds - before.x) / span;
    const center = before.center + (after.center - before.center) * ratio;
    return { x: seconds, center, lower: center - halfWidth, upper: center + halfWidth };
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

  function buildDistanceDomain(points) {
    const values = points.map((point) => point.distance).filter((value) => Number.isFinite(value));
    if (!values.length) {
      return null;
    }
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    return padLinearDomain([Math.min(100, minValue), maxValue]);
  }

  function buildStaDomain(points) {
    const values = points.map((point) => point.staSeconds).filter((value) => Number.isFinite(value));
    if (!values.length) {
      return null;
    }
    return padLinearDomain(d3.extent(values));
  }

  function padLinearDomain([min, max] = []) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return null;
    }
    if (min === max) {
      const pad = Math.max(5, Math.abs(min) * 0.05 || 5);
      return [min - pad, max + pad];
    }
    const span = max - min;
    const padding = span * 0.08 || 5;
    return [Math.max(0, min - padding), max + padding];
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
