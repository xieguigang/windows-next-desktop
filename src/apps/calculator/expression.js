/**
 * 数学表达式引擎
 *
 * Tokenizer → Shunting-Yard (转 RPN) → RPN 求值。
 * 编译为闭包后求值代价低，适合绘图模式的高频调用。
 *
 * 支持：
 *   + - * / ^ % ( ) , 一元负号
 *   常量 pi e
 *   函数 sin cos tan asin acos atan ln log sqrt abs floor ceil round pow min max
 *
 * 不依赖任何第三方库，体积小、可控、易于扩展。
 */

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  exp: Math.exp,
  sign: Math.sign,
};

const CONSTANTS = { pi: Math.PI, e: Math.E };

/* ============================================================
   Tokenizer
   ============================================================ */

const NUMBER_RE = /^\d+(\.\d+)?(e[+-]?\d+)?|^pi|^e/i;

/**
 * @param {string} input
 * @returns {Array<{type:string, value:any, pos:number}>}
 */
function tokenize(input) {
  const tokens = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }

    // 数字
    if (/[0-9.]/.test(c)) {
      const start = i;
      while (i < input.length && /[0-9.eE+-]/.test(input[i]) && !(input[i] === '+' || input[i] === '-') || (i === start)) i++;
      // 修正：上面读 +/-, 避免误吞（无法从单字符正则干净地处理）—— 用更显式的循环
      i = start;
      while (i < input.length && /[0-9.]/.test(input[i])) i++;
      // 指数
      if (input[i] === 'e' && /[0-9+-]/.test(input[i + 1] || '')) {
        i++; // 'e'
        if (input[i] === '+' || input[i] === '-') i++;
        while (i < input.length && /[0-9]/.test(input[i])) i++;
      }
      const raw = input.slice(start, i);
      const num = Number(raw);
      if (Number.isNaN(num)) throw new SyntaxError(`非法数字：${raw}`);
      tokens.push({ type: 'num', value: num, pos: start });
      continue;
    }

    // 标识符（常量/函数/变量 x）
    if (/[a-zA-Z]/.test(c)) {
      const start = i;
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) i++;
      const name = input.slice(start, i);
      if (name === 'pi' || name === 'e') {
        tokens.push({ type: 'num', value: CONSTANTS[name], pos: start });
      } else if (FUNCTIONS[name]) {
        tokens.push({ type: 'fn', value: name, pos: start });
      } else if (name === 'x' || name === 't') {
        tokens.push({ type: 'var', value: name, pos: start });
      } else {
        throw new SyntaxError(`未知标识符：${name}`);
      }
      continue;
    }

    // 操作符 / 括号 / 逗号
    if (c === '(' || c === ')' || c === ',') {
      tokens.push({ type: c, value: c, pos: i });
      i++;
      continue;
    }

    if ('+-*/^%'.includes(c)) {
      // 一元负号识别：仅在「前一个 token 是操作符/左括号/逗号/起始」时算 unary
      const prev = tokens[tokens.length - 1];
      const isUnary = c === '-' && (!prev || prev.type === 'op' || prev.type === '(' || prev.type === ',');
      tokens.push({ type: 'op', value: isUnary ? 'u-' : c, pos: i });
      i++;
      continue;
    }

    throw new SyntaxError(`无法识别的字符：${c}（位置 ${i}）`);
  }

  // 隐式乘法补全：`2x` `(2)3` `2sin(x)` 等 → 插入 *
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k];
    out.push(cur);
    if (k < tokens.length - 1) {
      const next = tokens[k + 1];
      const endsValue = cur.type === 'num' || cur.type === ')' || cur.type === 'var';
      const startsValue = next.type === 'num' || next.type === '(' || next.type === 'fn' || next.type === 'var';
      if (endsValue && startsValue) out.push({ type: 'op', value: '*', pos: cur.pos });
    }
  }
  return out;
}

/* ============================================================
   Shunting-Yard → RPN
   ============================================================ */

const PRECEDENCE = { 'u-': 4, '^': 3, '*': 2, '/': 2, '%': 2, '+': 1, '-': 1 };

/**
 * @param {string} input
 * @returns {Array<{type:string, value:any, pos:number}>}
 */
function toRPN(input) {
  const tokens = tokenize(input);
  const output = [];
  const stack = [];

  for (const t of tokens) {
    if (t.type === 'num' || t.type === 'var') {
      output.push(t);
    } else if (t.type === 'fn') {
      stack.push(t);
    } else if (t.type === ',') {
      while (stack.length && stack[stack.length - 1].type !== '(') output.push(stack.pop());
      if (!stack.length) throw new SyntaxError(`括号或逗号不匹配`);
    } else if (t.type === 'op') {
      const prec = PRECEDENCE[t.value] || 0;
      const rightAssoc = t.value === '^' || t.value === 'u-';
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type === '(') break;
        const topPrec = PRECEDENCE[top.value] || 0;
        if (topPrec > prec || (topPrec === prec && !rightAssoc)) output.push(stack.pop());
        else break;
      }
      stack.push(t);
    } else if (t.type === '(') {
      stack.push(t);
    } else if (t.type === ')') {
      while (stack.length && stack[stack.length - 1].type !== '(') output.push(stack.pop());
      if (!stack.length) throw new SyntaxError(`括号不匹配：) 没有对应的 (`);
      stack.pop(); // 弹出 (
      if (stack.length && stack[stack.length - 1].type === 'fn') output.push(stack.pop());
    }
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.type === '(') throw new SyntaxError(`括号不匹配：( 没有对应的 )`);
    output.push(top);
  }
  return output;
}

/* ============================================================
   编译 + 求值
   ============================================================ */

/**
 * 编译表达式为可复用求值函数
 * @param {string} expr
 * @param {Object} [options]
 * @param {Record<string, number>} [options.vars] 外部变量（如 { x: 1.5 }）
 * @returns {(vars?: Record<string, number>) => number}
 */
export function compile(expr, options = {}) {
  if (!expr || !expr.trim()) throw new SyntaxError('表达式为空');
  const rpn = toRPN(expr);
  const known = options.vars || {};

  return function evaluate(vars = {}) {
    const stack = [];
    const v = { ...known, ...vars };
    for (const t of rpn) {
      if (t.type === 'num') stack.push(t.value);
      else if (t.type === 'var') {
        if (!(t.value in v)) throw new ReferenceError(`未提供变量：${t.value}`);
        stack.push(v[t.value]);
      } else if (t.type === 'op') {
        if (t.value === 'u-') {
          if (!stack.length) throw new SyntaxError(`缺少操作数（位置 ${t.pos}）`);
          stack.push(-stack.pop());
        } else {
          const b = stack.pop();
          const a = stack.pop();
          if (a === undefined || b === undefined) throw new SyntaxError(`缺少操作数（位置 ${t.pos}）`);
          switch (t.value) {
            case '+': stack.push(a + b); break;
            case '-': stack.push(a - b); break;
            case '*': stack.push(a * b); break;
            case '/': stack.push(b === 0 ? NaN : a / b); break;
            case '%': stack.push(b === 0 ? NaN : a % b); break;
            case '^': stack.push(Math.pow(a, b)); break;
          }
        }
      } else if (t.type === 'fn') {
        const fn = FUNCTIONS[t.value];
        const arity = t.value === 'min' || t.value === 'max' ? stack.length : fn.length || 1;
        const args = [];
        for (let k = 0; k < arity; k++) args.unshift(stack.pop());
        if (args.some((a) => a === undefined)) throw new SyntaxError(`函数 ${t.value} 缺少参数`);
        stack.push(fn(...args));
      }
    }
    if (stack.length !== 1) throw new SyntaxError('表达式不合法');
    return stack[0];
  };
}

/**
 * 单次求值（便捷包装）
 */
export function evaluate(expr, vars) {
  return compile(expr)(vars);
}

/**
 * 检测奇点（极大/非有限值突变），用于绘图时插入 null 断点
 * @param {number[]} samples
 * @returns {number[]}
 */
export function sanitizeSamples(samples) {
  const out = new Array(samples.length);
  let prev = samples[0];
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    // 用相邻变化率判定奇点：突变超过量级本身 100 倍视为断点
    if (!Number.isFinite(v)) { out[i] = null; prev = 0; continue; }
    if (i > 0 && prev !== 0) {
      const ratio = Math.abs(v - prev) / Math.max(1, Math.abs(prev));
      if (ratio > 50) { out[i] = null; prev = 0; continue; }
    }
    out[i] = v;
    prev = v;
  }
  return out;
}