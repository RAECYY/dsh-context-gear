// TS->JS stripper for the smoke test ONLY. Uses exact, verified replacements
// derived from a grep of the two target files, so it never mis-parses ternaries,
// comparisons, or object literals. The .ts/.tsx deliverables are the source of
// truth; this exists solely to let `node --check` validate the JS.
const fs = require("fs");

function stripTs(code) {
  // interface / type-alias declarations (whole block up to the matching brace).
  // NOTE: import/export are KEPT — the output is an ESM module (package type: module).
  code = code.replace(/^\s*export\s+interface\s+[A-Za-z_$][\w$]*\s*\{[\s\S]*?\n\}/gm, "");
  code = code.replace(/^\s*interface\s+[A-Za-z_$][\w$]*\s*\{[\s\S]*?\n\}/gm, "");
  code = code.replace(/^\s*export\s+type\s+[A-Za-z_$][\w$]*\s*=[\s\S]*?;\s*$/gm, "");
  code = code.replace(/^\s*type\s+[A-Za-z_$][\w$]*\s*=[\s\S]*?;\s*$/gm, "");
  // `as` casts
  code = code.replace(/\s+as\s+(?:const|any|unknown|void|string|boolean|number)\b/g, "");
  code = code.replace(/\s+as\s+\{[^}]*\}/g, "");
  code = code.replace(/\s+as\s+(?:keyof\s+)?(?:typeof\s+)?[A-Za-z_$][\w$.]*(?:<[^>]*>)?/g, "");

  // --- remove full type phrases first (so nothing dangles) ---
  // generics by name (protects `a < b`)
  code = code.replace(/\buseState\s*<[^>]*>/g, "useState");
  code = code.replace(/\bRecord\s*<[^>]*>/g, "");
  // generics by name (protects `a < b`) — angle-bracket balanced
  function stripNameGeneric(name) {
    const re = new RegExp("\\b" + name + "\\s*<", "g");
    let m;
    while ((m = re.exec(code))) {
      let depth = 0, k = m.index + name.length;
      while (k < code.length) {
        const ch = code[k];
        if (ch === "<") depth++;
        else if (ch === ">") { depth--; if (depth === 0) { k++; break; } }
        k++;
      }
      code = code.slice(0, m.index) + name + code.slice(k);
      re.lastIndex = m.index + name.length;
    }
  }
  stripNameGeneric("useState");
  stripNameGeneric("Record");
  stripNameGeneric("Set");
  // return types `): Type`
  code = code.replace(/\)\s*:\s*void\b/g, ")");
  code = code.replace(/\)\s*:\s*Promise\s*<[^>]*>/g, ")");
  code = code.replace(/\)\s*:\s*CommandResult\b/g, ")");
  code = code.replace(/\)\s*:\s*string\b/g, ")");
  code = code.replace(/\)\s*:\s*\{\s*code:\s*string;\s*message\?:\s*string\s*\}/g, ")");
  // type predicates `x is Type` (TS only) — strip the whole predicate (object or identifier form)
  code = code.replace(/\)\s*:\s*[A-Za-z_$][\w$]*\s+is\s+\{[^}]*\}/g, ")");
  code = code.replace(/\)\s*:\s*[A-Za-z_$][\w$]*\s+is\s+[A-Za-z_$][\w$]*/g, ")");
  // object-typed params / return `{ ... }`
  code = code.replace(/:\s*\{\s*sessionId:\s*string;\s*ctx:\s*any\s*\}/g, "");
  code = code.replace(/:\s*\{\s*tier:\s*string;\s*auto:\s*boolean\s*\}/g, "");
  code = code.replace(/:\s*\{\s*text:\s*string;\s*kind:\s*"success"\s*\|\s*"error"\s*\}\s*\|\s*null/g, "");
  // optional property `?: type` -> keep `?`
  code = code.replace(/\?:\s*(?:string|boolean|number|unknown|any)\b/g, "?");
  // the `| { kind: ... }` union continuation lines
  code = code.replace(/^\s*\|\s*\{[^}]*\}\s*$/gm, "");

  // --- parameter annotations inside (...) ---
  code = code.replace(/(\()([^()]*?)(\))/g, (full, a, inner, b) => {
    // Strip `: Type` only when inside a real parameter list. A `:` that is inside a
    // nested `{...}` (object literal, e.g. JSON.stringify({ k: v })) is a property,
    // not a param annotation, so we track brace depth and skip those.
    let out2 = "", bd = 0;
    let p = 0;
    while (p < inner.length) {
      const cc = inner[p];
      if (cc === "{") { bd++; out2 += cc; p++; continue; }
      if (cc === "}") { bd = Math.max(0, bd - 1); out2 += cc; p++; continue; }
      if (cc === ":" && bd === 0) {
        // preceded by an identifier, in param position?
        let s = out2.length - 1; while (s >= 0 && /\s/.test(out2[s])) s--;
        const isParamPos = s >= 0 && (out2[s] === "(" || out2[s] === "," || /[A-Za-z0-9_$]/.test(out2[s]));
        if (isParamPos) {
          let j = p + 1; while (j < inner.length && /\s/.test(inner[j])) j++;
          let k = j;
          if (inner[k] === '"') {
            let q = k;
            for (;;) {
              if (inner[q] !== '"') break;
              q++;
              while (q < inner.length && inner[q] !== '"') { if (inner[q] === "\\") q++; q++; }
              if (inner[q] === '"') q++; else break;
              let sp = q; while (sp < inner.length && /\s/.test(inner[sp])) sp++;
              if (inner[sp] === "|") { q = sp + 1; while (q < inner.length && /\s/.test(inner[q])) q++; }
              else break;
            }
            k = q;
          } else {
            while (k < inner.length && /[A-Za-z0-9_$]/.test(inner[k])) k++;
          }
          p = k; continue;
        }
      }
      out2 += cc; p++;
    }
    return a + out2 + b;
  });

  // --- dangling type after const/let/var name (before `=` OR `;` OR end) ---
  code = code.replace(/(\b(?:const|let|var)\s+[A-Za-z_$][\w$]*)\s*:\s*[^=;\n]*(?=[=;]|\n)/g, "$1");

  return code;
}

if (require.main === module) {
  const file = process.argv[2];
  const out = process.argv[3] || file.replace(/\.(tsx|ts)$/, ".js");
  fs.writeFileSync(out, stripTs(fs.readFileSync(file, "utf8")));
  console.log("wrote", out);
}
module.exports = { stripTs };
