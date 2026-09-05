// Parameter syntax only: SQL remains native PostgreSQL, never interpolated values.
export function bindParameters(sql) {
  let output = '',
    count = 0,
    at = 0;
  while (at < sql.length) {
    const char = sql[at];
    if (char === "'" || char === '"') {
      const quote = char;
      output += sql[at++];
      while (at < sql.length) {
        const current = sql[at++];
        output += current;
        if (current === quote) {
          if (sql[at] === quote) output += sql[at++];
          else break;
        }
      }
    } else if (sql.startsWith('--', at)) {
      const end = sql.indexOf('\n', at);
      if (end < 0) {
        output += sql.slice(at);
        break;
      }
      output += sql.slice(at, end + 1);
      at = end + 1;
    } else if (sql.startsWith('/*', at)) {
      let depth = 1;
      output += sql.slice(at, (at += 2));
      while (depth && at < sql.length) {
        if (sql.startsWith('/*', at)) {
          depth++;
          output += sql.slice(at, (at += 2));
        } else if (sql.startsWith('*/', at)) {
          depth--;
          output += sql.slice(at, (at += 2));
        } else output += sql[at++];
      }
    } else if (char === '$' && /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.test(sql.slice(at))) {
      const delimiter = sql.slice(at).match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)[0];
      const end = sql.indexOf(delimiter, at + delimiter.length);
      if (end < 0) throw new Error('Cadena SQL sin cerrar.');
      output += sql.slice(at, end + delimiter.length);
      at = end + delimiter.length;
    } else if (char === '?') {
      output += '$' + ++count;
      at++;
    } else {
      output += char;
      at++;
    }
  }
  return { sql: output, count };
}
