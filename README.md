# pi-bert

An animated Bert companion for the [Pi coding agent](https://pi.dev). Bert stays visible in a medium-sized panel at the bottom-right of the terminal and reacts to Pi's lifecycle events.

![Bert sprite sheet](bert-sprites.png)

## Behavior

| Pi state | Bert behavior |
| --- | --- |
| Idle | Neutral and ready |
| Thinking/streaming | Neutral talking animation |
| Running a tool | Gesturing talking animation with the tool name |
| Tool error | Annoyed animation for two seconds |
| Running longer than 12 seconds | Tired talking animation |
| Finished | Smiles briefly, then returns to idle |
| Waiting for a dialog response | Waits for you |
| Compacting context | Tired compacting animation |

On terminals at least 80 columns wide, Bert appears as a bottom-right overlay. On narrower terminals, he automatically moves to a right-aligned widget above the editor.

## Requirements

- Pi 0.85.1 or newer
- Node.js 20 or newer
- An inline-image terminal for sprites: Ghostty, Kitty, iTerm2, WezTerm, or Warp

Other terminals receive a small text fallback.

## Try it

From this repository:

```bash
pi -e .
```

To install it from this local checkout:

```bash
pi install /absolute/path/to/pi-bert
```

Restart Pi after installation. While developing an installed local package, use `/reload` after changing the extension.

## Commands

```text
/bert                       Show Bert's current state
/bert on                    Show Bert
/bert off                   Hide Bert
/bert test idle             Preview idle for five seconds
/bert test thinking         Preview thinking for five seconds
/bert test tool             Preview tool use for five seconds
/bert test error            Preview an error for five seconds
/bert test tired            Preview tired for five seconds
/bert test done             Preview completion for five seconds
/bert test waiting          Preview waiting for five seconds
/bert test compacting       Preview compaction for five seconds
```

## Sprite generation

The committed frame images are cropped from `bert-sprites.png`. If the source sheet changes, regenerate all 20 frames with ImageMagick 7:

```bash
npm run sprites
```

The crop coordinates are documented in [`scripts/slice-sprites.sh`](scripts/slice-sprites.sh).

## Development

```bash
npm install
npm run check
```
