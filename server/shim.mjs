// Замена класса DurableObject из cloudflare:workers для запуска на своём сервере
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
