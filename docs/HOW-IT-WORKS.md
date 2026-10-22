# How ISS works

This is the research and design behind ISS: what the closed-source "Space Station" extension appears to do, how X Spaces works under the hood, and how ISS does the same things in the open with no servers.

## 1. What we were replacing

"Space Station" (by @blankspeaker) is a closed-source Chrome extension for X Spaces, offered to paying X subscribers. From the author's public posts, it:

- removes X's "voice optimization" (noise cancellation, voice isolation) so music sounds right;
- streams tab audio, local media ("Mix Station", v2.0) and live instruments;
- ducks music while you talk ("talk over");
- puts the current "Artist - Track" in the Space title, read from the shared tab's title;
- sends music-note reactions while playing, and (v2.1.12) "new emojis" that listeners on web, iOS and X-Lite see without installing anything.

No code was available, so ISS is a clean-room build from the browser platform and public protocol knowledge.

## 2. How X Spaces carries audio

Spaces is built on Periscope's infrastructure (first reported in 2020 by Jane Manchun Wong; still visible in the `pscp.tv` hosts the web app talks to).

```
 your browser (speaker)
   getUserMedia() ──► mic track ──► RTCPeerConnection ──► Janus WebRTC gateway (janus.plugin.videoroom)
                                                              │  forwards Opus packets as-is (SFU)
                                                              ├──► other speakers (WebRTC)
                                                              └──► X transcodes ──► listeners (HLS stream)
   WebSocket ──► Periscope "chatman" (…pscp.tv/chatapi/v1/chatnow)
                 auth, join room, reactions, speaker requests, occupancy
```

Key facts, cross-checked against the open-source `agent-twitter-client` Spaces implementation (`src/spaces/core/JanusClient.ts`, `ChatClient.ts`):

- **Audio goes through Janus's `videoroom` plugin**, an SFU. It forwards Opus packets without decoding, so whatever Opus settings our browser negotiates reach other speakers unchanged, and X's listener transcode gets the cleanest possible source.
- **Reactions are chat frames.** After authenticating (`kind: 3`) and joining the room (`kind: 2` with `{room}`), a reaction is:

  ```json
  { "kind": 1, "type": 2,
    "body":    "{\"body\":\"🦖\",\"type\":2,\"v\":2}",
    "payload": "{\"room\":\"<room id>\",\"body\":\"{\\\"body\\\":\\\"🦖\\\",\\\"type\\\":2,\\\"v\\\":2}\"}" }
  ```

  The emoji is a free-form string. The server doesn't restrict it to X's built-in set, which is why any emoji works for every listener.
- The chat room ID is the Periscope broadcast ID for the Space.

## 3. Why the audio sounds bad without help

X's web client asks the browser for a "voice" mic. Chrome then runs WebRTC's audio processing on it:

- **Noise suppression** treats sustained tones (pads, chords, cymbals) as noise and removes them.
- **Automatic gain control** pumps the volume up in quiet parts and down in loud ones.
- **Echo cancellation** tries to subtract what it thinks is speaker bleed, which smears music.
- **Voice isolation** (where supported) strips anything that isn't speech.

On top of that, Opus defaults are tuned for speech: mono, low bitrate, and **DTX**, which stops sending audio during "silence" and chops fades and reverb tails.

Virtual audio cables and hardware mixers can't fix this, because the processing happens after the audio enters the browser. It has to be fixed in the browser.

## 4. What ISS does about it

ISS runs as a content script in the page's own JavaScript world at `document_start`, before X's code, and wraps standard browser APIs. It never patches X's code, so it keeps working when X ships a new build.

| Hook | What ISS does |
| --- | --- |
| `MediaDevices.getUserMedia` | For audio-only requests (Spaces), removes every echo/noise/gain/isolation request, legacy `goog*` ones included, asks for 48 kHz stereo, and opens the mic itself. The mic goes into the ISS mixer, and X receives the **mixer's output track** in its place. Requests with video (camera recording elsewhere on X) are left untouched. |
| `RTCPeerConnection.setLocalDescription / setRemoteDescription` | Rewrites the Opus `fmtp` line: `stereo=1; sprop-stereo=1; maxaveragebitrate=<N>; usedtx=0; useinbandfec=1; maxplaybackrate=48000`, and drops `b=AS`/`b=TIAS` caps in audio sections. The remote answer's parameters control our encoder, so both sides are tuned. |
| `RTCRtpSender.setParameters` (on connect) | Sets `maxBitrate` and high priority on the audio sender. |
| `addTrack`, `addTransceiver`, `RTCRtpSender.replaceTrack` | If X tries to send any other audio track (for example its own processed copy of the mic), ISS sends its mix instead. |
| `MediaStreamTrack.stop` | When X stops the mix track (you left the Space), ISS turns the real mic off too. |
| `WebSocket` | Spots X's own Periscope chat socket and the room it joins. Reactions are sent on that socket. ISS never opens a connection or reads tokens. |
| `fetch` / `XMLHttpRequest` | Only while you're in "Learn" mode for the title feature (see below). Otherwise they pass straight through. |

### The mixer

Built on the Web Audio API, all local:

```
mic ► low-cut ► compressor ► gate ► fader ─────────────┐
aux (instrument/interface, processing off) ► fader ────┤
Mix Station player ► fader ─┐                          ├► master ► limiter ► track given to X
shared tab audio  ► fader ──┴► ducker ─────────────────┤
soundboard pads   ► fader ─────────────────────────────┘
```

Ducking and the gate read the mic level every 25 ms and ramp gains smoothly. A separate monitor output lets you hear the player, pads and (optionally) aux input without hearing yourself; it can go to any output device via `AudioContext.setSinkId`.

Shared tab audio uses `getDisplayMedia`, which Chrome lets you point at a single tab with "share tab audio" ticked. It isn't monitored, because the tab already plays through your speakers.

### Song titles without a hard-coded API

The Space title is edited through X's private API, which changes often. ISS learns it instead:

1. You click **Learn**. ISS makes a test title like `ISS "4821" test`. The space and quotes make every encoding look different: raw, JSON-escaped (to any nesting depth), URL-encoded, form-encoded.
2. You set your Space's title to that text in X's own UI.
3. ISS finds the one outgoing request (HTTP or chat socket) containing that text, works out the encoding, and stores it as a template. The current Space ID and chat room ID inside it are swapped for placeholders, and cookies aren't stored.
4. Later, ISS fills in the new title and the current Space IDs, refreshes the CSRF token from the `ct0` cookie, and sends it with your browser's own cookies. At most once every 15 seconds.

### Now playing

- **Mix Station**: the file name, split into "Artist - Track" when it looks like one.
- **Shared tab**: the extension's background worker watches for audible tabs (`chrome.tabs`, the only permission ISS asks for) and passes the best-guess title to the X tab. It only does this while you're sharing a tab with the option on. Titles are cleaned for YouTube, YouTube Music, SoundCloud, Spotify web and others.

## 5. Why there's no server

| Feature | Where it happens |
| --- | --- |
| Clean mic audio | browser constraints on your own mic |
| Mixing, ducking, soundboard, player | Web Audio, on your machine |
| HQ stream | SDP negotiation between your browser and X |
| Reactions | X's own chat socket |
| Title updates | the same request X's edit button sends |
| Storage | `localStorage` and IndexedDB on x.com, in your browser |

None of it needs a third party. The only plausible reason for a server in a paid tool is checking who has paid.

## 6. Limits and things to watch

- **Listener quality.** Most listeners hear X's transcoded stream. ISS improves the source, but X sets the final bitrate.
- **Mute.** X mutes by disabling the track it was given, which is the ISS mix. Muted in X means nothing goes out, music included. Use ISS's own mic mute (Mixer → Mic → Live/Muted) to mute just your voice and keep the music going.
- **Feedback.** With echo cancellation off you need headphones. The Setup tab can turn it back on.
- **Protocol drift.** If X moves away from `getUserMedia` + WebRTC, or changes the chat frame format, the relevant hook needs updating. Debug logging (Setup) shows what ISS sees.
- **Userscript timing.** Userscript managers don't always run before the page's own scripts. Violentmonkey with `@inject-into page` and `@run-at document-start` usually does; the extension always does.

## 7. Testing

- `npm test` covers the pure logic: SDP rewriting, constraint rewriting, chat frame building/parsing, title learning in every encoding, tab-title cleanup.
- `npm run test:e2e` launches Chromium with the extension loaded and a fake `x.com` that behaves like the Spaces client: voice mic request, WebRTC publish, chat socket join, title edit. It checks that processing is off, the mix track is what's sent, Opus is stereo/high-bitrate/no-DTX, X's track swaps are overridden, soundboard audio is decoded on the far side of the call, reactions go out with the right room, and title edits are learned and replayed with fresh IDs and CSRF.
