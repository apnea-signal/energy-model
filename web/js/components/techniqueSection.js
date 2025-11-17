import { findVideoColumn, normalizeName } from "../utils.js";
import { createDataTable } from "./baseTable.js";

const TECHNIQUE_COLUMNS = {
  DNF: [
    { key: "Name", label: "Athlete", always: true },
    { key: "Video", label: "Video", type: "video" },
    { key: "Style", label: "Technique", always: true, className: "style-col" },
    { key: "ST_K", label: "Kicks / pull" },
    { key: "ST_WK", label: "Post-wall kicks" },
    { key: "ST_DK", label: "Dolphin kicks" },
    { key: "TA", label: "Arm pulls" },
    { key: "TK", label: "Total kicks" },
    { key: "TDK", label: "Total dolphin kicks" },
    { key: "movement_intensity", label: "Movement intensity", formatter: formatMovementIntensity },
  ],
  DYNB: [
    { key: "Name", label: "Athlete", always: true },
    { key: "Video", label: "Video", type: "video" },
    { key: "Style", label: "Technique", always: true, className: "style-col" },
    { key: "Fin type", label: "Fin" },
    { key: "TK", label: "Total kicks" },
    { key: "movement_intensity", label: "Movement intensity", formatter: formatMovementIntensity },
  ],
};

const DEFAULT_COLUMNS = [
  { key: "Name", label: "Athlete", always: true },
  { key: "Video", label: "Video", type: "video" },
  { key: "Style", label: "Technique", always: true, className: "style-col" },
  { key: "movement_intensity", label: "Movement intensity", formatter: formatMovementIntensity },
];

export function createTechniqueSection({ techniqueTableEl }) {
  const techniqueTable = createDataTable({ container: techniqueTableEl });
  let datasetName = "";
  let rawRows = [];
  let movementEntries = [];

  function update({ data = [], dataset = "", movement = [] } = {}) {
    rawRows = Array.isArray(data) ? data : [];
    datasetName = dataset;
    movementEntries = Array.isArray(movement) ? movement : [];
    renderTechniqueTable();
  }

  function renderTechniqueTable() {
    if (!techniqueTableEl) {
      return;
    }
    const config = getTechniqueColumns(datasetName);
    const movementLookup = buildMovementLookup(movementEntries);
    const videoColumn = findVideoColumn(Object.keys(rawRows[0] || {}));
    const tableRows = rawRows.map((row) => mapTechniqueRow(row, videoColumn, movementLookup));
    const columns = buildColumnDefs(config, tableRows, Boolean(videoColumn));
    techniqueTable.render({
      columns,
      rows: tableRows,
      emptyMessage: "No technique data available.",
    });
  }

  return {
    update,
  };
}

function getTechniqueColumns(dataset) {
  return TECHNIQUE_COLUMNS[dataset] || DEFAULT_COLUMNS;
}

function buildMovementLookup(entries) {
  const lookup = {};
  entries.forEach((entry) => {
    const name = entry?.name || entry?.Name;
    const key = normalizeName(name);
    if (key) {
      lookup[key] = entry;
    }
  });
  return lookup;
}

function mapTechniqueRow(row, videoColumn, movementLookup) {
  const name = row.Name || row.name || row.Athlete || "";
  const style = row.Style || row.style || row.Technique || row["Technique notes"] || "";
  const formatted = {
    Name: name,
    Style: style,
    "Fin type": row["Fin type"] || row.fin || row.Fin || "",
    ST_K: row.ST_K ?? row["ST_K"],
    ST_WK: row.ST_WK ?? row["ST_WK"],
    ST_DK: row.ST_DK ?? row["ST_DK"],
    TA: row.TA,
    TK: row.TK,
    TDK: row.TDK,
  };

  const normalized = normalizeName(name);
  if (normalized && movementLookup[normalized]) {
    formatted.movement_intensity = movementLookup[normalized].movement_intensity;
  } else {
    formatted.movement_intensity = null;
  }

  if (videoColumn) {
    formatted.Video = row[videoColumn];
  }
  return formatted;
}

function buildColumnDefs(config, rows, hasVideoColumn) {
  return config
    .filter((column) => {
      if (column.key === "Video" && !hasVideoColumn) {
        return false;
      }
      if (column.always) {
        return true;
      }
      return rows.some((row) => hasRenderableValue(row[column.key]));
    })
    .map((column) => createColumnDef(column));
}

function createColumnDef(column) {
  if (column.type === "video") {
    return {
      id: column.key,
      name: column.label,
      accessor: (row) => row.Video,
      renderCell: renderVideoLink,
      cellAttributes: () => ({ className: "video-col" }),
    };
  }
  return {
    id: column.key,
    name: column.label,
    accessor: (row) => row[column.key],
    renderCell: (value) => {
      if (column.formatter) {
        return column.formatter(value);
      }
      return value ?? "";
    },
    cellAttributes: column.className
      ? () => ({ className: column.className })
      : undefined,
  };
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

function hasRenderableValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function formatMovementIntensity(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return Number(value).toFixed(3);
}
