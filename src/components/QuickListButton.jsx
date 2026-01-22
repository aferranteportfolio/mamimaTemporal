import { useEffect, useRef, useState } from "react";

/**
 * @param {{
 *   items: string[],
 *   onPick: (value:string)=>void,
 *   title?: string
 * }} props
 */
export default function QuickListButton({ items, onPick, title = "Quick actions" }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  // close on outside click / Esc + HOTKEY (key left of "1")
  useEffect(() => {
    console.log("[QLB] effect mount, open =", open);

    function onDocClick(e) {
      if (!open) return;
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      console.log("[QLB] outside click → close");
      setOpen(false);
    }

    function onKey(e) {
      console.log("[QLB][keydown]", {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        target: e.target?.tagName,
      });

      // close with Esc
      if (e.key === "Escape") {
        console.log("[QLB] ESC → close");
        setOpen(false);
        return;
      }

      // HOTKEY: physical key to the LEFT of "1" (usually Backquote)
      // and with no modifiers
      if (
        e.code === "Backquote" && // physical key
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        e.preventDefault(); // avoid typing the character into the input

        setOpen(v => {
          const next = !v;
          console.log("[QLB] HOTKEY Backquote → toggle", { next });
          return next;
        });

        // optional: when opening, focus first quick item
        if (!open) {
          queueMicrotask(() => {
            const firstItem = popRef.current?.querySelector(".qlb-item");
            firstItem?.focus?.();
          });
        }
      }
    }

    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey, true); // capture = true just in case

    return () => {
      console.log("[QLB] effect cleanup");
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="qlb-wrap">
      <button
        ref={btnRef}
        type="button"
        className="qlb-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(v => !v)}
      >
        ⋯
      </button>

      {open && (
        <div ref={popRef} className="qlb-pop" role="listbox" tabIndex={-1}>
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="option"
              className="qlb-item"
              onClick={() => {
                onPick(it);
                setOpen(false);
              }}
            >
              {it}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
