const fs = require('fs');
function balance(src, file) {
  const pairs = { '(' : ')', '{' : '}', '[' : ']' };
  const open = new Set(['(','{','[']);
  const close = new Set([')','}',']']);
  const stack = [];
  const inStr = { q: null, esc: false };
  const inTmpl = { on: false, esc: false, interpDepth: 0 };
  let line = 1;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i+1];
    if (c === '\n') { line++; inLineComment = false; continue; }
    // String and template state take priority over comment detection.
    if (inStr.q) {
      if (inStr.esc) inStr.esc = false;
      else if (c === '\\') inStr.esc = true;
      else if (c === inStr.q) inStr.q = null;
      continue;
    }
    if (inTmpl.on) {
      if (inTmpl.esc) inTmpl.esc = false;
      else if (c === '\\') inTmpl.esc = true;
      else if (c === '`') inTmpl.on = false;
      else if (c === '$' && src[i+1] === '{') {
        inTmpl.on = false;
        inTmpl.interpDepth = 1;
        i++;
      }
      continue;
    }
    if (inTmpl.interpDepth > 0) {
      if (c === '{') inTmpl.interpDepth++;
      else if (c === '}') { inTmpl.interpDepth--; if (inTmpl.interpDepth === 0) inTmpl.on = true; }
      continue;
    }
    // Now safe to interpret comments.
    if (inLineComment) continue;
    if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i++; } continue; }
    if (c === '/' && n === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && n === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'") { inStr.q = c; continue; }
    if (c === '`') { inTmpl.on = true; continue; }
    if (open.has(c)) stack.push({ c, line });
    else if (close.has(c)) {
      const top = stack.pop();
      if (!top || pairs[top.c] !== c) { console.log(`UNBALANCED ${file} @line ${line}: got '${c}' expected close of '${top && top.c}'`); return false; }
    }
  }
  if (stack.length) { console.log(`UNCLOSED ${file}:`, stack.slice(-5)); return false; }
  return true;
}
for (const f of ['host.ts','client.tsx','src/dsh-shims.d.ts']) {
  const p = 'D:/AI/DeepSeekChat/dsh-context-gear/' + f;
  if (!fs.existsSync(p)) { console.log('missing', f); continue; }
  const ok = balance(fs.readFileSync(p,'utf8'), f);
  console.log(f, ok ? 'OK balanced' : 'BALANCE FAIL');
}
const c = fs.readFileSync('D:/AI/DeepSeekChat/dsh-context-gear/client.tsx','utf8');
console.log('moduleLoader.load present:', /window\.__ModuleLoader__\.load\(\{/.test(c));
console.log('has id @deepseek-ai/dsh-context-gear:', c.includes('"@deepseek-ai/dsh-context-gear"'));
console.log('has conversation.input.left inject:', c.includes('conversation.input.left'));
console.log('localStorage key prefix dsh-context-gear:', c.includes('dsh-context-gear:'));
console.log('copy uses navigator.clipboard:', c.includes('navigator.clipboard.writeText'));
console.log('no append/sendMessage (does not mutate conversation):', !/appendMessage|sendMessage|addMessage/.test(c));
console.log('dispatch via remote.commands.execute:', c.includes('remote.commands.execute'));
const h = fs.readFileSync('D:/AI/DeepSeekChat/dsh-context-gear/host.ts','utf8');
console.log('host TIER_POLICY present:', h.includes('const TIER_POLICY'));
console.log('host TIER_PROMPTS present:', h.includes('const TIER_PROMPTS'));
console.log('host command name context-gear-apply:', h.includes('name: "context-gear-apply"'));
console.log('host debounce busySessions:', h.includes('busySessions'));
console.log('host finally releases lock:', /finally\s*\{\s*busySessions\.delete/.test(h));
console.log('host ManualCompactionError handling:', h.includes('ManualCompactionError'));
console.log('host backend-missing guard:', h.includes('未检测到压缩后端'));
