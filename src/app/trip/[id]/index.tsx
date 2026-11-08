import { Redirect, useLocalSearchParams } from 'expo-router';

export default function TripIndex() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/trip/${id}/map`} />;
}
