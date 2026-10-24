/**
 * ECharts options for render blocks, in the app's palette. Pure, so the
 * mapping from block to chart can be tested without a browser.
 */
import type { RenderBlock } from "@simha/shared";

const SERIES_COLORS = ["#59b89f", "#b45309", "#3f5c8a", "#9a3b5f", "#5b6b2f"];

const INK = "#1a1f1e";
const MUTED = "#878d8a";
const LINE = "#efede7";
const FONT = "IBM Plex Sans, sans-serif";

const label = (value: unknown) => (value === null || value === undefined ? "(kosong)" : String(value));

export const chartOption = (block: RenderBlock) => {
  const x = block.x ?? block.kolom[0] ?? "";
  const categories = block.baris.map((row) => label(row[x]));
  const base = {
    color: SERIES_COLORS,
    textStyle: { fontFamily: FONT, color: INK },
    animationDuration: 500,
    tooltip: {
      trigger: block.tipe === "pie" ? "item" : "axis",
      backgroundColor: "#ffffff",
      borderColor: "#e3e0d8",
      textStyle: { color: INK, fontFamily: FONT, fontSize: 12 },
      valueFormatter: (v: unknown) => (typeof v === "number" ? v.toLocaleString("id-ID") : String(v)) + (block.satuan ? ` ${block.satuan}` : ""),
    },
  };

  if (block.tipe === "pie") {
    const y = block.y[0] ?? "";
    return {
      ...base,
      legend: { bottom: 0, type: "scroll", textStyle: { color: MUTED, fontSize: 12 } },
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          center: ["50%", "45%"],
          itemStyle: { borderColor: "#ffffff", borderWidth: 2 },
          label: { color: INK, fontSize: 12, formatter: "{b}: {d}%" },
          data: block.baris.map((row) => ({ name: label(row[x]), value: row[y] })),
        },
      ],
    };
  }

  // Long category names read better as a horizontal bar chart.
  const horizontal = block.tipe === "bar" && categories.some((c) => c.length > 14);
  const categoryAxis = {
    type: "category",
    data: horizontal ? categories.toReversed() : categories,
    axisLine: { lineStyle: { color: "#e3e0d8" } },
    axisTick: { show: false },
    axisLabel: { color: MUTED, fontSize: 12, width: horizontal ? 180 : 90, overflow: "truncate", hideOverlap: true },
  };
  const counts = block.y.every((c) => block.baris.every((r) => r[c] === null || Number.isInteger(r[c])));
  const valueAxis = {
    type: "value",
    minInterval: counts ? 1 : undefined,
    splitLine: { lineStyle: { color: LINE } },
    axisLabel: { color: MUTED, fontSize: 12 },
    name: block.satuan ?? "",
    nameTextStyle: { color: MUTED, fontSize: 11 },
  };
  return {
    ...base,
    legend: block.y.length > 1 ? { top: 0, textStyle: { color: MUTED, fontSize: 12 } } : undefined,
    grid: { left: 8, right: 16, top: block.y.length > 1 ? 32 : 16, bottom: 8, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: block.y.map((column) => {
      const values = block.baris.map((row) => row[column] ?? null);
      return {
        name: column,
        type: block.tipe === "line" ? "line" : "bar",
        data: horizontal ? values.toReversed() : values,
        barMaxWidth: 28,
        smooth: block.tipe === "line" ? 0.2 : undefined,
        symbolSize: 6,
        itemStyle: { borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
      };
    }),
  };
};

/** Taller charts for many horizontal bars. */
export const chartHeight = (block: RenderBlock) =>
  block.tipe === "bar" && block.baris.some((r) => label(r[block.x ?? ""]).length > 14)
    ? Math.max(220, block.baris.length * 30 + 40)
    : 300;
