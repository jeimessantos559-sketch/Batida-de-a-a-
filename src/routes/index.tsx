import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { makeBatidaDb } from "@/lib/batidaDb";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Batida de Açaí" },
      { name: "description", content: "Clientes, pedidos, produção, gastos e preços da Batida de Açaí" },
      { name: "theme-color", content: "#140826" },
    ],
  }),
  component: Index,
});

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };

function Index() {
  const [ready, setReady] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    (window as unknown as { batidaDb: unknown }).batidaDb = makeBatidaDb(supabase);
    setReady(true);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    const onInstalled = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return (
    <main style={{ position: "fixed", inset: 0, background: "#140826" }}>
      {ready && (
        <iframe
          src="/batida.html"
          title="Batida de Açaí"
          style={{ border: 0, width: "100%", height: "100%", display: "block" }}
        />
      )}
      {install && (
        <button
          type="button"
          onClick={async () => {
            await install.prompt();
            await install.userChoice.catch(() => {});
            setInstall(null);
          }}
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 10,
            padding: "12px 18px",
            borderRadius: 999,
            border: 0,
            background: "#FFC72C",
            color: "#140826",
            fontWeight: 800,
            fontSize: 15,
            boxShadow: "0 6px 20px rgba(0,0,0,.35)",
            cursor: "pointer",
          }}
        >
          Instalar app
        </button>
      )}
    </main>
  );
}
