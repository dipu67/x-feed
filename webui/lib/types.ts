export type Project = {
  userId: string;
  name: string;
  username: string;
  twitterName: string | null;
  followers: number;
  following: number;
  tweets: number;
  description: string | null;
  website: string | null;
  github: string | null;
  chain: string | null;
  tokenAddress: string | null;
  profileImageUrl: string | null;
  lastTweetId: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectInput = {
  username?: string;
  userId?: string;
  name?: string;
  description?: string | null;
  website?: string | null;
  github?: string | null;
  chain?: string | null;
  tokenAddress?: string | null;
};

export type FeedMediaPhoto = {
  type: "photo" | "gif";
  url: string;
  width?: number;
  height?: number;
  altText?: string;
};

export type FeedMediaVideo = {
  type: "video" | "gif";
  url: string;
  thumbnail_url?: string | null;
  width?: number;
  height?: number;
};

export type FeedAuthor = {
  id?: string;
  name?: string;
  screen_name?: string;
  avatar_url?: string | null;
  url?: string;
};

export type FeedMedia = {
  photos?: FeedMediaPhoto[];
  videos?: FeedMediaVideo[];
};

/** Set when the tweet is a reply — points at the tweet it answers. */
export type FeedReplyingTo = {
  screen_name: string;
  status: string;
  url?: string;
  profile_url?: string;
  display_name?: string;
};

/** Set when the item is a repost — `author` is then the original poster. */
export type FeedRepostedBy = {
  id: string;
  name: string;
  screen_name: string;
  avatar_url?: string | null;
  url?: string;
};

export type FeedQuotedStatus = {
  type: "status";
  id: string;
  url: string;
  text: string;
  created_at?: string;
  created_timestamp?: number;
  author?: FeedAuthor;
  media?: FeedMedia;
  likes?: number;
  reposts?: number;
  replies?: number;
};

/** A quoted tweet that was deleted, protected, or otherwise unavailable. */
export type FeedQuotedTombstone = {
  type: "tombstone";
  id?: string;
  url?: string;
  reason?: string;
  message?: string;
};

export type FeedQuote = FeedQuotedStatus | FeedQuotedTombstone;

export type FeedPayload = {
  id?: string;
  text?: string;
  url?: string;
  created_at?: string;
  created_timestamp?: number;
  author?: FeedAuthor;
  media?: FeedMedia;
  quote?: FeedQuote | null;
  quotes?: number;
  views?: number | null;
  replying_to?: FeedReplyingTo | null;
  reposted_by?: FeedRepostedBy | null;
  possibly_sensitive?: boolean;
};

export type AuthToken = {
  id: string;
  username: string;
  isActive: boolean;
  authTokenHint: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthTokenInput = {
  id?: string;
  username?: string;
  authToken?: string;
  ct0?: string;
  isActive?: boolean;
};

export type WebhookField = {
  name: string;
  required: boolean;
  description: string;
};

export type WebhookInfo = {
  method: string;
  path: string;
  secretConfigured: boolean;
  header: string;
  fields: WebhookField[];
  example: Record<string, string>;
};

export type FeedItem = {
  id: string;
  projectId: string;
  username: string;
  text: string;
  tweetUrl: string;
  postedAt: string;
  likes: number;
  reposts: number;
  replies: number;
  payload: FeedPayload | null;
  detectedAt: string;
  project: {
    userId: string;
    name: string;
    username: string;
    chain: string | null;
    tokenAddress: string | null;
    profileImageUrl: string | null;
  };
};
