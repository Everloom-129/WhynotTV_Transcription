import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");

// Tiny dev plugin: GET /api/transcript?episode=ep, POST /api/save, plus static audio under /audio.
function podcastApi(): Plugin {
  return {
    name: "podcast-api",
    configureServer(server) {
      server.middlewares.use("/api/transcript", (req, res) => {
        const url = new URL(req.url ?? "", "http://x");
        const ep = url.searchParams.get("episode") ?? "danfei";
        const rawPath = path.join(REPO_ROOT, "data", "raw", `${ep}.json`);
        const editsPath = path.join(REPO_ROOT, "data", "edits", `${ep}.json`);
        if (!fs.existsSync(rawPath)) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: `no raw json for ${ep}` }));
          return;
        }
        const raw = JSON.parse(fs.readFileSync(rawPath, "utf-8"));
        const edits = fs.existsSync(editsPath)
          ? JSON.parse(fs.readFileSync(editsPath, "utf-8"))
          : null;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ episode: ep, raw, edits }));
      });

      server.middlewares.use("/api/save", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            const ep = body.episode;
            if (!ep || typeof ep !== "string" || !/^[\w-]+$/.test(ep)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "bad episode slug" }));
              return;
            }
            const outDir = path.join(REPO_ROOT, "data", "edits");
            fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, `${ep}.json`);
            fs.writeFileSync(
              outPath,
              JSON.stringify(body.payload, null, 2),
              "utf-8",
            );
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, path: outPath }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });

      // Serve audio files from <repo>/data/audio under /audio/*.
      server.middlewares.use("/audio", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const filePath = path.join(REPO_ROOT, "data", "audio", rel);
        if (!filePath.startsWith(path.join(REPO_ROOT, "data", "audio"))) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          next();
          return;
        }
        res.setHeader(
          "content-type",
          rel.endsWith(".wav") ? "audio/wav" : "application/octet-stream",
        );
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), podcastApi()],
  server: {
    fs: { allow: [REPO_ROOT] },
  },
});
