import 'maplibre-gl/dist/maplibre-gl.css';

import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { config } from '@/config';
import { boundsOf, type MapPerson, type TripMapProps } from './TripMap.types';

// Plain background used if the map tiles can't load (offline, blocked), so
// people's pins still show where everyone is relative to each other.
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#E8EEF2' } }],
};

function pinElement(p: MapPerson, onSelect?: (id: string) => void): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';
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

export function TripMap({ people, focusId, onSelect, fitToken = 0 }: TripMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new globalThis.Map<string, maplibregl.Marker>());
  const fitted = useRef(-1);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

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
    let fellBack = false;
    m.on('error', () => {
      if (!fellBack && !m.isStyleLoaded()) {
        fellBack = true;
        m.setStyle(FALLBACK_STYLE);
      }
    });
    map.current = m;
    const current = markers.current;
    return () => {
      current.forEach((mk) => mk.remove());
      current.clear();
      m.remove();
      map.current = null;
    };
  }, []);

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
        const mk = new maplibregl.Marker({ element: pinElement(p, (id) => selectRef.current?.(id)), anchor: 'bottom' })
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
          { padding: { top: 170, bottom: 300, left: 70, right: 70 }, duration: 600, maxZoom: 15 },
        );
      }
    }
  }, [people, fitToken]);

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
