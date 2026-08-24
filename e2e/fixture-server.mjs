import { createServer } from "node:http";

const pages = {
  "/plain": "<h1>Plain fixture</h1><button id=fixture-control>Fixture control</button>",
  "/direct": "<h1>Direct fixture</h1><button id=fixture-control>Fixture control</button>",
  "/content":
    "<h1>Content fixture</h1><button id=fixture-control>Fixture control</button><img src=/cf-image.svg alt=''>",
};

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/cf-image.svg") {
    response.writeHead(200, {
      "content-type": "image/svg+xml",
      "cf-cache-status": "HIT",
    });
    response.end("<svg xmlns='http://www.w3.org/2000/svg'/>");
    return;
  }

  const page = pages[path];
  if (page === undefined) {
    response.writeHead(404);
    response.end();
    return;
  }

  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    ...(path === "/direct" ? { "cf-ray": "fixture-ray" } : {}),
  });
  response.end(
    `<!doctype html><html><head><style>#fixture-control { margin-top: 280px; }</style></head><body>${page}<script>document.querySelector('#fixture-control').addEventListener('click', () => document.body.dataset.clicked = 'true')</script></body></html>`,
  );
});

server.listen(4173, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
