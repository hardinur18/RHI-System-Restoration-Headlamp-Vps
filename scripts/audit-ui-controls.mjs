// Source inventory, not a visual pass/fail test. Native controls include intentional
// tabs, calendar cells and cards; inspect them before converting them to Button.
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx$/.test(entry.name) ? [join(dir, entry.name)] : []);
}
const rows = [];
for (const file of files('src/app').sort()) {
  const source = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const row = { file, buttons: 0, nativeButtons: 0, inputs: 0, selects: 0, actionGroups: 0, filterRows: 0, localSizing: [] };
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      const counter = { Button: 'buttons', button: 'nativeButtons', Input: 'inputs', SelectTrigger: 'selects', Select: 'selects', ActionGroup: 'actionGroups', FilterRow: 'filterRows' }[tag];
      if (counter) row[counter]++;
      if (['Button', 'Input', 'SelectTrigger'].includes(tag)) {
        const attrs = node.attributes.properties.filter(a => ts.isJsxAttribute(a) && ['className', 'style'].includes(a.name.getText(tree)));
        if (attrs.some(a => /\b(?:h-|min-h-|max-h-|size-|height\s*:|minHeight\s*:)/.test(a.getText(tree)))) {
          row.localSizing.push({ line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, component: tag });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  rows.push(row);
}
const totals = Object.fromEntries(['buttons', 'nativeButtons', 'inputs', 'selects', 'actionGroups', 'filterRows'].map(key => [key, rows.reduce((n, row) => n + row[key], 0)]));
console.log(JSON.stringify({ filesScanned: rows.length, totals, localSizingSites: rows.reduce((n, row) => n + row.localSizing.length, 0), note: 'Inventory only. A sizing site may be intentional; browser verification is required.', files: rows.filter(row => Object.keys(totals).some(key => row[key])) }, null, 2));
