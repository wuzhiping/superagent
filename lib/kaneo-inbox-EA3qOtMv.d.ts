import "./kind-DUtZFUu7.js";
import "./kaneo-api-CFd1tToG.js";
//#region src/sources/kaneo-inbox.d.ts
/** One event of another Source, as it is filed. */
interface InboxEvent {
  /** 来源名（gitea、ntfy…）：标签与说明都用它。 */
  source: string;
  /** 卡片标题：原事件的标题（没有标题就用正文首行）。 */
  title: string;
  /** 原事件的正文。 */
  body?: string | undefined;
  /** 原链接：写进描述的 `Source URL:` 一行。 */
  url?: string | undefined;
  /** 发起人。 */
  by?: string | undefined;
}
//#endregion
export { InboxEvent as t };