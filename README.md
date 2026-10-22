# ISS · International Space Station

**A free, open-source audio toolkit for X Spaces.** Clean music audio, a mixer, a soundboard, a local music player and custom emoji reactions, all running in your own browser. No account, no subscription, no servers, no tracking.

Released into the public domain under the [Unlicense](LICENSE). Copy it, fork it, ship it, sell it. No permission needed.

> ISS is an independent project. It is not affiliated with X Corp. It is also a clean-room alternative to the closed-source "Space Station" extension: it was built from first principles and public research, not from that extension's code. See [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## What it does

| Feature | What you get |
| --- | --- |
| **Clean audio** | Turns off the voice processing X applies to your mic (echo cancellation, noise suppression, auto gain, voice isolation). Music, instruments and singing come through as they are. |
| **High-quality stream** | Negotiates stereo Opus at up to 510 kbps (128 kbps default), with silence-dropping (DTX) off so fades and reverb tails don't get chopped. |
| **Mixer** | Mic, instrument/aux input, music, shared tab audio and soundboard, each with a fader and level meter, plus a master limiter. |
| **Talk-over (ducking)** | Music drops automatically while you speak and comes back when you stop. |
| **Soundboard** | Drag in clips, trigger with a click or `Alt+1…0` / `Alt+Q…P`. Per-pad volume, loop and play mode. `` Alt+` `` stops everything. Clips are stored in your browser. |
| **Mix Station** | Play local music or video files (or a whole folder) straight into the Space. Shuffle, repeat, seek. |
| **Share tab audio** | Send audio from YouTube, SoundCloud, Spotify web, a DAW in another window, anything you can share. |
| **Any emoji reaction** | Send any emoji as a Space reaction. Everyone on web, iOS and Android sees it with nothing installed. Auto-react while music plays. |
| **Now playing** | Put the current song in your Space title automatically, from Mix Station or the shared tab's title. Optional reaction on song change. |
| **Monitor** | Hear what you're sending on any output device, without hearing yourself. |

## Install

### Chrome, Edge, Brave, Opera, Arc (extension)

1. Get the code (clone or download this repo). Optionally run `npm run build` to get `dist/iss-extension-<version>.zip`.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension/` folder (or the unzipped build).
4. Reload x.com. A small satellite button appears bottom-left. `Alt+Shift+S` opens the panel too.

### Firefox, Safari and others (userscript)

Install [Violentmonkey](https://violentmonkey.github.io/) (recommended) or Tampermonkey, then open `dist/iss.user.js` (from `npm run build`). Everything works except reading the song name from another tab. Violentmonkey with `@inject-into page` runs it early enough; if ISS doesn't take over your mic, reload the page once before joining the Space.

## Use

1. **Wear headphones.** With echo cancellation off, speakers would feed the Space back into your mic.
2. Open the ISS panel on x.com. Load sounds into **Board**, music into **Station**, or connect an instrument in **Mixer**.
3. Start or join a Space and become a speaker. The panel shows **On air**.
4. Play. Adjust faders. React.

Already speaking when you installed or enabled ISS? Open **Setup → Re-attach now**, or leave and rejoin the Space.

### Song title in the Space title (one-time setup)

ISS doesn't hard-code X's private API, which changes often. Instead it learns the request once:

1. **Station → Now playing → Learn.** ISS shows a test title like `ISS "4821" test`.
2. Edit your Space's title in X to exactly that text and save.
3. ISS records that one request. From then on it reuses it for song titles, at most once every 15 seconds. If X changes something and it stops working, click **Learn** again.

## Why no servers?

Everything Space Station-style tools do can happen between your browser and X:

- Audio processing is a browser setting on your own microphone.
- Mixing happens in the Web Audio API on your machine.
- Reactions travel over the chat connection X's own web app already opened.
- Title changes use the same request X's own edit button sends.

A paid tool may run a server to check subscriptions. ISS has nothing to check, so it has no server. It only ever talks to X, the same way X's own web app does, and nothing is sent anywhere else.

## Develop

```bash
npm test           # unit tests (Node 20+, no dependencies)
npm run test:e2e   # loads the real extension in Chromium against a fake x.com (needs Playwright)
npm run build      # dist/iss-extension-<version>.zip and dist/iss.user.js
```

The e2e test fakes X's Spaces client: it asks for a voice-processed mic, publishes over WebRTC, joins the Periscope chat socket and edits the title, then checks that ISS took over each step and that soundboard audio really arrives on the far side of the call.

Code map:

```
extension/
  manifest.json
  src/page/        runs inside x.com, before X's own code
    core.js        settings, events, logging
    constraints.js mic constraint rewriting (processing off)
    sdp.js         Opus tuning
    hooks.js       getUserMedia / RTCPeerConnection / track hooks
    engine.js      Web Audio mixer
    chat.js        reactions over X's chat socket
    titles.js      learn-and-replay Space title edits
    board.js       soundboard     station.js  Mix Station
    nowplaying.js  song detection, auto reactions
    ui.js          panel (Shadow DOM)    main.js  entry
  src/ext/         extension-only: background worker + bridge (tab titles)
  popup/           toolbar popup
```

Turn on **Setup → Debug logging** to see what ISS is doing in the browser console. If X changes how Spaces work, that log is the first place to look; please open an issue with it.

## Caveats

- Listeners mostly hear Spaces through X's own stream, which X re-encodes. ISS sends X the best possible source, but X decides the final listener quality. Other speakers receive your Opus stream as sent.
- X can change its web app at any time. ISS hooks standard browser APIs rather than X's code, which makes it fairly resilient, but things can still break.
- Use it the way you'd use a mic and a mixer. Respect copyright and X's rules for what you play.

## License

Public domain, via the [Unlicense](LICENSE).
