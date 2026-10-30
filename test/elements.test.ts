import ky from "ky"

import { PermitElements, PERMIT_URL, isPermitEmbedOrigin } from "../src/elements"
import { sendTokenToIframe } from "../src/sendToken"
import { LoginMethod } from "../src/types"

const ENV_ID = "0123456789abcdef0123456789abcdef"
const OTHER_ENV_ID = "fedcba9876543210fedcba9876543210"
const DASHED_ENV_ID = "01234567-89ab-cdef-0123-456789abcdef"

// A minimal window/document: enough for login(), logout() and sendTokenToIframe()
// under the node environment.
let listeners: Set<(msg: any) => void>
let appended: any[]

// As in a browser, an iframe has a contentWindow only while it is in the document.
function makeElement(): any {
  const element: any = { style: {}, contentWindow: null }
  element.remove = () => {
    const index = appended.indexOf(element)
    if (index >= 0) appended.splice(index, 1)
    element.contentWindow = null
  }
  return element
}

function attach(element: any) {
  appended.push(element)
  element.contentWindow = { postMessage: jest.fn() }
}

// For a test where approve() must refuse before it sends anything.
function refuseRequests() {
  return jest.spyOn(ky, "post").mockImplementation(() => {
    throw new Error("unexpected request")
  })
}

beforeEach(() => {
  listeners = new Set()
  appended = []
  ;(global as any).window = {
    addEventListener: (_type: string, listener: (msg: any) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (msg: any) => void) => listeners.delete(listener),
  }
  ;(global as any).document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: makeElement,
    body: { appendChild: attach },
  }
  jest.useFakeTimers()
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
  delete (global as any).window
  delete (global as any).document
})

// A login without an answer says that a deployment other than Permit SaaS must pass permitApiUrl.
const NO_ANSWER = /did not answer.*permitApiUrl/

const flush = () => new Promise(jest.requireActual("timers").setImmediate)

function post(msg: { origin: string; source: unknown; data: unknown }) {
  listeners.forEach((listener) => listener(msg))
}

function startLogin(elements: PermitElements, permitApiUrl?: string) {
  const login = elements.login({
    loginUrl: "https://app.example.com/login",
    loginMethod: LoginMethod.cookie,
    permitApiUrl,
  })
  const iframe = appended[0]
  expect(iframe).toBeDefined()
  return { login, iframe }
}

const SAAS_ORIGINS = [
  `https://${ENV_ID}.embed.api.permit.io`,
  `https://${ENV_ID}.embed.api.stg.permit.io`,
  "https://embed.api.permit.io",
  "https://embed.permit.io",
]

test.each(SAAS_ORIGINS)("the origin check accepts %s", (origin) => {
  expect(PERMIT_URL.test(origin)).toBe(true)
  expect(isPermitEmbedOrigin(origin)).toBe(true)
})

test("each dot of an accepted origin must be a dot", () => {
  for (const origin of SAAS_ORIGINS) {
    origin.split("").forEach((character, index) => {
      if (character !== ".") return
      for (const other of ["x", "-"]) {
        const changed = origin.slice(0, index) + other + origin.slice(index + 1)
        expect([changed, isPermitEmbedOrigin(changed)]).toEqual([changed, false])
      }
    })
  }
})

test.each([
  "https://example.com",
  `https://${ENV_ID}.embed.api.permit.io.example.com`,
  `http://${ENV_ID}.embed.api.permit.io`,
  "not a url",
])("the origin check refuses %s", (origin) => {
  expect(isPermitEmbedOrigin(origin)).toBe(false)
})

test.each([
  [`https://${ENV_ID}.embed.api.example.com`, "https://api.example.com", true],
  ["http://localhost:8000", "http://localhost:8000", true],
  ["http://127.0.0.1:8000", "http://127.0.0.1:8000", true],
  ["http://[::1]:8000", "http://[::1]:8000", true],
  [`https://${ENV_ID}.embed.10.0.0.1.example.com`, "https://10.0.0.1.example.com", true],
  ["https://10.0.0.1.example.com", "https://10.0.0.1.example.com", false],
  [`http://${ENV_ID}.embed.localhost:8000`, "http://localhost:8000", false],
  ["http://localhost:8001", "http://localhost:8000", false],
  ["javascript://x", "javascript:alert(1)", false],
  [`https://${ENV_ID}.embed.other.example.com`, "https://api.example.com", false],
  ["https://embed.api.example.com", "https://api.example.com", false],
  [`https://${ENV_ID}.embed.api.example.com:8443`, "https://api.example.com", false],
  [`https://${ENV_ID.slice(1)}.embed.api.example.com`, "https://api.example.com", false],
  [`http://${ENV_ID}.embed.api.example.com`, "https://api.example.com", false],
])("a deployment's own embed origin %s, for API %s: %s", (origin, permitApiUrl, accepted) => {
  expect(isPermitEmbedOrigin(origin, permitApiUrl)).toBe(accepted)
})

test("the origin check accepts a trusted origin exactly as given", () => {
  expect(isPermitEmbedOrigin("https://embed.example.com", undefined, ["https://embed.example.com"])).toBe(true)
  expect(isPermitEmbedOrigin("https://embed.example.com:8443", undefined, ["https://embed.example.com"])).toBe(false)
})

test("login takes an error answer from a trusted origin", async () => {
  const elements = new PermitElements()
  const login = elements.login({
    loginUrl: "https://app.example.com/login",
    loginMethod: LoginMethod.cookie,
    permitApiUrl: "https://api.example.com",
    trustedOrigins: ["https://embed.example.com"],
  })
  const iframe = appended[0]

  post({ origin: "https://embed.example.com", source: iframe.contentWindow, data: { success: false, error: "denied" } })

  await expect(login).rejects.toBe("denied")
})

test("login takes no success answer from a trusted origin", async () => {
  const elements = new PermitElements()
  const login = elements.login({
    loginUrl: "https://app.example.com/login",
    loginMethod: LoginMethod.cookie,
    permitApiUrl: "https://api.example.com",
    trustedOrigins: ["https://embed.example.com"],
  })
  const iframe = appended[0]
  const me = { actor: { env_id: ENV_ID } }

  post({ origin: "https://embed.example.com", source: iframe.contentWindow, data: { success: true, me } })
  expect(elements.isConnected).toBe(false)
  expect(elements.me).toBeUndefined()

  post({ origin: `https://${ENV_ID}.embed.api.example.com`, source: iframe.contentWindow, data: { success: true, me } })
  await expect(login).resolves.toBe(true)
})

test("login compares trustedOrigins entries as origins", async () => {
  const elements = new PermitElements()
  const login = elements.login({
    loginUrl: "https://app.example.com/login",
    loginMethod: LoginMethod.cookie,
    trustedOrigins: ["https://Embed.Example.com:443/error/"],
  })
  const iframe = appended[0]

  post({ origin: "https://embed.example.com", source: iframe.contentWindow, data: { success: false, error: "denied" } })

  await expect(login).rejects.toBe("denied")
})

test.each(["null", "embed.example.com", "javascript:alert(1)", "file:///tmp/x"])(
  "login refuses the trustedOrigins entry %p",
  async (entry) => {
    const elements = new PermitElements()

    await expect(
      elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie, trustedOrigins: [entry] }),
    ).rejects.toThrow(`trustedOrigins entry ${entry}`)
    expect(appended).toHaveLength(0)
    expect(listeners.size).toBe(0)
  },
)

test("a connected login still refuses an invalid trustedOrigins entry", async () => {
  const elements = new PermitElements()
  elements.isConnected = true

  await expect(
    elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie, trustedOrigins: ["null"] }),
  ).rejects.toThrow("trustedOrigins entry null")
})

test.each([
  ["api.example.com", false],
  ["api.example.com", true],
  ["//api.example.com", false],
  ["/\\api.example.com", false],
  ["ftp://api.example.com", false],
  // `/` and `/\t` would request `//v2/auth/...`, which leaves the page's origin.
  ["/", false],
  ["/\t", false],
  [null, false],
])("login refuses the permitApiUrl %p (connected: %p)", async (permitApiUrl, connected) => {
  const elements = new PermitElements()
  elements.isConnected = connected

  await expect(
    elements.login({
      loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie, permitApiUrl: permitApiUrl as string,
    }),
  ).rejects.toThrow("login: permitApiUrl must be an http(s) URL or a path on this page's origin")
  expect(appended).toHaveLength(0)
  expect(listeners.size).toBe(0)
})

test("login puts the tenant in its URL as one query value", async () => {
  const elements = new PermitElements()
  elements.login({ loginUrl: "https://app.example.com/login?a=1", loginMethod: LoginMethod.cookie, tenant: "t&x=1" })

  expect(appended[0].src).toBe("https://app.example.com/login?a=1&tenant=t%26x%3D1")
})

test("login resolves on the login iframe's answer", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const me = { actor: { env_id: ENV_ID } }

  post({ origin: `https://${ENV_ID}.embed.api.permit.io`, source: iframe.contentWindow, data: { success: true, me } })

  await expect(login).resolves.toBe(true)
  expect(elements.isConnected).toBe(true)
  expect(elements.me).toEqual(me)
  expect(listeners.size).toBe(0)
})

test("login accepts the embed origin of a deployment's own API URL", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "https://api.example.com")

  post({ origin: `https://${ENV_ID}.embed.api.example.com`, source: iframe.contentWindow, data: { success: true, me: {} } })

  await expect(login).resolves.toBe(true)
})

test("login ignores answers from another origin or another window, then times out", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const answer = { success: true, me: { actor: { env_id: ENV_ID } } }

  post({ origin: "https://example.com", source: iframe.contentWindow, data: answer })
  post({ origin: `https://${ENV_ID}.embed.api.permit.io`, source: {}, data: answer })
  expect(elements.isConnected).toBe(false)
  expect(elements.me).toBeUndefined()

  jest.advanceTimersByTime(3000)
  await expect(login).rejects.toThrow(NO_ANSWER)
  expect(elements.isConnected).toBe(false)
  expect(listeners.size).toBe(0)
  expect(appended).toHaveLength(0)
})

test("login ignores an error answer from another origin", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)

  post({ origin: "https://example.com", source: iframe.contentWindow, data: { success: false, error: "denied" } })
  expect(listeners.size).toBe(1)

  jest.advanceTimersByTime(3000)
  await expect(login).rejects.toThrow(NO_ANSWER)
})

test.each([
  ["no%20such%20user", "no such user"],
  ["50%off", "50%off"],
  [undefined, "Permit Elements login failed"],
  [42, "Permit Elements login failed"],
  [{ message: "denied" }, "Permit Elements login failed"],
])("login rejects with the login iframe's error (%p)", async (error, expected) => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)

  post({ origin: "https://embed.api.permit.io", source: iframe.contentWindow, data: { success: false, error } })

  await expect(login).rejects.toBe(expected)
  expect(listeners.size).toBe(0)
})

test("once its iframe is gone, login ignores a message without a source", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  iframe.remove()

  post({ origin: "https://embed.api.permit.io", source: null, data: { success: true, me: {} } })
  jest.advanceTimersByTime(3000)

  await expect(login).rejects.toThrow(NO_ANSWER)
  expect(elements.isConnected).toBe(false)
})

test("a failed login does not hold up the logout queued behind it", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const logout = elements.logout()

  post({ origin: "https://embed.api.permit.io", source: iframe.contentWindow, data: { success: false, error: "no" } })

  await expect(login).rejects.toBe("no")
  // No session to end: the login failed.
  await expect(logout).resolves.toBe(false)
})

test("the timeout still settles login when the page already removed the iframe", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  iframe.remove()

  jest.advanceTimersByTime(3000)

  await expect(login).rejects.toThrow(NO_ANSWER)
  expect(listeners.size).toBe(0)
})

test("a login that cannot add its iframe stops listening", async () => {
  ;(global as any).document.body.appendChild = () => {
    throw new TypeError("no body")
  }
  const elements = new PermitElements()

  await expect(
    elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie }),
  ).rejects.toThrow("no body")
  expect(listeners.size).toBe(0)
})

test("a second login waits for the first, then finds it connected", async () => {
  jest.spyOn(console, "info").mockImplementation(() => undefined)
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const second = elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie })

  expect(appended).toHaveLength(1)
  post({ origin: "https://embed.api.permit.io", source: iframe.contentWindow, data: { success: true, me: {} } })
  await expect(login).resolves.toBe(true)
  await expect(second).resolves.toBe(true)
  expect(appended).toHaveLength(1)
  expect(console.info).toHaveBeenCalledWith(expect.stringContaining("Already connected"))
})

test("login, logout and login again run in that order", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const logout = elements.logout()
  const again = elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie })

  post({
    origin: `https://${ENV_ID}.embed.api.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await expect(login).resolves.toBe(true)
  await flush()
  const logoutIframe = appended[appended.length - 1]
  expect(logoutIframe.src).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/logout`)
  logoutIframe.onload()
  await expect(logout).resolves.toBe(true)
  await flush()

  const secondLoginIframe = appended[appended.length - 1]
  expect(secondLoginIframe).not.toBe(iframe)
  post({ origin: "https://embed.api.permit.io", source: secondLoginIframe.contentWindow, data: { success: true, me: {} } })
  await expect(again).resolves.toBe(true)
  expect(elements.isConnected).toBe(true)
})

test("a login after the one before a running logout settles still waits for that logout", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const logout = elements.logout()
  post({
    origin: `https://${ENV_ID}.embed.api.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await expect(login).resolves.toBe(true)
  await flush()
  const logoutIframe = appended[appended.length - 1]
  expect(logoutIframe.src).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/logout`)

  const before = [...appended]
  const again = elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie })
  await flush()
  expect(appended).toEqual(before)

  logoutIframe.onload()
  await expect(logout).resolves.toBe(true)
  await flush()
  const againIframe = appended[appended.length - 1]
  expect(before).not.toContain(againIframe)
  post({ origin: "https://embed.api.permit.io", source: againIframe.contentWindow, data: { success: true, me: {} } })
  await expect(again).resolves.toBe(true)
})

test("login hands its caller a promise nothing else handles, so an ignored error is reported", async () => {
  // Node and browsers report a rejection as unhandled only if no handler was ever attached.
  const handled = new Set<unknown>()
  const then = Promise.prototype.then
  jest.spyOn(Promise.prototype, "then").mockImplementation(function (this: Promise<unknown>, onFulfilled, onRejected) {
    if (typeof onRejected === "function") handled.add(this)
    return then.call(this, onFulfilled, onRejected)
  })
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const logout = elements.logout()

  expect(handled.has(login)).toBe(false)
  expect(handled.has(logout)).toBe(false)
  post({ origin: "https://embed.api.permit.io", source: iframe.contentWindow, data: { success: false, error: "no" } })
  await expect(login).rejects.toBe("no")
  await expect(logout).resolves.toBe(false)
})

test("a login whose request stalls gives up, and the logout behind it runs", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined)
  jest.spyOn(ky, "post").mockImplementation((_url, options: any) => ({
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")))
    }),
  }) as never)
  const elements = new PermitElements()
  const login = elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.bearer, token: "t" })
  const logout = elements.logout("https://app.example.com/logout")
  await flush()
  expect(appended).toHaveLength(0)

  jest.advanceTimersByTime(10000)
  await expect(login).rejects.toThrow("login request took longer than 10 seconds")
  await flush()
  expect(appended.map((iframe) => iframe.src)).toEqual(["https://app.example.com/logout"])
  appended[0].onload()
  await expect(logout).resolves.toBe(true)
})

test("a bearer login sends its own token even when approve() is called in the same tick", async () => {
  const kyPost = jest.spyOn(ky, "post").mockImplementation(() => ({
    json: () => Promise.resolve({ url: "https://app.example.com/frame" }),
  }) as never)
  const elements = new PermitElements()

  const login = elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.bearer, token: "login-token" })
  const approve = elements.approve({ inviteCode: "code", email: "a@example.com", token: "approve-token", envId: ENV_ID })
  await approve
  await flush()

  const loginCall = kyPost.mock.calls.find(([url]) => url === "https://app.example.com/login") as any
  expect(loginCall[1].headers).toEqual({ Authorization: "Bearer login-token" })
  jest.advanceTimersByTime(3000)
  await expect(login).rejects.toThrow(NO_ANSWER)
})

test("a supportsPrivateBrowser login resolves once its request returns, stays disconnected, then sends the token", async () => {
  jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ url: "token-1" }) } as never)
  const element = makeElement()
  attach(element)
  ;(global as any).document.querySelector = () => element
  const elements = new PermitElements()

  await expect(elements.login({
    loginUrl: "https://app.example.com/login",
    loginMethod: LoginMethod.supportsPrivateBrowser,
    elementIframeUrl: "https://elements.example.com/",
  })).resolves.toBe(true)
  expect(elements.isConnected).toBe(false)
  expect(element.contentWindow.postMessage).not.toHaveBeenCalled()

  jest.advanceTimersByTime(400)
  expect(element.contentWindow.postMessage).toHaveBeenCalledWith(
    { type: "permitToken", permitToken: "token-1" }, "https://elements.example.com/",
  )
})

test("a login request ky refuses at once rejects with the login error and leaves no timer", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined)
  jest.spyOn(ky, "post").mockImplementation(() => {
    throw new TypeError("invalid header value")
  })
  const elements = new PermitElements()

  await expect(
    elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.bearer, token: "t" }),
  ).rejects.toThrow("Error while trying to login")
  expect(jest.getTimerCount()).toBe(0)
})

test("a login or logout that throws before it returns a promise does not hold up later calls", async () => {
  const elements = new PermitElements()
  ;(elements as any).startLogin = () => {
    throw new TypeError("bad arguments")
  }

  await expect(elements.login({ loginMethod: LoginMethod.cookie })).rejects.toThrow("bad arguments")
  await expect(elements.logout()).resolves.toBe(false)
})

test("a second logout waits for the first", async () => {
  const elements = new PermitElements()
  elements.me = { actor: { env_id: ENV_ID } }
  const first = elements.logout()
  let secondDone = false
  const second = elements.logout().then((result) => {
    secondDone = true
    return result
  })
  await flush()
  expect(secondDone).toBe(false)

  appended[0].onload()
  await expect(first).resolves.toBe(true)
  // The first ended the session.
  await expect(second).resolves.toBe(false)
})

test("a slow logout keeps its iframe until the request has loaded", async () => {
  const elements = new PermitElements()
  elements.me = { actor: { env_id: ENV_ID } }
  const logout = elements.logout()
  const iframe = appended[0]

  jest.advanceTimersByTime(10000)
  await expect(logout).resolves.toBe(true)
  expect(appended).toEqual([iframe])
  iframe.onload()
  expect(appended).toHaveLength(0)
})

test("logout loads the environment's logout URL and resolves once it has loaded", async () => {
  const elements = new PermitElements()
  elements.isConnected = true
  elements.me = { actor: { env_id: DASHED_ENV_ID.toUpperCase() } }

  const logout = elements.logout()
  await Promise.resolve()
  const iframe = appended[0]
  expect(iframe.src).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/logout`)
  iframe.onload()

  await expect(logout).resolves.toBe(true)
  expect(appended).toHaveLength(0)
  expect(elements.isConnected).toBe(false)
  expect(elements.me).toBeUndefined()
})

test("logout ends the session on the origin that answered the login", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "https://proxy.example.com")
  post({
    origin: `https://${ENV_ID}.embed.api.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await login

  const logout = elements.logout()
  await flush()
  const logoutIframe = appended[appended.length - 1]
  expect(logoutIframe.src).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/logout`)
  logoutIframe.onload()
  await expect(logout).resolves.toBe(true)
})

test("logout on a deployment reached on localhost uses its API origin", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "http://localhost:8000")
  post({ origin: "http://localhost:8000", source: iframe.contentWindow, data: { success: true, me: { actor: { env_id: ENV_ID } } } })
  await expect(login).resolves.toBe(true)

  const logout = elements.logout()
  await flush()
  const logoutIframe = appended[appended.length - 1]
  expect(logoutIframe.src).toBe("http://localhost:8000/v2/auth/logout")
  logoutIframe.onload()
  await expect(logout).resolves.toBe(true)
})

test("logout uses the API URL of the login", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "https://api.example.com")
  post({
    origin: `https://${ENV_ID}.embed.api.example.com`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await login

  const logout = elements.logout()
  await flush()
  const logoutIframe = appended[appended.length - 1]
  expect(logoutIframe.src).toBe(`https://${ENV_ID}.embed.api.example.com/v2/auth/logout`)
  logoutIframe.onload()
  await expect(logout).resolves.toBe(true)
})

test.each([undefined, { actor: {} }, { actor: { env_id: "example.com/x" } }])(
  "logout without a known session loads nothing and resolves false (%p)",
  async (me) => {
    const elements = new PermitElements()
    elements.isConnected = true
    elements.me = me

    await expect(elements.logout()).resolves.toBe(false)
    expect(appended).toHaveLength(0)
    expect(elements.isConnected).toBe(false)
    expect(elements.me).toBeUndefined()
  },
)

test("logout ends a session whose login answer had no environment id", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  post({ origin: `https://${ENV_ID}.embed.api.permit.io`, source: iframe.contentWindow, data: { success: true, me: {} } })
  await expect(login).resolves.toBe(true)

  const logout = elements.logout()
  await flush()
  const logoutIframe = appended[appended.length - 1]
  expect(logoutIframe.src).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/logout`)
  logoutIframe.onload()
  await expect(logout).resolves.toBe(true)
})

test("a logout after a login's logout has nothing to end", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  post({ origin: `https://${ENV_ID}.embed.api.permit.io`, source: iframe.contentWindow, data: { success: true, me: {} } })
  await expect(login).resolves.toBe(true)
  const first = elements.logout()
  await flush()
  appended[appended.length - 1].onload()
  await expect(first).resolves.toBe(true)

  const count = appended.length
  const second = elements.logout()
  await flush()
  expect(appended).toHaveLength(count)
  await expect(second).resolves.toBe(false)
})

test("a logout that cannot add its iframe rejects, and the next call still runs", async () => {
  ;(global as any).document.body.appendChild = () => {
    throw new TypeError("no body")
  }
  const elements = new PermitElements()
  elements.me = { actor: { env_id: ENV_ID } }

  await expect(elements.logout()).rejects.toThrow("no body")
  expect(jest.getTimerCount()).toBe(0)
  await expect(elements.logout()).resolves.toBe(false)
})

test("logout loads the logout URL it is given", async () => {
  const elements = new PermitElements()
  elements.isConnected = true
  elements.me = { actor: { env_id: ENV_ID } }

  let done = false
  const logout = elements.logout("https://app.example.com/logout").then((result) => {
    done = true
    return result
  })
  expect(appended.map((iframe) => iframe.src)).toEqual(["https://app.example.com/logout"])
  await flush()
  expect(done).toBe(false)

  appended[0].onload()
  await expect(logout).resolves.toBe(true)
  expect(elements.me).toBeUndefined()
  expect(elements.isConnected).toBe(false)
})

test("logout waits for a login in flight, then ends it", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const logout = elements.logout()

  post({
    origin: `https://${ENV_ID}.embed.api.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await expect(login).resolves.toBe(true)
  await flush()
  const logoutIframe = appended[appended.length - 1]
  expect(logoutIframe.src).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/logout`)
  logoutIframe.onload()

  await expect(logout).resolves.toBe(true)
  expect(elements.isConnected).toBe(false)
})

test("login waits for a logout still loading", async () => {
  const elements = new PermitElements()
  elements.me = { actor: { env_id: ENV_ID } }
  const logout = elements.logout()
  const logoutIframe = appended[0]

  const login = elements.login({ loginUrl: "https://app.example.com/login", loginMethod: LoginMethod.cookie })
  await flush()
  expect(appended).toEqual([logoutIframe])

  logoutIframe.onload()
  await logout
  await flush()
  expect(appended).toHaveLength(1)
  expect(appended[0]).not.toBe(logoutIframe)
  jest.advanceTimersByTime(3000)
  await expect(login).rejects.toThrow(NO_ANSWER)
})

test("logout with an invalid API URL loads nothing", async () => {
  const elements = new PermitElements()
  elements.permitApiUrl = "api.example.com"
  elements.me = { actor: { env_id: ENV_ID } }

  await expect(elements.logout()).resolves.toBe(false)
  expect(appended).toHaveLength(0)
})

test("approve refuses a permitApiUrl that is not a URL", async () => {
  const kyPost = refuseRequests()
  const elements = new PermitElements()

  await expect(
    elements.approve({
      inviteCode: "code", email: "a@example.com", token: "t", envId: ENV_ID, permitApiUrl: "not a url",
    }),
  ).rejects.toThrow("permitApiUrl must be an http(s) URL")
  expect(kyPost).not.toHaveBeenCalled()
})

test("approve posts to the embed origin of the login's deployment", async () => {
  const post = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()
  elements.permitApiUrl = "https://api.example.com"

  await expect(
    elements.approve({ inviteCode: "code-1", email: "a@example.com", token: "t", envId: DASHED_ENV_ID }),
  ).resolves.toEqual({ ok: true })
  expect(post.mock.calls[0][0]).toBe(
    `https://${ENV_ID}.embed.api.example.com/v2/auth/${ENV_ID}/user_invites/code-1/approve`,
  )
})

test("approve puts the invite code in its URL as one path segment", async () => {
  const post = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()

  await elements.approve({ inviteCode: "../../x?y#z", email: "a@example.com", token: "t", envId: ENV_ID })
  expect(post.mock.calls[0][0]).toBe(
    `https://${ENV_ID}.embed.api.permit.io/v2/auth/${ENV_ID}/user_invites/..%2F..%2Fx%3Fy%23z/approve`,
  )
})

test.each(["", ".", "..", undefined as unknown as string, 1 as unknown as string])("approve refuses the invite code %p", async (inviteCode) => {
  const post = refuseRequests()
  const elements = new PermitElements()

  await expect(
    elements.approve({ inviteCode, email: "a@example.com", token: "t", envId: ENV_ID }),
  ).rejects.toThrow("inviteCode must be an invite code")
  expect(post).not.toHaveBeenCalled()
})

test("approve without a login answer posts to the environment's embed origin", async () => {
  const kyPost = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()
  elements.me = { actor: { env_id: ENV_ID } }

  await elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: ENV_ID })
  expect(kyPost.mock.calls[0][0]).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/${ENV_ID}/user_invites/code/approve`)
})

test("approve after a login posts to the origin that answered it", async () => {
  const kyPost = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "https://proxy.example.com")
  post({
    origin: `https://${ENV_ID}.embed.api.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await login

  await elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: ENV_ID })
  expect(kyPost.mock.calls[0][0]).toBe(`https://${ENV_ID}.embed.api.permit.io/v2/auth/${ENV_ID}/user_invites/code/approve`)
})

test("after a login answered by the staging deployment it named, approve for another environment stays there", async () => {
  const kyPost = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "https://api.stg.permit.io")
  post({
    origin: `https://${ENV_ID}.embed.api.stg.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await login

  await elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: OTHER_ENV_ID })
  expect(kyPost.mock.calls[0][0]).toBe(
    `https://${OTHER_ENV_ID}.embed.api.stg.permit.io/v2/auth/${OTHER_ENV_ID}/user_invites/code/approve`,
  )
})

test("a frontendOnly login takes a permitApiUrl that is a path on the page's origin", async () => {
  const kyPost = jest.spyOn(ky, "post").mockImplementation(() => ({
    json: () => Promise.resolve({ redirect_url: "https://app.example.com/frame" }),
  }) as never)
  const elements = new PermitElements()
  const login = elements.login({
    loginMethod: LoginMethod.frontendOnly, tenant: "t", userJwt: "jwt", envId: ENV_ID, permitApiUrl: "/permit-api",
  })
  await flush()
  expect(kyPost.mock.calls[0][0]).toBe(`/permit-api/v2/auth/${ENV_ID}/elements_fe_login_as`)
  const iframe = appended[0]
  expect(iframe.src).toBe("https://app.example.com/frame")

  post({ origin: `https://${ENV_ID}.embed.api.permit.io`, source: iframe.contentWindow, data: { success: true, me: { actor: { env_id: ENV_ID } } } })
  await expect(login).resolves.toBe(true)
  await elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: OTHER_ENV_ID })
  expect(kyPost.mock.calls[1][0]).toBe(
    `https://${OTHER_ENV_ID}.embed.api.permit.io/v2/auth/${OTHER_ENV_ID}/user_invites/code/approve`,
  )
})

test.each([
  `https://${ENV_ID}.embed.api.stg.permit.io`,
  "https://embed.api.stg.permit.io",
  "https://embed.stg.permit.io",
  `https://${ENV_ID}.embed.stg.permit.io`,
])(
  "after a login answered by Permit staging from %s, approve for another environment posts to staging",
  async (origin) => {
    const kyPost = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
    const elements = new PermitElements()
    const { login, iframe } = startLogin(elements, "https://proxy.example.com")
    post({ origin, source: iframe.contentWindow, data: { success: true, me: { actor: { env_id: ENV_ID } } } })
    await login

    await elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: OTHER_ENV_ID })
    expect(kyPost.mock.calls[0][0]).toBe(
      `https://${OTHER_ENV_ID}.embed.api.stg.permit.io/v2/auth/${OTHER_ENV_ID}/user_invites/code/approve`,
    )
  },
)

test("approve after a login posts another environment's invite to the login's deployment", async () => {
  const kyPost = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "https://api.example.com")
  post({
    origin: `https://${ENV_ID}.embed.api.example.com`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await login

  await elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: OTHER_ENV_ID })
  expect(kyPost.mock.calls[0][0]).toBe(
    `https://${OTHER_ENV_ID}.embed.api.example.com/v2/auth/${OTHER_ENV_ID}/user_invites/code/approve`,
  )
})

test("after a login answered by Permit SaaS, approve for another environment posts to Permit SaaS", async () => {
  const kyPost = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements, "https://proxy.example.com")
  post({
    origin: `https://${ENV_ID}.embed.api.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await login

  await elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: OTHER_ENV_ID })
  expect(kyPost.mock.calls[0][0]).toBe(
    `https://${OTHER_ENV_ID}.embed.api.permit.io/v2/auth/${OTHER_ENV_ID}/user_invites/code/approve`,
  )
})

test("approve posts to the permitApiUrl it is given, even for the session's environment", async () => {
  const kyPost = jest.spyOn(ky, "post").mockReturnValue({ json: () => Promise.resolve({ ok: true }) } as never)
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  post({
    origin: `https://${ENV_ID}.embed.api.permit.io`,
    source: iframe.contentWindow,
    data: { success: true, me: { actor: { env_id: ENV_ID } } },
  })
  await login

  await elements.approve({
    inviteCode: "code", email: "a@example.com", token: "t", envId: ENV_ID, permitApiUrl: "https://api.example.com",
  })
  expect(kyPost.mock.calls[0][0]).toBe(`https://${ENV_ID}.embed.api.example.com/v2/auth/${ENV_ID}/user_invites/code/approve`)
})

test("after a login answer without an environment id, approve still refuses an invalid envId", async () => {
  const kyPost = refuseRequests()
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  post({ origin: `https://${ENV_ID}.embed.api.permit.io`, source: iframe.contentWindow, data: { success: true, me: {} } })
  await login

  await expect(
    elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: "example.com/x?" }),
  ).rejects.toThrow("envId must be a Permit environment id")
  expect(kyPost).not.toHaveBeenCalled()
})

const NOT_ENV_IDS = [`${ENV_ID}.example.com`, `x${ENV_ID}`, `${ENV_ID}0`, `${ENV_ID}/x`, ENV_ID.slice(1)]

test.each(NOT_ENV_IDS)("approve refuses the envId %p", async (envId) => {
  const kyPost = refuseRequests()
  const elements = new PermitElements()

  await expect(
    elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId }),
  ).rejects.toThrow("envId must be a Permit environment id")
  expect(kyPost).not.toHaveBeenCalled()
})

test.each(NOT_ENV_IDS)("logout loads nothing for the environment id %p", async (envId) => {
  const elements = new PermitElements()
  elements.me = { actor: { env_id: envId } }

  await expect(elements.logout()).resolves.toBe(false)
  expect(appended).toHaveLength(0)
})

test("approve refuses a permitApiUrl that is not http or https", async () => {
  const kyPost = refuseRequests()
  const elements = new PermitElements()

  await expect(
    elements.approve({
      inviteCode: "code", email: "a@example.com", token: "t", envId: ENV_ID, permitApiUrl: "ftp://api.example.com",
    }),
  ).rejects.toThrow("permitApiUrl must be an http(s) URL")
  expect(kyPost).not.toHaveBeenCalled()
})

test("approve refuses an envId that is not an environment id", async () => {
  const kyPost = refuseRequests()
  const elements = new PermitElements()

  await expect(
    elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: "example.com/x?" }),
  ).rejects.toThrow("envId must be a Permit environment id")
  expect(kyPost).not.toHaveBeenCalled()
})

test("sendTokenToIframe stops only on the element iframe's confirmation", () => {
  const iframe = makeElement()
  attach(iframe)
  ;(global as any).document.querySelector = () => iframe
  const elementIframeUrl = "https://elements.example.com/"

  sendTokenToIframe("token", elementIframeUrl)
  jest.advanceTimersByTime(400)
  expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(1)

  post({ origin: "https://example.com", source: {}, data: { type: "permitTokenReceived" } })
  jest.advanceTimersByTime(400)
  expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(2)

  post({ origin: "https://elements.example.com", source: iframe.contentWindow, data: { type: "permitTokenReceived" } })
  jest.advanceTimersByTime(4000)
  expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(2)
})

test("sendTokenToIframe stops listening once it gives up", () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined)
  const iframe = makeElement()
  attach(iframe)
  ;(global as any).document.querySelector = () => iframe

  sendTokenToIframe("token", "https://elements.example.com/")
  jest.advanceTimersByTime(400 * 21)

  expect(listeners.size).toBe(0)
})
