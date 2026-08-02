// Angular / TypeScript extractor. Recognizes the decorators Angular actually
// uses to classify a class (@Component, @Injectable, @NgModule, @Directive,
// @Pipe) so the graph reflects Angular's own architecture rather than
// treating every class the same. Also captures constructor-injected
// dependencies, which is how almost all Angular DI happens.

const DECORATOR_KIND = {
  Component: "component",
  Injectable: "service",
  NgModule: "module",
  Directive: "directive",
  Pipe: "pipe",
};
const DECORATOR_RE = /@(Component|Injectable|NgModule|Directive|Pipe)\s*\(/;
const CLASS_RE = /\bclass\s+(\w+)/;
const METHOD_RE = /^\s*(?:public|private|protected|async|static)*\s*(\w+)\s*\(([^)]*)\)\s*(?::\s*[\w<>\[\],\s]+)?\s*\{/;
const CONSTRUCTOR_RE = /\bconstructor\s*\(([^)]*)\)/;
const CALL_RE = /\b(\w+)\s*\(/g;
const IMPORT_RE = /import\s*\{[^}]*\}\s*from\s*['"](\.[^'"]+)['"]/g;

export function extractAngularSymbols(text) {
  const lines = text.split("\n");
  const nodes = [];
  let pendingDecoratorKind = null;

  lines.forEach((line, idx) => {
    const decoratorMatch = line.match(DECORATOR_RE);
    if (decoratorMatch) {
      pendingDecoratorKind = DECORATOR_KIND[decoratorMatch[1]];
      return;
    }

    const classMatch = line.match(CLASS_RE);
    if (classMatch) {
      const name = classMatch[1];
      let depth = 0, endLine = idx + 1, started = false;
      for (let i = idx; i < lines.length; i++) {
        for (const ch of lines[i]) {
          if (ch === "{") { depth++; started = true; }
          if (ch === "}") depth--;
        }
        if (started && depth <= 0) { endLine = i + 1; break; }
      }
      const body = lines.slice(idx, endLine).join("\n");

      nodes.push({
        kind: pendingDecoratorKind || "class",
        name,
        qualifiedName: name,
        startLine: idx + 1,
        endLine,
        calls: [],
        injects: extractConstructorInjections(body),
      });
      pendingDecoratorKind = null;
      return;
    }

    const methodMatch = line.match(METHOD_RE);
    if (methodMatch && !line.includes("constructor")) {
      const [, name, params] = methodMatch;
      let depth = 0, endLine = idx + 1, started = false;
      for (let i = idx; i < lines.length; i++) {
        for (const ch of lines[i]) {
          if (ch === "{") { depth++; started = true; }
          if (ch === "}") depth--;
        }
        if (started && depth <= 0) { endLine = i + 1; break; }
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
        qualifiedName: name,
        startLine: idx + 1,
        endLine,
        calls: [...calls],
        injects: [],
      });
    }
  });
  return nodes;
}

function extractConstructorInjections(classBody) {
  const ctorMatch = classBody.match(CONSTRUCTOR_RE);
  if (!ctorMatch) return [];
  return ctorMatch[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      // `private http: HttpClient` -> HttpClient ; `@Inject(TOKEN) private x: Foo` -> Foo
      const parts = p.split(":");
      return parts.length > 1 ? parts[1].trim().replace(/[<>\[\]]/g, "") : null;
    })
    .filter(Boolean);
}

/** Returns relative import specifiers, e.g. ['./user.service', '../shared/models'] */
export function extractRelativeImports(text) {
  const imports = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) imports.push(m[1]);
  return imports;
}
