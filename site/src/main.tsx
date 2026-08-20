import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Белый экран — худшее, что может случиться с CRM: данные в браузере есть, а достать их нечем.
// Поэтому любой срыв рендера ловим и показываем экран, с которого можно спасти базу.
function rescue(err: unknown): ReactNode {
  const dump = () => {
    try {
      const blob = new Blob([window.localStorage.getItem("xxlcrm-site-v1") ?? "{}"], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "xxlcrm-backup.json";
      a.click();
    } catch { /* и это не вышло */ }
  }
  const clear = () => {
    if (!window.confirm("Стереть данные этого браузера? Сначала сохраните копию кнопкой рядом.")) return;
    try { window.localStorage.clear(); } catch { /* ignore */ }
    location.reload();
  }
  return (
    <div style={{ maxWidth: 560, margin: "12vh auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", color: "#2a2620", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>XXLcrm не смог открыться</h1>
      <p style={{ fontSize: 14, margin: "0 0 4px" }}>
        Данные никуда не делись — они лежат в этом браузере. Сохраните копию, потом попробуйте перезагрузить страницу.
        Если не помогает — очистите хранилище и загрузите копию обратно.
      </p>
      <p style={{ fontSize: 12, color: "#7a7266", margin: "8px 0 16px", wordBreak: "break-word" }}>{String(err)}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={dump} style={btn(true)}>Сохранить копию базы</button>
        <button onClick={() => location.reload()} style={btn(false)}>Перезагрузить</button>
        <button onClick={clear} style={btn(false)}>Очистить хранилище</button>
      </div>
    </div>
  );
}
const btn = (primary: boolean): React.CSSProperties => ({
  height: 36, padding: "0 14px", fontSize: 13, borderRadius: 8, cursor: "pointer",
  border: primary ? "none" : "1px solid #d6d0c4",
  background: primary ? "#2a2620" : "transparent", color: primary ? "#f7f4ec" : "#2a2620",
});

class Boundary extends Component<{ children: ReactNode }, { err: unknown }> {
  state = { err: null as unknown };
  static getDerivedStateFromError(err: unknown) { return { err }; }
  render() { return this.state.err ? rescue(this.state.err) : this.props.children; }
}

const root = document.getElementById("root")!;
try {
  createRoot(root).render(
    <StrictMode>
      <Boundary><App /></Boundary>
    </StrictMode>,
  );
} catch (err) {
  // сорвалось до первого рендера (например, переполненное хранилище в стороннем модуле)
  createRoot(root).render(rescue(err));
}
