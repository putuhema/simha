/**
 * Small React wrapper around Apache ECharts. Only the chart types we use are
 * bundled, and the SVG renderer keeps charts sharp in Electron and when printed.
 */
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

export const EChart = ({ option, height = 300, label }: { readonly option: ChartOption; readonly height?: number; readonly label: string }) => {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!element.current) return;
    const instance = echarts.init(element.current, null, { renderer: "svg" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={element} role="img" aria-label={label} style={{ height }} className="w-full" />;
};
