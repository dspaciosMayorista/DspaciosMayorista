import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

test("all application date/month fields use the shared calendar, never a native picker", () => {
  const native: string[] = [];
  let calendars = 0;
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { scan(path); continue; }
      if (!/\.[jt]sx$/.test(path)) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          const tag = node.tagName.getText(source);
          if (tag === "DateInput") calendars++;
          const type = node.attributes.properties.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "type");
          if (type && ts.isJsxAttribute(type) && type.initializer && ts.isStringLiteral(type.initializer)
            && ["date", "month", "datetime-local", "week"].includes(type.initializer.text) && tag !== "DateInput") {
            native.push(`${path}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan("app"); scan("components");
  assert.deepEqual(native, [], "native calendars must not be reintroduced");
  assert.ok(calendars >= 121, `expected coverage of at least 121 existing fields, got ${calendars}`);
});
