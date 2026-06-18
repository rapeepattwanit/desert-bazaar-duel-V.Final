# UPDATE NOTES v5.0.0

อัปเดตตาม Prompt 1–20:

- Normalize audio filenames to lowercase `.mp3`
- Fixed effect mapping for click/take/sell/camel/trade/notification/winner
- No fallback tone when audio file is missing; console warns instead
- Audio settings persisted in localStorage
- Background music starts only after entering a room
- Smaller scrollable settings modal
- Atomic trade validation in server.js
- XSS hardening for player names/log rendering
- Reconnect handling improved with websocket identity checks and stale slot cleanup
- Fair tie-breaker with true tie outcome
- Round/game result popups with collapsible score details
- Hidden bonus token values during play
- Real shuffled bonus token stacks per round
- Improved sell UI and action disabled states
- Market card tap now selects first, then player confirms action
- Responsive CSS improvements
- Static frontend moved to public/
- Card WebP assets added for faster loading
- validateGameState and node:test tests added
