/** Minimal glob matcher: `**`, `*`, `?` and `{a,b}`. Paths are normalised to forward slashes. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        re += '(?:' + glob.slice(i + 1, end).split(',').map(escape).join('|') + ')';
        i = end;
      } else {
        re += '\\{';
      }
    } else {
      re += escape(c);
    }
  }
  return new RegExp('^' + re + '$');
}

function escape(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  const p = path.replace(/\\/g, '/');
  return globs.some((g) => {
    const re = globToRegExp(g);
    return re.test(p) || re.test(p.replace(/^\/+/, ''));
  });
}
