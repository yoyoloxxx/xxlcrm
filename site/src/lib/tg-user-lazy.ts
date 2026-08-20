// Мост к личному Telegram, который НЕ тянет GramJS, пока он не понадобился.
// Библиотека при загрузке пишет в localStorage свой кэш на 1,3 МБ — это четверть квоты браузера
// у человека, который личный Telegram вообще не подключал, и его база из-за этого не помещалась.
import { getState } from "./store";

type Mod = typeof import("./tg-user");
let mod: Promise<Mod> | null = null;
const load = (): Promise<Mod> => (mod ??= import("./tg-user"));

/** Ключи приложения нужны в форме до загрузки библиотеки — держим копию здесь. */
export const TG_APP = { apiId: "", apiHash: "" };

export const tguStartLogin = async (apiId: string, apiHash: string, phone: string) => (await load()).tguStartLogin(apiId, apiHash, phone);
export const tguSubmitCode = async (code: string) => (await load()).tguSubmitCode(code);
export const tguSubmitPassword = async (pw: string) => (await load()).tguSubmitPassword(pw);
export const tguCancelLogin = async () => (await load()).tguCancelLogin();
export const tguDisconnect = async () => (await load()).tguDisconnect();
export const tguResync = async () => (await load()).tguResync();
export const tguSend = async (peer: string, text: string) => (await load()).tguSend(peer, text);
/** На старте грузим библиотеку ТОЛЬКО если человек уже входил в личный Telegram. */
export const tguInit = async () => {
  if (!getState().integrations.tgUser.session) return;
  return (await load()).tguInit();
};
