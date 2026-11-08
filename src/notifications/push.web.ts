// Web: push notifications aren't used; the in-app notification feed covers it.
export async function registerForPush(): Promise<string | null> {
  return null;
}

export function configureNotificationHandling(_onOpen: (data: Record<string, unknown>) => void): () => void {
  return () => undefined;
}
