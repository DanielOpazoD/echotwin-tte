/**
 * Build-time shrinking of the shader sources (decision 228). The GLSL of the WebGL2 port is written as template literals
 * in TypeScript modules, and its comments — the reasons for each line, kept next to the code on purpose — travelled in
 * the bundle: the renderer's chunk reached its 132 kB budget at decision 227, and earlier the comments had been cut to
 * their decision numbers by hand to stay under it (decision 222). This strips, inside template-literal text only, the
 * `//` comments and the indentation of each line, and drops the lines left empty; the interpolations (`${…}`), the
 * TypeScript around the literals and the line structure the GLSL preprocessor needs are kept. The modules it runs on
 * hold no regular-expression literals, which this scanner does not recognise.
 */
export function stripGlslTemplateComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  // stack of contexts: TypeScript (with its brace depth) or template-literal text
  const stack: { kind: 'code' | 'tpl'; depth: number }[] = [{ kind: 'code', depth: 0 }];
  // template text since the last line break or interpolation, and the state of the current line
  let seg = '';
  let lineStart = true,
    inComment = false,
    lineHasText = false;
  const emitSeg = (endOfLine: boolean) => {
    let t = lineStart ? seg.replace(/^\s+/, '') : seg;
    if (endOfLine) t = t.replace(/\s+$/, '');
    if (t.length) {
      out += t;
      lineHasText = true;
    }
    seg = '';
  };
  while (i < n) {
    const top = stack[stack.length - 1]!;
    const c = source[i]!;
    if (top.kind === 'tpl') {
      if (c === '\\') {
        if (!inComment) seg += c + (source[i + 1] ?? '');
        i += 2;
      } else if (c === '`') {
        emitSeg(true);
        out += '`';
        stack.pop();
        i++;
      } else if (c === '$' && source[i + 1] === '{') {
        if (inComment)
          throw new Error(`glslStrip: an interpolation inside a GLSL comment at offset ${i}`);
        emitSeg(false);
        lineStart = false;
        out += '${';
        stack.push({ kind: 'code', depth: 0 });
        i += 2;
      } else if (c === '\n') {
        emitSeg(true);
        if (lineHasText) out += '\n';
        lineStart = true;
        inComment = false;
        lineHasText = false;
        i++;
      } else {
        if (!inComment && c === '/' && source[i + 1] === '/') inComment = true;
        if (!inComment) seg += c;
        i++;
      }
      continue;
    }
    // TypeScript
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      out += source.slice(i, stop);
      i = stop;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += source.slice(i, stop);
      i = stop;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (c === '`') {
      out += '`';
      stack.push({ kind: 'tpl', depth: 0 });
      lineStart = false;
      inComment = false;
      lineHasText = true;
      i++;
    } else if (c === '{') {
      top.depth++;
      out += c;
      i++;
    } else if (c === '}') {
      if (top.depth === 0 && stack.length > 1) {
        // the end of an interpolation: back to the template text, whose line continues after it
        stack.pop();
        out += '}';
        lineStart = false;
        inComment = false;
        lineHasText = true;
      } else {
        top.depth--;
        out += c;
      }
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
