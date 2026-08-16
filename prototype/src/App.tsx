import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { initIntegrations } from "@/lib/integrations";
import { Wizard } from "@/components/app/Wizard";
import { Shell } from "@/components/app/Shell";
import { Toaster } from "sonner";

export default function App() {
  const s = useApp();
  const dark = s.screen === "app" && !!s.ws && s.theme === "dark";
  useEffect(() => { initIntegrations(); }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <>
      {s.screen === "wizard" || !s.ws ? <Wizard /> : <Shell />}
      <Toaster
        position="bottom-left"
        toastOptions={{
          style: dark
            ? { background: "hsl(43 22% 90%)", color: "hsl(40 12% 12%)", border: "none", fontSize: "13px", fontFamily: "inherit" }
            : { background: "hsl(40 18% 13%)", color: "hsl(45 40% 96%)", border: "none", fontSize: "13px", fontFamily: "inherit" },
        }}
      />
    </>
  );
}
