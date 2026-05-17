# Episode audio (generated)

`python -m src.cli --url … --episode <slug>` writes here:

- **`<slug>.<ext>`** — source audio from yt-dlp (`.webm`, `.m4a`, etc.; extension depends on the host).
- **`<slug>.wav`** — 16 kHz mono WAV from ffmpeg; this is what Whisper transcribes.

With `--audio path/to/file`, only `<slug>.wav` is created if the input is not already WAV. These files are large and gitignored; transcripts live under `data/raw/` and `data/transcripts/`.


Example Output (361M): 
- danfei.wav   # 252M
- danfei.webm  # 109M