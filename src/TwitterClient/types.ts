export type TwitterCookies = {
  authToken: string;
  ct0: string;
};

export interface TwitterClientOptions {
  cookies: TwitterCookies;
  userAgent?: string;
}

export interface TweetData {
  id: string;
  text: string;
  author: { username: string; name: string };
  createdAt?: string;
  replyCount?: number;
  retweetCount?: number;
  likeCount?: number;
  conversationId?: string;
  inReplyToStatusId?: string;
}

export interface UserData {
  id: string;
  username: string;
  name: string;
  description?: string;
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;
  likeCount?: number;
  isBlueVerified?: boolean;
  profileImageUrl?: string;
  profileBannerUrl?: string;
  createdAt?: string;
  location?: string;
}

export interface ListData {
  id: string;
  name: string;
  description?: string;
  memberCount?: number;
  subscriberCount?: number;
  isPrivate?: boolean;
  createdAt?: number;
  owner?: { id: string; username: string; name: string } | undefined;
}

export interface TweetResult {
  success: boolean;
  tweetId?: string;
  error?: string;
  rateLimit?: RateLimit;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  rateLimit?: RateLimit;
}

export interface GetTweetResult {
  success: boolean;
  tweet?: TweetData;
  error?: string;
  rateLimit?: RateLimit;
}

export interface TweetsResult {
  success: boolean;
  tweets?: TweetData[];
  /** Bottom cursor for HomeLatestTimeline / paginated timelines. */
  nextCursor?: string;
  error?: string;
  rateLimit?: RateLimit;
}

export interface UserResult {
  success: boolean;
  user?: UserData;
  error?: string;
  rateLimit?: RateLimit;
}

export interface UsersResult {
  success: boolean;
  users?: UserData[];
  /** Bottom cursor for paginated user timelines (e.g. list members). */
  nextCursor?: string;
  error?: string;
  rateLimit?: RateLimit;
}

export interface CurrentUserResult {
  success: boolean;
  user?: { id: string; username: string; name: string };
  error?: string;
  rateLimit?: RateLimit;
}

export interface ListResult {
  success: boolean;
  list?: ListData;
  error?: string;
  rateLimit?: RateLimit;
}

export interface ListsResult {
  success: boolean;
  lists?: ListData[];
  error?: string;
  rateLimit?: RateLimit;
}

// ── Grok types ──

export type GrokModel = "grok-3-latest" | "grok-3" | "grok-2";
export type GrokModelMode = "MODEL_MODE_FAST" | "MODEL_MODE_NORMAL";

export interface GrokMessageData {
  chatItemId: string;
  message: string;
  senderType: "User" | "Agent";
  createdAtMs: number;
  grokMode?: string;
  thinkingTrace?: string;
  isPartial?: boolean;
}

export interface GrokHistoryItem {
  conversationId: string;
  title: string;
  createdAtMs: number;
  isPinned: boolean;
}

export interface GrokSendMessageOptions {
  model?: GrokModel;
  modelMode?: GrokModelMode;
  imageGeneration?: boolean;
  imageGenerationCount?: number;
  isTemporaryChat?: boolean;
}

export type GrokSendMessageRequest = {
  message: string;
  conversationId?: string;
  options?: GrokSendMessageOptions;
};

export interface GrokConversationResult {
  success: boolean;
  conversationId?: string;
  error?: string;
  rateLimit?: RateLimit;
}
export interface DeleteGrokConversationResult {
  success: boolean;
  error?: string;
  rateLimit?: RateLimit;
}
export interface GrokMessageResult {
  success: boolean;
  conversationId?: string;
  message?: string;
  responseId?: string | undefined;
  error?: string;
}

export interface GrokHistoryResult {
  success: boolean;
  conversations?: GrokHistoryItem[];
  error?: string;
  rateLimit?: RateLimit;
}

export interface GrokConversationItemsResult {
  success: boolean;
  messages?: GrokMessageData[];
  cursor?: string | undefined;
  isPinned?: boolean;
  error?: string;
  rateLimit?: RateLimit;
}

// ── Client ──

export interface RateLimit {
  limit: number;
  remaining: number;
  reset: number;
}
