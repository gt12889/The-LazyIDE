import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

type LocalEvent = { kind: 'headers'; status: number } | { kind: 'data'; bytes: number[] } | { kind: 'done' };

/** Native streaming bridge avoids changing the user's Ollama CORS settings. */
export function localFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isTauri()) return fetch(url, init);
  if (init.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const id = crypto.randomUUID();
  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let ended = false;
    const cancel = () => { void invoke('local_llm_cancel', { id }).catch(() => {}); };
    const body = new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
      cancel() { ended = true; cancel(); },
    });
    const abort = () => {
      if (!ended) {
        ended = true;
        const error = new DOMException('Aborted', 'AbortError');
        controller.error(error);
        reject(error);
        cancel();
      }
    };
    init.signal?.addEventListener('abort', abort, { once: true });
    const onEvent = new Channel<LocalEvent>();
    onEvent.onmessage = (event) => {
      if (ended) return;
      if (event.kind === 'headers') resolve(new Response(body, { status: event.status }));
      else if (event.kind === 'data') controller.enqueue(new Uint8Array(event.bytes));
      else { ended = true; controller.close(); init.signal?.removeEventListener('abort', abort); }
    };
    void invoke('local_llm_request', {
      id, url, body: init.body ? JSON.parse(String(init.body)) : null, onEvent,
    }).catch((cause: unknown) => {
      if (!ended) {
        ended = true;
        const error = new Error(String(cause));
        controller.error(error);
        reject(error);
        init.signal?.removeEventListener('abort', abort);
      }
    });
  });
}
