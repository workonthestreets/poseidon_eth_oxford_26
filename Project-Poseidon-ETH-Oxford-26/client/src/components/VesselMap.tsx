import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Vessel } from "@/lib/marketLogic";

const vesselColors: Record<string, string> = {
  v1: "#60a5fa",
  v2: "#34d399",
  v3: "#fbbf24",
  v4: "#a78bfa",
  v5: "#fb7185",
  v6: "#22d3ee",
  v7: "#fb923c",
  v8: "#f472b6",
  v9: "#2dd4bf",
};

function createPulseIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `
      <div style="position:relative;width:18px;height:18px;">
        <div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.3;animation:vessel-pulse 2s ease-in-out infinite;"></div>
        <div style="position:absolute;top:4px;left:4px;width:10px;height:10px;border-radius:50%;background:${color};border:2px solid rgba(0,0,0,0.4);"></div>
      </div>
    `,
  });
}

export default function VesselMap({ vessels }: { vessels: Vessel[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [, navigate] = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const initMap = useCallback(() => {
    if (!mapRef.current) return;
    if (leafletMapRef.current) return;

    const map = L.map(mapRef.current, {
      center: [20, 40],
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      zoomControl: true,
      attributionControl: false,
      worldCopyJump: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    leafletMapRef.current = map;
  }, []);

  useEffect(() => {
    initMap();
    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      markersRef.current = [];
    };
  }, [initMap]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    vessels.forEach((vessel) => {
      const color = vesselColors[vessel.id] || "#60a5fa";
      const icon = createPulseIcon(color);

      const marketsHtml = vessel.markets
        .map(
          (m) =>
            `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;padding:1px 0;">
              <span style="color:#9ca3af;">${m.name}</span>
              <span style="font-family:'JetBrains Mono',monospace;color:#e5e7eb;">${(m.estimatedProbability * 100).toFixed(0)}%</span>
            </div>`
        )
        .join("");

      const totalPool = vessel.markets.reduce((sum, m) => sum + m.totalPool, 0);

      const popupContent = `
        <div style="font-family:'DM Sans',sans-serif;min-width:180px;cursor:pointer;" data-vessel-id="${vessel.id}" class="vessel-popup">
          <div style="font-weight:600;font-size:13px;color:#f3f4f6;margin-bottom:2px;">${vessel.name}</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">${vessel.type} &middot; ${vessel.flag}</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">${vessel.route}</div>
          <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;margin-bottom:4px;">
            ${marketsHtml}
          </div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:6px;">Pool: $${totalPool.toLocaleString()}</div>
          <div style="font-size:10px;color:#60a5fa;text-align:right;">Click to view auctions &rarr;</div>
        </div>
      `;

      const marker = L.marker([vessel.lat, vessel.lng], { icon })
        .addTo(map)
        .bindPopup(popupContent, {
          className: "vessel-popup-container",
          closeButton: false,
          maxWidth: 240,
        })
        .bindTooltip(vessel.name, {
          className: "vessel-tooltip",
          direction: "top",
          offset: [0, -12],
        });

      const handleClick = () => {
        navigateRef.current(`/vessel/${vessel.id}`);
      };

      let popupClickHandler: (() => void) | null = null;

      marker.on("popupopen", () => {
        const popup = marker.getPopup();
        if (popup) {
          const el = popup.getElement();
          if (el) {
            popupClickHandler = handleClick;
            el.addEventListener("click", popupClickHandler);
          }
        }
      });

      marker.on("popupclose", () => {
        const popup = marker.getPopup();
        if (popup && popupClickHandler) {
          const el = popup.getElement();
          if (el) {
            el.removeEventListener("click", popupClickHandler);
          }
          popupClickHandler = null;
        }
      });

      markersRef.current.push(marker);
    });
  }, [vessels]);

  return (
    <>
      <style>{`
        @keyframes vessel-pulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(2.2); opacity: 0; }
        }
        .vessel-popup-container .leaflet-popup-content-wrapper {
          background: hsl(222 20% 12%);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          color: #f3f4f6;
          padding: 0;
        }
        .vessel-popup-container .leaflet-popup-content {
          margin: 10px 12px;
        }
        .vessel-popup-container .leaflet-popup-tip {
          background: hsl(222 20% 12%);
          border: 1px solid rgba(255,255,255,0.08);
        }
        .vessel-tooltip {
          background: hsl(222 20% 16%) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          color: #e5e7eb !important;
          font-family: 'DM Sans', sans-serif !important;
          font-size: 11px !important;
          padding: 3px 8px !important;
          border-radius: 4px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
        }
        .vessel-tooltip::before {
          border-top-color: hsl(222 20% 16%) !important;
        }
        .leaflet-control-zoom a {
          background: hsl(222 20% 14%) !important;
          color: #9ca3af !important;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .leaflet-control-zoom a:hover {
          background: hsl(222 20% 20%) !important;
          color: #e5e7eb !important;
        }
      `}</style>
      <div
        ref={mapRef}
        className="w-full h-full rounded-md overflow-hidden"
        data-testid="map-vessel-view"
        style={{ minHeight: 400 }}
      />
    </>
  );
}
