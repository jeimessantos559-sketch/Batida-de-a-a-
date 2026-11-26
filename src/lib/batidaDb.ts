import type { SupabaseClient } from "@supabase/supabase-js";

type Data = Record<string, unknown>;
type Row = { id: string; data: Data };
type Sub = { cb: (snap: unknown) => void; err?: (e: unknown) => void };
type Op =
  | { k: "set"; id: string; kind: string; data: Data }
  | { k: "patch"; id: string; patch: Data }
  | { k: "del"; id: string };
export type BatidaStatus = { online: boolean; pending: number };

const CACHE_KEY = "batida-cache-v1";
const OUTBOX_KEY = "batida-outbox-v1";

// Adaptador que o app da batida (public/batida.html) usa para salvar os dados na tabela `docs`.
// Funciona sem internet: guarda uma cópia dos dados no aparelho e uma fila de alterações,
// que é enviada sozinha quando a internet volta.
export function makeBatidaDb(sb: SupabaseClient) {
  const ls = typeof localStorage !== "undefined" ? localStorage : null;
  const load = <T,>(k: string, d: T): T => {
    try {
      const v = ls?.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  };
  const store = (k: string, v: unknown) => {
    try {
      ls?.setItem(k, JSON.stringify(v));
    } catch {
      /* armazenamento cheio: segue só na memória */
    }
  };

  let rows: Row[] = load<Row[]>(CACHE_KEY, []);
  let outbox: Op[] = load<Op[]>(OUTBOX_KEY, []);
  let online = typeof navigator === "undefined" ? true : navigator.onLine;
  let flushing = false;
  const subs = new Set<Sub>();
  const statusSubs = new Set<(s: BatidaStatus) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;

  const snap = () => ({ docs: rows.map((r) => ({ id: r.id, data: () => r.data })) });
  const status = (): BatidaStatus => ({ online, pending: outbox.length });
  const emitStatus = () => statusSubs.forEach((f) => f(status()));
  const emit = () => subs.forEach((s) => s.cb(snap()));
  const saveCache = () => store(CACHE_KEY, rows);
  const saveOutbox = () => store(OUTBOX_KEY, outbox);

  function applyLocal(list: Row[], op: Op): Row[] {
    if (op.k === "del") return list.filter((r) => r.id !== op.id);
    const i = list.findIndex((r) => r.id === op.id);
    if (op.k === "set") {
      const r = { id: op.id, data: op.data };
      if (i < 0) return [...list, r];
      const c = list.slice();
      c[i] = r;
      return c;
    }
    if (i < 0) return list;
    const c = list.slice();
    c[i] = { id: op.id, data: { ...c[i]!.data, ...op.patch } };
    return c;
  }

  const isNetErr = (e: unknown) => {
    const m = String((e as { message?: string })?.message ?? e ?? "");
    return (
      (typeof navigator !== "undefined" && !navigator.onLine) ||
      /fetch|network|load failed|timeout|offline|abort/i.test(m)
    );
  };

  async function sendOp(op: Op) {
    if (op.k === "set") {
      const r = await sb.from("docs").upsert({ id: op.id, kind: op.kind, data: op.data });
      if (r.error) throw r.error;
    } else if (op.k === "patch") {
      const { data: cur, error } = await sb.from("docs").select("data,kind").eq("id", op.id).maybeSingle();
      if (error) throw error;
      if (!cur) return; // já foi apagado em outro aparelho
      const merged = { ...(cur.data as Data), ...op.patch };
      const r = await sb.from("docs").update({ data: merged }).eq("id", op.id);
      if (r.error) throw r.error;
    } else {
      const r = await sb.from("docs").delete().eq("id", op.id);
      if (r.error) throw r.error;
    }
  }

  async function flush() {
    if (flushing || !outbox.length) return;
    flushing = true;
    try {
      while (outbox.length) {
        try {
          await sendOp(outbox[0]!);
          online = true;
        } catch (e) {
          if (isNetErr(e)) {
            online = false;
            emitStatus();
            return;
          }
          console.error("[batida] alteração recusada pelo servidor, descartada", outbox[0], e);
        }
        outbox.shift();
        saveOutbox();
        emitStatus();
      }
      later();
    } finally {
      flushing = false;
    }
  }

  function enqueue(op: Op) {
    rows = applyLocal(rows, op);
    outbox.push(op);
    saveCache();
    saveOutbox();
    emit();
    emitStatus();
    void flush();
  }

  async function refresh() {
    const { data, error } = await sb.from("docs").select("id,data").limit(20000);
    if (error) {
      if (isNetErr(error)) {
        if (online) {
          online = false;
          emitStatus();
        }
        return; // sem internet: continua com a cópia do aparelho
      }
      console.error("[batida] erro ao carregar", error);
      subs.forEach((s) => s.err?.(error));
      return;
    }
    if (!online) {
      online = true;
      emitStatus();
    }
    let fresh = (data as Row[]) || [];
    // alterações ainda não enviadas continuam valendo na tela
    for (const op of outbox) fresh = applyLocal(fresh, op);
    rows = fresh;
    saveCache();
    emit();
    if (outbox.length) void flush();
  }
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  };
  function ensureChannel() {
    if (channel) return;
    channel = sb
      .channel("docs-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, later)
      .subscribe();
    if (typeof window !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          void flush();
          later();
        }
      });
      window.addEventListener("online", () => {
        online = true;
        emitStatus();
        void flush();
        later();
      });
      window.addEventListener("offline", () => {
        online = false;
        emitStatus();
      });
      setInterval(() => {
        if (outbox.length) void flush();
      }, 20000);
    }
  }
  const kindOf = (d: Data | null | undefined, id: string) =>
    (d && typeof d["type"] === "string" && (d["type"] as string)) || (id === "pricing" ? "pricing" : "doc");

  return {
    add(data: Data) {
      const id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      enqueue({ k: "set", id, kind: kindOf(data, id), data });
      return Promise.resolve({ id });
    },
    doc(id: string) {
      return {
        set(data: Data) {
          enqueue({ k: "set", id, kind: kindOf(data, id), data });
          return Promise.resolve();
        },
        update(patch: Data) {
          if (!rows.some((r) => r.id === id)) return Promise.reject(new Error("documento não encontrado"));
          enqueue({ k: "patch", id, patch });
          return Promise.resolve();
        },
        delete() {
          enqueue({ k: "del", id });
          return Promise.resolve();
        },
      };
    },
    onSnapshot(cb: (snap: unknown) => void, err?: (e: unknown) => void) {
      const s: Sub = err ? { cb, err } : { cb };
      subs.add(s);
      ensureChannel();
      if (rows.length) cb(snap()); // mostra na hora o que está guardado no aparelho
      void refresh();
      void flush();
      return () => {
        subs.delete(s);
      };
    },
    onStatus(cb: (s: BatidaStatus) => void) {
      statusSubs.add(cb);
      cb(status());
      return () => {
        statusSubs.delete(cb);
      };
    },
    status,
  };
}
