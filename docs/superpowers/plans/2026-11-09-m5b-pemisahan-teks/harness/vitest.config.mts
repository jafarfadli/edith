// Runs identity.harness.ts with the web app's module graph (alias @ -> apps/web/src, fontkit from apps/web).
// Use: cd <repo>/apps/web && npx vitest run --config <this file>
import path from "node:path";

const WEB = process.env.EDITH_WEB || path.resolve(process.cwd());
const HERE = path.dirname(new URL(import.meta.url).pathname);

export default {
  root: WEB,
  resolve: { alias: { "@": path.join(WEB, "src") } },
  server: { fs: { allow: [WEB, HERE, path.resolve(WEB, "../..")] } },
  test: { dir: HERE, include: ["**/*.harness.ts"], environment: "node", testTimeout: 3_600_000 },
};
