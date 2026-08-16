// Клиент Supabase. anon-ключ публичный по дизайну — доступ к данным ограничивает RLS на сервере.
import { createClient } from "@supabase/supabase-js";

export const SUPA_URL = "https://nddauhfqciuvzbvdipuf.supabase.co";
export const SUPA_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kZGF1aGZxY2l1dnpidmRpcHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NzU5NTcsImV4cCI6MjEwMjQ1MTk1N30.tkbPMNc10kyr__q3N5qwEcj1x30SDRmg6hYc8Mr8Gsc";

export const supa = createClient(SUPA_URL, SUPA_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "xxlcrm-auth" },
});
