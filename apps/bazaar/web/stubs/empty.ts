// Empty stub for server-only modules in browser builds

// Elysia stub (server-side web framework)
export class Elysia {
  constructor(_config?: unknown) {
    throw new Error('Elysia is not available in browser')
  }
  get(_path: string, _handler: unknown): Elysia {
    throw new Error('Elysia is not available in browser')
  }
  post(_path: string, _handler: unknown): Elysia {
    throw new Error('Elysia is not available in browser')
  }
  listen(_port: number): void {
    throw new Error('Elysia is not available in browser')
  }
}

export default Elysia
