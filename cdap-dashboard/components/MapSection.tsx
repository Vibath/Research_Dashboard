"use client";

import { useState, useCallback, useMemo } from "react";
import Map, { Source, Layer, MapLayerMouseEvent } from "react-map-gl/maplibre";
import type { LayerSpecification } from "maplibre-gl";
import type { DivisionProps, MapMetric } from "../app/page";
import { CLUSTER_COLORS } from "../app/page";

// ─── Types ────────────────────────────────────────────────────────────────────
interface MapSectionProps {
  geojsonData: GeoJSON.FeatureCollection | null;
  mapMetric: MapMetric;
  onHover: (
    info: { properties: DivisionProps; x: number; y: number } | null
  ) => void;
  onClick: (props: DivisionProps) => void;
  selectedName: string | null;
}

// MapLibre expression type alias to avoid 'any'
type MLExpression = LayerSpecification extends { paint?: infer P }
  ? P extends Record<string, infer V>
    ? V
    : unknown
  : unknown;

// ─── Color helpers ────────────────────────────────────────────────────────────
function getContinuousFillExpression(
  metric: MapMetric,
  data: GeoJSON.FeatureCollection
): MLExpression {
  const values = data.features
    .map((f) => (f.properties as DivisionProps)[metric] as number)
    .filter((v) => v != null && !isNaN(v));

  if (values.length === 0) return "#94a3b8" as MLExpression;

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Prevent min === max (all same value)
  const safeMax = max > min ? max : min + 1;

  return [
    "interpolate",
    ["linear"],
    ["get", metric],
    min, "#bfdbfe",
    safeMax, "#1e40af",
  ] as unknown as MLExpression;
}

function getCategoricalFillExpression(): MLExpression {
  return [
    "match",
    ["get", "Best_Model_Cluster"],
    0, CLUSTER_COLORS[0],
    1, CLUSTER_COLORS[1],
    2, CLUSTER_COLORS[2],
    3, CLUSTER_COLORS[3],
    "#94a3b8",
  ] as unknown as MLExpression;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MapSection({
  geojsonData,
  mapMetric,
  onHover,
  onClick,
  selectedName,
}: MapSectionProps) {
  const [viewState, setViewState] = useState({
    longitude: 80.7718,
    latitude: 7.8731,
    zoom: 6.8,
  });

  const fillColor = useMemo<MLExpression>(() => {
    if (!geojsonData) return "#94a3b8" as MLExpression;
    if (mapMetric === "Best_Model_Cluster") {
      return getCategoricalFillExpression();
    }
    return getContinuousFillExpression(mapMetric, geojsonData);
  }, [mapMetric, geojsonData]);

  const handleMouseMove = useCallback(
    (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (feature?.properties) {
        onHover({
          properties: feature.properties as DivisionProps,
          x: event.point.x,
          y: event.point.y,
        });
      } else {
        onHover(null);
      }
    },
    [onHover]
  );

  const handleMouseLeave = useCallback(() => {
    onHover(null);
  }, [onHover]);

  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (feature?.properties) {
        onClick(feature.properties as DivisionProps);
      }
    },
    [onClick]
  );

  if (!geojsonData) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 gap-3">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Loading spatial data…</p>
      </div>
    );
  }

  return (
    <Map
      {...viewState}
      onMove={(evt) => setViewState(evt.viewState)}
      style={{ width: "100%", height: "100%" }}
      mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      interactiveLayerIds={["divisions-fill"]}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <Source id="divisions" type="geojson" data={geojsonData}>
        {/* Fill layer */}
        <Layer
          id="divisions-fill"
          type="fill"
          paint={{
            "fill-color": fillColor as LayerSpecification extends { type: "fill"; paint?: infer P }
              ? P extends Record<"fill-color", infer C> ? C : never
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              : any,
            "fill-opacity": 0.75,
          }}
        />

        {/* Outline layer */}
        <Layer
          id="divisions-outline"
          type="line"
          paint={{
            "line-color": "#ffffff",
            "line-width": 0.6,
            "line-opacity": 0.8,
          }}
        />

        {/* Selected division highlight */}
        {selectedName && (
          <Layer
            id="divisions-selected"
            type="line"
            filter={["==", ["get", "adm3_name"], selectedName]}
            paint={{
              "line-color": "#1d4ed8",
              "line-width": 3,
              "line-opacity": 1,
            }}
          />
        )}

        {/* Selected division fill pulse */}
        {selectedName && (
          <Layer
            id="divisions-selected-fill"
            type="fill"
            filter={["==", ["get", "adm3_name"], selectedName]}
            paint={{
              "fill-color": "#3b82f6",
              "fill-opacity": 0.15,
            }}
          />
        )}
      </Source>
    </Map>
  );
}
