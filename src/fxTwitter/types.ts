// types.ts - Plain TS types for FxTwitterClient (no Zod)

export interface APIFacet {
  type: string;
  indices: [number, number];
  original?: string;
  replacement?: string;
  display?: string;
  id?: string;
}

export interface APITranslate {
  text: string;
  source_lang: string;
  source_lang_en: string;
  target_lang: string;
  provider: string;
}

export interface APIPollChoice {
  label: string;
  count: number;
  percentage: number;
}

export interface APIPoll {
  choices: APIPollChoice[];
  total_votes: number;
  ends_at: string;
  time_left_en: string;
}

export interface APIReplyingTo {
  screen_name: string;
  status: string;
  url?: string;
  profile_url?: string;
  display_name?: string;
}

export interface APIVideoFormat {
  container?: 'mp4' | 'webm' | 'm3u8';
  codec?: 'h264' | 'hevc' | 'vp9' | 'av1';
  bitrate?: number;
  url: string;
  size?: number;
  height?: number;
  width?: number;
}

export interface APIMediaContainer {
  external?: APIExternalMedia;
  photos?: APIPhoto[];
  videos?: APIVideo[];
  all?: Array<APIPhoto | APIVideo | APIMosaicPhoto | any>;
  mosaic?: APIMosaicPhoto;
  broadcast?: APIBroadcast;
}

export interface APIExternalMedia {
  type: 'video';
  url: string;
  thumbnail_url?: string;
  height?: number;
  width?: number;
}

export interface APIPhoto {
  id?: string;
  format?: string;
  type: 'photo' | 'gif';
  url: string;
  width: number;
  height: number;
  transcode_url?: string | null;
  altText?: string;
}

export interface APIVideo {
  id?: string;
  format?: string;
  type: 'video' | 'gif';
  url: string;
  width: number;
  height: number;
  thumbnail_url?: string | null;
  transcode_url?: string | null;
  duration: number;
  filesize?: number;
  formats: APIVideoFormat[];
  publisher?: APIUser | null;
}

export interface APIMosaicPhoto {
  id?: string;
  format?: string;
  type: 'mosaic_photo';
  url: string;
  width: number;
  height: number;
  formats: { webp: string; jpeg: string };
}

export interface APIBroadcast {
  url: string;
  width: number;
  height: number;
  state: 'LIVE' | 'ENDED';
  broadcaster: { username: string; display_name: string; id: string };
  stream?: { url: string };
  title: string;
  source: string;
  orientation: 'landscape' | 'portrait';
  broadcast_id: string;
  media_id: string;
  media_key: string;
  is_high_latency: boolean;
  thumbnail: {
    original: { url: string };
    small?: { url: string };
    medium?: { url: string };
    large?: { url: string };
    x_large?: { url: string };
  };
}

export interface APICard {
  url: string;
  title?: string;
  description?: string;
  domain?: string;
  card_name?: string;
  image?: {
    width?: number;
    height?: number;
    url?: string;
    alt?: string;
  };
}

export interface APIRepostedBy {
  id: string;
  name: string;
  screen_name: string;
  avatar_url?: string | null;
  url?: string;
}

export interface APIAboutAccount {
  based_in?: string | null;
  location_accurate?: boolean;
  created_country_accurate?: boolean | null;
  source?: string | null;
  username_changes?: {
    count: number;
    last_changed_at?: string | null;
  };
}

export interface APIUser {
  type: 'profile';
  id: string;
  name: string;
  screen_name: string;
  avatar_url?: string | null;
  banner_url?: string | null;
  description: string;
  raw_description: {
    text: string;
    facets: APIFacet[];
  };
  location: string;
  url: string;
  protected: boolean;
  followers: number;
  following: number;
  statuses: number;
  media_count: number;
  likes: number;
  joined: string;
  website?: { url: string; display_url: string } | null;
  birthday?: { day?: number; month?: number; year?: number } | null;
  verification?: {
    verified: boolean;
    type?: 'organization' | 'government' | 'individual' | null;
    verified_at?: string | null;
    identity_verified?: boolean;
    verified_by?: string;
  };
  about_account?: APIAboutAccount;
  profile_embed?: boolean;
}

export interface APITwitterCommunityNote {
  text: string;
  facets: APIFacet[];
}

export interface APITwitterCommunityNoteLegacy {
  text: string;
  entities: Record<string, unknown>[];
}

export interface APITwitterCommunity {
  id: string;
  name: string;
  description: string;
  created_at: string;
  search_tags: string[];
  is_nsfw: boolean;
  topic?: string | null;
  admin?: APIUser | null;
  creator?: APIUser | null;
  join_policy: 'Open' | 'Closed';
  invites_policy: 'MemberInvitesAllowed' | 'MemberInvitesDisabled';
  is_pinned: boolean;
}

export interface APIStatusTombstone {
  type: 'tombstone';
  provider: string;
  reason: string;
  message: string;
  id?: string;
  url?: string;
  author?: Partial<APIUser>;
}

export interface APITwitterStatus {
  id: string;
  url: string;
  text: string;
  created_at: string;
  created_timestamp: number;
  likes: number;
  reposts: number;
  quotes: number;
  replies: number;
  quote?: APITwitterStatus | APIStatusTombstone;
  poll?: APIPoll;
  author: APIUser;
  media: APIMediaContainer;
  raw_text: {
    text: string;
    display_text_range: [number, number];
    facets: APIFacet[];
  };
  lang: string | null;
  translation?: APITranslate;
  possibly_sensitive: boolean;
  replying_to: APIReplyingTo | null;
  source: string | null;
  embed_card: 'tweet' | 'summary' | 'summary_large_image' | 'player';
  provider: 'twitter';
  views?: number | null;
  bookmarks?: number | null;
  community?: APITwitterCommunity;
  article?: any;
  is_note_tweet: boolean;
  community_note: APITwitterCommunityNote | APITwitterCommunityNoteLegacy | null;
  reposted_by: APIRepostedBy | null;
  card?: APICard;
  type: 'status';
}

// ── API Response Types ─────────────────────────────────────────────────────

export interface StatusAPIResponse {
  code: number;
  status: APITwitterStatus | null;
  author?: APIUser | null;
}

export interface ThreadAPIResponse {
  code: number;
  status: APITwitterStatus | null;
  thread: (APITwitterStatus | APIStatusTombstone)[] | null;
  author: APIUser | null;
}

export interface ConversationAPIResponse {
  code: number;
  status: APITwitterStatus | null;
  thread: (APITwitterStatus | APIStatusTombstone)[] | null;
  replies: any[] | null;
  author: APIUser | null;
  cursor?: { bottom: string | null } | null;
}

export interface StatusListAPIResponse {
  code: number;
  results: APITwitterStatus[];
  cursor: { top: string | null; bottom: string | null };
}

export interface GroupedStatusListAPIResponse {
  code: number;
  results: Array<APITwitterStatus | { type: 'thread'; conversation_id: string; statuses: APITwitterStatus[]; truncated: boolean }>;
  cursor: { top: string | null; bottom: string | null };
}

export interface UserListAPIResponse {
  code: number;
  results: APIUser[];
  cursor: { top: string | null; bottom: string | null };
}

export interface UserAPIResponse {
  code: number;
  message: string;
  user?: APIUser;
  reason?: 'suspended';
  id?: string;
}

export interface ProfileAboutAPIResponse {
  code: number;
  message: string;
  about_account?: APIAboutAccount;
}

export interface APITrendsResponse {
  code: number;
  message?: string;
  timeline_type: string;
  trends: Array<{
    name: string;
    rank?: string | null;
    context?: string | null;
    grouped_topics?: Array<{ name: string }>;
  }>;
  cursor: { top: string | null; bottom: string | null };
}

export interface APITypeaheadResponse {
  code: number;
  query: string;
  num_results: number;
  users: APIUser[];
  topics: any[];
  events: any[];
}

// ── Client Options ────────────────────────────────────────────────────────

export interface FxTwitterClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface StatusQueryOptions {
  aboutAccount?: boolean;
  lang?: string;
}

export interface CursorPageOptions {
  count?: number;
  cursor?: string;
}

export interface ConversationQueryOptions extends CursorPageOptions {
  rankingMode?: string;
  aboutAccount?: boolean;
  lang?: string;
}

export interface ProfileQueryOptions {
  aboutAccount?: boolean;
}

export interface ProfileStatusesOptions extends CursorPageOptions {
  since?: string;
  withReplies?: boolean;
  groupThreads?: boolean;
  lang?: string;
}

export interface ProfileTimelineOptions extends CursorPageOptions {
  lang?: string;
}

export interface SearchOptions {
  q: string;
  feed?: 'latest' | 'top' | 'media';
  count?: number;
  cursor?: string;
  lang?: string;
}

export interface TypeaheadOptions {
  q: string;
  resultType?: string;
  src?: string;
}

export interface TrendsOptions {
  type?: string;
  count?: number;
}