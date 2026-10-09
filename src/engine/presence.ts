import { useUI } from '../state/store';

/** Keeps `online` in the store up to date from the Presence Durable Object (worker/index.ts). */
export function trackPresence() {
  if (import.meta.env.DEV) return; // the Vite dev server has no Worker behind it
  let retry = 2000;
  const connect = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/presence`);
    const ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 40_000);
    ws.onopen = () => { retry = 2000; };
    ws.onmessage = e => {
      const n = parseInt(e.data, 10);
      if (n > 0) useUI.setState({ online: n });
    };
    ws.onclose = () => {
      clearInterval(ping);
      useUI.setState({ online: null });
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 60_000);
    };
  };
  connect();
}
