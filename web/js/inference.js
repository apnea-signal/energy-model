import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const MODEL_DATA_URL = "./dashboard_data/model_params.json";
const INFERENCE_URL = "./dashboard_data/inference_predictions.json";

const datasetSelect = document.getElementById("inferenceDataset");
const residualModeSelect = document.getElementById("residualMode");
const tableEl = d3.select("#residualTable");
const chartEl = d3.select("#residualChart");
const form = document.getElementById("predictionForm");
const nameInput = document.getElementById("athleteName");
const formDatasetSelect = document.getElementById("formDataset");
const featureInput = document.getElementById("formFeature");
const notesInput = document.getElementById("formNotes");
const predictionBox = document.getElementById("customPrediction");

const state = {
  dataset: "DNF",
  mode: "signed",
  inference: {},
  params: {},
};

init();

async function init() {
  const [params, inference] = await Promise.all([fetchJson(MODEL_DATA_URL), fetchJson(INFERENCE_URL)]);
  state.params = params;
  state.inference = inference;
  populateDatasets();
  render();

  datasetSelect.addEventListener("change", () => {
    state.dataset = datasetSelect.value;
    formDatasetSelect.value = state.dataset;
    render();
  });

  residualModeSelect.addEventListener("change", () => {
    state.mode = residualModeSelect.value;
    render();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handlePrediction();
  });

  featureInput.addEventListener("input", () => {
    // Keep predictions fresh without submitting.
    if (featureInput.value) {
      handlePrediction({ silent: true });
    }
  });
}

function populateDatasets() {
  datasetSelect.innerHTML = "";
  Object.keys(state.inference).forEach((dataset) => {
    const option = document.createElement("option");
    option.value = dataset;
    option.textContent = dataset;
    datasetSelect.appendChild(option);
  });
  datasetSelect.value = state.dataset;
  formDatasetSelect.value = state.dataset;
}

function render() {
  renderChart();
  renderTable();
}

function getSortedRecords(limit = 20) {
  const data = state.inference[state.dataset] || [];
  const sorted = data
    .slice()
    .sort((a, b) => {
      if (state.mode === "absolute") {
        return Math.abs(b.residual) - Math.abs(a.residual);
      }
      return b.residual - a.residual;
    });
  return sorted.slice(0, limit);
}

function renderChart() {
  chartEl.selectAll("*").remove();
  const data = getSortedRecords(25);
  if (!data.length) {
    chartEl.append("div").attr("class", "alert").text("Inference payload missing. Re-run the builder script.");
    return;
  }

  const width = chartEl.node().clientWidth || 900;
  const height = 420;
  const margins = { top: 20, right: 20, bottom: 120, left: 70 };

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.name))
    .range([margins.left, width - margins.right])
    .padding(0.1);
  const yExtent = d3.extent(data.flatMap((d) => [d.residual, -d.residual]));
  const yMax = Math.max(Math.abs(yExtent[0] || 0), Math.abs(yExtent[1] || 0));
  const y = d3
    .scaleLinear()
    .domain([-yMax, yMax])
    .range([height - margins.bottom, margins.top]);

  const svg = chartEl.append("svg").attr("viewBox", `0 0 ${width} ${height}`);

  svg
    .append("g")
    .attr("transform", `translate(0, ${height - margins.bottom})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-45)");

  svg
    .append("g")
    .attr("transform", `translate(${margins.left}, 0)`)
    .call(d3.axisLeft(y));

  svg
    .append("line")
    .attr("x1", margins.left)
    .attr("x2", width - margins.right)
    .attr("y1", y(0))
    .attr("y2", y(0))
    .attr("stroke", "#94a3b8");

  svg
    .selectAll("rect")
    .data(data)
    .enter()
    .append("rect")
    .attr("x", (d) => x(d.name))
    .attr("width", x.bandwidth())
    .attr("y", (d) => (d.residual >= 0 ? y(d.residual) : y(0)))
    .attr("height", (d) => Math.abs(y(d.residual) - y(0)))
    .attr("fill", (d) => (d.residual >= 0 ? "#22c55e" : "#ef4444"))
    .append("title")
    .text((d) => `${d.name}: residual ${d.residual.toFixed(1)} m`);
}

function renderTable() {
  tableEl.selectAll("*").remove();
  const data = getSortedRecords(12);
  if (!data.length) {
    return;
  }

  const columns = ["name", "feature", "actual_distance", "predicted_distance", "residual"];
  const headers = ["Athlete", "Feature", "Actual (m)", "Predicted (m)", "Residual (m)"];

  const thead = tableEl.append("thead").append("tr");
  thead
    .selectAll("th")
    .data(headers)
    .enter()
    .append("th")
    .text((d) => d);

  const tbody = tableEl.append("tbody");
  const rows = tbody.selectAll("tr").data(data).enter().append("tr");
  rows
    .selectAll("td")
    .data((row) =>
      columns.map((col) => {
        const value = row[col];
        if (typeof value === "number") {
          return value.toFixed(1);
        }
        return value ?? "";
      })
    )
    .enter()
    .append("td")
    .text((d) => d);
}

function handlePrediction(options = {}) {
  const dataset = formDatasetSelect.value;
  const params = state.params[dataset];
  if (!params) {
    predictionBox.textContent = "Model parameters unavailable. Run the builder script first.";
    return;
  }
  const name = nameInput.value || "You";
  const featureValue = Number(featureInput.value);
  if (!Number.isFinite(featureValue)) {
    predictionBox.textContent = "Enter a numeric stroke/kick count.";
    return;
  }
  const predictedDistance = params.slope * featureValue + params.intercept;
  const note = notesInput.value ? ` | Notes: ${notesInput.value}` : "";
  const message = `${name} (${dataset}) with ${featureValue} ${params.feature} → ${predictedDistance.toFixed(1)} m${note}`;
  predictionBox.textContent = message;
  if (!options.silent) {
    predictionBox.scrollIntoView({ behavior: "smooth" });
  }
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}`);
  }
  return response.json();
}
