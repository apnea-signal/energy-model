import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createDistanceTimeSection } from "./components/distanceTimeSection.js";
import { createStaReferenceSection } from "./components/staReferenceSection.js";
import { createTechniqueSection } from "./components/techniqueSection.js";
import { createMovementQuadrantSection } from "./components/movementQuadrantSection.js";
import { createOxygenEconomySection } from "./components/oxygenEconomySection.js";
import { normalizeName, parseTimeToSeconds } from "./utils.js";

const DATASETS = {
  DNF: () => `../data/aida_greece_2025/DNF.csv?ts=${Date.now()}`,
  DYNB: () => `../data/aida_greece_2025/DYNB.csv?ts=${Date.now()}`,
};
const STA_DATA_URL = "../data/aida_greece_2025/STA_PB.csv";
const MODEL_PARAM_FILES = [
  { url: "../data/dashboard_data/01_split_stats.json" },
  { url: "../data/dashboard_data/02_static_bands.json" },
  { url: "../data/dashboard_data/03_movement_intensity.json" },
  { url: "../data/dashboard_data/04_movement_bands.json" },
  { url: "../data/dashboard_data/05_propulsion_fit.json", namespace: "propulsion_fit" },
];

const datasetNavButtons = Array.from(document.querySelectorAll(".dataset-link[data-dataset]"));
const timeTableEl = document.getElementById("timeTable");
const techniqueTableEl = document.getElementById("techniqueTable");
const movementQuadrantChartEl = document.getElementById("movementQuadrantChart");
const movementQuadrantNoteEl = document.getElementById("movementQuadrantNote");
const oxygenEconomyChartEl = document.getElementById("oxygenEconomyChart");
const oxygenEconomyNoteEl = document.getElementById("oxygenEconomyNote");
const distanceTimeChartEl = document.getElementById("distanceTimeChart");
const legendEl = document.getElementById("distanceTimeLegend");
const splitStatsEl = document.getElementById("splitStats");
const athleteSelect = document.getElementById("athleteSelect");
const staTableEl = document.getElementById("staTable");
const staChartEl = document.getElementById("staPerformanceChart");
const staTrainingNoteEl = document.getElementById("staTrainingNote");

const distanceTimeSection = createDistanceTimeSection({
  athleteSelect,
  timeTableEl,
  distanceTimeChartEl,
  legendEl,
  splitStatsEl,
});
const staReferenceSection = createStaReferenceSection({
  staTableEl,
  staChartEl,
  staTrainingNoteEl,
});
const techniqueSection = createTechniqueSection({ techniqueTableEl });
const movementQuadrantSection = createMovementQuadrantSection({ chartEl: movementQuadrantChartEl, noteEl: movementQuadrantNoteEl });
const oxygenEconomySection = createOxygenEconomySection({ chartEl: oxygenEconomyChartEl, noteEl: oxygenEconomyNoteEl });

const state = {
  dataset: "DNF",
  data: [],
};

let MODEL_PARAMS = {};
let staRoster = [];

setupDatasetNav();

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
    staReferenceSection.updateRoster(staRoster);
    if (state.data.length) {
      staReferenceSection.updateDataset({ data: state.data, dataset: state.dataset, modelParams: MODEL_PARAMS });
    }
  } catch (error) {
    console.warn("STA PB data unavailable", error);
    staRoster = [];
    staReferenceSection.updateRoster([]);
    if (staTableEl) {
      staTableEl.textContent = "STA PB data unavailable.";
    }
  }
}

async function loadDataset(dataset) {
  state.dataset = dataset;
  updateDatasetNav(dataset);
  const urlBuilder = DATASETS[dataset];
  const url = typeof urlBuilder === "function" ? urlBuilder() : urlBuilder;
  const data = await d3.csv(url, d3.autoType);
  state.data = data;
  distanceTimeSection.update({ data, dataset, modelParams: MODEL_PARAMS });
  techniqueSection.update({
    data,
    dataset,
    movement: getMovementEntries(dataset),
  });
  movementQuadrantSection.update({
    dataset,
    data,
    movement: getMovementEntries(dataset),
    bands: getMovementBands(dataset),
  });
  oxygenEconomySection.update({
    dataset,
    data,
    movement: getMovementEntries(dataset),
    propulsion: getPropulsionFit(dataset),
    splitDistance: getSplitDistance(dataset),
  });
  staReferenceSection.updateDataset({ data, dataset, modelParams: MODEL_PARAMS });
}

function setupDatasetNav() {
  datasetNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const dataset = button.dataset.dataset;
      if (dataset && dataset !== state.dataset) {
        loadDataset(dataset);
      }
    });
  });
  updateDatasetNav(state.dataset);
}

function updateDatasetNav(activeDataset) {
  datasetNavButtons.forEach((button) => {
    const isActive = button.dataset.dataset === activeDataset;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.setAttribute("tabindex", isActive ? "0" : "-1");
  });
}

async function loadModelParams() {
  const merged = {};
  for (const source of MODEL_PARAM_FILES) {
    const { url, namespace } = typeof source === "string" ? { url: source } : source;
    try {
      const chunk = await fetchJson(url);
      const payload = namespace ? wrapWithNamespace(chunk, namespace) : chunk;
      mergeModelParams(merged, payload);
    } catch (error) {
      console.warn(`Model params unavailable from ${url}`, error);
    }
  }
  MODEL_PARAMS = merged;
  window.MODEL_PARAMS = MODEL_PARAMS;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

function mergeModelParams(target, source) {
  if (!source || typeof source !== "object") {
    return target;
  }
  Object.entries(source).forEach(([dataset, payload]) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    if (!target[dataset]) {
      target[dataset] = { ...payload };
    } else {
      target[dataset] = { ...target[dataset], ...payload };
    }
  });
  return target;
}

function wrapWithNamespace(source, namespace) {
  if (!namespace || !source || typeof source !== "object") {
    return source;
  }
  const wrapped = {};
  Object.entries(source).forEach(([dataset, payload]) => {
    wrapped[dataset] = { [namespace]: payload };
  });
  return wrapped;
}

function getMovementEntries(dataset) {
  const payload = MODEL_PARAMS?.[dataset];
  if (!payload) {
    return [];
  }
  const { athletes } = payload;
  return Array.isArray(athletes) ? athletes : [];
}

function getMovementBands(dataset) {
  const payload = MODEL_PARAMS?.[dataset];
  if (!payload) {
    return {};
  }
  const { movement_intensity_band, work_bias_band } = payload;
  return { movement_intensity_band, work_bias_band };
}

function getPropulsionFit(dataset) {
  return MODEL_PARAMS?.[dataset]?.propulsion_fit;
}

function getSplitDistance(dataset) {
  const distance = MODEL_PARAMS?.[dataset]?.metadata?.split_distance_m;
  return Number.isFinite(distance) ? distance : 50;
}
