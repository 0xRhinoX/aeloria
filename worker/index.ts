import { DurableObject } from 'cloudflare:workers';

interface Env {
  ASSETS: Fetcher;
  PRESENCE: DurableObjectNamespace<Presence>;
}

/**
 * Counts open game tabs. One instance holds a WebSocket per tab and tells every tab the total
 * whenever someone joins or leaves. It hibernates in between, so idle players cost nothing.
 */
export class Presence extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // keep-alive pings are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketClose(ws: WebSocket) { this.leave(ws); }
  webSocketError(ws: WebSocket) { this.leave(ws); }

  private leave(ws: WebSocket) {
    try { ws.close(1000); } catch { /* already closed */ }
    this.broadcast(ws);
  }

  private broadcast(gone?: WebSocket) {
    const open = this.ctx.getWebSockets().filter(w => w !== gone && w.readyState === WebSocket.OPEN);
    for (const w of open) {
      try { w.send(String(open.length)); } catch { /* closing; its own close event rebroadcasts */ }
    }
  }
}

export default {
  fetch(req, env) {
    if (new URL(req.url).pathname === '/api/presence') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return env.PRESENCE.get(env.PRESENCE.idFromName('world')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
