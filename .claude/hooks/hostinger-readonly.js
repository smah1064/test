#!/usr/bin/env node
// Auto-approves read-only Hostinger API operations (deployment status, logs,
// website lists). Anything else gets no answer from this hook, so the normal
// permission prompt still asks.
const READ_ONLY = new Set([
  'hosting_get-deployment',
  'hosting_nodejs_runtime-logs',
  'hosting_websites_list',
  'hosting_websites_list-setups',
]);
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let op = '';
  try { op = String((JSON.parse(input).tool_input || {}).operation || ''); } catch (e) { return; }
  if (!READ_ONLY.has(op)) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: `Read-only Hostinger check (${op})`,
    },
  }));
});
