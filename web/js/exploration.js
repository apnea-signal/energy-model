import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createDistanceTimeSection } from "./components/distanceTimeSection.js";
import { createStaReferenceSection } from "./components/staReferenceSection.js";
import { createTechniqueSection } from "./components/techniqueSection.js";
import { normalizeName, parseTimeToSeconds } from "./utils.js";

const DATASETS = {
  DNF: "../data/aida_greece_2025/DNF.csv",
  DYNB: "../data/aida_greece_2025/DYNB.csv",
};
const STA_DATA_URL = "../data/aida_greece_2025/STA_PB.csv";

const datasetSelect = document.getElementById("datasetSelect");
const timeTableEl = document.getElementById("timeTable");
const techniqueTableEl = document.getElementById("techniqueTable");
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

const state = {
  dataset: "DNF",
  data: [],
};

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
  datasetSelect.value = dataset;
  const url = DATASETS[dataset];
  const data = await d3.csv(url, d3.autoType);
  state.data = data;
  distanceTimeSection.update({ data, dataset, modelParams: MODEL_PARAMS });
  techniqueSection.update(data);
  staReferenceSection.updateDataset({ data, dataset, modelParams: MODEL_PARAMS });
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
