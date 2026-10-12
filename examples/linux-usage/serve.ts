import { buildHtml } from "./build";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SCOUT_USAGE_STUDY_PORT ?? 43140);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid SCOUT_USAGE_STUDY_PORT");
}
const html = await buildHtml();
const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  fetch() {
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});
console.log(`Linux usage study: ${server.url}`);
