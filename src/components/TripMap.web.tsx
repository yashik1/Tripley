import 'maplibre-gl/dist/maplibre-gl.css';

import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { config } from '@/config';
import { circleRing } from '@/lib/geo';
import { boundsOf, placeEmoji, type MapPerson, type MapPlace, type TripMapProps } from './TripMap.types';

// MapLibre finds its worker next to its own module (import.meta.url), which in
// a bundled app points at the bundle, so serve a copy from public/ instead
// (scripts/copy-map-worker.cjs). Without a worker no map tiles can be drawn.
maplibregl.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);

// Plain background used if the map style can't load (offline, blocked), so
// people's pins still show where everyone is relative to each other.
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#E8EEF2' } }],
};

const ZONES = 'tripley-zones';

function pinElement(p: MapPerson, onSelect?: (id: string) => void): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;z-index:2;';
  root.setAttribute('aria-label', `${p.name}, ${p.ago}`);
  root.dataset.testid = `map-pin-${p.id}`;
  const dot = document.createElement('div');
  dot.className = 'tripley-dot';
  const label = document.createElement('div');
  label.className = 'tripley-label';
  label.style.cssText =
    'margin-top:4px;background:rgba(17,20,24,.8);color:#fff;border-radius:8px;padding:2px 6px;font:600 11px system-ui,sans-serif;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;';
  root.append(dot, label);
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect?.(p.id);
  });
  updatePin(root, p);
  return root;
}

function updatePin(root: HTMLElement, p: MapPerson) {
  const dot = root.querySelector('.tripley-dot') as HTMLElement;
  const label = root.querySelector('.tripley-label') as HTMLElement;
  dot.style.cssText = `box-sizing:border-box;width:42px;height:42px;border-radius:50%;border:3px solid ${p.isMe ? '#2F80ED' : '#fff'};background:${p.color};opacity:${p.stale ? 0.45 : 1};display:flex;align-items:center;justify-content:center;color:#fff;font:700 14px system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3);`;
  dot.textContent = p.initials;
  label.textContent = `${p.isMe ? 'You' : p.name.split(' ')[0]} · ${p.ago}`;
}

function placeElement(p: MapPlace, onPress?: (id: string) => void): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;z-index:1;';
  root.dataset.testid = `map-place-${p.id}`;
  root.setAttribute('aria-label', p.name);
  root.setAttribute('role', 'button');
  const badge = document.createElement('div');
  badge.className = 'tripley-place';
  badge.style.cssText =
    'width:32px;height:32px;border-radius:10px;background:#fff;border:2px solid #0E7C66;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 2px 6px rgba(0,0,0,.25);';
  const label = document.createElement('div');
  label.className = 'tripley-place-label';
  label.style.cssText =
    'margin-top:3px;background:rgba(255,255,255,.92);color:#111418;border-radius:6px;padding:1px 5px;font:600 10px system-ui,sans-serif;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;';
  root.append(badge, label);
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    onPress?.(p.id);
  });
  updatePlace(root, p);
  return root;
}

function updatePlace(root: HTMLElement, p: MapPlace) {
  (root.querySelector('.tripley-place') as HTMLElement).textContent = placeEmoji(p.kind);
  (root.querySelector('.tripley-place-label') as HTMLElement).textContent = p.name;
}

function zonesData(places: MapPlace[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: places
      .filter((p) => p.alerts)
      .map((p) => ({
        type: 'Feature',
        properties: { id: p.id },
        geometry: { type: 'Polygon', coordinates: [circleRing(p, p.radiusM)] },
      })),
  };
}

export function TripMap({ people, places = [], focusId, onSelect, onPlacePress, picking, onPick, fitToken = 0 }: TripMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new globalThis.Map<string, maplibregl.Marker>());
  const placeMarkers = useRef(new globalThis.Map<string, maplibregl.Marker>());
  const fitted = useRef(-1);
  const latest = useRef({ onSelect, onPlacePress, picking, onPick, places });
  useEffect(() => {
    latest.current = { onSelect, onPlacePress, picking, onPick, places };
  });

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: config.mapStyleUrl,
      center: [0, 20],
      zoom: 1.3,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    // Only a style that never loads falls back to the plain background. A tile
    // or icon that fails later just leaves a gap; the rest of the map stays.
    let styleLoaded = false;
    let fellBack = false;
    m.on('error', (e) => {
      console.warn('[map]', e.error?.message ?? e);
      if (!styleLoaded && !fellBack) {
        fellBack = true;
        m.setStyle(FALLBACK_STYLE);
      }
    });
    // Arrival zones, drawn under the pins; re-added whenever a style loads.
    m.on('style.load', () => {
      styleLoaded = true;
      if (!m.getSource(ZONES)) {
        m.addSource(ZONES, { type: 'geojson', data: zonesData(latest.current.places) });
        m.addLayer({ id: `${ZONES}-fill`, type: 'fill', source: ZONES, paint: { 'fill-color': '#0E7C66', 'fill-opacity': 0.12 } });
        m.addLayer({ id: `${ZONES}-line`, type: 'line', source: ZONES, paint: { 'line-color': '#0E7C66', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
      }
    });
    m.on('click', (e) => {
      if (latest.current.picking) latest.current.onPick?.(e.lngLat.lat, e.lngLat.lng);
    });
    map.current = m;
    const people = markers.current;
    const placeMs = placeMarkers.current;
    return () => {
      people.forEach((mk) => mk.remove());
      people.clear();
      placeMs.forEach((mk) => mk.remove());
      placeMs.clear();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.getCanvas().style.cursor = picking ? 'crosshair' : '';
  }, [picking]);

  // People
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of people) {
      seen.add(p.id);
      const existing = markers.current.get(p.id);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
        updatePin(existing.getElement(), p);
      } else {
        const mk = new maplibregl.Marker({ element: pinElement(p, (id) => latest.current.onSelect?.(id)), anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .addTo(m);
        markers.current.set(p.id, mk);
      }
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.remove();
        markers.current.delete(id);
      }
    }
    if (people.length > 0 && fitted.current !== fitToken) {
      const b = boundsOf(people);
      if (b) {
        fitted.current = fitToken;
        m.fitBounds(
          [
            [b[0], b[1]],
            [b[2], b[3]],
          ],
          { padding: { top: 170, bottom: 300, left: 70, right: 70 }, duration: 600, maxZoom: 17 },
        );
      }
    }
  }, [people, fitToken]);

  // Places and their zones
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of places) {
      seen.add(p.id);
      const existing = placeMarkers.current.get(p.id);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
        updatePlace(existing.getElement(), p);
      } else {
        const mk = new maplibregl.Marker({ element: placeElement(p, (id) => latest.current.onPlacePress?.(id)), anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .addTo(m);
        placeMarkers.current.set(p.id, mk);
      }
    }
    for (const [id, mk] of placeMarkers.current) {
      if (!seen.has(id)) {
        mk.remove();
        placeMarkers.current.delete(id);
      }
    }
    const source = m.getSource(ZONES) as maplibregl.GeoJSONSource | undefined;
    source?.setData(zonesData(places));
  }, [places]);

  useEffect(() => {
    const p = people.find((x) => x.id === focusId);
    if (p && map.current) map.current.flyTo({ center: [p.lng, p.lat], zoom: 15, duration: 800 });
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <div ref={container} style={{ width: '100%', height: '100%' }} data-testid="trip-map" />
    </View>
  );
}
