import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const MODEL_DATA_URL = "./dashboard_data/model_params.json";
const INFERENCE_URL = "./dashboard_data/inference_predictions.json";

const datasetSelect = document.getElementById("modelDataset");
const slider = document.getElementById("featureSlider");
const featureInput = document.getElementById("featureInput");
const predictionSummary = document.getElementById("predictionSummary");
const metricsContainer = d3.select("#modelMetrics");
const chartEl = d3.select("#modelChart");

const state = {
  dataset: "DNF",
  params: {},
  inference: {},
  featureValue: 0,
};

init();

async function init() {
  const [params, inference] = await Promise.all([fetchJson(MODEL_DATA_URL), fetchJson(INFERENCE_URL)]);
  state.params = params;
  state.inference = inference;
  populateDatasetOptions();
  setDataset(state.dataset);

  datasetSelect.addEventListener("change", () => setDataset(datasetSelect.value));
  slider.addEventListener("input", () => syncFeatureValue(Number(slider.value)));
  featureInput.addEventListener("input", () => {
    const next = Number(featureInput.value);
    if (Number.isFinite(next)) {
      syncFeatureValue(next);
    }
  });
}

function populateDatasetOptions() {
  datasetSelect.innerHTML = "";
  Object.keys(state.params).forEach((event) => {
    const option = document.createElement("option");
    option.value = event;
    option.textContent = event;
    datasetSelect.appendChild(option);
  });
  datasetSelect.value = state.dataset;
}

function setDataset(dataset) {
  state.dataset = dataset;
  datasetSelect.value = dataset;
  const params = state.params[dataset];
  if (!params) {
    return;
  }
  const [minFeature, maxFeature] = params.feature_range;
  slider.min = minFeature;
  slider.max = maxFeature;
  slider.step = 1;
  featureInput.min = minFeature;
  featureInput.max = maxFeature;
  const defaultValue = Math.round((minFeature + maxFeature) / 2);
  syncFeatureValue(defaultValue);
  renderMetrics();
  renderChart();
}

function syncFeatureValue(value) {
  const params = state.params[state.dataset];
  const clamped = Math.max(Number(slider.min), Math.min(Number(slider.max), value));
  state.featureValue = clamped;
  slider.value = clamped;
  featureInput.value = clamped;
  renderPrediction();
}

function renderPrediction() {
  const params = state.params[state.dataset];
  if (!params) {
    predictionSummary.textContent = "Run the build_dashboard_data script first.";
    return;
  }
  const predicted = params.slope * state.featureValue + params.intercept;
  predictionSummary.innerHTML = `Using <strong>${params.feature}</strong> = <strong>${state.featureValue}</strong> ` +
    `predicts <strong>${predicted.toFixed(1)} m</strong>`;
}

function renderMetrics() {
  const params = state.params[state.dataset];
  if (!params) {
    return;
  }
  metricsContainer.selectAll("*").remove();
  const stats = [
    { label: "Slope", value: params.slope.toFixed(3) },
    { label: "Intercept", value: params.intercept.toFixed(1) },
    { label: "MAE", value: params.mae.toFixed(1) },
    { label: "RMSE", value: params.rmse.toFixed(1) },
    { label: "R²", value: params.r_squared.toFixed(2) },
    { label: "Rows", value: params.count },
  ];
  stats.forEach((stat) => {
    const card = metricsContainer.append("div").attr("class", "summary-card");
    card.append("div").text(stat.label);
    card.append("strong").text(stat.value);
  });
}

function renderChart() {
  chartEl.selectAll("*").remove();
  const params = state.params[state.dataset];
  const inference = state.inference[state.dataset] || [];
  if (!inference.length || !params) {
    chartEl.append("div").attr("class", "alert").text("No inference data for this dataset yet.");
    return;
  }

  const width = chartEl.node().clientWidth || 900;
  const height = 380;
  const margins = { top: 20, right: 20, bottom: 50, left: 60 };

  const x = d3
    .scaleLinear()
    .domain(d3.extent(inference, (d) => d.feature))
    .nice()
    .range([margins.left, width - margins.right]);
  const yValues = inference.flatMap((d) => [d.actual_distance, d.predicted_distance]);
  const y = d3
    .scaleLinear()
    .domain(d3.extent(yValues))
    .nice()
    .range([height - margins.bottom, margins.top]);

  const svg = chartEl.append("svg").attr("viewBox", `0 0 ${width} ${height}`);

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margins.bottom})`)
    .call(d3.axisBottom(x))
    .append("text")
    .attr("x", width / 2)
    .attr("y", 40)
    .attr("fill", "#0f172a")
    .text(params.feature);

  svg
    .append("g")
    .attr("transform", `translate(${margins.left}, 0)`)
    .call(d3.axisLeft(y))
    .append("text")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -45)
    .attr("fill", "#0f172a")
    .text(params.target);

  svg
    .selectAll("circle")
    .data(inference)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(d.feature))
    .attr("cy", (d) => y(d.actual_distance))
    .attr("r", 4)
    .attr("fill", "#a855f7")
    .attr("opacity", 0.8)
    .append("title")
    .text((d) => `${d.name}: actual ${d.actual_distance.toFixed(1)} m`);

  const lineData = [
    { feature: params.feature_range[0], value: params.slope * params.feature_range[0] + params.intercept },
    { feature: params.feature_range[1], value: params.slope * params.feature_range[1] + params.intercept },
  ];

  const line = d3
    .line()
    .x((d) => x(d.feature))
    .y((d) => y(d.value));

  svg
    .append("path")
    .datum(lineData)
    .attr("fill", "none")
    .attr("stroke", "#2563eb")
    .attr("stroke-width", 2)
    .attr("d", line);
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}`);
  }
  return response.json();
}
