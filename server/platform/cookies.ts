/**
 * Minimal in-memory cookie store for authentication flow.
 */

export class SimpleCookieStore {
  private map = new Map<string, string>();

  constructor(initialCookie?: string) {
    if (initialCookie) {
      this.parseCookieHeader(initialCookie);
    }
  }

  public parseCookieHeader(header: string): void {
    if (!header) return;
    const parts = header.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (key) this.map.set(key, val);
      }
    }
  }

  public setCookieLine(line: string): void {
    if (!line) return;
    const seg = line.split(';')[0];
    const eq = seg.indexOf('=');
    if (eq === -1) return;
    const k = seg.slice(0, eq).trim();
    const v = seg.slice(eq + 1).trim();
    if (k) this.map.set(k, v);
  }

  public applySetCookie(lines?: string[] | string): void {
    if (!lines) return;
    if (Array.isArray(lines)) {
      for (const line of lines) {
        this.setCookieLine(line);
      }
    } else {
      this.setCookieLine(lines);
    }
  }

  public get(name: string): string | undefined {
    return this.map.get(name);
  }

  public set(name: string, value: string): void {
    this.map.set(name, value);
  }

  public delete(name: string): void {
    this.map.delete(name);
  }

  public clear(): void {
    this.map.clear();
  }

  public headerString(): string {
    return Array.from(this.map.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  public toActiveCookie(): string {
    const sessionid = this.map.get('sessionid');
    const csrftoken = this.map.get('csrftoken');
    const parts: string[] = [];
    if (csrftoken) parts.push(`csrftoken=${csrftoken}`);
    if (sessionid) parts.push(`sessionid=${sessionid}`);
    return parts.join('; ');
  }
}
