"use client";

import { useState } from "react";
import { Heart, MessageCircle, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  likeTweet,
  replyToTweet,
  retweetTweet,
  type WriteResult,
} from "@/lib/api";
import { useUser } from "@/hooks/useUser";

type Props = {
  tweetId: string;
  initialLiked: boolean;
};

function toastResult(action: string, r: WriteResult) {
  if (r.ok) {
    toast.success(`${action} posted`);
    return;
  }
  toast.error(`${action} failed`, {
    description: r.message ?? r.error,
  });
}

export function PostActions({ tweetId, initialLiked }: Props) {
  const { user } = useUser();
  const [liked, setLiked] = useState(initialLiked);
  const [busy, setBusy] = useState<"like" | "retweet" | "reply" | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  if (!user) return null;

  async function onLike() {
    setBusy("like");
    try {
      const r = await likeTweet(tweetId);
      if (r.ok) setLiked(true);
      toastResult("Like", r);
    } finally {
      setBusy(null);
    }
  }

  async function onRetweet() {
    setBusy("retweet");
    try {
      const r = await retweetTweet(tweetId);
      toastResult("Retweet", r);
    } finally {
      setBusy(null);
    }
  }

  async function onReplySubmit() {
    const text = replyText.trim();
    if (text.length === 0) return;
    setBusy("reply");
    try {
      const r = await replyToTweet(tweetId, text);
      toastResult("Reply", r);
      if (r.ok) {
        setReplyOpen(false);
        setReplyText("");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        disabled={busy !== null}
        onClick={onLike}
        aria-label={liked ? "Liked" : "Like"}
      >
        <Heart className={liked ? "fill-red-500 text-red-500" : ""} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={busy !== null}
        onClick={onRetweet}
        aria-label="Retweet"
      >
        <Repeat2 />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={busy !== null}
        onClick={() => setReplyOpen(true)}
        aria-label="Reply"
      >
        <MessageCircle />
      </Button>
      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reply</DialogTitle>
          </DialogHeader>
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply…"
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setReplyOpen(false)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={onReplySubmit}
              disabled={busy !== null || replyText.trim().length === 0}
            >
              {busy === "reply" ? "Posting…" : "Reply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
