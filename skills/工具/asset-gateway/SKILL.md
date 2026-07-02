---
name: asset-gateway
description: >
  Generates images, videos, and other assets using built-in tools.
  Use when the user asks to create or edit images, generate videos,
  or produce other media assets.
---

# Asset Generation

Use the built-in `generate_image` and `generate_video` tools directly — do NOT use bash CLI.

## Image Generation

### New image from text

```
generate_image(prompt="a medieval castle at sunset", size="1024x1024")
```

### Edit an existing image (using URL from previous result)

```
generate_image(
  prompt="Add a moat around the castle",
  input_image="https://asset.origingame.dev/assets/xxx.png",
  edit_mode="edit"
)
```

### Edit modes

| Mode | Use when |
|------|----------|
| `edit` | General edits based on prompt (default) |
| `inpaint` | Fill in or replace specific areas |
| `restyle` | Keep subject, change artistic style |
| `expand` | Extend the image canvas |

### Transparent background

```
generate_image(prompt="a game icon of a fire sword", transparent=true)
```

### Reference images for style guidance

```
generate_image(
  prompt="a warrior in this art style",
  reference_images=["https://...style-ref.png"]
)
```

## Video Generation

### Text to video

```
generate_video(prompt="Slow cinematic fly-through of a mossy temple at sunrise")
```

### Image to video (animate a still image)

```
generate_video(
  prompt="The character waves and blinks",
  input_image="https://asset.origingame.dev/assets/xxx.png"
)
```

## Editing Workflow

1. Generate an image → tool returns a URL
2. The URL is displayed inline in the conversation
3. User can annotate (draw arrows, add notes) or request edits via text
4. Pass the URL back as `input_image` for the next edit — no re-upload needed
5. Repeat until satisfied

## Choosing Tools

| Goal | Tool |
|------|------|
| Still image creation | `generate_image` |
| Image editing / iteration | `generate_image` with `input_image` |
| Motion clip / animation | `generate_video` |
| Animate a still image | `generate_video` with `input_image` |

## Notes

- Results are URLs — they display inline in the conversation automatically.
- For editing, pass the URL from a previous result directly as `input_image`.
- Local file paths also work as `input_image` — they are uploaded automatically.
- Do NOT use `asset-gateway` CLI through bash — use the tools directly.
