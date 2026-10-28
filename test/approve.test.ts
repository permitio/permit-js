import { HTTPError, TimeoutError } from "ky"
import { ApproveError, PermitElements } from "../src/elements"

// approve() touches no window or document; the network is stubbed at fetch, so ky runs for real.
const ENV_ID = "0123456789abcdef0123456789abcdef"
const TOKEN = "secret-token"
const PREFIX = "Error while trying to approve invite"
const APPROVE_URL =
  `https://${ENV_ID}.embed.api.permit.io/v2/auth/${ENV_ID}/user_invites/invite-1/approve`
const JSON_TYPE = { "content-type": "application/json" }
// The PER-16765 refusal, as the backend's approve route words it.
const NOT_THE_INVITEE =
  "This token cannot approve this invite: it must carry the invitee's user key or verified email"
// ServiceException.get_details() as the backend's standard error handler renders it, for the
// approve route's unknown environment (404) and its refused user_key_claim (400).
const STANDARD_NOT_FOUND = {
  id: "0b6c5d0e8f6a4c3e9b1d2a7f4e5c6d8a",
  title: "We could not find the requested object/s",
  error_code: "NOT_FOUND",
  message:
    "The requested data could not be found, we could not find 'Environment' with the given " +
    `filters: env_id='${ENV_ID}'. Please try again with different filters.\nIf you are sure ` +
    "there is an object with the given filters, contact our support on Slack for further guidance.",
  additional_info: { filters: { env_id: ENV_ID } },
}
const STANDARD_USER_KEY_CLAIM = {
  id: "5e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b",
  title: "The request was invalid",
  error_code: "INVALID_INPUT",
  message:
    "We are sorry for the inconvenience, The request's user_key_claim does not match the claim " +
    "this environment's JWKS config names as the user key, 'sub'. Omit user_key_claim from the " +
    "request. To key users on another claim, set 'user_key_claim' in the environment's JWKS " +
    "config.\nIf the issue keeps happening, contact our support on Slack for further guidance.",
}

let consoleError: jest.SpyInstance

beforeEach(() => {
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_TYPE })
}

function textResponse(status: number, text: string, contentType = "text/plain"): Response {
  return new Response(text, { status, headers: { "content-type": contentType } })
}

// A body whose stream errors after its first chunk, as a dropped connection does.
function brokenBodyResponse(status: number): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"detail": "par'))
      controller.error(new Error("connection reset"))
    },
  })
  return new Response(body, { status, headers: JSON_TYPE })
}

// A fresh Response per call, as a real fetch gives.
function stubFetch(respond: (request: Request) => Response | Promise<Response>) {
  return jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) => respond(input as Request))
}

function rejectFetch(error: unknown) {
  return jest.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(error))
}

function approve(overrides: Record<string, unknown> = {}) {
  return new PermitElements().approve({
    inviteCode: "invite-1",
    email: "invitee@example.com",
    token: TOKEN,
    envId: ENV_ID,
    ...overrides,
  })
}

// The rejection reason in a box: returned bare from an async function, a reason that is itself a
// promise would be adopted, hiding it.
function caught(promise: Promise<unknown>): Promise<{ error: any }> {
  return promise.then(
    () => {
      throw new Error("expected approve() to reject")
    },
    (error) => ({ error }),
  )
}

function expectApproveError(
  error: any,
  expected: { message: string; status?: number; detail?: unknown },
) {
  expect(error).toBeInstanceOf(ApproveError)
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toBe(expected.message)
  expect(error.message.startsWith(PREFIX)).toBe(true)
  expect(error.status).toBe(expected.status)
  expect(error.detail).toEqual(expected.detail)
}

function expectNoToken(error: any) {
  // Any other own property (a `cause`, the request) could carry the token.
  expect(Object.getOwnPropertyNames(error).sort()).toEqual([
    "detail", "message", "name", "stack", "status",
  ])
  expect(error.message).not.toContain(TOKEN)
  expect(error.stack).not.toContain(TOKEN)
  expect(JSON.stringify(error)).not.toContain(TOKEN)
}

// A real macrotask: every pending microtask runs, even while timers are fake.
const flush = () => new Promise(jest.requireActual("timers").setImmediate)

const ONLY_TIMEOUTS_FAKE = {
  doNotFake: [
    "Date", "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame",
    "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate",
    "clearImmediate", "setInterval", "clearInterval",
  ] as FakeableAPI[],
}

describe("A. success", () => {
  test("A1 a 200 resolves to its JSON body, from the same request as before", async () => {
    const body = {
      key: "user-1",
      email: "invitee@example.com",
      roles: [{ role: "viewer", tenant: "t1" }],
    }
    // Read while the request is live: a later ky may cancel its body once the call settles.
    let sent: unknown
    const fetchMock = stubFetch(async (request) => {
      sent = await request.clone().json()
      return jsonResponse(200, body)
    })

    await expect(approve()).resolves.toEqual(body)

    expect(consoleError).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0][0] as Request
    expect(request.url).toBe(APPROVE_URL)
    expect(request.method).toBe("POST")
    expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`)
    expect(request.headers.get("content-type")).toBe("application/json")
    expect(request.credentials).toBe("include")
    expect(sent).toEqual({ email: "invitee@example.com", user_key_claim: "sub", attributes: {} })
  })

  test.each([
    { name: "a 200 with an empty body", respond: () => textResponse(200, "", "application/json") },
    { name: "a 204", respond: () => new Response(null, { status: 204 }) },
  ])("A2 $name resolves to an empty string", async ({ respond }) => {
    stubFetch(respond)

    await expect(approve()).resolves.toBe("")
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe("B. the backend answered with an error status", () => {
  test.each([
    { name: "a token that is not the invitee's", status: 403, detail: NOT_THE_INVITEE },
    {
      name: "an invite already approved",
      status: 400,
      detail: "User invite invite-1 is already approved",
    },
    {
      name: "an email that is not the invite's",
      status: 400,
      detail:
        "Email: other@example.com does not match the email of the invite: invitee@example.com",
    },
    { name: "an invalid token", status: 401, detail: "Invalid token." },
  ])("B1 a $status for $name reports its status and detail", async ({ status, detail }) => {
    const fetchMock = stubFetch(() => jsonResponse(status, { detail }))

    const { error } = await caught(approve())

    expectApproveError(error, { message: `${PREFIX} (${status}): ${detail}`, status, detail })
    expect(consoleError).toHaveBeenCalledTimes(1)
    const logged = consoleError.mock.calls[0][0]
    expect(logged).toBeInstanceOf(HTTPError)
    expect(logged.response.status).toBe(status)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("B1 the PER-16765 refusal reads in full", async () => {
    stubFetch(() => jsonResponse(403, { detail: NOT_THE_INVITEE }))

    const { error } = await caught(approve())

    expect(error.message).toBe(
      "Error while trying to approve invite (403): This token cannot approve this invite: " +
        "it must carry the invitee's user key or verified email",
    )
  })

  test("B2 a 422's validation array is reported as JSON", async () => {
    const detail = [
      {
        loc: ["body", "email"],
        msg: "value is not a valid email address",
        type: "value_error.email",
      },
    ]
    // The backend's 422 also echoes the request body.
    const body = { email: "not-an-email", user_key_claim: "sub", attributes: {} }
    stubFetch(() => jsonResponse(422, { detail, body }))

    const { error } = await caught(approve({ email: "not-an-email" }))

    expectApproveError(error, {
      message:
        'Error while trying to approve invite (422): [{"loc":["body","email"],' +
        '"msg":"value is not a valid email address","type":"value_error.email"}]',
      status: 422,
      detail,
    })
  })

  test.each([
    { detail: { code: "x" }, shown: '{"code":"x"}' },
    { detail: 0, shown: "0" },
    { detail: false, shown: "false" },
    { detail: [], shown: "[]" },
    { detail: { a: { b: [1, 2] } }, shown: '{"a":{"b":[1,2]}}' },
  ])("B3 a detail of $shown is shown as JSON", async ({ detail, shown }) => {
    stubFetch(() => jsonResponse(400, { detail }))

    const { error } = await caught(approve())

    expectApproveError(error, { message: `${PREFIX} (400): ${shown}`, status: 400, detail })
  })

  test("B3 a detail nested too deep to render gives the status alone", async () => {
    // The body parses, but JSON.stringify runs out of stack on it: V8 renders objects with
    // index keys recursively, even where it renders plain arrays and objects iteratively.
    const depth = 100000
    const nested = `${'{"0":'.repeat(depth)}1${"}".repeat(depth)}`
    stubFetch(() => textResponse(400, `{"detail":${nested}}`, "application/json"))

    const { error } = await caught(approve())

    expect(error).toBeInstanceOf(ApproveError)
    expect(error.message).toBe(`${PREFIX} (400)`)
    expect(error.status).toBe(400)
    let levels = 0
    for (let item = error.detail; typeof item === "object" && item !== null; item = item["0"]) {
      levels += 1
    }
    expect(levels).toBe(depth)
  })

  test.each([
    {
      name: "JSON without detail or message",
      status: 400,
      respond: () => jsonResponse(400, { error: "x" }),
    },
    {
      name: "a null detail",
      status: 400,
      detail: null,
      respond: () => jsonResponse(400, { detail: null }),
    },
    {
      name: "an empty detail",
      status: 400,
      detail: "",
      respond: () => jsonResponse(400, { detail: "" }),
    },
    { name: "a text/plain body", status: 403, respond: () => textResponse(403, "Forbidden") },
    {
      name: "an HTML 502",
      status: 502,
      respond: () => textResponse(502, "<html><body>502 Bad Gateway</body></html>", "text/html"),
    },
    { name: "an empty 401", status: 401, respond: () => new Response("", { status: 401 }) },
    {
      name: "truncated JSON",
      status: 400,
      respond: () => textResponse(400, '{"detail": "x', "application/json"),
    },
    { name: "JSON null", status: 400, respond: () => jsonResponse(400, null) },
    { name: "a JSON array", status: 400, respond: () => jsonResponse(400, []) },
    { name: "a JSON string", status: 400, respond: () => jsonResponse(400, "text") },
    { name: "a JSON number", status: 400, respond: () => jsonResponse(400, 42) },
    { name: "a JSON boolean", status: 400, respond: () => jsonResponse(400, true) },
  ])("B4 $name gives the status alone", async ({ status, detail, respond }) => {
    stubFetch(respond)

    const { error } = await caught(approve())

    expectApproveError(error, { message: `${PREFIX} (${status})`, status, detail })
  })

  test("B5 a JSON body is read whatever its content type", async () => {
    stubFetch(() => textResponse(400, '{"detail":"x"}'))

    const { error } = await caught(approve())

    expectApproveError(error, { message: `${PREFIX} (400): x`, status: 400, detail: "x" })
  })

  test("B6 a body that fails mid-read gives the status alone", async () => {
    stubFetch(() => brokenBodyResponse(500))

    const { error } = await caught(approve())

    expectApproveError(error, { message: `${PREFIX} (500)`, status: 500 })
  })

  test.each([
    { status: 404, body: STANDARD_NOT_FOUND },
    { status: 400, body: STANDARD_USER_KEY_CLAIM },
  ])("B7 the backend's standard $status body reports its message", async ({ status, body }) => {
    stubFetch(() => jsonResponse(status, body))

    const { error } = await caught(approve())

    expectApproveError(error, {
      message: `${PREFIX} (${status}): ${body.message}`,
      status,
      detail: body.message,
    })
  })

  test("B8 detail wins over message", async () => {
    stubFetch(() => jsonResponse(400, { detail: "from detail", message: "from message" }))

    const { error } = await caught(approve())

    expectApproveError(error, {
      message: `${PREFIX} (400): from detail`,
      status: 400,
      detail: "from detail",
    })
  })

  test("B8 a message that is not a string gives the status alone", async () => {
    stubFetch(() => jsonResponse(400, { message: 5 }))

    const { error } = await caught(approve())

    expectApproveError(error, { message: `${PREFIX} (400)`, status: 400 })
  })

  test("B9 a body that never finishes is given up on after 2 seconds", async () => {
    jest.useFakeTimers(ONLY_TIMEOUTS_FAKE)
    stubFetch(() => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"detail": '))
        },
      })
      return new Response(body, { status: 403, headers: JSON_TYPE })
    })
    let settled = false
    const result = caught(approve()).finally(() => {
      settled = true
    })

    await flush()
    // Logged, so the body read and its timer have started; ky's own timer is cleared.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
    jest.advanceTimersByTime(1999)
    await flush()
    expect(settled).toBe(false)

    jest.advanceTimersByTime(1)
    await flush()
    expect(settled).toBe(true)
    expectApproveError((await result).error, { message: `${PREFIX} (403)`, status: 403 })
  })

  test.each([
    { name: "a JSON body", status: 403, respond: () => jsonResponse(403, { detail: "x" }) },
    { name: "a body that is not JSON", status: 403, respond: () => textResponse(403, "Forbidden") },
    { name: "a body that fails mid-read", status: 500, respond: () => brokenBodyResponse(500) },
  ])("B9 $name, read in time, leaves no timer behind", async ({ status, respond }) => {
    jest.useFakeTimers(ONLY_TIMEOUTS_FAKE)
    stubFetch(respond)

    const { error } = await caught(approve())

    expect(error.status).toBe(status)
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe("C. no answer from the backend", () => {
  test.each([
    { name: "a browser network failure", error: new TypeError("Failed to fetch") },
    { name: "a Node network failure", error: new TypeError("fetch failed") },
  ])("C1 $name keeps the old message", async ({ error: failure }) => {
    rejectFetch(failure)

    const { error } = await caught(approve())

    expectApproveError(error, { message: PREFIX })
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toBe(failure)
  })

  test.each([
    { name: "an abort", error: new DOMException("This operation was aborted", "AbortError") },
    { name: "a string", error: "boom" },
    { name: "undefined", error: undefined },
  ])("C2 a rejection with $name keeps the old message", async ({ error: failure }) => {
    rejectFetch(failure)

    const { error } = await caught(approve())

    expectApproveError(error, { message: PREFIX })
  })

  test("C3 a request that times out keeps the old message", async () => {
    jest.useFakeTimers(ONLY_TIMEOUTS_FAKE)
    const fetchMock = stubFetch(() => new Promise<Response>(() => undefined))
    let settled = false
    const result = caught(approve()).finally(() => {
      settled = true
    })

    await flush()
    // ky starts its timer before calling fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(9999)
    await flush()
    expect(settled).toBe(false)

    jest.advanceTimersByTime(1)
    await flush()
    expect(settled).toBe(true)
    expectApproveError((await result).error, { message: PREFIX })
    expect(consoleError.mock.calls[0][0]).toBeInstanceOf(TimeoutError)
  })

  test.each([
    { name: "a token with a line break", overrides: { token: "a\nb" } },
    {
      name: "circular attributes",
      overrides: {
        attributes: (() => {
          const attributes: Record<string, unknown> = {}
          attributes.self = attributes
          return attributes
        })(),
      },
    },
  ])("C4 a request ky cannot build ($name) rejects with an ApproveError", async ({ overrides }) => {
    const fetchMock = stubFetch(() => jsonResponse(200, {}))

    const { error } = await caught(approve(overrides))

    expectApproveError(error, { message: PREFIX })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledTimes(1)
  })
})

describe("D. a success answer whose body is not JSON", () => {
  test.each([
    { name: "HTML", respond: () => textResponse(200, "<html></html>", "text/html") },
    { name: "truncated JSON", respond: () => textResponse(200, '{"key": "us', "application/json") },
  ])("D1 a 200 with $name keeps the old message, with no status", async ({ respond }) => {
    stubFetch(respond)

    const { error } = await caught(approve())

    expectApproveError(error, { message: PREFIX })
    expect(consoleError.mock.calls[0][0].name).toBe("SyntaxError")
  })
})

describe("E. contract", () => {
  const html = () => textResponse(502, "<html></html>", "text/html")
  const htmlSuccess = () => textResponse(200, "<html></html>", "text/html")

  test.each([
    { name: "a 403", stub: () => stubFetch(() => jsonResponse(403, { detail: NOT_THE_INVITEE })) },
    { name: "an HTML 502", stub: () => stubFetch(html) },
    { name: "a network failure", stub: () => rejectFetch(new TypeError("Failed to fetch")) },
    { name: "a 200 that is not JSON", stub: () => stubFetch(htmlSuccess) },
  ])("E1 $name keeps the old message as a prefix", async ({ stub }) => {
    stub()

    const { error } = await caught(approve())

    expect(error.message.startsWith(PREFIX)).toBe(true)
  })

  test("E1 a network failure's message is exactly the old one", async () => {
    rejectFetch(new TypeError("Failed to fetch"))

    const { error } = await caught(approve())

    expect(error.message).toBe("Error while trying to approve invite")
  })

  test("E2 the error is named ApproveError", async () => {
    stubFetch(() => jsonResponse(403, { detail: NOT_THE_INVITEE }))

    const { error } = await caught(approve())

    expect(error.name).toBe("ApproveError")
    expect(String(error).startsWith("ApproveError: Error while trying")).toBe(true)
  })

  test.each([
    { name: "a 403", stub: () => stubFetch(() => jsonResponse(403, { detail: NOT_THE_INVITEE })) },
    { name: "a network failure", stub: () => rejectFetch(new TypeError("Failed to fetch")) },
  ])("E3 after $name the error carries neither the token nor the request", async ({ stub }) => {
    const fetchMock = stub()

    const { error } = await caught(approve())

    const sent = fetchMock.mock.calls[0][0] as Request
    expect(sent.headers.get("authorization")).toBe(`Bearer ${TOKEN}`)
    expectNoToken(error)
  })

  test("E3 a token that cannot be sent stays out of the error", async () => {
    const token = `${TOKEN}\nx`
    stubFetch(() => jsonResponse(200, {}))

    const { error } = await caught(approve({ token }))

    // The error approve() caught names the header value, token included.
    expect(String(consoleError.mock.calls[0][0].message)).toContain(TOKEN)
    expectNoToken(error)
  })

  test.each([
    { name: "an API URL that is not a URL", overrides: { permitApiUrl: "not a url" } },
    { name: "an env id with a host in it", overrides: { envId: "example.com/x?" } },
    { name: "an empty env id", overrides: { envId: "" } },
    { name: "an env id of 31 hex digits", overrides: { envId: ENV_ID.slice(1) } },
  ])("E4 $name is refused before any request, with a plain Error", async ({ overrides }) => {
    const fetchMock = stubFetch(() => jsonResponse(200, {}))

    const { error } = await caught(approve(overrides))

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ApproveError)
    expect(error.message).toBe(
      "approve: envId must be a Permit environment id, and permitApiUrl an http(s) URL",
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
