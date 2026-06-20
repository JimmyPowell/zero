import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

import { useUi } from "@/lib/ui-store";

const LONG_PRESS_MS = 350;

// 对话区右下角浮动滚动导航：短按 上/下 = 上一条/下一条消息，长按 = 到顶/到底。
// 用 sticky h-0 钉在滚动容器视口底部右侧（不额外撑高内容），仅在可滚动时显示。
export function ScrollNav({
  scrollRef,
}: {
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const { t } = useUi();
  const [show, setShow] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);
  const timer = useRef<number | null>(null);
  const longFired = useRef(false);

  // 监听滚动容器：是否可滚动 + 到顶/到底（内容变化也更新）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setShow(el.scrollHeight > el.clientHeight + 80);
      setAtTop(el.scrollTop <= 8);
      setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 8);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef]);

  const anchors = (): HTMLElement[] => {
    const el = scrollRef.current;
    return el ? Array.from(el.querySelectorAll<HTMLElement>("[data-msg]")) : [];
  };
  const toTop = () =>
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const toBottom = () => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };
  // 上一条：最后一个明显在当前位置之上的锚点；没有就到顶
  const stepPrev = () => {
    const el = scrollRef.current;
    if (!el) return;
    let target: HTMLElement | null = null;
    for (const a of anchors()) {
      if (a.offsetTop < el.scrollTop - 4) target = a;
      else break;
    }
    if (target)
      el.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: "smooth" });
    else toTop();
  };
  // 下一条：第一个在当前位置之下的锚点；没有就到底
  const stepNext = () => {
    const el = scrollRef.current;
    if (!el) return;
    const target = anchors().find((a) => a.offsetTop > el.scrollTop + 4);
    if (target) el.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
    else toBottom();
  };

  const onDown = (dir: "up" | "down") => {
    longFired.current = false;
    timer.current = window.setTimeout(() => {
      longFired.current = true; // 长按：直达顶/底
      if (dir === "up") toTop();
      else toBottom();
    }, LONG_PRESS_MS);
  };
  const onUp = (dir: "up" | "down") => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!longFired.current) {
      // 短按：上一条/下一条
      if (dir === "up") stepPrev();
      else stepNext();
    }
  };
  const onCancel = () => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    longFired.current = true; // 移出/取消：这次松手不触发短按
  };

  if (!show) return null;

  const btn =
    "pointer-events-auto flex size-9 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground shadow-md backdrop-blur transition-all hover:bg-card hover:text-foreground hover:shadow-lg disabled:pointer-events-none disabled:opacity-30";

  return (
    <div className="pointer-events-none sticky bottom-0 z-20 h-0 self-stretch">
      <div className="absolute right-1 bottom-5 flex flex-col gap-2">
        <button
          type="button"
          aria-label={t("scrollnav.up")}
          title={t("scrollnav.up")}
          disabled={atTop}
          onPointerDown={() => onDown("up")}
          onPointerUp={() => onUp("up")}
          onPointerLeave={onCancel}
          onPointerCancel={onCancel}
          className={btn}
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("scrollnav.down")}
          title={t("scrollnav.down")}
          disabled={atBottom}
          onPointerDown={() => onDown("down")}
          onPointerUp={() => onUp("down")}
          onPointerLeave={onCancel}
          onPointerCancel={onCancel}
          className={btn}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
    </div>
  );
}
