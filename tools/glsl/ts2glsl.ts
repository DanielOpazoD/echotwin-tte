import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TypeScript → GLSL for the pure scalar functions the CPU tracer and the WebGL2 port share (engineering
 * audit, C1-b). The TypeScript function is the single source; `npm run glsl:gen` writes
 * src/simulator/renderer/gpu/glslGenerated.ts, which the shaders include, and glslGenerated.test.ts fails
 * when that file is stale or when a target uses syntax outside the subset below.
 *
 * Subset: functions of `number` parameters returning `number`; `const`/`let` of numbers; `if`/`else`;
 * `return`; `for (let i = a; i < b; i++)` with integer bounds; assignments and compound assignments;
 * `+ - * / < <= > >= === !== && || ! -`; the conditional operator; parentheses; numeric literals;
 * `Math.{abs,min,max,sqrt,pow,exp,log,floor,ceil,cos,sin,tan,atan2,PI}` (`Math.pow` with a whole exponent of 2-4 becomes a
 * product: GLSL leaves `pow` undefined for a negative base); calls to other target functions;
 * free identifiers in ALL_CAPS, which must be `#define`s or constants of the shader that includes the
 * output (glslHeart.test.ts and glslParity.test.ts check that). Anything else throws with the node kind, so
 * a target that grows past the subset is noticed at generation time, not in the browser.
 */
export interface GenTarget {
  file: string;
  functions: string[];
}

export const TARGETS: GenTarget[] = [
  { file: 'src/simulator/anatomy/valveSkirt.ts', functions: ['annulusOffset', 'tvInflowTaper'] },
  { file: 'src/simulator/anatomy/lvShape.ts', functions: ['ellipseFactor', 'axialWallFactor'] },
  { file: 'src/simulator/anatomy/rv.ts', functions: ['rvAxialTaper', 'rvAzProfile', 'rvFloorZ'] },
  { file: 'src/simulator/anatomy/lvWall.ts', functions: ['septalShiftAt'] },
  { file: 'src/simulator/anatomy/lvSegments.ts', functions: ['lvSegmentCode', 'lvWallKind'] },
  { file: 'src/simulator/anatomy/classify/root.ts', functions: ['rootBend'] },
  { file: 'src/simulator/anatomy/thoraxModel.ts', functions: ['mediastinumDistance'] },
  {
    file: 'src/simulator/anatomy/classify/atria.ts',
    functions: ['atrialScale', 'iasThickness', 'raCollapseScale'],
  },
  {
    file: 'src/simulator/anatomy/classify/rightVentricle.ts',
    functions: ['rvFreeWallNow', 'rvOutflowScale'],
  },
  {
    file: 'src/simulator/renderer/acoustic/acoustics.ts',
    functions: [
      'myoHelixGain',
      'pleuralReverberation',
      'beamHalfWidthCm',
      'focusingGain',
      'membraneWeight',
    ],
  },
  { file: 'src/simulator/renderer/acoustic/psf.ts', functions: ['sliceHalfWidthCm'] },
];

export const OUTPUT = 'src/simulator/renderer/gpu/glslGenerated.ts';

const MATH_FN: Record<string, string> = {
  abs: 'abs',
  min: 'min',
  max: 'max',
  sqrt: 'sqrt',
  pow: 'pow',
  exp: 'exp',
  log: 'log',
  floor: 'floor',
  ceil: 'ceil',
  cos: 'cos',
  sin: 'sin',
  tan: 'tan',
  atan2: 'atan',
};

class Unsupported extends Error {
  constructor(node: ts.Node, fn: string, why = '') {
    super(
      `ts2glsl: ${fn}: unsupported ${ts.SyntaxKind[node.kind]}${why ? ` (${why})` : ''}: ${node.getText()}`,
    );
  }
}

/** A number as a GLSL float literal (`1` → `1.0`). */
export function glslFloat(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`ts2glsl: non-finite literal ${v}`);
  return Number.isInteger(v) ? `${v}.0` : `${v}`;
}

interface Ctx {
  fn: string;
  /** Loop counters (GLSL ints): read as `float(i)` in float expressions. */
  ints: Set<string>;
  /** Names of the functions being generated, callable from each other. */
  functions: Set<string>;
  /** Free identifiers seen (not params, locals or generated functions). */
  free: Set<string>;
  locals: Set<string>;
}

function expr(n: ts.Expression, c: Ctx, wantInt = false): string {
  if (ts.isParenthesizedExpression(n)) return `(${expr(n.expression, c, wantInt)})`;
  if (ts.isNumericLiteral(n)) return wantInt ? String(Number(n.text)) : glslFloat(Number(n.text));
  if (ts.isPrefixUnaryExpression(n)) {
    const op =
      n.operator === ts.SyntaxKind.MinusToken
        ? '-'
        : n.operator === ts.SyntaxKind.ExclamationToken
          ? '!'
          : n.operator === ts.SyntaxKind.PlusToken
            ? '+'
            : null;
    if (!op) throw new Unsupported(n, c.fn);
    return `${op}${expr(n.operand, c, wantInt)}`;
  }
  if (ts.isIdentifier(n)) {
    const name = n.text;
    if (c.ints.has(name)) return wantInt ? name : `float(${name})`;
    if (!c.locals.has(name) && !c.functions.has(name)) c.free.add(name);
    return name;
  }
  if (ts.isPropertyAccessExpression(n)) {
    if (ts.isIdentifier(n.expression) && n.expression.text === 'Math' && n.name.text === 'PI')
      return 'PI';
    throw new Unsupported(n, c.fn, 'only Math.PI');
  }
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    const ops: Partial<Record<ts.SyntaxKind, string>> = {
      [ts.SyntaxKind.PlusToken]: '+',
      [ts.SyntaxKind.MinusToken]: '-',
      [ts.SyntaxKind.AsteriskToken]: '*',
      [ts.SyntaxKind.SlashToken]: '/',
      [ts.SyntaxKind.LessThanToken]: '<',
      [ts.SyntaxKind.LessThanEqualsToken]: '<=',
      [ts.SyntaxKind.GreaterThanToken]: '>',
      [ts.SyntaxKind.GreaterThanEqualsToken]: '>=',
      [ts.SyntaxKind.EqualsEqualsEqualsToken]: '==',
      [ts.SyntaxKind.ExclamationEqualsEqualsToken]: '!=',
      [ts.SyntaxKind.AmpersandAmpersandToken]: '&&',
      [ts.SyntaxKind.BarBarToken]: '||',
    };
    const op = ops[k];
    if (!op) throw new Unsupported(n, c.fn, 'operator');
    return `${expr(n.left, c, wantInt)} ${op} ${expr(n.right, c, wantInt)}`;
  }
  if (ts.isConditionalExpression(n))
    return `${expr(n.condition, c)} ? ${expr(n.whenTrue, c, wantInt)} : ${expr(n.whenFalse, c, wantInt)}`;
  if (ts.isCallExpression(n)) {
    // Math.pow with a small whole exponent becomes a product: GLSL leaves pow(x, y) undefined for x < 0, and Metal and
    // ANGLE compute it as exp2(y·log2 x), NaN there, where JavaScript squares a negative base (decision 169). Any other
    // exponent keeps pow, whose base must then be non-negative on both sides.
    if (
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Math' &&
      n.expression.name.text === 'pow' &&
      n.arguments.length === 2 &&
      ts.isNumericLiteral(n.arguments[1]!)
    ) {
      const k = Number(n.arguments[1].text);
      if (Number.isInteger(k) && k >= 2 && k <= 4) {
        const base = `(${expr(n.arguments[0]!, c)})`;
        return `(${Array.from({ length: k }, () => base).join(' * ')})`;
      }
    }
    const args = n.arguments.map((a) => expr(a, c)).join(', ');
    if (
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Math'
    ) {
      const g = MATH_FN[n.expression.name.text];
      if (!g) throw new Unsupported(n, c.fn, `Math.${n.expression.name.text}`);
      // GLSL min and max take two arguments: Math.min(a, b, c) nests as min(min(a, b), c) (decision 213: a three-argument
      // min compiled nowhere and only the GPU end-to-end tests saw it)
      if ((g === 'min' || g === 'max') && n.arguments.length > 2)
        return n.arguments
          .slice(1)
          .reduce((acc, a) => `${g}(${acc}, ${expr(a, c)})`, expr(n.arguments[0]!, c));
      return `${g}(${args})`;
    }
    if (ts.isIdentifier(n.expression) && c.functions.has(n.expression.text))
      return `${n.expression.text}(${args})`;
    throw new Unsupported(n, c.fn, 'call target must be Math.* or another generated function');
  }
  throw new Unsupported(n, c.fn);
}

function stmt(s: ts.Statement, c: Ctx, indent: string): string[] {
  const out: string[] = [];
  if (ts.isReturnStatement(s)) {
    if (!s.expression) throw new Unsupported(s, c.fn, 'bare return');
    out.push(`${indent}return ${expr(s.expression, c)};`);
  } else if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) throw new Unsupported(d, c.fn);
      c.locals.add(d.name.text);
      out.push(`${indent}float ${d.name.text} = ${expr(d.initializer, c)};`);
    }
  } else if (ts.isIfStatement(s)) {
    out.push(`${indent}if (${expr(s.expression, c)}) {`);
    out.push(...block(s.thenStatement, c, indent + '  '));
    if (s.elseStatement) {
      out.push(`${indent}} else {`);
      out.push(...block(s.elseStatement, c, indent + '  '));
    }
    out.push(`${indent}}`);
  } else if (ts.isExpressionStatement(s)) {
    const e = s.expression;
    if (!ts.isBinaryExpression(e) || !ts.isIdentifier(e.left))
      throw new Unsupported(s, c.fn, 'only assignments');
    const ops: Partial<Record<ts.SyntaxKind, string>> = {
      [ts.SyntaxKind.EqualsToken]: '=',
      [ts.SyntaxKind.PlusEqualsToken]: '+=',
      [ts.SyntaxKind.MinusEqualsToken]: '-=',
      [ts.SyntaxKind.AsteriskEqualsToken]: '*=',
      [ts.SyntaxKind.SlashEqualsToken]: '/=',
    };
    const op = ops[e.operatorToken.kind];
    if (!op) throw new Unsupported(s, c.fn, 'assignment operator');
    if (!c.locals.has(e.left.text)) throw new Unsupported(s, c.fn, 'assignment to a non-local');
    out.push(`${indent}${e.left.text} ${op} ${expr(e.right, c)};`);
  } else if (ts.isForStatement(s)) {
    const init = s.initializer;
    if (
      !init ||
      !ts.isVariableDeclarationList(init) ||
      init.declarations.length !== 1 ||
      !s.condition ||
      !s.incrementor
    )
      throw new Unsupported(s, c.fn, 'for (let i = a; i < b; i++) only');
    const d = init.declarations[0]!;
    if (!ts.isIdentifier(d.name) || !d.initializer) throw new Unsupported(s, c.fn);
    const inc = s.incrementor;
    if (
      !ts.isPostfixUnaryExpression(inc) ||
      inc.operator !== ts.SyntaxKind.PlusPlusToken ||
      !ts.isIdentifier(inc.operand) ||
      inc.operand.text !== d.name.text
    )
      throw new Unsupported(s, c.fn, 'incrementor must be i++');
    c.ints.add(d.name.text);
    out.push(
      `${indent}for (int ${d.name.text} = ${expr(d.initializer, c, true)}; ${expr(s.condition, c, true)}; ${d.name.text}++) {`,
    );
    out.push(...block(s.statement, c, indent + '  '));
    out.push(`${indent}}`);
    c.ints.delete(d.name.text);
  } else throw new Unsupported(s, c.fn);
  return out;
}

function block(s: ts.Statement, c: Ctx, indent: string): string[] {
  if (ts.isBlock(s)) return s.statements.flatMap((x) => stmt(x, c, indent));
  return stmt(s, c, indent);
}

export interface Generated {
  name: string;
  glsl: string;
  free: string[];
}

/** Transpile one function declaration of a source text. */
export function transpileFunction(
  source: string,
  name: string,
  functions: Set<string>,
  fileName = 'target.ts',
): Generated {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const decl = sf.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name,
  );
  if (!decl?.body) throw new Error(`ts2glsl: function ${name} not found in ${fileName}`);
  const c: Ctx = { fn: name, ints: new Set(), functions, free: new Set(), locals: new Set() };
  const params = decl.parameters.map((p) => {
    if (!ts.isIdentifier(p.name) || p.initializer || p.questionToken)
      throw new Unsupported(p, name, 'plain parameters only');
    if (!p.type || p.type.kind !== ts.SyntaxKind.NumberKeyword)
      throw new Unsupported(p, name, 'parameters must be number');
    c.locals.add(p.name.text);
    return `float ${p.name.text}`;
  });
  if (!decl.type || decl.type.kind !== ts.SyntaxKind.NumberKeyword)
    throw new Unsupported(decl, name, 'return type must be number');
  const body = decl.body.statements.flatMap((s) => stmt(s, c, '  '));
  const glsl = [`float ${name}(${params.join(', ')}) {`, ...body, '}'].join('\n');
  return { name, glsl, free: [...c.free].sort() };
}

/** All targets → the generated module text. */
export function generateModule(root: string, targets: GenTarget[] = TARGETS): string {
  const functions = new Set(targets.flatMap((t) => t.functions));
  const parts: string[] = [];
  const free = new Set<string>();
  for (const t of targets) {
    const source = readFileSync(join(root, t.file), 'utf8');
    for (const fn of t.functions) {
      const g = transpileFunction(source, fn, functions, t.file);
      parts.push(`// ${t.file}: ${fn}\n${g.glsl}`);
      for (const f of g.free) free.add(f);
    }
  }
  const bad = [...free].filter((f) => !/^[A-Z][A-Z0-9_]+$/.test(f) && f !== 'PI');
  if (bad.length)
    throw new Error(
      `ts2glsl: free identifiers that are not shader constants: ${bad.join(', ')} (make them parameters or exported constants)`,
    );
  return [
    '// GENERATED by `npm run glsl:gen` (tools/glsl/ts2glsl.ts) from the TypeScript functions named below.',
    '// Do not edit: change the TypeScript and regenerate. glslGenerated.test.ts fails when this file is stale.',
    '',
    '/** Pure scalar functions shared by the CPU tracer and the shaders, transpiled from their TypeScript source. */',
    'export const GLSL_GENERATED = /* glsl */ `',
    parts.join('\n'),
    '`;',
    '',
    `/** Shader constants the generated functions read (must be #defines or constants of the including shader). */`,
    `export const GLSL_GENERATED_FREE_IDENTIFIERS: readonly string[] = ${JSON.stringify([...free].sort())};`,
    '',
  ].join('\n');
}

if (process.argv[1] && /ts2glsl\.ts$/.test(process.argv[1])) {
  const root = process.cwd();
  const text = generateModule(root);
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(join(root, OUTPUT), 'utf8');
    } catch {
      /* missing: stale */
    }
    if (current !== text) {
      console.error(`${OUTPUT} is stale: run npm run glsl:gen`);
      process.exit(1);
    }
  } else {
    writeFileSync(join(root, OUTPUT), text);
    console.info(`wrote ${OUTPUT}`);
  }
}
