/** The path the app is served under (next.config.ts basePath), for URLs Next does not prefix itself: files in public/
 *  fetched or handed to pdf.js. Empty in dev and tests. */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
