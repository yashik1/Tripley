import { useLocalSearchParams } from 'expo-router';
import { createContext, useContext } from 'react';

// The trip layout owns the [id] segment and shares it with every trip screen.
// (Screens created as the stack's initial route don't always get URL params.)
export const TripIdContext = createContext<string | null>(null);

export function useTripId(): string {
  const fromLayout = useContext(TripIdContext);
  const { id } = useLocalSearchParams<{ id?: string }>();
  return fromLayout ?? id ?? '';
}
