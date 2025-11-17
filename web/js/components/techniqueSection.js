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
    const techniqueColumns = selectTechniqueColumns(columns);
    const columnDefs = techniqueColumns.map((col) => {
      const lower = col.toLowerCase();
      return {
        id: col,
        name: col,
        accessor: (row) => row[col],
        renderCell: createColumnRenderer(lower),
        cellAttributes: (value) => ({
          className: lower.includes("style") ? "style-col" : undefined,
          title: typeof value === "string" ? value : undefined,
        }),
      };
    });

    techniqueTable.render({
      columns: columnDefs,
      rows: dataRows,
      emptyMessage: "No columns available for this view.",
    });
  }

  function selectTechniqueColumns(columns) {
    const keywords = ["fin", "kick", "pull", "arm", "st_", "tk", "tw", "glide", "dk", "wk"];
    const ordered = [];
    const seen = new Set();

    if (columns.includes("Name")) {
      ordered.push("Name");
      seen.add("Name");
    }

    columns.forEach((col) => {
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

  function createColumnRenderer(lower) {
    if (lower.includes("video")) {
      return (value) => {
        if (!value) {
          return "";
        }
        const link = document.createElement("a");
        link.href = value;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Open video";
        return link;
      };
    }
    return (value) => (value ?? "");
  }

  return {
    update,
  };
}
