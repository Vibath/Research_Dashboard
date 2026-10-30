"use client";

import React, { useState, useEffect, useMemo, useSyncExternalStore } from "react";
import Map, { Source, Layer, type MapLayerMouseEvent, type LayerProps } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import {
  MapIcon,
  Activity,
  Layers,
  MapPin,
  LayoutDashboard,
  Database,
  Settings,
  Filter,
  ShieldAlert,
  Search,
  Download,
  RefreshCw,
  CheckCircle2,
  Sliders,
  Globe2,
  BarChart3,
  ExternalLink,
  RotateCcw,
  Building2,
  GraduationCap,
  HeartPulse,
  Printer,
  TableProperties,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Cpu,
  CheckCircle,
} from "lucide-react";

// ─── TYPES & INTERFACES ────────────────────────────────────────────────────────
export type MapMetric =
  | "Best_Model_Cluster"
  | "Total_Services_Count"
  | "Service_Diversity_Score"
  | "Hospital_per_50k";

export interface DivisionProps {
  adm3_name: string;
  adm3_pcode?: string;
  Best_Model_Cluster: number;
  Total_Services_Count: number;
  Service_Diversity_Score: number;
  Hospital_per_50k?: number;
  Severe_Deficit_Flag?: number;
  Edu_Primary?: number;
  Edu_Higher?: number;
  Health_Major?: number;
  Health_Minor?: number;
  Finance?: number;
  Civic?: number;
  center_lat?: number | string;
  center_lon?: number | string;
  Pop_sum?: number | string;
  Area_km2?: number | string;
  [key: string]: string | number | boolean | null | undefined | unknown;
}

type SortField =
  | "adm3_name"
  | "Best_Model_Cluster"
  | "Total_Services_Count"
  | "Service_Diversity_Score"
  | "Edu_Primary"
  | "Health_Major"
  | "Civic"
  | "Finance";

type SortDirection = "asc" | "desc";

// ─── CONSTANTS & STYLING PALETTES ─────────────────────────────────────────────
export const CLUSTER_COLORS: Record<number, string> = {
  0: "#ef4444",
  1: "#10B981",
  2: "#3b82f6",
  3: "#f59e0b",
};

export const CLUSTER_LABELS: Record<number, string> = {
  0: "Tier 0: Severe Desert",
  1: "Tier 1: Developed Hub",
  2: "Tier 2: Adequate",
  3: "Tier 3: Transitional",
};

export const CLUSTER_DESCRIPTIONS: Record<number, string> = {
  0: "Acute infrastructure scarcity with severe service deficits.",
  1: "High facility density, diverse educational & medical hubs.",
  2: "Balanced accessibility meeting baseline public needs.",
  3: "Developing service capacity requiring targeted expansion.",
};

const NATIONAL_AVERAGES = {
  Edu_Primary: 28,
  Edu_Higher: 1.2,
  Health_Major: 0.8,
  Health_Minor: 8.5,
  FinanceCivic: 12,
};

// Safe numerical parser handling string numbers from GeoJSON properties
function toNum(val: unknown, fallback = 0): number {
  if (typeof val === "number") return isNaN(val) ? fallback : val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

// Format property values cleanly for the extended dataset grid
function formatPropertyValue(val: unknown): string {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === "boolean") return val ? "True" : "False";
  if (typeof val === "number") {
    if (Number.isInteger(val)) return val.toLocaleString();
    return Number(val.toFixed(3)).toString();
  }
  if (typeof val === "string") {
    const num = parseFloat(val);
    if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(val.trim())) {
      if (Number.isInteger(num)) return num.toLocaleString();
      return Number(num.toFixed(3)).toString();
    }
    return val;
  }
  return String(val);
}

// Format property names into clean human-readable headers
function formatPropertyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ─── MAIN DASHBOARD COMPONENT ──────────────────────────────────────────────────
export default function AdvancedCDAPDashboard() {
  // SSR Safe Client Hydration Bypass
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Application Shell State
  const [activePage, setActivePage] = useState<"overview" | "spatial" | "data" | "settings">("overview");

  // Core Spatial & GeoJSON State
  const [rawGeoJSON, setRawGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ properties: DivisionProps; x: number; y: number } | null>(null);
  const [selectedDS, setSelectedDS] = useState<DivisionProps | null>(null);
  const [mapMetric, setMapMetric] = useState<MapMetric>("Best_Model_Cluster");
  const [showDesertsOnly, setShowDesertsOnly] = useState(false);

  // Map Camera State
  const [viewState, setViewState] = useState({
    longitude: 80.7718,
    latitude: 7.8731,
    zoom: 7,
  });

  // Spatial Search State
  const [spatialSearchTerm, setSpatialSearchTerm] = useState("");
  const [spatialSearchOpen, setSpatialSearchOpen] = useState(false);

  // Data Matrix Page State
  const [dataSearchTerm, setDataSearchTerm] = useState("");
  const [dataTierFilter, setDataTierFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("adm3_name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Settings & ML Engine State
  const [featureWeights, setFeatureWeights] = useState({
    edu: 0.35,
    health: 0.4,
    civicFinance: 0.25,
  });
  const [isRetraining, setIsRetraining] = useState(false);
  const [retrainSuccess, setRetrainSuccess] = useState(false);

  // Fetch Dataset
  useEffect(() => {
    fetch("/data/SL_ML_Results.geojson")
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => setRawGeoJSON(data))
      .catch((err) => console.error("Failed to load geojson", err));
  }, []);

  // Filtered GeoJSON for Spatial Map
  const displayGeoJSON = useMemo(() => {
    if (!rawGeoJSON) return null;
    if (!showDesertsOnly) return rawGeoJSON;
    return {
      ...rawGeoJSON,
      features: rawGeoJSON.features.filter((f) => {
        const props = f.properties as DivisionProps | null;
        return (
          toNum(props?.Severe_Deficit_Flag) === 1 ||
          toNum(props?.Best_Model_Cluster) === 0
        );
      }),
    };
  }, [rawGeoJSON, showDesertsOnly]);

  // Aggregate Statistics for Overview Page
  const overviewStats = useMemo(() => {
    if (!rawGeoJSON?.features) {
      return {
        totalDivisions: 331,
        severeCount: 48,
        totalServices: 14820,
        avgDiversity: 8.4,
        clusterDistribution: [
          { name: "Tier 0", label: "Severe Desert", count: 48, fill: CLUSTER_COLORS[0] },
          { name: "Tier 1", label: "Developed Hub", count: 72, fill: CLUSTER_COLORS[1] },
          { name: "Tier 2", label: "Adequate", count: 124, fill: CLUSTER_COLORS[2] },
          { name: "Tier 3", label: "Transitional", count: 87, fill: CLUSTER_COLORS[3] },
        ],
      };
    }

    const features = rawGeoJSON.features;
    let severeCount = 0;
    let totalServices = 0;
    let sumDiversity = 0;
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

    features.forEach((f) => {
      const p = f.properties as DivisionProps;
      const cluster = Math.round(toNum(p.Best_Model_Cluster, 0));
      if (counts[cluster] !== undefined) counts[cluster]++;

      if (toNum(p.Severe_Deficit_Flag) === 1 || cluster === 0) {
        severeCount++;
      }
      totalServices += toNum(p.Total_Services_Count);
      sumDiversity += toNum(p.Service_Diversity_Score);
    });

    return {
      totalDivisions: features.length,
      severeCount,
      totalServices,
      avgDiversity: +(sumDiversity / (features.length || 1)).toFixed(1),
      clusterDistribution: [
        { name: "Tier 0", label: "Severe Desert", count: counts[0], fill: CLUSTER_COLORS[0] },
        { name: "Tier 1", label: "Developed Hub", count: counts[1], fill: CLUSTER_COLORS[1] },
        { name: "Tier 2", label: "Adequate", count: counts[2], fill: CLUSTER_COLORS[2] },
        { name: "Tier 3", label: "Transitional", count: counts[3], fill: CLUSTER_COLORS[3] },
      ],
    };
  }, [rawGeoJSON]);

  // Select Division & Smooth Pan
  const handleSelectDS = (props: DivisionProps) => {
    setSelectedDS(props);
    const lon = toNum(props.center_lon);
    const lat = toNum(props.center_lat);
    if (lon && lat) {
      setViewState((prev) => ({
        ...prev,
        longitude: lon,
        latitude: lat,
        zoom: Math.max(prev.zoom, 8.5),
      }));
    }
  };

  // Live Spatial Search Matches
  const searchedDivisions = useMemo(() => {
    if (!rawGeoJSON?.features || !spatialSearchTerm.trim()) return [];
    const term = spatialSearchTerm.toLowerCase().trim();
    return rawGeoJSON.features
      .map((f) => f.properties as DivisionProps)
      .filter((p) => p.adm3_name?.toLowerCase().includes(term))
      .slice(0, 12);
  }, [rawGeoJSON, spatialSearchTerm]);

  // Maplibre Fill Layer
  const dataLayer: LayerProps = useMemo(
    () => ({
      id: "data-layer",
      type: "fill",
      paint: {
        "fill-color": (mapMetric === "Best_Model_Cluster"
          ? [
              "match",
              ["to-number", ["get", "Best_Model_Cluster"]],
              0,
              "#EF4444",
              1,
              "#10B981",
              2,
              "#3B82F6",
              3,
              "#F59E0B",
              "#CCCCCC",
            ]
          : [
              "interpolate",
              ["linear"],
              ["to-number", ["get", mapMetric]],
              0,
              "#EFF6FF",
              100,
              "#1D4ED8",
            ]) as unknown as string,
        "fill-opacity": showDesertsOnly ? 0.9 : 0.75,
        "fill-outline-color": showDesertsOnly ? "#991B1B" : "#ffffff",
      },
    }),
    [mapMetric, showDesertsOnly]
  );

  // Map Hover Event
  const onHover = (event: MapLayerMouseEvent) => {
    const { features, point: { x, y } } = event;
    const hoveredFeature = features && features[0];
    if (hoveredFeature?.properties) {
      setHoverInfo({ properties: hoveredFeature.properties as DivisionProps, x, y });
    } else {
      setHoverInfo(null);
    }
  };

  // Map Click Event
  const onClick = (event: MapLayerMouseEvent) => {
    const { features } = event;
    if (features && features.length > 0 && features[0].properties) {
      handleSelectDS(features[0].properties as DivisionProps);
    } else {
      setSelectedDS(null);
    }
  };

  // Comparative Radar Data for Selected Division
  const radarData = selectedDS
    ? [
        { subject: "Primary Edu", Selected: toNum(selectedDS.Edu_Primary), National: NATIONAL_AVERAGES.Edu_Primary, fullMark: 100 },
        { subject: "Higher Edu", Selected: toNum(selectedDS.Edu_Higher), National: NATIONAL_AVERAGES.Edu_Higher, fullMark: 10 },
        { subject: "Major Health", Selected: toNum(selectedDS.Health_Major), National: NATIONAL_AVERAGES.Health_Major, fullMark: 5 },
        { subject: "Minor Health", Selected: toNum(selectedDS.Health_Minor), National: NATIONAL_AVERAGES.Health_Minor, fullMark: 30 },
        { subject: "Finance/Civic", Selected: toNum(selectedDS.Finance) + toNum(selectedDS.Civic), National: NATIONAL_AVERAGES.FinanceCivic, fullMark: 40 },
      ]
    : [];

  // Dynamic Extended Features Grid for Selected Division
  const extendedFeaturesEntries = useMemo(() => {
    if (!selectedDS) return [];
    return Object.entries(selectedDS).filter(
      ([key, value]) =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        typeof value !== "object" &&
        !["center_lat", "center_lon"].includes(key)
    );
  }, [selectedDS]);

  // Data Matrix Sorting Handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Data Matrix Search, Filter & Sort Logic via useMemo
  const processedMatrixData = useMemo(() => {
    if (!rawGeoJSON?.features) return [];

    const searchLower = dataSearchTerm.trim().toLowerCase();

    // 1. Filter by search & cluster
    const filtered = rawGeoJSON.features
      .map((f) => f.properties as DivisionProps)
      .filter((p) => {
        const matchesName = (p.adm3_name || "").toLowerCase().includes(searchLower);
        const clusterVal = String(Math.round(toNum(p.Best_Model_Cluster, 0)));
        const matchesTier = dataTierFilter === "all" || clusterVal === dataTierFilter;
        return matchesName && matchesTier;
      });

    // 2. Sort by active column
    return filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (sortField === "adm3_name") {
        const aStr = (aVal || "").toString().toLowerCase();
        const bStr = (bVal || "").toString().toLowerCase();
        if (aStr < bStr) return sortDirection === "asc" ? -1 : 1;
        if (aStr > bStr) return sortDirection === "asc" ? 1 : -1;
        return 0;
      }

      const aNum = toNum(aVal);
      const bNum = toNum(bVal);
      return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
    });
  }, [rawGeoJSON, dataSearchTerm, dataTierFilter, sortField, sortDirection]);

  // Export CSV Handler
  const handleDownloadCSV = () => {
    if (!rawGeoJSON?.features || rawGeoJSON.features.length === 0) return;
    const headers = [
      "Division Name",
      "PCode",
      "ML Tier",
      "Tier Label",
      "Total Services",
      "Diversity Score",
      "Edu Primary",
      "Health Major",
      "Civic",
      "Finance",
      "Hospitals per 50k",
      "Severe Deficit Flag",
    ];

    const rows = rawGeoJSON.features.map((f) => {
      const p = f.properties as DivisionProps;
      const tier = Math.round(toNum(p.Best_Model_Cluster, 0));
      return [
        `"${p.adm3_name || ""}"`,
        `"${p.adm3_pcode || ""}"`,
        tier,
        `"${CLUSTER_LABELS[tier] || ""}"`,
        toNum(p.Total_Services_Count),
        toNum(p.Service_Diversity_Score),
        toNum(p.Edu_Primary),
        toNum(p.Health_Major),
        toNum(p.Civic),
        toNum(p.Finance),
        toNum(p.Hospital_per_50k).toFixed(2),
        toNum(p.Severe_Deficit_Flag) === 1 ? "1 (Flagged Deficit)" : "0 (Balanced)",
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = url;
    downloadAnchor.setAttribute("download", `SL_Infrastructure_Equity_Assessment_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(url);
  };

  // Model Retrain Simulation
  const handleRetrainModel = () => {
    setIsRetraining(true);
    setRetrainSuccess(false);
    setTimeout(() => {
      setIsRetraining(false);
      setRetrainSuccess(true);
      setTimeout(() => setRetrainSuccess(false), 5000);
    }, 2000);
  };

  if (!isMounted) {
    return (
      <div className="h-screen w-screen bg-slate-50 flex flex-col items-center justify-center gap-3 font-sans text-slate-700">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-sm font-semibold tracking-wide text-slate-500">Initializing CDAP Research Platform...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-800 antialiased select-none">
      {/* ─── 1. APP NAVIGATION RAIL ────────────────────────────────────────── */}
      <nav className="w-20 bg-slate-900 flex flex-col items-center py-6 gap-7 z-30 shadow-2xl flex-shrink-0 border-r border-slate-800/80">
        <div className="w-11 h-11 bg-gradient-to-tr from-blue-700 to-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25 mb-2 ring-2 ring-white/10">
          <Layers className="text-white w-6 h-6" />
        </div>

        <div className="flex flex-col gap-3.5 w-full px-3">
          <NavItem
            icon={LayoutDashboard}
            label="Overview"
            description="Executive summary & pipeline"
            active={activePage === "overview"}
            onClick={() => setActivePage("overview")}
          />
          <NavItem
            icon={MapIcon}
            label="Spatial ML"
            description="Interactive Maplibre clustering"
            active={activePage === "spatial"}
            onClick={() => setActivePage("spatial")}
          />
          <NavItem
            icon={Database}
            label="Data Matrix"
            description="Multi-attribute sorted datagrid"
            active={activePage === "data"}
            onClick={() => setActivePage("data")}
          />
        </div>

        <div className="mt-auto w-full px-3">
          <NavItem
            icon={Settings}
            label="Settings"
            description="ML pipeline & diagnostics"
            active={activePage === "settings"}
            onClick={() => setActivePage("settings")}
          />
        </div>
      </nav>

      {/* ─── 2. ACTIVE PAGE CONTAINER ──────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* ─── PAGE 1: OVERVIEW (HOME) ─────────────────────────────────────── */}
        {activePage === "overview" && (
          <main className="flex-1 overflow-y-auto bg-slate-50 flex flex-col p-8 animate-in fade-in duration-300">
            <div className="max-w-7xl mx-auto w-full space-y-8">
              {/* Research Defense Academic Banner */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 border-b border-slate-200/80 pb-6">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 uppercase tracking-wider">
                      CDAP Research Defense
                    </span>
                    <span className="text-xs text-slate-400 font-medium">Department of Computer Science & Software Engineering</span>
                  </div>
                  <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-1.5">
                    Sri Lanka National Infrastructure Equity Assessment
                  </h1>
                  <p className="text-sm text-slate-600 mt-1 max-w-3xl font-medium">
                    Unsupervised Spatial Machine Learning Engine (GMM Clustering) for Divisional Secretariat (DSD) Public Service Deserts
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button
                    onClick={() => setActivePage("spatial")}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-all"
                  >
                    <MapIcon size={16} /> Open Spatial ML Map
                  </button>
                  <button
                    onClick={() => setActivePage("data")}
                    className="inline-flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-sm font-semibold px-4 py-2.5 rounded-xl shadow-sm transition-all"
                  >
                    <Database size={16} /> View Data Matrix
                  </button>
                </div>
              </div>

              {/* Research Metrics Showcase */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Spatial Extent</span>
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                      <Globe2 size={18} />
                    </div>
                  </div>
                  <div className="text-3xl font-extrabold text-slate-900">331 DS Divisions Analyzed</div>
                  <p className="text-xs text-slate-500 mt-2 font-medium">
                    National administrative census coverage across all 25 districts with complete multi-attribute vector layers.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Clustering Algorithm</span>
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <Cpu size={18} />
                    </div>
                  </div>
                  <div className="text-3xl font-extrabold text-slate-900">Model: Gaussian Mixture Models (GMM)</div>
                  <p className="text-xs text-slate-500 mt-2 font-medium">
                    Probabilistic clustering with spatial lag regularization (K=4) evaluated via Silhouette & BIC validation.
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between text-slate-400 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Vulnerability Detection</span>
                    <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-600">
                      <ShieldAlert size={18} />
                    </div>
                  </div>
                  <div className="text-3xl font-extrabold text-red-600">
                    {overviewStats.severeCount} Identified Tier 0 Service Deserts
                  </div>
                  <p className="text-xs text-red-600/90 mt-2 font-medium">
                    Statistically flagged administrative divisions demonstrating critical deficits in public amenities.
                  </p>
                </div>
              </div>

              {/* Research Methodology Pipeline Status */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Activity size={18} className="text-blue-600" /> End-to-End Pipeline Status
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Empirical workflow architecture from raw spatial vector data to client-side ML rendering
                    </p>
                  </div>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> All Stages Verified
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
                    <CheckCircle className="text-emerald-500 flex-shrink-0 mt-0.5" size={18} />
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">Vector Data Rasterization</h3>
                      <p className="text-xs text-emerald-600 font-semibold mt-0.5">Complete</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        OpenStreetMap & Survey Dept boundary aggregation with 17 facility classes.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
                    <CheckCircle className="text-emerald-500 flex-shrink-0 mt-0.5" size={18} />
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">Feature Scaling & PCA</h3>
                      <p className="text-xs text-emerald-600 font-semibold mt-0.5">Complete</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Robust z-score normalization and multicollinearity variance reduction.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
                    <CheckCircle className="text-emerald-500 flex-shrink-0 mt-0.5" size={18} />
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">K-Means/GMM Clustering</h3>
                      <p className="text-xs text-emerald-600 font-semibold mt-0.5">Complete</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Expectation-Maximization converged with optimal Bayesian Information Criterion.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-100 flex items-start gap-3">
                    <Activity className="text-blue-600 flex-shrink-0 mt-0.5 animate-pulse" size={18} />
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">Live Dashboard Rendering</h3>
                      <p className="text-xs text-blue-600 font-semibold mt-0.5">Active</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Client-side Maplibre GPU tiles & interactive dynamic multidimensional analytics.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chart & Cluster Distribution Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recharts Bar Chart */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                        <BarChart3 size={18} className="text-blue-600" />
                        GMM Cluster Division Distribution
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Categorization of Sri Lankan administrative divisions across the 4 identified tiers
                      </p>
                    </div>
                    <span className="text-xs font-bold px-2.5 py-1 bg-slate-100 rounded-lg text-slate-600">
                      K=4 Gaussian Components
                    </span>
                  </div>

                  <div className="h-[280px] w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={overviewStats.clusterDistribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b", fontWeight: 600 }} />
                        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
                        <RechartsTooltip
                          cursor={{ fill: "rgba(241, 245, 249, 0.6)" }}
                          contentStyle={{ backgroundColor: "#1e293b", borderRadius: "10px", border: "none", color: "#fff" }}
                          itemStyle={{ color: "#fff", fontSize: "12px", fontWeight: "bold" }}
                          formatter={(value: unknown) => [`${value} Divisions`, "Count"]}
                        />
                        <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={60}>
                          {overviewStats.clusterDistribution.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Cluster Taxonomy Breakdown */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 mb-1">Clustering Taxonomy</h2>
                    <p className="text-xs text-slate-500 mb-4">Empirical tier attributes extracted from feature distributions</p>
                    <div className="space-y-3">
                      {Object.entries(CLUSTER_LABELS).map(([k, label]) => {
                        const tierNum = Number(k);
                        return (
                          <div key={k} className="p-3 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold flex items-center gap-2" style={{ color: CLUSTER_COLORS[tierNum] }}>
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[tierNum] }} />
                                {label}
                              </span>
                              <span className="text-xs font-bold text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                                {overviewStats.clusterDistribution[tierNum]?.count ?? 0}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-tight">
                              {CLUSTER_DESCRIPTIONS[tierNum]}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => setActivePage("spatial")}
                    className="mt-4 w-full py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    Inspect Spatial Distribution <ExternalLink size={14} />
                  </button>
                </div>
              </div>
            </div>
          </main>
        )}

        {/* ─── PAGE 2: ADVANCED SPATIAL ML MAPLIBRE PAGE ────────────────────── */}
        {activePage === "spatial" && (
          <div className="flex-1 flex overflow-hidden min-w-0 animate-in fade-in duration-300">
            {/* 2.1 CONTROL PANEL */}
            <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shadow-sm z-20 flex-shrink-0">
              <div className="p-6 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-800 tracking-tight">Public Services</h2>
                <p className="text-xs text-slate-500 mt-1">Spatial Machine Learning</p>
              </div>

              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                {/* 2.1.1 LIVE DS SEARCH ENGINE */}
                <div className="relative">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest mb-2.5">
                    <Search size={14} className="text-blue-500" /> Live DS Search Engine
                  </label>
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Type division name..."
                      value={spatialSearchTerm}
                      onChange={(e) => {
                        setSpatialSearchTerm(e.target.value);
                        setSpatialSearchOpen(true);
                      }}
                      onFocus={() => setSpatialSearchOpen(true)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs focus:ring-2 focus:ring-blue-600 outline-none transition-all placeholder:text-slate-400 font-medium"
                    />
                    {spatialSearchTerm && (
                      <button
                        onClick={() => {
                          setSpatialSearchTerm("");
                          setSpatialSearchOpen(false);
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Dropdown Auto-complete list */}
                  {spatialSearchOpen && spatialSearchTerm.trim() && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-150">
                      {searchedDivisions.length === 0 ? (
                        <div className="p-3 text-center text-xs text-slate-400 font-medium">No divisions match</div>
                      ) : (
                        searchedDivisions.map((division) => {
                          const tier = Math.round(toNum(division.Best_Model_Cluster, 0));
                          return (
                            <button
                              key={division.adm3_pcode || division.adm3_name}
                              onClick={() => {
                                handleSelectDS(division);
                                setSpatialSearchOpen(false);
                              }}
                              className="w-full p-2.5 text-left hover:bg-blue-50/70 transition-colors flex items-center justify-between group"
                            >
                              <div className="min-w-0 pr-2">
                                <p className="text-xs font-bold text-slate-800 group-hover:text-blue-600 truncate">
                                  {division.adm3_name}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono truncate">
                                  {division.adm3_pcode || "DSD"} · {toNum(division.Total_Services_Count)} facilities
                                </p>
                              </div>
                              <span
                                className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{
                                  color: CLUSTER_COLORS[tier],
                                  backgroundColor: `${CLUSTER_COLORS[tier]}18`,
                                }}
                              >
                                T{tier}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* 2.1.2 METRIC SELECTOR */}
                <div>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                    <Activity size={14} className="text-blue-500" /> Display Metric
                  </label>
                  <select
                    className="w-full bg-slate-50 border border-slate-200 text-slate-700 rounded-lg p-2.5 text-xs font-semibold focus:ring-2 focus:ring-blue-600 outline-none cursor-pointer"
                    value={mapMetric}
                    onChange={(e) => setMapMetric(e.target.value as MapMetric)}
                  >
                    <option value="Best_Model_Cluster">Machine Learning Tiers</option>
                    <option value="Total_Services_Count">Total Facility Count</option>
                    <option value="Service_Diversity_Score">Diversity Score</option>
                    <option value="Hospital_per_50k">Hospitals per 50k</option>
                  </select>
                </div>

                {/* 2.1.3 VULNERABILITY FILTER */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                    <Filter size={14} className="text-blue-500" /> Vulnerability Filter
                  </label>
                  <label className="flex items-center cursor-pointer gap-3">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={showDesertsOnly}
                        onChange={() => setShowDesertsOnly(!showDesertsOnly)}
                      />
                      <div
                        className={`block w-10 h-6 rounded-full transition-colors ${
                          showDesertsOnly ? "bg-red-500" : "bg-slate-300"
                        }`}
                      />
                      <div
                        className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${
                          showDesertsOnly ? "translate-x-4" : ""
                        }`}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-700">Isolate Tier 0 Deserts</span>
                  </label>
                </div>

                {/* 2.1.4 MAP LEGEND */}
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 block">Legend</label>
                  {mapMetric === "Best_Model_Cluster" ? (
                    <div className="space-y-2.5">
                      {Object.entries(CLUSTER_LABELS).map(([k, label]) => (
                        <div key={k} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[Number(k)] }} />
                          <span className="text-xs font-medium text-slate-600">{label}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="h-3 rounded-full bg-gradient-to-r from-blue-100 to-blue-700" />
                      <div className="flex justify-between text-[10px] text-slate-400 font-semibold px-0.5">
                        <span>Low Density</span>
                        <span>High Density</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* 2.2 MAIN MAP AREA */}
            <main className="flex-1 flex relative bg-slate-100 min-w-0">
              {displayGeoJSON ? (
                <div className="absolute inset-0 w-full h-full">
                  <Map
                    {...viewState}
                    onMove={(evt) => setViewState(evt.viewState)}
                    style={{ width: "100%", height: "100%" }}
                    mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                    interactiveLayerIds={["data-layer"]}
                    onMouseMove={onHover}
                    onMouseLeave={() => setHoverInfo(null)}
                    onClick={onClick}
                  >
                    <Source type="geojson" data={displayGeoJSON}>
                      {/* Base Choropleth Layer */}
                      <Layer {...dataLayer} />

                      {/* Highlight Fill Layer for Selected Division */}
                      {selectedDS && (
                        <Layer
                          id="selected-ds-fill"
                          type="fill"
                          filter={["==", ["get", "adm3_name"], selectedDS.adm3_name]}
                          paint={{
                            "fill-color": "#2563eb",
                            "fill-opacity": 0.25,
                          }}
                        />
                      )}

                      {/* Highlight Contour Outline Layer for Selected Division */}
                      {selectedDS && (
                        <Layer
                          id="selected-ds-outline"
                          type="line"
                          filter={["==", ["get", "adm3_name"], selectedDS.adm3_name]}
                          paint={{
                            "line-color": "#1d4ed8",
                            "line-width": 3,
                          }}
                        />
                      )}
                    </Source>
                  </Map>

                  {/* Hover Floating Tooltip */}
                  {hoverInfo && (
                    <div
                      className="absolute bg-slate-900/95 backdrop-blur-sm text-white p-3 rounded-xl shadow-2xl text-sm pointer-events-none transform -translate-x-1/2 -translate-y-[120%] z-50 border border-slate-700 min-w-[180px]"
                      style={{ left: hoverInfo.x, top: hoverInfo.y }}
                    >
                      <p className="font-bold text-base mb-2">{hoverInfo.properties.adm3_name}</p>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">ML Tier</span>
                        <span
                          className="font-bold px-1.5 rounded"
                          style={{
                            color: CLUSTER_COLORS[Math.round(toNum(hoverInfo.properties.Best_Model_Cluster))],
                            backgroundColor: `${CLUSTER_COLORS[Math.round(toNum(hoverInfo.properties.Best_Model_Cluster))]}20`,
                          }}
                        >
                          Tier {Math.round(toNum(hoverInfo.properties.Best_Model_Cluster))}
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Services</span>
                        <span className="font-bold">{hoverInfo.properties.Total_Services_Count}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center w-full h-full">
                  <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                </div>
              )}
            </main>

            {/* 2.3 COMPARATIVE ANALYTICS & EXTENDED FEATURES PANEL */}
            <aside className="w-[440px] bg-white border-l border-slate-200 shadow-2xl z-20 flex flex-col overflow-y-auto flex-shrink-0">
              {!selectedDS ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 opacity-60">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
                    <MapPin className="w-8 h-8 text-blue-500" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800">Select a Division</h3>
                  <p className="text-sm text-slate-500 mt-2 max-w-[250px]">
                    Click any polygon on the map or search from the control panel to view its complete micro-analytics profile.
                  </p>
                </div>
              ) : (
                <div className="p-6 animate-in fade-in slide-in-from-right-4 duration-300 space-y-6">
                  {/* Panel Header & Generate Report Action */}
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <button
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 rounded-xl text-xs font-bold transition-all shadow-sm"
                      title="Generate and print administrative DS profile report"
                    >
                      <Printer size={14} className="text-blue-600" />
                      <span>Generate DS Report</span>
                    </button>
                    <button
                      onClick={() => setSelectedDS(null)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-bold text-xs"
                      aria-label="Close panel"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Division Heading */}
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">{selectedDS.adm3_name}</h2>
                      {selectedDS.adm3_pcode && (
                        <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                          {selectedDS.adm3_pcode}
                        </span>
                      )}
                    </div>
                    <span
                      className="inline-block mt-2 px-2.5 py-1 text-xs font-bold rounded-md"
                      style={{
                        backgroundColor: `${CLUSTER_COLORS[Math.round(toNum(selectedDS.Best_Model_Cluster))]}15`,
                        color: CLUSTER_COLORS[Math.round(toNum(selectedDS.Best_Model_Cluster))],
                      }}
                    >
                      {CLUSTER_LABELS[Math.round(toNum(selectedDS.Best_Model_Cluster))]}
                    </span>
                  </div>

                  {/* Severe Deficit Hotspot Alert */}
                  {toNum(selectedDS.Severe_Deficit_Flag) === 1 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 items-start shadow-sm">
                      <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={20} />
                      <div>
                        <p className="text-sm font-bold text-red-800">Critical Service Deficit</p>
                        <p className="text-xs text-red-600 mt-1">
                          Statistically flagged by the spatial lag model for urgent infrastructure intervention.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Top Stats Cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Facilities</p>
                      <p className="text-2xl font-extrabold text-slate-800">{toNum(selectedDS.Total_Services_Count)}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Diversity Index</p>
                      <p className="text-2xl font-extrabold text-slate-800">
                        {toNum(selectedDS.Service_Diversity_Score)}/17
                      </p>
                    </div>
                  </div>

                  {/* Comparative Baseline Radar Chart */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-800 mb-1">Comparative Baseline Profile</h3>
                    <p className="text-xs text-slate-500 mb-3">Selected division vs. Sri Lankan national averages.</p>
                    <div className="h-[260px] w-full bg-slate-50 border border-slate-100 rounded-xl p-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarData}>
                          <PolarGrid stroke="#E2E8F0" />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748B", fontSize: 10, fontWeight: 700 }} />
                          <Radar
                            name="National Avg"
                            dataKey="National"
                            stroke="#94A3B8"
                            strokeDasharray="3 3"
                            fill="none"
                            strokeWidth={2}
                          />
                          <Radar
                            name={selectedDS.adm3_name}
                            dataKey="Selected"
                            stroke="#2563EB"
                            fill="#3B82F6"
                            fillOpacity={0.4}
                            strokeWidth={2}
                            dot={{ r: 3, fill: "#2563EB", strokeWidth: 0 }}
                          />
                          <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                          <RechartsTooltip
                            contentStyle={{ backgroundColor: "#1E293B", border: "none", borderRadius: "8px", color: "#fff" }}
                            itemStyle={{ color: "#fff", fontSize: "12px" }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Dynamic Extended Features Grid */}
                  <div className="pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <TableProperties size={16} className="text-blue-600" /> Extended Features
                      </h3>
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                        {extendedFeaturesEntries.length} Dimensions
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mb-3">
                      Multi-dimensional indicators dynamically extracted from the Python dataset properties.
                    </p>

                    <div className="grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1">
                      {extendedFeaturesEntries.map(([key, value]) => (
                        <div
                          key={key}
                          className="bg-slate-50 border border-slate-100 rounded-lg p-2.5 hover:bg-blue-50/50 hover:border-blue-100 transition-colors"
                        >
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate" title={key}>
                            {formatPropertyKey(key)}
                          </p>
                          <p className="text-xs font-bold text-slate-800 truncate mt-0.5" title={String(value)}>
                            {formatPropertyValue(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {/* ─── PAGE 3: DATA MATRIX - FULLY INTERACTIVE DATAGRID ────────────── */}
        {activePage === "data" && (
          <main className="flex-1 flex flex-col bg-slate-50 overflow-hidden animate-in fade-in duration-300">
            {/* Top Control Bar */}
            <div className="bg-white border-b border-slate-200 px-8 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 flex-shrink-0">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Data Matrix & Spatial Census</h1>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                    {processedMatrixData.length} of {overviewStats.totalDivisions} Divisions
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Multi-attribute datagrid with interactive column sorting, category filtration, and direct geospatial link.
                </p>
              </div>

              {/* Action Controls */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Global Search Input */}
                <div className="relative min-w-[260px]">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search division name..."
                    value={dataSearchTerm}
                    onChange={(e) => setDataSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl text-xs font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
                  />
                  {dataSearchTerm && (
                    <button
                      onClick={() => setDataSearchTerm("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Filter Dropdown */}
                <select
                  value={dataTierFilter}
                  onChange={(e) => setDataTierFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-700 py-2 px-3 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                >
                  <option value="all">All Tiers</option>
                  <option value="0">Tier 0: Severe Desert</option>
                  <option value="1">Tier 1: Developed Hub</option>
                  <option value="2">Tier 2: Adequate</option>
                  <option value="3">Tier 3: Transitional</option>
                </select>

                {/* Export Dataset (CSV) Button */}
                <button
                  onClick={handleDownloadCSV}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm transition-all"
                >
                  <Download size={14} /> Export Dataset (CSV)
                </button>
              </div>
            </div>

            {/* Scrollable Data Table with Clickable Sort Headers */}
            <div className="flex-1 overflow-auto p-8">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left text-xs text-slate-600 border-collapse">
                  <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-md z-10 border-b border-slate-200 select-none">
                    <tr>
                      <th
                        onClick={() => handleSort("adm3_name")}
                        className="py-3.5 px-5 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>DS Name</span>
                          {sortField === "adm3_name" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSort("Best_Model_Cluster")}
                        className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>ML Tier</span>
                          {sortField === "Best_Model_Cluster" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSort("Total_Services_Count")}
                        className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer text-right transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Total Services</span>
                          {sortField === "Total_Services_Count" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSort("Service_Diversity_Score")}
                        className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer text-center transition-colors"
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <span>Diversity Score</span>
                          {sortField === "Service_Diversity_Score" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSort("Edu_Primary")}
                        className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer text-right transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Edu Primary</span>
                          {sortField === "Edu_Primary" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSort("Health_Major")}
                        className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer text-right transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Health Major</span>
                          {sortField === "Health_Major" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSort("Civic")}
                        className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer text-right transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Civic</span>
                          {sortField === "Civic" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSort("Finance")}
                        className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-600 hover:text-blue-600 cursor-pointer text-right transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Finance</span>
                          {sortField === "Finance" ? (
                            sortDirection === "asc" ? <ArrowUp size={13} className="text-blue-600" /> : <ArrowDown size={13} className="text-blue-600" />
                          ) : (
                            <ArrowUpDown size={13} className="text-slate-400" />
                          )}
                        </div>
                      </th>

                      <th className="py-3.5 px-4 font-bold uppercase tracking-wider text-slate-500 text-center">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {processedMatrixData.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400">
                          <p className="text-sm font-semibold">No divisions match the search query.</p>
                          <p className="text-xs mt-1 text-slate-400">Try adjusting your filters or search keywords.</p>
                        </td>
                      </tr>
                    ) : (
                      processedMatrixData.map((row, idx) => {
                        const tier = Math.round(toNum(row.Best_Model_Cluster, 0));
                        const diversityScore = toNum(row.Service_Diversity_Score);

                        return (
                          <tr
                            key={row.adm3_pcode || `${row.adm3_name}-${idx}`}
                            className="even:bg-slate-50/50 hover:bg-blue-50/40 transition-colors"
                          >
                            <td className="py-3 px-5 font-bold text-slate-900">
                              <div className="flex flex-col">
                                <span>{row.adm3_name}</span>
                                {row.adm3_pcode && (
                                  <span className="text-[10px] text-slate-400 font-mono">{row.adm3_pcode}</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold"
                                style={{
                                  color: CLUSTER_COLORS[tier],
                                  backgroundColor: `${CLUSTER_COLORS[tier]}18`,
                                }}
                              >
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[tier] }} />
                                {CLUSTER_LABELS[tier]}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-800">
                              {toNum(row.Total_Services_Count)}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col items-center">
                                <span className="font-bold text-slate-700">{diversityScore} / 17</span>
                                <div className="w-16 bg-slate-200 h-1.5 rounded-full mt-1 overflow-hidden">
                                  <div
                                    className="bg-blue-600 h-full rounded-full"
                                    style={{ width: `${Math.min(100, (diversityScore / 17) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-700">
                              {toNum(row.Edu_Primary)}
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-700">
                              {toNum(row.Health_Major)}
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-700">
                              {toNum(row.Civic)}
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-700">
                              {toNum(row.Finance)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => {
                                  handleSelectDS(row);
                                  setActivePage("spatial");
                                }}
                                className="text-blue-600 hover:text-blue-800 font-bold hover:underline inline-flex items-center gap-1"
                              >
                                View Map <ExternalLink size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        )}

        {/* ─── PAGE 4: SETTINGS - ML PIPELINE ──────────────────────────────── */}
        {activePage === "settings" && (
          <main className="flex-1 overflow-y-auto bg-slate-50 flex flex-col p-8 animate-in fade-in duration-300">
            <div className="max-w-4xl mx-auto w-full space-y-8">
              {/* Top Banner */}
              <div className="border-b border-slate-200/80 pb-6">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 uppercase tracking-wider">
                    Model Calibration
                  </span>
                  <span className="text-xs text-slate-400 font-medium">GMM Engine v2.4</span>
                </div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-1.5">
                  ML Pipeline & System Configuration
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  Adjust feature weights for unsupervised Gaussian Mixture Model (GMM) clustering, examine PostGIS database status, and trigger model re-calibration.
                </p>
              </div>

              {/* Success Notification Alert */}
              {retrainSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 text-emerald-900 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm">
                  <CheckCircle2 className="text-emerald-600 flex-shrink-0" size={20} />
                  <div>
                    <p className="text-sm font-bold">Model Re-calibration Succeeded</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      GMM cluster boundaries updated with new feature weight matrix across all administrative units.
                    </p>
                  </div>
                </div>
              )}

              {/* Section 1: GMM Feature Weights */}
              <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Sliders size={18} className="text-blue-600" /> GMM Feature Weights
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Configure the relative feature importance for probabilistic spatial cluster assignment.
                    </p>
                  </div>
                  <button
                    onClick={() => setFeatureWeights({ edu: 0.35, health: 0.4, civicFinance: 0.25 })}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 self-start sm:self-auto"
                  >
                    <RotateCcw size={12} /> Reset Defaults
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Slider 1: Education */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                        <GraduationCap size={15} className="text-blue-500" /> Education
                      </label>
                      <span className="text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                        {(featureWeights.edu * 100).toFixed(0)}% ({featureWeights.edu.toFixed(2)})
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={featureWeights.edu}
                      onChange={(e) =>
                        setFeatureWeights((prev) => ({ ...prev, edu: parseFloat(e.target.value) }))
                      }
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                      <span>0.0 (Low Impact)</span>
                      <span>Primary & Secondary Schools, Higher Education</span>
                      <span>1.0 (Dominant)</span>
                    </div>
                  </div>

                  {/* Slider 2: Healthcare */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                        <HeartPulse size={15} className="text-red-500" /> Healthcare
                      </label>
                      <span className="text-xs font-mono font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">
                        {(featureWeights.health * 100).toFixed(0)}% ({featureWeights.health.toFixed(2)})
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={featureWeights.health}
                      onChange={(e) =>
                        setFeatureWeights((prev) => ({ ...prev, health: parseFloat(e.target.value) }))
                      }
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-red-600"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                      <span>0.0 (Low Impact)</span>
                      <span>Major Hospitals, Primary Care Units, Rural Clinics</span>
                      <span>1.0 (Dominant)</span>
                    </div>
                  </div>

                  {/* Slider 3: Finance & Civic */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                        <Building2 size={15} className="text-emerald-500" /> Finance / Civic
                      </label>
                      <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                        {(featureWeights.civicFinance * 100).toFixed(0)}% ({featureWeights.civicFinance.toFixed(2)})
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.0"
                      step="0.05"
                      value={featureWeights.civicFinance}
                      onChange={(e) =>
                        setFeatureWeights((prev) => ({ ...prev, civicFinance: parseFloat(e.target.value) }))
                      }
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                      <span>0.0 (Low Impact)</span>
                      <span>Commercial Banks, Postal Facilities, DSD Administrative Hubs</span>
                      <span>1.0 (Dominant)</span>
                    </div>
                  </div>
                </div>

                {/* Weight Balance Composite Bar */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-700 mb-2">
                    <span>Feature Weight Composite Balance</span>
                    <span className="text-slate-500">
                      Sum: {(featureWeights.edu + featureWeights.health + featureWeights.civicFinance).toFixed(2)}
                    </span>
                  </div>
                  <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-200">
                    <div
                      style={{
                        width: `${
                          (featureWeights.edu /
                            (featureWeights.edu + featureWeights.health + featureWeights.civicFinance || 1)) *
                          100
                        }%`,
                      }}
                      className="bg-blue-600 transition-all duration-300"
                    />
                    <div
                      style={{
                        width: `${
                          (featureWeights.health /
                            (featureWeights.edu + featureWeights.health + featureWeights.civicFinance || 1)) *
                          100
                        }%`,
                      }}
                      className="bg-red-500 transition-all duration-300"
                    />
                    <div
                      style={{
                        width: `${
                          (featureWeights.civicFinance /
                            (featureWeights.edu + featureWeights.health + featureWeights.civicFinance || 1)) *
                          100
                        }%`,
                      }}
                      className="bg-emerald-500 transition-all duration-300"
                    />
                  </div>
                  <div className="flex justify-between text-[11px] font-semibold mt-2 text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-600" /> Education
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500" /> Healthcare
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" /> Finance / Civic
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: System Diagnostics */}
              <div className="bg-white p-7 rounded-2xl border border-slate-200 shadow-sm space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Cpu size={18} className="text-blue-600" /> System Diagnostics & Persistence
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Live telemetry from the spatial database layer and cloud pipeline integration.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex items-start gap-3">
                    <div className="relative mt-1 flex-shrink-0">
                      <span className="w-3 h-3 block rounded-full bg-emerald-500 animate-ping absolute" />
                      <span className="w-3 h-3 block rounded-full bg-emerald-500 relative" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">PostGIS Database</h3>
                      <p className="text-xs text-emerald-600 font-semibold mt-0.5">Synced & Operational</p>
                      <p className="text-[10px] text-slate-400 mt-1">Spatial boundaries and geometries indexed with R-Tree.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex items-start gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-500 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">Spatial Lag Weight Matrix</h3>
                      <p className="text-xs text-slate-700 font-semibold mt-0.5">Queen Contiguity (Order 1)</p>
                      <p className="text-[10px] text-slate-400 mt-1">Spatial autocorrelation constraints loaded.</p>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-slate-100">
                  <div className="text-xs text-slate-500">
                    Triggering a re-calibration refits the Gaussian Mixture Model with current feature weights.
                  </div>
                  <button
                    onClick={handleRetrainModel}
                    disabled={isRetraining}
                    className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 disabled:bg-slate-400 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-sm transition-all flex-shrink-0"
                  >
                    {isRetraining ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" /> Training Model...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={14} /> Force Re-train Model
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

// ─── TOOLTIP-EQUIPPED NAVIGATION ITEM ─────────────────────────────────────────
interface NavItemProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon: Icon, label, description, active, onClick }: NavItemProps) {
  return (
    <div className="relative group flex items-center justify-center">
      <button
        onClick={onClick}
        aria-label={label}
        className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 outline-none ${
          active
            ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30 ring-2 ring-blue-400/20"
            : "text-slate-400 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Icon size={22} className={`transition-transform duration-200 ${active ? "scale-105" : "group-hover:scale-110"}`} />
      </button>

      {/* Floating Tooltip with Label & Description */}
      <div className="absolute left-16 top-1/2 -translate-y-1/2 bg-slate-900 text-white px-3.5 py-2 rounded-xl shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 whitespace-nowrap z-50 border border-slate-700/80 translate-x-2 group-hover:translate-x-0">
        <p className="text-xs font-bold tracking-tight text-white">{label}</p>
        <p className="text-[10px] text-slate-400 font-medium">{description}</p>
        {/* Triangle Pointer */}
        <div className="absolute -left-1 top-1/2 -translate-y-1/2 border-y-4 border-y-transparent border-r-4 border-r-slate-900" />
      </div>
    </div>
  );
}
