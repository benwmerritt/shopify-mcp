# MCP 2026-07-28 and TypeScript SDK v2 research

Research date: 2026-09-19. Sources are the official specification, official SDK documentation, and npm metadata. SDK `main` documentation can change; installed dependencies and connection tests determine the behavior shipped.

## Availability and runtime

The npm registry reports stable `2.0.0` releases for `@modelcontextprotocol/server` and `@modelcontextprotocol/server-legacy`. The server depends on `@modelcontextprotocol/core` `2.0.0` and Zod `^4.2.0`. Both server packages declare Node `>=20`; v1 `@modelcontextprotocol/sdk` latest is `1.30.0`, declaring Node `>=18`. Checked with `npm view ... version dist-tags engines dependencies exports --json`.

Sources: [server metadata](https://registry.npmjs.org/@modelcontextprotocol/server/2.0.0), [legacy bridge metadata](https://registry.npmjs.org/@modelcontextprotocol/server-legacy/2.0.0), [v1 metadata](https://registry.npmjs.org/@modelcontextprotocol/sdk/1.30.0).

This repository previously declared Node `>=18.0.0`. A supported v2 upgrade requires raising the runtime minimum to Node 20 and documenting that Node 18 deployments must upgrade their runtime or retain the previous release. Protocol backward compatibility does not imply Node 18 runtime compatibility. The SDK ships ESM and CommonJS builds, including native CommonJS exports suitable for Jest. [SDK packaging guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md#packaging--runtime)

## Relevant protocol changes

The 2026 revision removes the initialization handshake and protocol-level HTTP sessions. Each request carries its protocol version and client capabilities in `_meta`; `server/discover` advertises supported versions, capabilities, and identity. Client identity is recommended per request. Results require `resultType`; clients must treat older responses lacking it as complete. Cacheable results require `ttlMs` and `cacheScope`. [Specification changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

Standalone HTTP GET notification streams become `subscriptions/listen`; SSE replay/resumability is removed. Server-initiated requests become multi-round-trip `input_required` results. Roots, sampling, and logging are deprecated; experimental tasks move to an extension. These features need not be newly advertised by this tool-only server. [Specification changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

Modern HTTP request POSTs require `MCP-Protocol-Version` and `Mcp-Method`; named methods also require the corresponding `Mcp-Name`. These must agree with the body. Parameters annotated with `x-mcp-header` require matching `Mcp-Param-*` headers. Missing or conflicting required headers produce HTTP 400 with JSON-RPC `-32020`. The SDK validates these on the modern handler, emits required result fields, and defaults cache hints to `ttlMs: 0`, `cacheScope: 'private'`. Older responses omit the new fields. [Protocol migration: headers and caching](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md#mcp-param--and-standard-headers-sep-2243)

## Serving both old and new clients

Upgrading imports alone does **not** enable 2026: a directly connected `McpServer` and `StdioServerTransport` continue to speak the older era. Use `serveStdio(factory)` from `@modelcontextprotocol/server/stdio`. Its opening exchange selects the era, and its default serves both old initialization-based connections and modern connections through the same tool factory. Its returned handle owns shutdown. [Stdio serving guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md), [protocol migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md#server-over-stdio--long-lived-connections-servestdio)

For HTTP, use `createMcpHandler(factory)` from `@modelcontextprotocol/server`, wrapped with `toNodeHandler(handler)` from `@modelcontextprotocol/node`. Default `legacy: 'stateless'` accepts modern per-request traffic and legacy initialization-based Streamable HTTP. Applications already using sessionful Streamable HTTP must preserve their legacy handler separately; the default fallback has different session semantics. [HTTP migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md#server-over-http-createmcphandler)

The repository's existing remote transport is HTTP+SSE: GET `/mcp` opens an event stream and POST `/messages` submits session messages. Preserve these routes and add POST `/mcp` for Streamable HTTP. SDK v2 removed `SSEServerTransport` from its main package but supplies a frozen bridge at `@modelcontextprotocol/server-legacy/sse`. This is a compatibility dependency, not the modern transport. The specification allows old SSE/POST endpoints alongside the new endpoint. [SDK transport migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md#imports--transports), [specification compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#backwards-compatibility)

The SDK documentation groups revisions from 2024-10-07 through 2025-11-25 as legacy. A v2 client defaults to legacy mode; tests must use `versionNegotiation: { mode: { pin: '2026-07-28' } }` to prove modern support. `mode: 'auto'` probes discovery and may fall back to legacy. Only using a default v2 client does not test modern connections. SDK stdio probing can launch a disposable sibling process, which matters for test fixtures and startup side effects. [Protocol versions](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md)

## Application API migration

- Import `McpServer` and shared public types from `@modelcontextprotocol/server`; import stdio entries through `/stdio`.
- Replace removed variadic `.tool()` registrations with `registerTool(name, config, handler)`.
- Use full schemas such as `z.object({...})`. V2 requires Standard Schema support and Zod v3 is unsupported. Zod `^4.2.0` is the documented path; deprecated raw-shape overloads remain but should not be the migration target.
- A tool with an input schema receives parsed arguments then context. Without a schema it receives context first; preserve no-argument handler semantics.
- Low-level handler registrations take method strings instead of schema constants. `McpError` becomes `ProtocolError`; `RequestHandlerExtra` becomes nested `ServerContext`. Apply these only where used.

Source: [SDK v1-to-v2 upgrade guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md).

## Security and verification

`createMcpHandler` checks no API token, Host, or Origin. Mount authentication and request guards before it. The specification requires checking a supplied Origin and returning 403 when invalid; localhost deployments should bind loopback and guard against DNS rebinding. The new endpoint must retain existing API key checks, upload protections, Shopify credential handling, and scope restrictions. Public reverse-proxy setups need appropriate host/origin configuration, not an unconditional localhost allowlist. [HTTP security guidance](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md#validate-host-and-origin-in-front-of-it), [transport security requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#security-warning)

Verification criteria against the built entry point, with mocked Shopify responses:

1. A v1 client initializes, lists the existing tools, and calls a representative tool over stdio and the original SSE routes.
2. A pinned modern client or raw 2026 exchange discovers, lists, and calls tools over stdio and POST `/mcp`.
3. A legacy Streamable HTTP client initializes and calls tools at POST `/mcp`.
4. Tool names, descriptions, schemas, annotations, validation, pagination, and Shopify request construction retain intended behavior after Zod and registration changes.
5. Unauthenticated discovery/tool calls remain rejected; invalid Origin and modern header disagreement cannot reach handlers.
6. Existing OAuth/client-credentials renewal, upload protections, and application tests pass.

These are criteria, not claims that tests have run. The PR must report executed checks and distinguish protocol compatibility from the Node 20 requirement and frozen SSE bridge limitation.
