import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const origin = "http://w-test-yiyan.localhost:57140";
const otherOrigin = "http://w-other.localhost:57140";
const site = "https://example.vercel.app";
const desktop = "/api/yiyan/desktop";
const authorization = desktop + "/authorization";

function routes(redis) {
  const cache = new Map();
  let userId = "owner";
  const cookies = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const js = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    cache.set(file, exports);
    const imports = specifier => {
      if (specifier === "server-only") return {};
      if (specifier === "next/headers") return { cookies: async () => cookies };
      if (specifier === "@/lib/session") return { getSession: async () => userId ? { userId } : null };
      if (specifier === "./redis" || specifier === "@/lib/redis") return { getRedis: () => redis };
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const path = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
        return load(path.endsWith(".ts") ? path : path + ".ts");
      }
      return require(specifier);
    };
    new Function("require", "exports", js)(imports, exports);
    return exports;
  }
  return {
    auth: load(resolve(root, "app/api/yiyan/desktop/authorization/route.ts")),
    widget: load(resolve(root, "app/api/yiyan/desktop/route.ts")),
    session: load(resolve(root, "lib/yiyan-session.ts")),
    cookie: (value) => cookies.set("xuliu_yiyan_connection", { value }),
    as: (account) => { userId = account; },
  };
}

function memoryRedis() {
  const records = new Map();
  const redis = {
    records,
    async get(key) {
      const record = records.get(key);
      return record && record.expiration > Date.now() ? record.value : null;
    },
    async set(key, value, options) {
      if (options.nx && records.has(key)) return null;
      records.set(key, { value, expiration: Date.now() + options.ex * 1000 });
      return "OK";
    },
    async incr(key) {
      const record = records.get(key);
      const value = (record?.value ?? 0) + 1;
      records.set(key, { value, expiration: record?.expiration ?? Infinity });
      return value;
    },
    async expire(key, seconds) { records.get(key).expiration = Date.now() + seconds * 1000; },
    async exists(key) { return await redis.get(key) === null ? 0 : 1; },
    async del(...keys) {
      let removed = 0;
      for (const key of keys) if (records.delete(key)) removed++;
      return removed;
    },
    async eval(lua, keys, args) {
      if (lua.includes('"PXAT"')) {
        const [pending, active] = keys;
        const [expected, value, expiration] = args;
        const record = records.get(pending);
        if (record?.value !== expected || record.expiration <= Date.now()) return 0;
        records.set(active, { value, expiration });
        records.delete(pending);
        return 1;
      }
      assert.match(lua, /"KEEPTTL"/);
      const [key] = keys, [expected, replacement, prefix] = args;
      const entry = records.get(key);
      if (!entry || entry.expiration <= Date.now()) return 0;
      if (!replacement) return entry.value.startsWith(prefix) ? Number(records.delete(key)) : 0;
      if (entry.value !== expected) return 0;
      records.set(key, { value: replacement, expiration: entry.expiration });
      return 1;
    },
  };
  return redis;
}

function request(url, { method = "GET", from = origin, token, data } = {}) {
  return new Request(site + url, {
    method,
    headers: { Origin: from, ...(token ? { Authorization: "Bearer " + token } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}

test("web authorization issues an origin-bound, single-use Yiyan grant without transferring cookies", async () => {
  const previous = process.env.XULIU_SESSION_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.XULIU_SESSION_SECRET = "x".repeat(40);
  try {
    const redis = memoryRedis();
    const { auth, widget, session, cookie, as } = routes(redis);
    const authRequest = (method, from = site) => request(authorization, { method, from });
    const status = (token, from = origin) => widget.GET(request(desktop + "?status=1", { token, from }));
    const pair = code => widget.POST(request(desktop + "?pair=1", { method: "POST", data: { code } }));
    const expiresAt = Date.now() + 90_000;
    const sealed = session.sealYiyanSession({
      owner: "owner", kind: "connected", expiresAt, cookies: [["JSESSIONID", "dummy-upstream-session"]],
      identity: { uid: "42", username: "test-user" },
    }, session.yiyanKey(process.env.XULIU_SESSION_SECRET));

    assert.equal((await auth.POST(authRequest("POST"))).status, 409);
    cookie(sealed);
    assert.equal((await auth.POST(authRequest("POST", origin))).status, 403);
    as("partner");
    assert.equal((await auth.POST(authRequest("POST"))).status, 409);
    as(null);
    assert.equal((await auth.POST(authRequest("POST"))).status, 401);
    as("owner");
    const { code, expiresIn } = await (await auth.POST(authRequest("POST"))).json();
    assert.match(code, /^xyp1\.owner\./);
    assert.ok(expiresIn <= 90);
    assert.equal((await pair(code.replace("xyp1", "xdp1"))).status, 401);
    const preflight = widget.OPTIONS(request(desktop, { method: "OPTIONS" }));
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(widget.OPTIONS(request(desktop, { method: "OPTIONS", from: "https://example.net" })).status, 403);
    const paired = await Promise.all([pair(code), pair(code)]);
    assert.deepEqual(paired.map(response => response.status).sort(), [200, 401]);
    const { token } = await paired.find(response => response.ok).json();
    assert.match(token, /^xyt1\.owner\./);
    assert.equal((await status(token, otherOrigin)).status, 401);
    assert.equal((await status(token.replace("xyt1", "xdt1"))).status, 401);
    assert.equal((await auth.GET()).headers.get("Access-Control-Allow-Origin"), null);
    const connected = await status(token);
    assert.deepEqual(await connected.json(), { connected: true, libraryReady: true, pending: false, retryAfter: 0 });
    assert.equal(connected.headers.get("Set-Cookie"), null);
    assert.equal(connected.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal(Array.from(redis.records.values())[0].expiration, expiresAt);
    const image = "https://jhyiyan.oss-cn-beijing.aliyuncs.com/test.png";
    const user = { uid: "42", username: "test-user" };
    const rawCard = { textcardid: "30", content: "一言直连测试图文", priv: "0", rec: "1", picpath: image };
    let saved = false;
    globalThis.fetch = async (url, options) => {
      if (url === image) {
        assert.equal(options.credentials, "omit");
        assert.equal(options.headers, undefined);
        return new Response(Uint8Array.of(1, 2, 3), { headers: { "content-type": "image/png" } });
      }
      const target = new URL(url);
      assert.equal(target.origin, "https://app.yiyan.art");
      if (target.pathname.endsWith("/gettodaycard")) {
        assert.equal(options.headers.Cookie, "JSESSIONID=dummy-upstream-session");
        return Response.json({ textcardlist: [rawCard] }, { headers: { "set-cookie": "JSESSIONID=rotated; HttpOnly" } });
      }
      assert.equal(options.headers.Cookie, "JSESSIONID=rotated");
      if (target.pathname.endsWith("/getuserinfoandbooklist")) {
        return Response.json({ user, booklist: [{ bookid: "20", bookname: "默认文集", creator: user }] });
      }
      if (target.pathname.endsWith("/gettextcardsinbook")) return Response.json({ textcardlist: saved ? [rawCard] : [] });
      if (target.pathname.endsWith("/collectcard")) {
        assert.equal(new URLSearchParams(options.body).get("collectbookid"), "20");
        saved = true;
        return Response.json({});
      }
      assert.fail("Unexpected provider request");
    };
    const quote = await widget.GET(request(desktop + "?exclude=29", { token }));
    assert.equal((await quote.json()).card.id, "30");
    assert.equal(quote.headers.get("Set-Cookie"), null);
    assert.equal(Array.from(redis.records.values())[0].expiration, expiresAt);
    const original = await widget.GET(request(desktop + "?image=" + encodeURIComponent(image), { token }));
    assert.equal(original.headers.get("Content-Type"), "image/png");
    assert.deepEqual(new Uint8Array(await original.arrayBuffer()), Uint8Array.of(1, 2, 3));
    const favorite = await widget.POST(request(desktop, {
      method: "POST", token, data: { action: "favorite", cardId: "30", bookId: "", requestId: "12345678-1234-1234-1234-123456789012" },
    }));
    assert.equal((await favorite.json()).saved, true);
    assert.equal(favorite.headers.get("Set-Cookie"), null);
    const forbidden = await widget.POST(request(desktop, { method: "POST", token, data: { action: "send-code" } }));
    assert.equal(forbidden.status, 403);
    assert.equal((await auth.DELETE(authRequest("DELETE"))).status, 200);
    assert.equal((await (await status(token)).json()).pairRequired, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previous === undefined) delete process.env.XULIU_SESSION_SECRET;
    else process.env.XULIU_SESSION_SECRET = previous;
  }
});
