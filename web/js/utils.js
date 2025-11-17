import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export function parseTimeToSeconds(value) {
  if (value === undefined || value === null || value === "-") {
    return NaN;
  }
  if (typeof value === "string" && value.trim() === "") {
    return NaN;
  }
  if (typeof value === "number") {
    return value;
  }
  const parts = String(value)
    .split(":")
    .map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) {
    return NaN;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }
  return parts[0];
}

export function formatSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) {
    return "-";
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

export function createChartTooltip(containerSelection) {
  if (!containerSelection || !containerSelection.node || !containerSelection.node()) {
    return null;
  }
  const containerNode = containerSelection.node();
  const tooltip = containerSelection
    .append("div")
    .attr("class", "chart-tooltip")
    .style("opacity", 0)
    .style("visibility", "hidden");

  const offset = 12;
  const reposition = (event) => {
    const [xPos, yPos] = d3.pointer(event, containerNode);
    const tooltipNode = tooltip.node();
    if (!tooltipNode) {
      return;
    }
    const tooltipWidth = tooltipNode.offsetWidth || 0;
    const tooltipHeight = tooltipNode.offsetHeight || 0;
    const { width: containerWidth = tooltipWidth, height: containerHeight = tooltipHeight } =
      containerNode.getBoundingClientRect();
    let left = xPos + offset;
    let top = yPos - tooltipHeight - offset;

    if (left + tooltipWidth > containerWidth - offset) {
      left = containerWidth - tooltipWidth - offset;
    }
    if (left < offset) {
      left = offset;
    }
    if (top < offset) {
      top = yPos + offset;
    }
    if (top + tooltipHeight > containerHeight - offset) {
      top = containerHeight - tooltipHeight - offset;
    }

    tooltip.style("transform", `translate(${left}px, ${top}px)`);
  };

  return {
    show(event, html) {
      tooltip.style("visibility", "visible").style("opacity", 1).html(html);
      reposition(event);
    },
    move(event) {
      reposition(event);
    },
    hide() {
      tooltip.style("opacity", 0).style("visibility", "hidden").style("transform", "translate(-9999px, -9999px)");
    },
  };
}
