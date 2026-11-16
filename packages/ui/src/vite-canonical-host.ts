import type { Plugin } from "vite";

/**
 * Dev server: alihkan alamat lain (mis. `localhost:5175`, `auth.localhost:5175`) ke satu alamat kanonis. Cookie sesi terikat
 * nama host, jadi masuk di alamat lain membuat aplikasi lain (Akasha, halaman depan) tidak mengenali sesi itu.
 */
export function canonicalHost(host: string): Plugin {
  return {
    name: "workingspace-canonical-host",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const current = req.headers.host;
        if (!current || current === host) return next();
        res.statusCode = 302;
        res.setHeader("Location", `http://${host}${req.url ?? "/"}`);
        res.end();
      });
    },
  };
}
