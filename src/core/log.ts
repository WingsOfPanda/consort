const C = { red: "\x1b[31m", grn: "\x1b[32m", yel: "\x1b[33m", blu: "\x1b[34m", rst: "\x1b[0m" };

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
  ok(...a: unknown[]): void;
}

export function createLogger(opts?: { color?: boolean; stream?: NodeJS.WritableStream }): Logger {
  const stream = opts?.stream ?? process.stderr;
  const color = opts?.color ?? Boolean((stream as NodeJS.WriteStream).isTTY);
  const emit = (col: string, label: string, a: unknown[]) => {
    const tag = color ? `${col}${label}${C.rst}` : label;
    stream.write(`${tag}  ${a.join(" ")}\n`);
  };
  return {
    info: (...a) => emit(C.blu, "[INFO]", a),
    warn: (...a) => emit(C.yel, "[WARN]", a),
    error: (...a) => emit(C.red, "[FAIL]", a),
    ok: (...a) => emit(C.grn, "[ OK ]", a),
  };
}

export const log = createLogger();
