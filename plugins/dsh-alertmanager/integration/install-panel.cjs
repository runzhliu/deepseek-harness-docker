// Applies only UI composition changes to the pinned prototype; DSH core stays unchanged.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = process.argv[2]; assert(root, 'Pass a Super Agent prototype source checkout');
for (const [file, name] of [['overview.tsx', 'OverviewPage'], ['execution.tsx', 'ExecutionStatus']]) {
  const target = path.join(root, 'src/client', file); let source = fs.readFileSync(target, 'utf8');
  if (!source.includes("import { AlertmanagerPanel } from './alertmanager.tsx'")) {
    const start = source.indexOf('export function ' + name + '('); assert(start >= 0, 'Unknown prototype layout: ' + file);
    const insert = source.indexOf('  return <>', start); assert(insert >= 0, 'Missing panel composition in ' + file);
    source = source.slice(0, insert) + source.slice(insert).replace('  return <>', '  return <>\n    <AlertmanagerPanel />');
    source = "import { AlertmanagerPanel } from './alertmanager.tsx'\n" + source;
    fs.writeFileSync(target, source);
  }
}
fs.copyFileSync(path.join(__dirname, 'AlertmanagerPanel.tsx'), path.join(root, 'src/client/alertmanager.tsx'));
console.log('Superagent overview and execution panels now include Alertmanager incidents');

const doc = path.join(root, 'docs/007-architecture.md');
if (fs.existsSync(doc)) {
  let text = fs.readFileSync(doc, 'utf8');
  if (!text.includes('`src/client/alertmanager.tsx`')) {
    const row = '| `src/client/alertmanager.tsx` | Optional Alertmanager incident plans and delivery state; separate from coding Tickets |\n';
    const at = text.indexOf('| `src/client/'); assert(at >= 0, 'Prototype module index not found');
    text = text.slice(0, at) + row + text.slice(at); fs.writeFileSync(doc, text);
  }
}
