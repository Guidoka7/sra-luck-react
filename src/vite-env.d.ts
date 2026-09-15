/// <reference types="vite/client" />

declare const process: {
  env: Record<string, string | undefined>;
};

type ExportedHandler<Env> = {
  fetch(request: Request, env: Env): Response | Promise<Response>;
};
