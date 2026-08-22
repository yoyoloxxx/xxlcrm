// Подсветить и прокрутить к нужной карточке канала в Настройках.
// Живёт отдельным модулем: на неё ссылаются и Настройки, и «Приём заявок», и Входящие —
// прямой импорт между ними завязал бы их в кольцо.
export function focusChannel(id: string, tries = 12): void {
  const el = document.querySelector(`[data-ch="${id}"]`) as HTMLElement | null;
  if (!el) {                                   // экран настроек ещё не отрисован — подождём кадр
    if (tries > 0) window.setTimeout(() => focusChannel(id, tries - 1), 80);
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.transition = "box-shadow .25s";
  el.style.boxShadow = "0 0 0 2px hsl(var(--brass))";
  window.setTimeout(() => { el.style.boxShadow = ""; }, 1800);
}
// канал маршрута → карточка в настройках («сайт» называется site, чтобы не путать с Тильдой)
export const channelCard = (src: string) => (src === "tilda" ? "site" : src);
