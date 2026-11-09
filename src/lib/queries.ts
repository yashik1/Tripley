/**
 * React Query hooks + Supabase Realtime subscriptions. Realtime events either
 * patch the cache directly (map dots) or invalidate the affected queries.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import * as api from './api';
import { supabase } from './supabase';
import type { MemberLocation } from './types';

// Each subscriber gets its own channel name: supabase.channel() returns an
// existing channel for a repeated name, which can't take new listeners.
let channelSeq = 0;
const channelName = (base: string) => `${base}:${Date.now().toString(36)}${(channelSeq++).toString(36)}`;

/**
 * True for the server's "Subscribed to PostgreSQL" message, sent each time a
 * channel's database listener is ready (first join and every reconnect).
 * Changes made before that moment are never streamed, so refetch then.
 */
const isListenerReady = (msg: { extension?: string; status?: string } | undefined) =>
  msg?.extension === 'postgres_changes' && msg?.status === 'ok';

export const keys = {
  trips: ['trips'] as const,
  trip: (id: string) => ['trip', id] as const,
  members: (id: string) => ['members', id] as const,
  locations: (id: string) => ['locations', id] as const,
  bills: (id: string) => ['bills', id] as const,
  bill: (id: string) => ['bill', id] as const,
  shares: (id: string) => ['shares', id] as const,
  settlements: (id: string) => ['settlements', id] as const,
  sentInvites: (id: string) => ['sentInvites', id] as const,
  invitations: ['invitations'] as const,
  notifications: ['notifications'] as const,
  profile: (id: string) => ['profile', id] as const,
  account: ['account'] as const,
  friends: ['friends'] as const,
  sharing: ['sharing'] as const,
  places: (id: string) => ['places', id] as const,
  kitties: (id: string) => ['kitties', id] as const,
  kittyCash: (id: string) => ['kittyCash', id] as const,
  itinerary: (id: string) => ['itinerary', id] as const,
  rsvps: (id: string) => ['rsvps', id] as const,
  itineraryComments: (itemId: string) => ['itineraryComments', itemId] as const,
};

export const useTrips = () => useQuery({ queryKey: keys.trips, queryFn: api.listMyTrips });
export const useTrip = (id: string) => useQuery({ queryKey: keys.trip(id), queryFn: () => api.getTrip(id), enabled: !!id });
export const useMembers = (id: string) =>
  useQuery({ queryKey: keys.members(id), queryFn: () => api.listMembers(id), enabled: !!id });
export const useLocations = (id: string) =>
  useQuery({ queryKey: keys.locations(id), queryFn: () => api.listLocations(id), enabled: !!id, refetchInterval: 60_000 });
export const useBills = (id: string) => useQuery({ queryKey: keys.bills(id), queryFn: () => api.listBills(id), enabled: !!id });
export const useBill = (id: string) => useQuery({ queryKey: keys.bill(id), queryFn: () => api.getBill(id), enabled: !!id });
export const useShareRows = (id: string) =>
  useQuery({ queryKey: keys.shares(id), queryFn: () => api.listShareRows(id), enabled: !!id });
export const useSettlements = (id: string) =>
  useQuery({ queryKey: keys.settlements(id), queryFn: () => api.listSettlements(id), enabled: !!id });
export const useSentInvitations = (id: string) =>
  useQuery({ queryKey: keys.sentInvites(id), queryFn: () => api.listSentInvitations(id), enabled: !!id });
export const useInvitations = () => useQuery({ queryKey: keys.invitations, queryFn: api.myInvitations });
export const useNotifications = () =>
  useQuery({ queryKey: keys.notifications, queryFn: api.listNotifications, refetchInterval: 120_000 });
export const useAccount = () => useQuery({ queryKey: keys.account, queryFn: api.getAccount });
export const usePlaces = (id: string) => useQuery({ queryKey: keys.places(id), queryFn: () => api.listPlaces(id), enabled: !!id });
export const useKitties = (id: string) => useQuery({ queryKey: keys.kitties(id), queryFn: () => api.listKitties(id), enabled: !!id });
export const useKittyOwnCash = (id: string) =>
  useQuery({ queryKey: keys.kittyCash(id), queryFn: () => api.listKittyOwnCash(id), enabled: !!id });
export const useItinerary = (id: string) =>
  useQuery({ queryKey: keys.itinerary(id), queryFn: () => api.listItinerary(id), enabled: !!id });
export const useRsvps = (id: string) => useQuery({ queryKey: keys.rsvps(id), queryFn: () => api.listRsvps(id), enabled: !!id });
export const useItineraryComments = (itemId: string) =>
  useQuery({ queryKey: keys.itineraryComments(itemId), queryFn: () => api.listItineraryComments(itemId), enabled: !!itemId });
export const useFriends = () => useQuery({ queryKey: keys.friends, queryFn: api.myTripFriends });

/** Live updates for one trip while its screens are open. */
export function useTripRealtime(tripId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!tripId) return;
    const filter = `trip_id=eq.${tripId}`;
    const channel = supabase
      .channel(channelName(`trip:${tripId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_locations', filter }, (payload) => {
        const key = keys.locations(tripId);
        const prev = qc.getQueryData<MemberLocation[]>(key);
        // Patch only a list that's already loaded. Starting one from this event
        // (often my own upload, before the map has fetched) would cache a
        // one-person list as fresh and skip fetching everyone else.
        if (!prev || payload.eventType === 'DELETE') {
          qc.invalidateQueries({ queryKey: key });
          return;
        }
        const row = payload.new as MemberLocation;
        qc.setQueryData<MemberLocation[]>(key, [...prev.filter((l) => l.user_id !== row.user_id), row]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bills', filter }, () => {
        qc.invalidateQueries({ queryKey: keys.bills(tripId) });
        qc.invalidateQueries({ queryKey: keys.shares(tripId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter }, () => {
        qc.invalidateQueries({ queryKey: keys.settlements(tripId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_places', filter }, () => {
        qc.invalidateQueries({ queryKey: keys.places(tripId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_kitties', filter }, () => {
        qc.invalidateQueries({ queryKey: keys.kitties(tripId) });
      })
      // No trip column to filter on; the server only sends rows this person may see.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kitty_own_cash' }, () => {
        qc.invalidateQueries({ queryKey: keys.kittyCash(tripId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items', filter }, () => {
        qc.invalidateQueries({ queryKey: keys.itinerary(tripId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_rsvps', filter }, () => {
        qc.invalidateQueries({ queryKey: keys.rsvps(tripId) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_comments', filter }, (payload) => {
        const row = (payload.new ?? payload.old) as { item_id?: string } | undefined;
        if (row?.item_id) qc.invalidateQueries({ queryKey: keys.itineraryComments(row.item_id) });
        else qc.invalidateQueries({ queryKey: ['itineraryComments'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter }, () => {
        qc.invalidateQueries({ queryKey: keys.members(tripId) });
        qc.invalidateQueries({ queryKey: keys.locations(tripId) });
      })
      .on('system', {}, (msg) => {
        if (!isListenerReady(msg)) return;
        for (const key of [keys.locations, keys.members, keys.bills, keys.shares, keys.settlements, keys.places, keys.kitties, keys.kittyCash, keys.itinerary, keys.rsvps]) {
          qc.invalidateQueries({ queryKey: key(tripId) });
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId, qc]);
}

/** Refresh notifications and invitations when new ones arrive. */
export function useNotificationsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(channelName(`notifications:${userId}`))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          qc.invalidateQueries({ queryKey: keys.notifications });
          const kind = (payload.new as { kind?: string }).kind;
          if (kind === 'invitation') qc.invalidateQueries({ queryKey: keys.invitations });
        },
      )
      .on('system', {}, (msg) => {
        if (!isListenerReady(msg)) return;
        qc.invalidateQueries({ queryKey: keys.notifications });
        qc.invalidateQueries({ queryKey: keys.invitations });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
