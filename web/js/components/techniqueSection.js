import { findVideoColumn } from "../utils.js";
import { createDataTable } from "./baseTable.js";

export function createTechniqueSection({ techniqueTableEl }) {
  let dataRows = [];
  const techniqueTable = createDataTable({ container: techniqueTableEl });

  function update(rows = []) {
    dataRows = Array.isArray(rows) ? rows : [];
    renderTechniqueTable();
  }

  function renderTechniqueTable() {
    const columns = Object.keys(dataRows[0] || {});
    const videoColumn = findVideoColumn(columns);
    const techniqueColumns = selectTechniqueColumns(columns, videoColumn);
    const columnDefs = buildTechniqueColumnDefs(techniqueColumns, videoColumn);

    techniqueTable.render({
      columns: columnDefs,
      rows: dataRows,
      emptyMessage: "No columns available for this view.",
    });
  }

  function selectTechniqueColumns(columns, videoColumn) {
    const keywords = ["fin", "kick", "pull", "arm", "st_", "tk", "tw", "glide", "dk", "wk"];
    const ordered = [];
    const seen = new Set();

    if (columns.includes("Name")) {
      ordered.push("Name");
      seen.add("Name");
    }

    columns.forEach((col) => {
      if (videoColumn && col === videoColumn) {
        return;
      }
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

  function buildTechniqueColumnDefs(techniqueColumns, videoColumn) {
    const defs = [];
    if (techniqueColumns.includes("Name")) {
      defs.push(createTechniqueDataColumn("Name"));
      if (videoColumn) {
        defs.push(createVideoColumn(videoColumn));
      }
    }
    techniqueColumns.forEach((col) => {
      if (col === "Name" || col === videoColumn) {
        return;
      }
      defs.push(createTechniqueDataColumn(col));
    });
    return defs;
  }

  function createTechniqueDataColumn(columnId) {
    const lower = columnId.toLowerCase();
    return {
      id: columnId,
      name: columnId,
      accessor: (row) => row[columnId],
      renderCell: (value) => value ?? "",
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
