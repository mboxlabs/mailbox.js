// 备用 polyfill：setupVitest.mjs 里的引用目前是注释掉的。
import fetch, { Headers, Request, Response } from 'node-fetch'

if (!globalThis.fetch) {
  globalThis.fetch = fetch
  globalThis.Headers = Headers
  globalThis.Request = Request
  globalThis.Response = Response
}