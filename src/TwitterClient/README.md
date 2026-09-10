# HunterX

A TypeScript Twitter/X API client using cookie-based authentication to interact with Twitter's internal GraphQL and REST v1.1 APIs.

## Setup

```bash
npm install
```

## Usage

```typescript
import { TwitterClient } from "./lib/TwitterClient.js";

const client = new TwitterClient({
  cookies: {
    authToken: "your_auth_token",
    ct0: "your_ct0_csrf_token",
  },
});
```

### Authentication

HunterX uses cookie-based auth. You need two values from your browser:

1. **`authToken`** — the `auth_token` cookie from x.com
2. **`ct0`** — the `ct0` CSRF token cookie from x.com

To extract these, open x.com in your browser, go to DevTools > Application > Cookies, and copy the values.

## API

### Tweets

| Method | Description |
|--------|-------------|
| `tweet(text)` | Post a new tweet |
| `reply(text, replyToTweetId)` | Reply to a tweet |
| `getTweet(tweetId)` | Get a single tweet by ID |
| `getReplies(tweetId)` | Get replies to a tweet |
| `getThread(tweetId)` | Get the full thread for a tweet |
| `search(query, count?)` | Search tweets (default 20 results) |
| `getUserTweets(userId, count?)` | Get a user's tweets |
| `getHomeTimeline(count?)` | Get the authenticated user's home timeline |

### Engagement

| Method | Description |
|--------|-------------|
| `like(tweetId)` | Like a tweet |
| `unlike(tweetId)` | Unlike a tweet |
| `retweet(tweetId)` | Retweet a tweet |
| `unretweet(tweetId)` | Undo a retweet |

### Users

| Method | Description |
|--------|-------------|
| `getUserByScreenName(screenName)` | Look up a user by handle |
| `getUsersByIds(userIds)` | Look up multiple users by ID |
| `getFollowers(userId, count?)` | Get a user's followers |
| `getFollowing(userId, count?)` | Get who a user follows |
| `getBlueVerifiedFollowers(userId, count?)` | Get a user's verified followers |
| `follow(userId)` | Follow a user |
| `unfollow(userId)` | Unfollow a user |
| `getCurrentUser()` | Get the authenticated user's info |

### Lists

| Method | Description |
|--------|-------------|
| `createList(name, description?, isPrivate?)` | Create a new list |
| `getList(listId)` | Get list details |
| `getListTweets(listId, count?)` | Get tweets from a list |
| `getListMembers(listId, count?, opts?)` | Get list members (paginated; `opts.cursor`) |
| `getMyLists(count?)` | Get the authenticated user's lists |
| `addListMember(listId, userId)` | Add a user to a list |
| `removeListMember(listId, userId)` | Remove a user from a list |
| `getListMemberships(userId, count?)` | Get lists a user belongs to |
| `getCombinedLists(userId, count?)` | Get all lists associated with a user |

### Rate Limiting

Every response includes a `rateLimit` field:

```typescript
{
  success: boolean;
  rateLimit?: {
    limit: number;      // max requests allowed
    remaining: number;  // requests left in window
    reset: number;      // unix timestamp when the window resets
  }
}
```

## Commands

```bash
# Run
npx tsx src/index.ts

# Type check
npx tsc --noEmit

# Build
npx tsc
```

## Project Structure

```
src/
  index.ts                  # Entry point
  lib/
    TwitterClient.ts        # Main client class
    query-ids.json          # GraphQL operation query IDs
  twitter_req/              # Captured curl commands (reference)
  twitter_response/         # Captured JSON responses (reference)
```

## License

ISC
