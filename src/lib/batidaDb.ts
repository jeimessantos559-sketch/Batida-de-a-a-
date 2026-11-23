import type { SupabaseClient } from "@supabase/supabase-js";

type Row = { id: string; data: Record<string, unknown> };
type Sub = { cb: (snap: unknown) => void; err?: (e: unknown) => void };

// Adaptador que o app da batida (public/batida.html) usa para salvar os dados na tabela `docs`.
export function makeBatidaDb(sb: SupabaseClient) {
  let rows: Row[] = [];
  const subs = new Set<Sub>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;

  const snap = () => ({ docs: rows.map((r) => ({ id: r.id, data: () => r.data })) });

  async function refresh() {
    const { data, error } = await sb.from("docs").select("id,data").limit(20000);
    if (error) {
      console.error("[batida] erro ao carregar", error);
      subs.forEach((s) => s.err?.(error));
      return;
    }
    rows = (data as Row[]) || [];
    subs.forEach((s) => s.cb(snap()));
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
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") later();
      });
    }
  }
  const kindOf = (d: Record<string, unknown> | null | undefined, id: string) =>
    (d && typeof d.type === "string" && d.type) || (id === "pricing" ? "pricing" : "doc");
  const check = (r: { error: unknown }) => {
    if (r.error) throw r.error;
    later();
  };

  return {
    add(data: Record<string, unknown>) {
      const id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      return sb
        .from("docs")
        .insert({ id, kind: kindOf(data, id), data })
        .then((r) => {
          check(r);
          return { id };
        });
    },
    doc(id: string) {
      return {
        set(data: Record<string, unknown>) {
          return sb.from("docs").upsert({ id, kind: kindOf(data, id), data }).then(check);
        },
        async update(patch: Record<string, unknown>) {
          const { data: cur, error } = await sb.from("docs").select("data").eq("id", id).maybeSingle();
          if (error) throw error;
          if (!cur) throw new Error("documento não encontrado");
          const merged = { ...(cur.data as Record<string, unknown>), ...patch };
          check(await sb.from("docs").update({ data: merged }).eq("id", id));
        },
        delete() {
          return sb.from("docs").delete().eq("id", id).then(check);
        },
      };
    },
    onSnapshot(cb: (snap: unknown) => void, err?: (e: unknown) => void) {
      const s: Sub = { cb, err };
      subs.add(s);
      ensureChannel();
      refresh();
      return () => {
        subs.delete(s);
      };
    },
  };
}
