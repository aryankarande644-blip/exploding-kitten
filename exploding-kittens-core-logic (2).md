# Exploding Kittens Clone — Core Game Logic Reference

This is a **platform-agnostic engine spec** — no UI, no network. Build this first as a
pure module (works the same for local pass-and-play or as the source of truth on a
multiplayer server). Get this right and both platforms are trivial wrappers around it.

---

## 1. The Rules (complete, corrected)

### Setup (N players)
1. Pull all `defuse` and `exploding_kitten` cards out of the deck.
2. Give each player exactly 1 `defuse`. Shuffle any leftover defuse cards back in.
3. Shuffle the rest of the deck, deal 7 cards to each player (8 total per player).
4. Add exactly `N - 1` exploding kittens to the deck, shuffle. Discard any leftover kittens.

### Turn structure
Each player's turn = **one or more "draw obligations."** Normally 1, but Attack can stack
this up. A turn looks like:

1. **Action phase (optional, repeatable):** play 0+ cards from hand to the discard pile.
   Every played card goes through the **Nope window** before its effect applies.
2. **Draw phase (mandatory, unless the action phase already ended the turn via Skip/Attack):**
   draw the top card.
   - Regular card → goes to hand, one draw-obligation is fulfilled.
   - Exploding Kitten → explosion sequence (below).
3. If the player still owes draw-obligations (from a stacked Attack), repeat from step 1
   for the same player. Otherwise, turn passes to the next **alive** player clockwise.

### Explosion sequence
- **Has a Defuse:** must play it immediately (not optional, can't be Noped, doesn't open a
  Nope window). Discard the Defuse. Secretly re-insert the kitten anywhere in the deck
  (index chosen by the player). This fulfills one draw-obligation — continue turn if more owed.
- **No Defuse:** eliminated. Their entire hand (including any unused cards) goes to the
  discard pile. Removed from turn order permanently.

### Card effects
| Card | Effect | Notes |
|---|---|---|
| Defuse | Cancels an explosion | Never enters the Nope window |
| Skip | Fulfills current draw-obligation without drawing | |
| Shuffle | Randomizes remaining deck order | |
| See the Future | Privately reveals top 3 cards | Order unchanged, private to viewer |
| Favor | Target picks 1 card from their own hand, gives it to you | Target chooses, not you |
| Attack | Ends your turn immediately (all your remaining obligations voided) and adds 2 draw-obligations to the **next** player | **Stacks**: if that player Attacks again instead of drawing, the obligation passes on +2 further (e.g. 2 → 4 → 6...) rather than resetting |
| Cat pair (2 matching) | Steal 1 **random** card from a target's hand | Fizzles harmlessly if target has 0 cards |
| Cat triple (3 matching, optional/advanced) | Name a card type; take it from target if they have it | Nothing happens if they don't have it (info still "used") |
| Cat quintuple (5 different, optional/advanced) | Take any 1 card from the discard pile | |
| Nope | Cancels the effect of the most recently played card | Can Nope a Nope (recursive); cannot Nope a Defuse or the kitten explosion itself |

### Nope window resolution
Any played card (except Defuse) opens a window where any player may play Nope, which can
itself be Noped, and so on, forming a stack.
- Stack length **even** (0, 2, 4…) → original effect resolves.
- Stack length **odd** (1, 3, 5…) → effect is cancelled, card still goes to discard.

This is a **rule**, not a UI feature — implement it as pure state, then let your UI decide
whether the "window" is a 5-second timer (online) or "does anyone want to Nope this?" prompt
(local pass-and-play).

### Win condition
Last player not eliminated wins. Game cannot deadlock — deck size guarantees resolution
(see note in your docs review above).

---

## 2. Data model

```ts
type CardType =
  | 'defuse' | 'skip' | 'shuffle' | 'see_future' | 'favor' | 'attack'
  | 'nope' | 'exploding_kitten'
  | 'cat_a' | 'cat_b' | 'cat_c' | 'cat_d' | 'cat_e'; // 5 distinct cat variants

interface Card {
  id: string;      // unique instance id, e.g. "cat_a_3"
  type: CardType;
}

interface Player {
  id: string;
  hand: Card[];
  alive: boolean;
}

interface PendingAction {
  card: Card;
  sourcePlayerId: string;
  targetPlayerId?: string;
  nopeStack: string[];   // player ids who played Nope, in order
  resolved: boolean;
}

interface GameState {
  players: Player[];
  deck: Card[];            // deck[0] = top of pile
  discard: Card[];         // discard[last] = top, visible
  currentPlayerIndex: number;
  drawObligations: number; // how many draws current player still owes this turn
  pendingAction: PendingAction | null;
  status: 'waiting' | 'in_progress' | 'finished';
  winnerId: string | null;
}
```

`drawObligations` is the key piece your original docs didn't quite model — it belongs to
**whoever is currently active**, starts at 1 each turn, and is what Attack manipulates.

---

## 3. Core algorithm (pseudocode)

```ts
function startTurn(state: GameState) {
  state.drawObligations ??= 1; // default 1 unless carried over by an Attack
}

function playCard(state, playerId, card, targetId?) {
  removeFromHand(state, playerId, card);
  if (card.type === 'defuse') throw Error('Defuse is never "played" via this path');

  state.pendingAction = { card, sourcePlayerId: playerId, targetPlayerId: targetId, nopeStack: [], resolved: false };
  // caller (server/UI) now opens a nope window; once resolved, call resolvePendingAction()
}

function playNope(state, playerId) {
  if (!state.pendingAction) return;
  state.pendingAction.nopeStack.push(playerId);
  // caller resets/extends the nope window timer here
}

function resolvePendingAction(state: GameState) {
  const action = state.pendingAction;
  if (!action) return;
  state.discard.push(action.card);
  const cancelled = action.nopeStack.length % 2 === 1;

  if (!cancelled) {
    applyEffect(state, action);
  }
  state.pendingAction = null;
}

function applyEffect(state: GameState, action: PendingAction) {
  const player = getPlayer(state, action.sourcePlayerId);
  switch (action.card.type) {
    case 'skip':
      state.drawObligations -= 1;
      break;
    case 'attack': {
      state.drawObligations = 0; // void the rest of MY obligations
      const next = nextAlivePlayer(state);
      // stacking: add to whatever the next player already owes (normally 0/undefined -> 1 baseline gets overwritten)
      advanceToPlayer(state, next, /*addObligations*/ 2);
      return; // turn already advanced, skip the generic end-of-effect check below
    }
    case 'shuffle':
      shuffle(state.deck);
      break;
    case 'see_future':
      // no state change — caller sends state.deck.slice(0,3) privately to `player`
      break;
    case 'favor': {
      const target = getPlayer(state, action.targetPlayerId!);
      // caller prompts target to choose a card; then:
      // transferCard(target, player, chosenCard)
      break;
    }
    case 'cat_pair': // detect via 2 cards of same type played together, not a single CardType
      stealRandomCard(state, action.targetPlayerId!, action.sourcePlayerId);
      break;
    case 'nope':
      // no direct effect — its presence already flipped nopeStack parity for the card it targets
      break;
  }
  checkTurnAdvance(state);
}

function checkTurnAdvance(state: GameState) {
  if (state.drawObligations <= 0) {
    advanceToPlayer(state, nextAlivePlayer(state), /*addObligations*/ 1);
  }
  // else: same player continues (more obligations owed), stay in action phase
}

function drawCard(state: GameState) {
  const card = state.deck.shift()!; // top of pile
  const player = getCurrentPlayer(state);

  if (card.type === 'exploding_kitten') {
    handleExplosion(state, player, card);
    return;
  }

  player.hand.push(card);
  state.drawObligations -= 1;
  checkTurnAdvance(state);
}

function handleExplosion(state: GameState, player: Player, kitten: Card) {
  const defuseIdx = player.hand.findIndex(c => c.type === 'defuse');
  if (defuseIdx === -1) {
    eliminate(state, player); // hand -> discard, remove from turn order
    checkWin(state);
    if (state.status !== 'finished') {
      advanceToPlayer(state, nextAlivePlayer(state), 1);
    }
    return;
  }

  // has defuse — mandatory use, no Nope window
  const [defuse] = player.hand.splice(defuseIdx, 1);
  state.discard.push(defuse);
  // caller supplies chosen re-insert index from the player
  const insertIndex = getPlayerChosenIndex(state, player, kitten);
  state.deck.splice(insertIndex, 0, kitten);

  state.drawObligations -= 1;
  checkTurnAdvance(state);
}

function advanceToPlayer(state: GameState, player: Player, addObligations: number) {
  state.currentPlayerIndex = state.players.indexOf(player);
  state.drawObligations = addObligations; // NOT +=, since obligations belong to whoever is now active
}

function nextAlivePlayer(state: GameState): Player {
  let i = state.currentPlayerIndex;
  do {
    i = (i + 1) % state.players.length;
  } while (!state.players[i].alive);
  return state.players[i];
}

function eliminate(state: GameState, player: Player) {
  state.discard.push(...player.hand);
  player.hand = [];
  player.alive = false;
}

function checkWin(state: GameState) {
  const alive = state.players.filter(p => p.alive);
  if (alive.length === 1) {
    state.status = 'finished';
    state.winnerId = alive[0].id;
  }
}
```

**Why `drawObligations` isn't `+=` on Attack chaining:** the accumulation happens because
each Attack *replaces* the target's count with `previous_owed + 2` — but since a player who
hasn't started their turn yet has no "previous owed" of their own, in practice you compute
it as: when player A attacks player B, and B (before drawing) attacks player C, you pass
`B's remaining drawObligations (which is 2, untouched) + 2` into C's obligations = 4. So the
"stacking" logic actually lives in the `attack` case — instead of always passing `2`, pass
`state.drawObligations + 2` before zeroing it out for the current player. Small but important
fix to the pseudocode above:

```ts
case 'attack': {
  const carried = state.drawObligations; // what I still owed
  state.drawObligations = 0;
  const next = nextAlivePlayer(state);
  advanceToPlayer(state, next, carried + 2 > 0 ? carried + 2 : 2);
  return;
}
```

---

## 4. Recommended build order

1. **Pure engine module** (the code above), zero UI/network. Test it with a script that
   plays thousands of random games and asserts invariants (deck+discard+hands always sum to
   full card count, exactly one winner, no negative obligations, etc.) — this catches Attack
   stacking bugs before you ever touch a UI.
2. **Local CLI or console harness** to manually play a game against the engine and sanity-check
   the Nope window and defuse-reinsertion flow.
3. **UI layer** (React) that calls the engine functions and renders state — start local
   pass-and-play, since it needs zero networking.
4. **Multiplayer layer** only once the engine is solid: wrap the same functions behind
   WebSocket handlers (your `full_spec.docx` WebSocket contract is a reasonable shape for this
   — `JOIN_ROOM`, `PLAY_CARD`, `PLAY_NOPE`, `DRAW_CARD`, `DEFUSE_BOMB` map directly onto
   `playCard`, `playNope`, `resolvePendingAction`, `drawCard`, `handleExplosion` above).

Keep the engine free of any WebSocket/React code — that separation is what lets you build
local mode first (fast to test) and multiplayer second (reuses everything).

---

## 5. Online Multiplayer Architecture

Goal: anyone can create or join a room from the browser and play against each other over
the network. This layer sits **on top of** the engine above — none of the rules logic
changes, only who's allowed to see/trigger it.

### High-level shape

```
Client (React/Next.js)  <—WebSocket—>  Server (holds GameState per room, calls engine fns)
```

**Server-authoritative, non-negotiable.** The server holds the only real `GameState`.
Clients never trust their own copy — they render whatever the server broadcasts. This
matters specifically because this game has hidden information (hands, kitten position) —
a client-authoritative model would let anyone read their own JS state and cheat.

### Recommended stack

- **Frontend:** Next.js, reusing the engine's TypeScript types as a shared package
- **Backend:** Node.js WebSocket server (`socket.io` or plain `ws`) — run as its own
  process, not Next.js API routes, since you need long-lived connections and in-memory
  room state
- **State storage:** a plain in-memory `Map<roomCode, GameState>` is genuinely enough here —
  no DB required unless you later want persistent accounts/match history
- **Deployment:** Vercel can't host the WebSocket server (serverless, no persistent
  connections) — put the socket server on Railway/Render/Fly.io; frontend stays on Vercel

(A Python/FastAPI + Postgres + Docker version, as sketched in your original spec doc, is
equally valid — the room/socket logic maps 1:1 either way. Node is only preferable here
because it lets you share the engine module between client and server unchanged.)

### Room lifecycle

1. `CREATE_ROOM` → server generates a room code, creates an empty `GameState` with
   `status: 'waiting'`, host becomes player 1.
2. `JOIN_ROOM { room_code }` → adds the player if the room is `waiting` and not full
   (2–5 players for this game).
3. Host sends `START_GAME` → server runs the engine's `setup()` deal logic, sets
   `status: 'in_progress'`, and pushes the initial state.
4. Gameplay proceeds through the engine's `playCard` / `playNope` / `drawCard` /
   `handleExplosion` exactly as defined in Section 3 — the server calls these functions,
   then broadcasts the new state after each resolution.
5. `checkWin` fires → `status: 'finished'`, broadcast the winner, room can be archived
   or discarded.

### What's different from local/offline mode

- **Hidden information over the wire.** The server must send *different* payloads to
  different sockets: everyone gets public state (deck count, discard top, whose turn),
  but hand contents only go to their owner. The engine module itself is pure logic and
  doesn't know about sockets — filtering `GameState` per-recipient before emitting is the
  server's job, done at the transport layer, not inside the engine.
- **The Nope window needs a real server-side timer** (5–10s is standard) instead of
  waiting indefinitely, since you can't block on a network client forever.
- **Disconnects:** mark the player `connected: false`, keep their hand/state intact, and
  auto-fire `DRAW_CARD` on their behalf if their turn's inactivity timer expires.
- **Reconnection:** client stores `{ roomCode, playerId, sessionToken }` locally; on
  reconnect it resends that to rejoin the socket and receives a fresh full-state push.

### WebSocket API (client ↔ server)

Client → Server:
```json
{"action": "CREATE_ROOM", "player_name": "Aryan"}
{"action": "JOIN_ROOM", "room_code": "ABCD", "player_name": "..."}
{"action": "START_GAME"}
{"action": "PLAY_CARD", "card_id": "skip_1", "target_player_id": null}
{"action": "PLAY_NOPE", "card_id": "nope_1"}
{"action": "DRAW_CARD"}
{"action": "DEFUSE_BOMB", "card_id": "defuse_1", "insert_index": 14}
{"action": "RECONNECT", "room_code": "ABCD", "player_id": "uuid", "session_token": "..."}
```

Server → Client:
```json
{"event": "ROOM_STATE", "players": [...], "status": "waiting"}
{"event": "GAME_STATE_UPDATE", "active_player": "uuid", "deck_count": 34, "discard_top": "skip_1", "draw_obligations": 1}
{"event": "PRIVATE_HAND", "hand": ["card_1", "card_2", ...]} // sent ONLY to that socket
{"event": "NOPE_WINDOW_OPEN", "triggering_player": "uuid", "card_played": "attack", "duration_ms": 7000}
{"event": "PRIVATE_FUTURE_VIEW", "cards": ["kitten", "defuse", "skip"]} // sent ONLY to active player
{"event": "PLAYER_ELIMINATED", "player_id": "uuid"}
{"event": "GAME_OVER", "winner_id": "uuid"}
```

Each server action handler is a thin wrapper: validate the sender is allowed to act right
now → call the matching engine function from Section 3 → filter and broadcast the
resulting state.

### Build order (updated)

1. Pure engine module (Section 3) — test with simulated random games.
2. Wrap it in a Node WebSocket server implementing the room lifecycle above, testable
   with a CLI/script client before any UI exists.
3. Lobby UI (create/join room, player list, start button).
4. Game board UI wired to the socket events.
5. Reconnect handling + inactivity auto-draw last — polish, not core to playability.

---

## 6. Deck Composition (exact counts — official base game, 2–5 players)

Your docs never specified quantities. An agent building the `setup()` deck needs exact
numbers, not just card types:

| Card | Count in full deck |
|---|---|
| Exploding Kitten | 4 total (only `N - 1` are used per game; rest removed) |
| Defuse | 6 total (1 dealt to each player up front; leftovers reshuffled in) |
| Skip | 4 |
| Attack | 4 |
| Favor | 4 |
| Shuffle | 4 |
| See the Future | 5 |
| Nope | 5 |
| Cat card (5 distinct types) | 4 of each = 20 total |

**Total non-kitten, non-defuse cards: 46.** For a game with `N` players, after dealing
`7 × N` of those 46 to players, the remainder + `N - 1` kittens forms the draw pile.
This supports 2–5 players (above 5, you run out of cards to deal — cap `START_GAME` at 5).

---

## 7. Suggested Project Structure

```
/engine          <- pure game logic (Section 3), zero deps on React/sockets
  deck.ts         <- deck composition + setup() from Section 6
  state.ts        <- GameState, Player, Card types (Section 2)
  actions.ts       <- playCard, playNope, resolvePendingAction, drawCard, handleExplosion
  turn.ts          <- advanceToPlayer, nextAlivePlayer, checkTurnAdvance, checkWin
  engine.test.ts   <- random-game simulation tests (see Section 4, step 1)

/server           <- Node WebSocket server, imports /engine
  rooms.ts         <- Map<roomCode, GameState>, create/join/start
  socket.ts        <- event handlers mapping Section 5's API to engine calls
  broadcast.ts      <- per-recipient state filtering (hides other players' hands)

/web              <- Next.js frontend
  app/lobby/        <- create/join room UI
  app/game/[room]/  <- game board, wired to socket events
  lib/socket.ts     <- client-side socket connection + typed event helpers
```

Keeping `/engine` dependency-free is what makes the test suite in Section 4 fast and lets
`/server` and any future local-mode UI both import the same logic unmodified.

---

## 8. Task Breakdown (hand this list to your coding agent, one task at a time)

Work through these in order; each has a concrete "done" check so an agent (or you) can
verify before moving on, instead of building everything at once and debugging blind.

1. **Scaffold `/engine` types** (Section 2). *Done when:* `GameState`, `Player`, `Card`,
   `PendingAction` compile with no logic yet.
2. **Implement `deck.ts`** using Section 6's counts. *Done when:* a unit test confirms
   `setup(4)` produces exactly 8 cards per player, 3 kittens in the deck, and total card
   count matches the full deck size minus removed kittens.
3. **Implement turn/draw logic** (`drawCard`, `checkTurnAdvance`, `nextAlivePlayer`)
   *without* card effects yet — just Skip-free, Attack-free turns. *Done when:* a
   simulated game where players only draw (never play cards) always ends in exactly one
   winner.
4. **Implement each card effect** one at a time in this order: Skip → Shuffle → See the
   Future → Favor → Cat pair → Attack (with the stacking fix from Section 3) → Nope.
   *Done when:* each has its own unit test using the exact scenario from the rules table.
5. **Implement the explosion/Defuse sequence.** *Done when:* a test where a player with
   no Defuse draws a rigged kitten results in elimination + their hand in discard; a test
   where a player with a Defuse draws a rigged kitten survives and the kitten is
   re-inserted at their chosen index.
6. **Run the random-game simulation** (thousands of iterations, Section 4 step 1) and fix
   any invariant violations before touching networking at all.
7. **Build `/server` room lifecycle** (create/join/start) with no gameplay yet — just
   getting players into a `waiting` room. *Done when:* two browser tabs can join the same
   room code and see each other in the player list.
8. **Wire gameplay socket events to the engine** (Section 5's API). *Done when:* two tabs
   can play a full game to completion using only network messages, no UI polish.
9. **Add hidden-info filtering** (private hand, private future-view) — *this is easy to
   get wrong silently*, so explicitly test that a browser dev-tools inspection of network
   traffic never shows another player's hand.
10. **Add disconnect/reconnect + inactivity auto-draw.** *Done when:* closing a tab
    mid-game doesn't freeze the other players, and reopening rejoins the same game state.
11. **Build the lobby + game board UI** last, once the underlying game is fully playable
    via raw socket messages.
