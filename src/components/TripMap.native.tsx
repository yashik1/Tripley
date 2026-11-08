import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { config } from '@/config';
import { boundsOf, type TripMapProps } from './TripMap.types';

export function TripMap({ people, focusId, onSelect, fitToken = 0 }: TripMapProps) {
  const camera = useRef<CameraRef>(null);
  const fitted = useRef(-1);

  useEffect(() => {
    if (people.length === 0 || fitted.current === fitToken) return;
    const b = boundsOf(people);
    if (!b) return;
    fitted.current = fitToken;
    camera.current?.fitBounds(b, { padding: { top: 80, bottom: 260, left: 60, right: 60 }, duration: 600 });
  }, [people, fitToken]);

  useEffect(() => {
    const p = people.find((x) => x.id === focusId);
    if (p) camera.current?.flyTo({ center: [p.lng, p.lat], zoom: 15, duration: 800 });
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={config.mapStyleUrl}>
      <Camera ref={camera} initialViewState={{ zoom: 1.5 }} />
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
});
