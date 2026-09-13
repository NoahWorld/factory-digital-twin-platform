import { Zip,ZipPassThrough } from "fflate";

export type ZipStreamEntry = { path:string;bytes:Uint8Array;executable?:boolean };
export function zipStream(entries:(signal:AbortSignal) => AsyncGenerator<ZipStreamEntry>,signal:AbortSignal):ReadableStream<Uint8Array> {
  const collecting = new AbortController(),iterator = entries(collecting.signal);
  let cancelled = false,ended = false,pending:Uint8Array[] = [],zipError:Error|null = null;
  const zip = new Zip((error,data,final) => { if (error) zipError = error; else { pending.push(data); if (final) ended = true; } });
  const cleanup = () => { if (cancelled) return; cancelled = true; collecting.abort(); zip.terminate(); pending = []; signal.removeEventListener("abort",abort); void iterator.return(undefined).catch(() => {}); };
  let controller:ReadableStreamDefaultController<Uint8Array>;
  const abort = () => { cleanup(); try { controller.error(new DOMException("ZIP export cancelled","AbortError")); } catch { /* Stream already closed. */ } };
  return new ReadableStream<Uint8Array>({
    start(value) { controller = value; signal.addEventListener("abort",abort,{ once:true }); if (signal.aborted) abort(); },
    async pull(value) {
      if (cancelled) return;
      try {
        if (!pending.length && !ended) {
          const item = await iterator.next(); if (cancelled) return;
          if (item.done) zip.end();
          else {
            const entry = new ZipPassThrough(item.value.path); entry.mtime = new Date("2000-01-01T00:00:00Z"); entry.os = 3; entry.attrs = (item.value.executable ? 0o100755 : 0o100644)<<16; zip.add(entry);
            const bytes = item.value.bytes;
            for (let offset = 0; offset < bytes.byteLength; offset+=65536) entry.push(bytes.subarray(offset,Math.min(offset+65536,bytes.byteLength)),offset+65536 >= bytes.byteLength);
            if (!bytes.byteLength) entry.push(bytes,true);
          }
        }
        if (zipError) throw zipError;
        const chunk = pending.shift(); if (chunk) value.enqueue(chunk);
        if (ended && !pending.length) { cleanup(); value.close(); }
      } catch (reason) { cleanup(); value.error(reason); }
    },cancel() { cleanup(); },
  },{ highWaterMark:1 });
}
