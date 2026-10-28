import ky from "ky"

import { PermitElements, PERMIT_URL, isPermitEmbedOrigin } from "../src/elements"
import { sendTokenToIframe } from "../src/sendToken"
import { LoginMethod } from "../src/types"

const ENV_ID = "0123456789abcdef0123456789abcdef"
const DASHED_ENV_ID = "01234567-89ab-cdef-0123-456789abcdef"

// A minimal window/document: enough for login(), logout() and sendTokenToIframe()
// under the node environment.
let listeners: Set<(msg: any) => void>
let appended: any[]

function makeElement(): any {
  const element: any = { style: {}, contentWindow: { postMessage: jest.fn() } }
  element.remove = () => {
    const index = appended.indexOf(element)
    if (index >= 0) appended.splice(index, 1)
  }
  return element
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
    body: { appendChild: (element: any) => appended.push(element) },
  }
  jest.useFakeTimers()
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
  delete (global as any).window
  delete (global as any).document
})

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
  [`http://${ENV_ID}.embed.localhost:8000`, "http://localhost:8000", true],
  [`https://${ENV_ID}.embed.other.example.com`, "https://api.example.com", false],
  ["https://embed.api.example.com", "https://api.example.com", false],
  [`https://${ENV_ID}.embed.api.example.com:8443`, "https://api.example.com", false],
  [`http://${ENV_ID}.embed.api.example.com`, "https://api.example.com", false],
])("a deployment's own embed origin %s, for API %s: %s", (origin, permitApiUrl, accepted) => {
  expect(isPermitEmbedOrigin(origin, permitApiUrl)).toBe(accepted)
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
  await expect(login).resolves.toBe(false)
  expect(elements.isConnected).toBe(false)
  expect(listeners.size).toBe(0)
  expect(appended).toHaveLength(0)
})

test.each([
  ["no%20such%20user", "no such user"],
  ["50%off", "50%off"],
  [undefined, "Permit Elements login failed"],
])("login rejects with the login iframe's error (%p)", async (error, expected) => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)

  post({ origin: "https://embed.api.permit.io", source: iframe.contentWindow, data: { success: false, error } })

  await expect(login).rejects.toBe(expected)
  expect(listeners.size).toBe(0)
})

test("the timeout still settles login when the page already removed the iframe", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  iframe.remove()

  jest.advanceTimersByTime(3000)

  await expect(login).resolves.toBe(false)
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
    origin: "https://embed.api.permit.io",
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
  await expect(second).resolves.toBe(true)
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
  "logout without an environment id loads nothing (%p)",
  async (me) => {
    const elements = new PermitElements()
    elements.isConnected = true
    elements.me = me

    await expect(elements.logout()).resolves.toBe(true)
    expect(appended).toHaveLength(0)
    expect(elements.isConnected).toBe(false)
  },
)

test("logout waits for a login in flight, then ends it", async () => {
  const elements = new PermitElements()
  const { login, iframe } = startLogin(elements)
  const logout = elements.logout()

  post({
    origin: "https://embed.api.permit.io",
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
  await Promise.resolve()
  expect(appended).toEqual([logoutIframe])

  logoutIframe.onload()
  await logout
  await flush()
  expect(appended).toHaveLength(1)
  expect(appended[0]).not.toBe(logoutIframe)
  jest.advanceTimersByTime(3000)
  await expect(login).resolves.toBe(false)
})

test("logout with an invalid API URL loads nothing", async () => {
  const elements = new PermitElements()
  elements.permitApiUrl = "api.example.com"
  elements.me = { actor: { env_id: ENV_ID } }

  await expect(elements.logout()).resolves.toBe(true)
  expect(appended).toHaveLength(0)
})

test("approve posts to the given deployment", async () => {
  const elements = new PermitElements()

  await expect(
    elements.approve({
      inviteCode: "code", email: "a@example.com", token: "t", envId: ENV_ID, permitApiUrl: "not a url",
    }),
  ).rejects.toThrow("permitApiUrl a URL")
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

test("approve refuses an envId that is not an environment id", async () => {
  const elements = new PermitElements()

  await expect(
    elements.approve({ inviteCode: "code", email: "a@example.com", token: "t", envId: "example.com/x?" }),
  ).rejects.toThrow("envId must be a Permit environment id")
})

test("sendTokenToIframe stops only on the element iframe's confirmation", () => {
  const iframe = makeElement()
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
  ;(global as any).document.querySelector = () => iframe

  sendTokenToIframe("token", "https://elements.example.com/")
  jest.advanceTimersByTime(400 * 21)

  expect(listeners.size).toBe(0)
})
