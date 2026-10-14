// C# (.NET 8) extractor. Still regex-based — good enough for common patterns
// (top-level types, one-per-line signatures, primary constructors, generics),
// but a real parser (Microsoft.CodeAnalysis.CSharp / Roslyn) will do better on
// multi-line signatures, expression-bodied members split across lines, and
// nested local functions. Swap this module out for a Roslyn helper process
// when you're ready; nothing else in the pipeline needs to change.

const TYPE_RE = /\b(class|interface|record|struct)\s+(\w+)(?:<[^>]*>)?\s*(?:\(([^)]*)\))?\s*(?::\s*([\w<>,.\s]+))?/;
// Deliberately does NOT require the opening brace/`=>`/`;` on the same
// line — Allman style (brace on its own line) is the .NET/VS default, so
// the signature match ends at the closing `)` of the parameter list, and
// indexFile()/scanning below looks forward for the body start separately.
const METHOD_RE = /\b(public|private|protected|internal|static|async|virtual|override)\b[^;{=()]*\b(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/;
const CALL_RE = /\b(\w+)\s*\(/g;

// Matches `services.AddScoped<IFoo, Foo>()`, `.AddSingleton<IBar, Bar>()`,
// `.AddTransient<IBaz, Baz>()`. Non-generic `AddScoped(typeof(X), typeof(Y))`
// form is intentionally left as a follow-up — flag if you need it.
const DI_REGISTRATION_RE = /\.Add(Scoped|Singleton|Transient)<\s*([\w.]+)\s*,\s*([\w.]+)\s*>\s*\(/g;

// `[Authorize]`, `[Authorize(Policy = "...")]`, `[AllowAnonymous]` — captured
// as 'references' edges (see indexer.js) so "which methods/controllers
// require auth" is a graph query instead of a grep across the repo.
const AUTH_ATTRIBUTE_RE = /\[(Authorize|AllowAnonymous)\b/;

/**
 * Scans lines immediately above a class/method declaration for stacked
 * attributes (`[ApiController]`, `[Route(...)]`, `[Authorize]`, ...) and
 * returns the auth-relevant ones found among them. Stops at the first line
 * that isn't itself an attribute line — the 40-line cap is just a sanity
 * backstop against a pathological file, not a realistic limit: real
 * controllers commonly stack 8-10+ attributes (Route, ApiController,
 * ApiVersion, several ProducesResponseType for Swagger docs, ...) above
 * Authorize, so a short fixed window (this used to be 6) silently misses it.
 */
function findPrecedingAuthAttributes(lines, idx) {
  const found = new Set();
  for (let i = idx - 1; i >= 0 && i >= idx - 40; i--) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue; // comment between attributes — doesn't break the chain
    const authMatch = line.match(AUTH_ATTRIBUTE_RE);
    if (authMatch) { found.add(authMatch[1]); continue; }
    if (line.startsWith("[") && line.endsWith("]")) continue; // some other attribute, keep scanning up
    break; // real code / comment above — stop
  }
  return [...found];
}

export function extractCSharpSymbols(text) {
  const lines = text.split("\n");
  const nodes = [];
  let currentType = null;

  lines.forEach((line, idx) => {
    const typeMatch = line.match(TYPE_RE);
    if (typeMatch) {
      const [, kindWord, name, primaryCtorParams, baseList] = typeMatch;
      currentType = name;
      nodes.push({
        kind: kindWord, // 'class' | 'interface' | 'record' | 'struct'
        name,
        qualifiedName: name,
        startLine: idx + 1,
        endLine: idx + 1,
        calls: [],
        implements: baseList ? baseList.split(",").map((s) => s.trim()) : [],
        references: findPrecedingAuthAttributes(lines, idx),
      });
      // C# 12 primary constructors on classes/records carry injected deps
      // right in the type declaration, e.g. `class FooService(IBar bar)`.
      if (primaryCtorParams) {
        nodes[nodes.length - 1].injects = extractParamTypes(primaryCtorParams);
      }
      return;
    }

    const methodMatch = line.match(METHOD_RE);
    if (methodMatch) {
      const [, , name, params] = methodMatch;
      const qualified = currentType ? `${currentType}.${name}` : name;
      let depth = 0, endLine = idx + 1, started = false;
      for (let i = idx; i < lines.length; i++) {
        for (const ch of lines[i]) {
          if (ch === "{") { depth++; started = true; }
          if (ch === "}") depth--;
        }
        if (started && depth <= 0) { endLine = i + 1; break; }
        if (!started && lines[i].includes(";")) { endLine = i + 1; break; } // expression-bodied / abstract
      }
      const body = lines.slice(idx, endLine).join("\n");
      const calls = new Set();
      let m;
      while ((m = CALL_RE.exec(body))) {
        if (m[1] !== name) calls.add(m[1]);
      }
      nodes.push({
        kind: "method",
        name,
        qualifiedName: qualified,
        startLine: idx + 1,
        endLine,
        calls: [...calls],
        // constructor injection via the classic pattern too, in case the
        // type itself wasn't declared with a primary constructor
        injects: name === currentType ? extractParamTypes(params) : [],
        references: findPrecedingAuthAttributes(lines, idx),
      });
    }
  });

  // Modern C# top-level statements (a Program.cs with no wrapping `class
  // Program` / `Main` method — the .NET 6+ minimal-hosting default). TYPE_RE
  // and METHOD_RE never match anything in such a file, so without this,
  // every fluent call at the top level — `builder.Services.AddAuthentication(...)`,
  // `.AddJwtBearer(...)`, `app.UseAuthorization()`, a custom
  // `AddBearerAuthentication(...)` extension method — is invisible to the
  // graph. Treat the whole file as one synthetic top-level node so those
  // calls become real 'calls' edges instead of requiring a grep fallback.
  //
  // `nodes.length === 0` alone misses the very common variant where the file
  // ALSO ends with `public partial class Program { }` (added purely so
  // WebApplicationFactory<Program> works in integration tests) — that one
  // line matches TYPE_RE, so a class node exists even though every real
  // statement above it is still unindexed. Catch that case too: no method
  // was ever extracted, AND the file has a recognizable top-level-statement
  // entry point signal (so a plain interface/DTO file — also "no methods" —
  // doesn't get swept in as noise).
  const hasMethodNode = nodes.some((n) => n.kind === "method");
  const looksLikeEntryPoint = /\b(WebApplication\.CreateBuilder|Host\.CreateDefaultBuilder|new\s+HostBuilder)\b/.test(text);
  if ((nodes.length === 0 || (!hasMethodNode && looksLikeEntryPoint)) && text.trim().length > 0) {
    const calls = new Set();
    let m;
    CALL_RE.lastIndex = 0;
    while ((m = CALL_RE.exec(text))) {
      calls.add(m[1]);
    }
    nodes.push({
      kind: "function",
      name: "TopLevelStatements",
      qualifiedName: "Program.TopLevelStatements",
      startLine: 1,
      endLine: lines.length,
      calls: [...calls],
      injects: [],
      references: [],
    });
  }

  return nodes;
}

function extractParamTypes(paramString) {
  if (!paramString || !paramString.trim()) return [];
  return paramString
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(/\s+/)[0].replace(/^I(?=[A-Z])/, "I")) // keep interface prefix as-is
    .filter((t) => /^I?[A-Z]\w*$/.test(t)); // heuristic: looks like a type name, not a primitive
}

/**
 * Scans DI container registration files (Program.cs / Startup*.cs) for
 * `AddScoped<IFoo, Foo>()`-style calls and returns interface->implementation
 * pairs. Call this once per relevant file; the indexer turns these into
 * 'registers' edges once both sides are resolved to nodes.
 */
export function extractDiRegistrations(text) {
  const registrations = [];
  let m;
  DI_REGISTRATION_RE.lastIndex = 0;
  while ((m = DI_REGISTRATION_RE.exec(text))) {
    registrations.push({ lifetime: m[1], iface: m[2], impl: m[3] });
  }
  return registrations;
}

export function isDiRegistrationFile(filePath) {
  return /(^|[\\/])(Program|Startup\w*)\.cs$/i.test(filePath);
}
