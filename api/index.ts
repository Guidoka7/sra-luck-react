type WebHandler = { handleRequest: (request: Request) => Promise<Response> };

let handlerPromise: Promise<WebHandler> | undefined;

function loadHandler(): Promise<WebHandler> {
  if (!handlerPromise) {
    const builtHandlerPath = "../dist/server/vercel-handler.mjs";
    handlerPromise = process.env.VITEST || process.env.NODE_ENV === "test"
      ? import("../server/vercel-handler")
      : import(/* @vite-ignore */ builtHandlerPath);
  }
  return handlerPromise;
}

// Vercel supplies a native Request (with an absolute URL) to this entry point.
export default {
  async fetch(request: Request): Promise<Response> {
    return (await loadHandler()).handleRequest(request);
  },
};
