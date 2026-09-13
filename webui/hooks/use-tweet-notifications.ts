import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FeedItem } from "@/lib/types";
import { KIND_LABEL, postKinds, resolveAuthor } from "@/lib/x";

const STORAGE_KEY = "x-feed:notifications";
/** Bursts of tweets shouldn't machine-gun the chime. */
const SOUND_COOLDOWN_MS = 800;
const BODY_MAX = 160;

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

function notificationText(item: FeedItem) {
  const { displayName, handle, avatar } = resolveAuthor(item);
  const [kind] = postKinds(item.payload);
  const who = `${displayName} (@${handle})`;
  const body =
    item.text.length > BODY_MAX
      ? `${item.text.slice(0, BODY_MAX).trimEnd()}…`
      : item.text;
  return {
    title: kind ? `${KIND_LABEL[kind]} · ${who}` : who,
    body,
    icon: avatar ?? undefined,
  };
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

      apply(true);
      // Preview the chime so the volume is no surprise on the first tweet.
      playChime(audioContext());
    },
    [apply, audioContext],
  );

  const notify = useCallback((item: FeedItem) => {
    if (!enabledRef.current) return;
    if (typeof window === "undefined" || Notification.permission !== "granted") {
      return;
    }

    const { title, body, icon } = notificationText(item);
    try {
      const notification = new Notification(title, {
        body,
        icon,
        tag: item.id, // collapses duplicates of the same tweet
      });
      notification.onclick = () => {
        window.open(item.tweetUrl, "_blank", "noopener,noreferrer");
        notification.close();
      };
    } catch (e) {
      // Some browsers (notably Android Chrome) only allow notifications via a
      // service worker; the sound below still fires.
      // For Android, we still fire the sound even if the Notification fails.
      if (e instanceof Error && /service worker/i.test(e.message)) {
        playChime(audioContext());
        return;
      }
    }

    const now = Date.now();
    if (now - lastSoundRef.current < SOUND_COOLDOWN_MS) return;
    lastSoundRef.current = now;
    try {
      playChime(audioContext());
    } catch {
      // Audio unavailable — notifications still work.
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
