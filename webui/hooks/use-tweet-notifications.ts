import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const STORAGE_KEY = "x-feed:notifications";
/** Bursts of tweets shouldn't machine-gun the chime. */
const SOUND_COOLDOWN_MS = 800;
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * A short two-note chime, synthesized rather than shipped as an audio file.
 * The AudioContext is created during the enable click — browsers refuse to
 * start audio outside a user gesture.
 */
function playChime(ctx: AudioContext) {
  const now = ctx.currentTime;
  [880, 1318.5].forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + index * 0.11;
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.28);
  });
}

/**
 * Resolves the active service worker registration, if available.
 * Android Chrome requires a service worker to show system notifications.
 */
let swReady: Promise<ServiceWorkerRegistration | null> | null = null;
function getServiceWorkerRegistration() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (!swReady) {
    // `register()` may resolve before the worker controls the page. Android
    // only accepts notifications from an active service worker, so wait for it.
    swReady = navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return swReady;
}

function base64UrlToUint8Array(value: string) {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

type BrowserPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  userAgent: string;
};

function serializePushSubscription(
  subscription: PushSubscription,
): BrowserPushSubscription {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    throw new Error("Browser returned an incomplete push subscription");
  }
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh, auth },
    userAgent: navigator.userAgent,
  };
}

async function savePushSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serializePushSubscription(subscription)),
  });
  if (!response.ok) {
    throw new Error("Could not save this device for background notifications");
  }
}

async function subscribeToPush() {
  if (!VAPID_PUBLIC_KEY) {
    throw new Error("Background notifications have not been configured yet");
  }
  const registration = await getServiceWorkerRegistration();
  if (!registration || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported by this browser");
  }

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY),
    }));
  await savePushSubscription(subscription);
}

async function unsubscribeFromPush() {
  const registration = await getServiceWorkerRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

export function useTweetNotifications() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  // Refs so `notify` stays referentially stable and can be called from the
  // socket effect without re-subscribing on every toggle.
  const enabledRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const lastSoundRef = useRef(0);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "Notification" in window;
    setSupported(ok);
    if (!ok) return;

    // Register before the user toggles push on. Android requires an active
    // service worker before it accepts a push subscription.
    void getServiceWorkerRegistration();

    setPermission(Notification.permission);
    // Only trust the stored preference while permission is still granted —
    // the user may have revoked it in browser settings since.
    const on =
      window.localStorage.getItem(STORAGE_KEY) === "1" &&
      Notification.permission === "granted";
    setEnabled(on);
    enabledRef.current = on;
  }, []);

  useEffect(() => {
    // Read through the ref at teardown — the context is created later, on enable.
    return () => {
      void audioRef.current?.close();
    };
  }, []);

  const audioContext = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new AudioContext();
    }
    if (audioRef.current.state === "suspended") {
      void audioRef.current.resume();
    }
    return audioRef.current;
  }, []);

  const apply = useCallback((on: boolean) => {
    enabledRef.current = on;
    setEnabled(on);
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  }, []);

  /** Must be called from a user gesture — it requests permission and starts audio. */
  const toggle = useCallback(
    async (next: boolean) => {
      if (!next) {
        apply(false);
        try {
          await unsubscribeFromPush();
        } catch {
          // The local preference still disables foreground notifications. The
          // server removes invalid endpoints automatically on the next send.
        }
        return;
      }
      if (!("Notification" in window)) return;

      let granted = Notification.permission;
      if (granted === "default") {
        granted = await Notification.requestPermission();
      }
      setPermission(granted);

      if (granted !== "granted") {
        apply(false);
        toast.error("Notifications are blocked", {
          description: "Allow notifications for this site in your browser settings.",
        });
        return;
      }

      try {
        await subscribeToPush();
      } catch (error) {
        apply(false);
        toast.error("Could not enable background notifications", {
          description:
            error instanceof Error
              ? error.message
              : "Try again after the app has finished loading.",
        });
        return;
      }

      apply(true);
      // Preview the chime so the volume is no surprise on the first tweet.
      playChime(audioContext());
    },
    [apply, audioContext],
  );

  /**
   * Sound only. Notifications themselves come exclusively from the server's
   * web push (handled by /sw.js) — showing them here too made every tweet
   * arrive twice while the tab was open.
   */
  const notify = useCallback(() => {
    if (!enabledRef.current) return;

    const now = Date.now();
    if (now - lastSoundRef.current < SOUND_COOLDOWN_MS) return;
    lastSoundRef.current = now;
    try {
      playChime(audioContext());
    } catch {
      // Audio unavailable — the push notification still works.
    }
  }, [audioContext]);

  return {
    supported,
    enabled,
    blocked: permission === "denied",
    toggle,
    notify,
  };
}
