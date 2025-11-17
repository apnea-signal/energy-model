export function createDataTable({ container }) {
  const state = {
    columns: [],
    rows: [],
    emptyMessage: "No data available.",
    defaultSort: null,
  };
  let sortState = null;

  function render({ columns = [], rows = [], defaultSort = null, emptyMessage = "No data available." }) {
    if (!container) {
      return;
    }
    state.columns = Array.isArray(columns) ? columns : [];
    state.rows = Array.isArray(rows) ? rows : [];
    state.emptyMessage = emptyMessage || "No data available.";
    state.defaultSort = defaultSort;
    if (defaultSort && Number.isInteger(defaultSort.column)) {
      sortState = {
        columnIndex: defaultSort.column,
        direction: defaultSort.direction === "desc" ? "desc" : "asc",
      };
    } else if (sortState && sortState.columnIndex >= state.columns.length) {
      sortState = null;
    }
    draw();
  }

  function draw() {
    if (!container) {
      return;
    }
    container.innerHTML = "";
    if (!state.columns.length) {
      container.textContent = state.emptyMessage;
      return;
    }

    const table = document.createElement("table");
    table.className = "standard-table";
    table.appendChild(buildHeader());
    table.appendChild(buildBody());
    container.appendChild(table);
  }

  function buildHeader() {
    const thead = document.createElement("thead");
    const row = document.createElement("tr");
    state.columns.forEach((column, index) => {
      const th = document.createElement("th");
      th.setAttribute("scope", "col");
      const sortDirection = sortState?.columnIndex === index ? sortState.direction : null;
      th.setAttribute("aria-sort", sortDirection ? (sortDirection === "desc" ? "descending" : "ascending") : "none");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-sort-button";
      button.addEventListener("click", () => handleSort(index));
      const label = document.createElement("span");
      label.className = "table-header-label";
      label.textContent = column.name || column.label || column.id || `Column ${index + 1}`;
      const indicator = document.createElement("span");
      indicator.className = "sort-indicator";
      indicator.dataset.direction = sortDirection || "";
      indicator.textContent = sortDirection ? (sortDirection === "desc" ? "▼" : "▲") : "↕";
      button.appendChild(label);
      button.appendChild(indicator);
      th.appendChild(button);
      row.appendChild(th);
    });
    thead.appendChild(row);
    return thead;
  }

  function buildBody() {
    const tbody = document.createElement("tbody");
    const rows = getSortedRows();
    if (!rows.length) {
      const emptyRow = document.createElement("tr");
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = state.columns.length;
      emptyCell.className = "empty-cell";
      emptyCell.textContent = state.emptyMessage;
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
      return tbody;
    }
    rows.forEach((rowData, rowIndex) => {
      const tr = document.createElement("tr");
      state.columns.forEach((column, columnIndex) => {
        const td = document.createElement("td");
        const value = getCellValue(column, rowData, rowIndex);
        const attributes = typeof column.cellAttributes === "function" ? column.cellAttributes(value, rowData, rowIndex) : null;
        if (attributes) {
          if (attributes.className) {
            td.className = attributes.className;
          }
          if (attributes.title) {
            td.title = attributes.title;
          }
        }
        const content = typeof column.renderCell === "function" ? column.renderCell(value, rowData, rowIndex) : value ?? "";
        if (content instanceof Node) {
          td.appendChild(content);
        } else if (content !== undefined && content !== null) {
          td.textContent = String(content);
        } else {
          td.textContent = "";
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    return tbody;
  }

  function getCellValue(column, rowData, rowIndex) {
    if (typeof column.accessor === "function") {
      return column.accessor(rowData, rowIndex);
    }
    if (column.id && Object.prototype.hasOwnProperty.call(rowData, column.id)) {
      return rowData[column.id];
    }
    return undefined;
  }

  function getSortedRows() {
    if (!sortState || sortState.columnIndex == null) {
      return [...state.rows];
    }
    const column = state.columns[sortState.columnIndex];
    if (!column) {
      return [...state.rows];
    }
    const sorted = [...state.rows].sort((a, b) => {
      const valueA = getSortValue(column, a);
      const valueB = getSortValue(column, b);
      return compareValues(valueA, valueB);
    });
    if (sortState.direction === "desc") {
      sorted.reverse();
    }
    return sorted;
  }

  function getSortValue(column, rowData) {
    const value = getCellValue(column, rowData, 0);
    if (typeof column.sortValue === "function") {
      return column.sortValue(value, rowData);
    }
    return defaultSortValue(value);
  }

  function defaultSortValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() === "") {
      return "";
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
    return String(value);
  }

  function compareValues(a, b) {
    if (a === b) {
      return 0;
    }
    if (a === null || a === undefined) {
      return -1;
    }
    if (b === null || b === undefined) {
      return 1;
    }
    if (typeof a === "number" && typeof b === "number") {
      return a - b;
    }
    if (typeof a === "number" && typeof b !== "number") {
      return -1;
    }
    if (typeof b === "number" && typeof a !== "number") {
      return 1;
    }
    return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
  }

  function handleSort(index) {
    if (!state.columns[index]) {
      return;
    }
    if (sortState?.columnIndex === index) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
      sortState = { columnIndex: index, direction: "asc" };
    }
    draw();
  }

  return {
    render,
  };
}
