import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { createChartTooltip } from "../utils.js";

export function renderBandScatterChart({
  containerEl,
  data = [],
  xAccessor = (d) => d.x,
  yAccessor = (d) => d.y,
  width,
  height = 380,
  margin = { top: 32, right: 28, bottom: 56, left: 64 },
  xDomain,
  yDomain,
  xTicks = 6,
  yTicks = 6,
  xTickFormat,
  yTickFormat,
  xLabel,
  yLabel,
  ariaLabel,
  getPointColor = () => "#2563eb",
  getPointRadius = () => 5,
  getPointStroke = () => undefined,
  getPointStrokeWidth = () => 0,
  pointOpacity = 0.85,
  tooltipFormatter,
  band,
  referenceLines = [],
} = {}) {
  if (!containerEl) {
    return null;
  }

  const containerSelection = d3.select(containerEl);
  containerSelection.selectAll("*").remove();

  const effectiveWidth = Number.isFinite(width) && width > 0 ? width : containerEl.clientWidth || 900;
  const effectiveHeight = Number.isFinite(height) && height > 0 ? height : 380;

  const resolvedMargin = {
    top: Number.isFinite(margin.top) ? margin.top : 32,
    right: Number.isFinite(margin.right) ? margin.right : 28,
    bottom: Number.isFinite(margin.bottom) ? margin.bottom : 56,
    left: Number.isFinite(margin.left) ? margin.left : 64,
  };

  const resolvedXDomain = resolveDomain(xDomain, data, xAccessor);
  const resolvedYDomain = resolveDomain(yDomain, data, yAccessor);

  const xScale = d3.scaleLinear().domain(resolvedXDomain).range([resolvedMargin.left, effectiveWidth - resolvedMargin.right]);
  const yScale = d3.scaleLinear().domain(resolvedYDomain).range([effectiveHeight - resolvedMargin.bottom, resolvedMargin.top]);

  const svg = containerSelection
    .append("svg")
    .attr("viewBox", `0 0 ${effectiveWidth} ${effectiveHeight}`)
    .attr("role", ariaLabel ? "img" : undefined)
    .attr("aria-label", ariaLabel || undefined);

  const tooltip = createChartTooltip(containerSelection);

  const xAxis = d3.axisBottom(xScale).ticks(xTicks);
  if (typeof xTickFormat === "function") {
    xAxis.tickFormat(xTickFormat);
  }

  const yAxis = d3.axisLeft(yScale).ticks(yTicks);
  if (typeof yTickFormat === "function") {
    yAxis.tickFormat(yTickFormat);
  }

  svg
    .append("g")
    .attr("transform", `translate(0, ${effectiveHeight - resolvedMargin.bottom})`)
    .call(xAxis);

  if (xLabel) {
    svg
      .append("text")
      .attr("x", effectiveWidth / 2)
      .attr("y", effectiveHeight - 10)
      .attr("text-anchor", "middle")
      .attr("class", "axis-label")
      .text(xLabel);
  }

  svg
    .append("g")
    .attr("transform", `translate(${resolvedMargin.left}, 0)`)
    .call(yAxis);

  if (yLabel) {
    svg
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -effectiveHeight / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("class", "axis-label")
      .text(yLabel);
  }

  drawReferenceLines(svg, referenceLines, { xScale, yScale, width: effectiveWidth, height: effectiveHeight, margin: resolvedMargin });

  if (band?.samples?.length) {
    drawBand(svg, band.samples, {
      xScale,
      yScale,
      curve: band.curve,
      fill: band.fill,
      fillOpacity: band.fillOpacity,
      stroke: band.stroke,
      strokeWidth: band.strokeWidth,
      strokeDasharray: band.strokeDasharray,
      orientation: band.orientation,
      xValueAccessor: band.xValueAccessor,
      yValueAccessor: band.yValueAccessor,
      yLowerAccessor: band.yLowerAccessor,
      yUpperAccessor: band.yUpperAccessor,
      yCenterAccessor: band.yCenterAccessor,
      xLowerAccessor: band.xLowerAccessor,
      xUpperAccessor: band.xUpperAccessor,
      xCenterAccessor: band.xCenterAccessor,
    });
  }

  const pointGroup = svg.append("g").attr("class", "chart-points");

  const points = pointGroup
    .selectAll("circle")
    .data(data)
    .enter()
    .append("circle")
    .attr("cx", (d) => xScale(xAccessor(d)))
    .attr("cy", (d) => yScale(yAccessor(d)))
    .attr("r", (d) => Math.max(1, Number(getPointRadius(d)) || 1))
    .attr("fill", (d) => getPointColor(d))
    .attr("stroke", (d) => getPointStroke(d) || "none")
    .attr("stroke-width", (d) => Math.max(0, Number(getPointStrokeWidth(d)) || 0))
    .attr("opacity", pointOpacity);

  if (typeof tooltipFormatter === "function") {
    points
      .on("mouseenter", (event, datum) => {
        const html = tooltipFormatter(datum);
        if (html) {
          tooltip?.show(event, html);
        }
      })
      .on("mousemove", (event) => tooltip?.move(event))
      .on("mouseleave", () => tooltip?.hide());
  }

  return {
    svg,
    xScale,
    yScale,
    tooltip,
    container: containerSelection,
    margin: resolvedMargin,
    width: effectiveWidth,
    height: effectiveHeight,
    points,
  };
}

export function appendChartTitle(chart, label) {
  if (!chart?.svg || !label) {
    return;
  }
  const topOffset = chart.margin?.top ?? 0;
  const leftOffset = chart.margin?.left ?? 0;
  chart.svg
    .append("text")
    .attr("x", leftOffset)
    .attr("y", topOffset - 10)
    .text(label);
}

function resolveDomain(domain, data, accessor) {
  if (isValidDomain(domain)) {
    return domain;
  }
  const values = (data || []).map((datum) => accessor(datum)).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return [0, 1];
  }
  const [min, max] = d3.extent(values);
  if (min === max) {
    const pad = Math.max(0.05, Math.abs(min) * 0.1 || 0.1);
    return [min - pad, max + pad];
  }
  const padding = (max - min) * 0.08 || 0.05;
  return [min - padding, max + padding];
}

function isValidDomain(domain) {
  return Array.isArray(domain) && domain.length === 2 && domain.every((value) => Number.isFinite(value));
}

function drawBand(
  svg,
  samples,
  {
    xScale,
    yScale,
    curve,
    fill,
    fillOpacity,
    stroke,
    strokeWidth,
    strokeDasharray,
    orientation = "vertical",
    xValueAccessor = (d) => d.x,
    yLowerAccessor = (d) => d.lower,
    yUpperAccessor = (d) => d.upper,
    yCenterAccessor = (d) => d.center,
    yValueAccessor = (d) => d.x,
    xLowerAccessor = (d) => d.lower,
    xUpperAccessor = (d) => d.upper,
    xCenterAccessor = (d) => d.center,
  }
) {
  if ((samples || []).length === 0) {
    return;
  }
  const fillColor = fill || "#bfdbfe";
  const strokeColor = stroke || fillColor || "#2563eb";
  const strokeWidthValue = Number.isFinite(strokeWidth) ? strokeWidth : 1.5;
  const fillOpacityValue = Number.isFinite(fillOpacity) ? fillOpacity : 0.3;
  const verticalCurve = curve || d3.curveMonotoneX;
  const horizontalCurve = curve || d3.curveMonotoneY;

  if (orientation === "horizontal") {
    const area = d3
      .area()
      .defined((d) =>
        [yValueAccessor(d), xLowerAccessor(d), xUpperAccessor(d)].every((value) => Number.isFinite(value))
      )
      .x0((d) => xScale(xLowerAccessor(d)))
      .x1((d) => xScale(xUpperAccessor(d)))
      .y((d) => yScale(yValueAccessor(d)))
      .curve(horizontalCurve);

    svg
      .append("path")
      .datum(samples)
      .attr("fill", fillColor)
      .attr("opacity", fillOpacityValue)
      .attr("stroke", "none")
      .attr("d", area);

    const line = d3
      .line()
      .defined((d) => [yValueAccessor(d), xCenterAccessor(d)].every((value) => Number.isFinite(value)))
      .x((d) => xScale(xCenterAccessor(d)))
      .y((d) => yScale(yValueAccessor(d)))
      .curve(horizontalCurve);

    svg
      .append("path")
      .datum(samples)
      .attr("fill", "none")
      .attr("stroke", strokeColor)
      .attr("stroke-width", strokeWidthValue)
      .attr("stroke-dasharray", strokeDasharray || null)
      .attr("d", line);
    return;
  }

  const area = d3
    .area()
    .defined((d) =>
      [xValueAccessor(d), yLowerAccessor(d), yUpperAccessor(d)].every((value) => Number.isFinite(value))
    )
    .x((d) => xScale(xValueAccessor(d)))
    .y0((d) => yScale(yLowerAccessor(d)))
    .y1((d) => yScale(yUpperAccessor(d)))
    .curve(verticalCurve);

  svg
    .append("path")
    .datum(samples)
    .attr("fill", fillColor)
    .attr("opacity", fillOpacityValue)
    .attr("stroke", "none")
    .attr("d", area);

  const line = d3
    .line()
    .defined((d) => [xValueAccessor(d), yCenterAccessor(d)].every((value) => Number.isFinite(value)))
    .x((d) => xScale(xValueAccessor(d)))
    .y((d) => yScale(yCenterAccessor(d)))
    .curve(verticalCurve);

  svg
    .append("path")
    .datum(samples)
    .attr("fill", "none")
    .attr("stroke", strokeColor)
    .attr("stroke-width", strokeWidthValue)
    .attr("stroke-dasharray", strokeDasharray || null)
    .attr("d", line);
}

function drawReferenceLines(svg, referenceLines, { xScale, yScale, width, height, margin }) {
  (referenceLines || []).forEach((line) => {
    if (!line || typeof line !== "object") {
      return;
    }
    if (line.type === "horizontal" && Number.isFinite(line.value)) {
      const y = yScale(line.value);
      svg
        .append("line")
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", y)
        .attr("y2", y)
        .attr("stroke", line.stroke || "#94a3b8")
        .attr("stroke-width", line.strokeWidth || 1)
        .attr("stroke-dasharray", line.strokeDasharray || "4 4");
      return;
    }
    if (line.type === "vertical" && Number.isFinite(line.value)) {
      const x = xScale(line.value);
      svg
        .append("line")
        .attr("x1", x)
        .attr("x2", x)
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom)
        .attr("stroke", line.stroke || "#94a3b8")
        .attr("stroke-width", line.strokeWidth || 1)
        .attr("stroke-dasharray", line.strokeDasharray || "4 4");
      return;
    }
    if (line.type === "segment") {
      const { x1, y1, x2, y2 } = line;
      if ([x1, y1, x2, y2].every((value) => Number.isFinite(value))) {
        svg
          .append("line")
          .attr("x1", xScale(x1))
          .attr("y1", yScale(y1))
          .attr("x2", xScale(x2))
          .attr("y2", yScale(y2))
          .attr("stroke", line.stroke || "#94a3b8")
          .attr("stroke-width", line.strokeWidth || 1)
          .attr("stroke-dasharray", line.strokeDasharray || "4 4");
      }
    }
  });
}
