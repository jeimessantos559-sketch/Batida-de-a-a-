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

function Index() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (window as unknown as { batidaDb: unknown }).batidaDb = makeBatidaDb(supabase);
    setReady(true);
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
    </main>
  );
}
