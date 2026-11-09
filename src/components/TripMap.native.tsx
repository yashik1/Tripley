import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { config } from '@/config';
import { circleRing } from '@/lib/geo';
import { boundsOf, placeEmoji, type TripMapProps } from './TripMap.types';

export function TripMap({ people, places = [], focusId, onSelect, onPlacePress, picking, onPick, fitToken = 0 }: TripMapProps) {
  const camera = useRef<CameraRef>(null);
  const fitted = useRef(-1);
  // Arrival zones for places with alerts on.
  const zones = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: places
        .filter((p) => p.alerts)
        .map((p) => ({ type: 'Feature', properties: { id: p.id }, geometry: { type: 'Polygon', coordinates: [circleRing(p, p.radiusM)] } })),
    }),
    [places],
  );

  useEffect(() => {
    if (people.length === 0 || fitted.current === fitToken) return;
    const b = boundsOf(people);
    if (!b) return;
    fitted.current = fitToken;
    camera.current?.fitBounds(b, { padding: { top: 170, bottom: 300, left: 70, right: 70 }, duration: 600 });
  }, [people, fitToken]);

  useEffect(() => {
    const p = people.find((x) => x.id === focusId);
    if (p) camera.current?.flyTo({ center: [p.lng, p.lat], zoom: 15, duration: 800 });
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={config.mapStyleUrl}
      onPress={(e) => {
        if (!picking) return;
        const [lng, lat] = e.nativeEvent.lngLat;
        onPick?.(lat, lng);
      }}>
      <Camera ref={camera} initialViewState={{ zoom: 1.5 }} />
      <GeoJSONSource id="tripley-zones" data={zones}>
        <Layer id="tripley-zones-fill" type="fill" paint={{ 'fill-color': '#0E7C66', 'fill-opacity': 0.12 }} />
        <Layer id="tripley-zones-line" type="line" paint={{ 'line-color': '#0E7C66', 'line-width': 1.5 }} />
      </GeoJSONSource>
      {places.map((p) => (
        <Marker key={`place-${p.id}`} id={`place-${p.id}`} lngLat={[p.lng, p.lat]} anchor="bottom" onPress={() => onPlacePress?.(p.id)}>
          <View style={styles.pin} accessibilityLabel={p.name}>
            <View style={styles.place}>
              <Text style={{ fontSize: 16 }}>{placeEmoji(p.kind)}</Text>
            </View>
            <View style={styles.placeLabel}>
              <Text style={styles.placeLabelText} numberOfLines={1}>{p.name}</Text>
            </View>
          </View>
        </Marker>
      ))}
      {people.map((p) => (
        <Marker key={p.id} id={p.id} lngLat={[p.lng, p.lat]} anchor="bottom" onPress={() => onSelect?.(p.id)}>
          <View style={styles.pin} accessibilityLabel={`${p.name}, ${p.ago}`}>
            <View style={[styles.dot, { backgroundColor: p.color, opacity: p.stale ? 0.45 : 1 }, p.isMe && styles.me]}>
              <Text style={styles.initials}>{p.initials}</Text>
            </View>
            <View style={styles.label}>
              <Text style={styles.labelText} numberOfLines={1}>
                {p.isMe ? 'You' : p.name.split(' ')[0]} · {p.ago}
              </Text>
            </View>
          </View>
        </Marker>
      ))}
    </Map>
  );
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center' },
  dot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  me: { borderColor: '#2F80ED' },
  initials: { color: '#fff', fontWeight: '700', fontSize: 14 },
  label: { marginTop: 4, backgroundColor: 'rgba(17,20,24,0.8)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  labelText: { color: '#fff', fontSize: 11, fontWeight: '600', maxWidth: 140 },
  place: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#0E7C66',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  placeLabel: { marginTop: 3, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  placeLabelText: { color: '#111418', fontSize: 10, fontWeight: '600', maxWidth: 120 },
});
