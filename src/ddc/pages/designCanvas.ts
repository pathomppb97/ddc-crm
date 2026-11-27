import "./designCanvas.css";

type Send = (type: string, payload: Record<string, unknown>) => void;

// The interaction layer is a sibling of the inert CRM root. Hit testing uses
// clipped bounding boxes so controls under a scroll container are never targets.
export function installDesignCanvas(send: Send) {
  const layer = document.createElement("div");
  layer.className = "ddc-design-layer";
  const marker = document.createElement("div");
  marker.className = "ddc-design-drop";
  marker.hidden = true;
  layer.append(marker);
  const axes = ["width", "height", "both"] as const;
  type Axis = (typeof axes)[number];
  const grips = axes.map((axis) => {
    const el = document.createElement("div");
    el.className = "ddc-size-grip ddc-" + axis + "-grip";
    el.hidden = true;
    el.tabIndex = 0;
    el.setAttribute("role", axis === "both" ? "group" : "separator");
    if (axis !== "both") {
      el.setAttribute(
        "aria-orientation",
        axis === "width" ? "vertical" : "horizontal",
      );
      el.setAttribute("aria-valuemin", axis === "width" ? "48" : "32");
      el.setAttribute("aria-valuemax", axis === "width" ? "1600" : "4096");
    }
    layer.append(el);
    return { axis, el };
  });
  document.body.append(layer);
  const buttons = new Map<string, HTMLButtonElement>();
  let panel = "",
    selected = "",
    scheduled = 0;
  let drag: {
    id: string;
    x: number;
    y: number;
    pointer: number;
    moved: boolean;
    target: string;
    after: boolean;
  } | null = null;
  let lastX = 0,
    lastY = 0,
    scrolling = 0;
  let sizing: {
    pointer: number;
    axis: Axis;
    grip: HTMLElement;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    lastWidth?: number;
    lastHeight?: number;
  } | null = null;
  let measuredHeight = 0;
  let measuredWidth = 0;
  let gridTrack = Infinity;
  let selectedTrack = Infinity;

  function layout() {
    scheduled = 0;
    const seen = new Set<string>();
    let showGrip = false;
    for (const node of document.querySelectorAll<HTMLElement>(
      "[data-design-panel][data-design-id]",
    )) {
      if (node.dataset.designPanel !== panel) continue;
      const id = node.dataset.designId!;
      const rect = node.getBoundingClientRect();
      let { left, top, right, bottom } = rect;
      for (
        let parent = node.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "visible" && style.overflowY === "visible")
          continue;
        const bounds = parent.getBoundingClientRect();
        if (style.overflowX !== "visible") {
          left = Math.max(left, bounds.left);
          right = Math.min(right, bounds.left + parent.clientWidth);
        }
        if (style.overflowY !== "visible") {
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.top + parent.clientHeight);
        }
      }
      left = Math.max(0, left);
      top = Math.max(0, top);
      right = Math.min(innerWidth, right);
      bottom = Math.min(innerHeight, bottom);
      if (right - left < 5 || bottom - top < 5) continue;
      seen.add(id);
      let button = buttons.get(id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.item = id;
        button.setAttribute("aria-label", "Edit " + id);
        button.addEventListener("click", (e) => {
          if (e.detail === 0) send("ddc-select", { panel, id });
        });
        layer.append(button);
        buttons.set(id, button);
      }
      Object.assign(button.style, {
        left: left + "px",
        top: top + "px",
        width: right - left + "px",
        height: bottom - top + "px",
      });
      button.setAttribute("aria-pressed", String(selected === id));
      if (selected === id) {
        measuredWidth = Math.round(rect.width);
        const parentStyle =
          node.parentElement && getComputedStyle(node.parentElement);
        selectedTrack =
          panel === "form" && parentStyle?.display === "grid"
            ? parseFloat(parentStyle.gridTemplateColumns) || Infinity
            : Infinity;
        measuredHeight = Math.round(rect.height);
        for (const { axis, el } of grips) {
          const x = axis === "height" ? (left + right) / 2 : right;
          const y = axis === "width" ? (top + bottom) / 2 : bottom;
          el.style.left = Math.max(10, Math.min(x, innerWidth - 10)) + "px";
          el.style.top = Math.max(10, Math.min(y, innerHeight - 10)) + "px";
          const label = axis === "both" ? "width and height" : axis;
          el.setAttribute("aria-label", "Resize " + label + " of " + id);
          if (axis !== "both")
            el.setAttribute(
              "aria-valuenow",
              String(axis === "width" ? measuredWidth : measuredHeight),
            );
          el.title =
            label + " · " + measuredWidth + " × " + measuredHeight + " px";
        }
        showGrip = true;
      }
    }
    for (const { el } of grips) el.hidden = !showGrip && !sizing;
    for (const [id, button] of buttons) {
      if (!seen.has(id)) {
        button.remove();
        buttons.delete(id);
      }
    }
  }
  function schedule() {
    if (!scheduled) scheduled = requestAnimationFrame(layout);
  }
  const observer = new MutationObserver(schedule);
  const root = document.getElementById("root")!;
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  const controller = new AbortController();
  const options = { signal: controller.signal };
  window.addEventListener("scroll", schedule, { ...options, capture: true });
  window.addEventListener("resize", schedule, options);

  function at(x: number, y: number) {
    return document
      .elementFromPoint(x, y)
      ?.closest<HTMLButtonElement>(".ddc-design-layer button[data-item]");
  }
  function dropPosition(x: number, y: number) {
    if (!drag) return;
    const target = at(x, y);
    marker.hidden = true;
    drag.target = "";
    if (!target || target.dataset.item === drag.id) return;
    const rect = target.getBoundingClientRect();
    const source = buttons.get(drag.id)?.getBoundingClientRect();
    const horizontal =
      panel === "table" ||
      (panel === "form" && source && Math.abs(source.top - rect.top) < 10);
    const after = horizontal
      ? x >= rect.left + rect.width / 2
      : y >= rect.top + rect.height / 2;
    drag.target = target.dataset.item!;
    drag.after = after;
    Object.assign(marker.style, {
      top: (horizontal ? rect.top : after ? rect.bottom - 3 : rect.top) + "px",
      left: (horizontal && after ? rect.right - 3 : rect.left) + "px",
      width: (horizontal ? 3 : rect.width) + "px",
      height: (horizontal ? rect.height : 3) + "px",
    });
    marker.hidden = false;
  }
  function underlying(x: number, y: number) {
    // Inert retargets hit tests. Locate the corresponding CRM element by ID.
    const id = at(x, y)?.dataset.item ?? drag?.id;
    return id
      ? root.querySelector<HTMLElement>(
          `[data-design-panel="${CSS.escape(panel)}"][data-design-id="${CSS.escape(id)}"]`,
        )
      : null;
  }
  function scrollByPoint(x: number, y: number, dx: number, dy: number) {
    for (let el = underlying(x, y)?.parentElement; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (
        dx &&
        /auto|scroll/.test(s.overflowX) &&
        el.scrollWidth > el.clientWidth
      ) {
        const old = el.scrollLeft;
        el.scrollLeft += dx;
        if (old !== el.scrollLeft) dx = 0;
      }
      if (
        dy &&
        /auto|scroll/.test(s.overflowY) &&
        el.scrollHeight > el.clientHeight
      ) {
        const old = el.scrollTop;
        el.scrollTop += dy;
        if (old !== el.scrollTop) dy = 0;
      }
      if (!dx && !dy) break;
    }
    if (dx || dy) window.scrollBy(dx, dy);
  }
  layer.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      scrollByPoint(
        e.clientX,
        e.clientY,
        e.deltaX || (e.shiftKey ? e.deltaY : 0),
        e.shiftKey ? 0 : e.deltaY,
      );
    },
    { passive: false },
  );
  function autoScroll() {
    if (!drag?.moved) return;
    const dx = lastX < 36 ? -12 : lastX > innerWidth - 36 ? 12 : 0;
    const dy = lastY < 36 ? -12 : lastY > innerHeight - 36 ? 12 : 0;
    if (dx || dy) {
      scrollByPoint(lastX, lastY, dx, dy);
      dropPosition(lastX, lastY);
    }
    scrolling = requestAnimationFrame(autoScroll);
  }
  function dimensions(axis: Axis, width: number, height: number) {
    return {
      ...(axis !== "height" && {
        width: Math.max(48, Math.min(1600, Math.round(width))),
      }),
      ...(axis !== "width" && {
        height: Math.max(32, Math.min(4096, Math.round(height))),
      }),
    };
  }
  function moveGrip(e: PointerEvent) {
    if (!sizing || sizing.pointer !== e.pointerId) return;
    const dx = e.clientX - sizing.startX,
      dy = e.clientY - sizing.startY;
    if (
      sizing.lastWidth === undefined &&
      sizing.lastHeight === undefined &&
      Math.max(
        sizing.axis === "height" ? 0 : Math.abs(dx),
        sizing.axis === "width" ? 0 : Math.abs(dy),
      ) < 2
    )
      return;
    const size = dimensions(
      sizing.axis,
      sizing.startWidth + dx,
      sizing.startHeight + dy,
    );
    if (size.width === sizing.lastWidth && size.height === sizing.lastHeight)
      return;
    sizing.lastWidth = size.width;
    sizing.lastHeight = size.height;
    send("ddc-size-preview", {
      panel,
      id: selected,
      ...size,
      spanRow: size.width !== undefined && size.width > gridTrack + 1,
    });
  }
  function finishGrip(commit: boolean) {
    if (!sizing) return;
    const { pointer, grip, lastWidth: width, lastHeight: height } = sizing;
    sizing = null;
    if (width !== undefined || height !== undefined)
      send(commit ? "ddc-size-end" : "ddc-size-cancel", {
        panel,
        id: selected,
        width,
        height,
        spanRow: width !== undefined && width > gridTrack + 1,
      });
    if (grip.hasPointerCapture(pointer)) grip.releasePointerCapture(pointer);
    schedule();
  }
  for (const { axis, el } of grips) {
    el.addEventListener("pointerdown", (e) => {
      if (sizing || drag || e.button !== 0 || !selected) return;
      e.preventDefault();
      e.stopPropagation();
      el.focus({ preventScroll: true });
      el.setPointerCapture(e.pointerId);
      gridTrack = selectedTrack;
      sizing = {
        axis,
        grip: el,
        pointer: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: measuredWidth,
        startHeight: measuredHeight,
      };
    });
    el.addEventListener("pointermove", moveGrip);
    el.addEventListener("pointerup", (e) => {
      if (sizing?.pointer !== e.pointerId) return;
      moveGrip(e);
      finishGrip(true);
    });
    for (const event of ["pointercancel", "lostpointercapture"] as const)
      el.addEventListener(event, (e) => {
        if (sizing?.pointer === e.pointerId) finishGrip(false);
      });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        finishGrip(false);
        return;
      }
      if (sizing) return;
      const dx = Number(e.key === "ArrowRight") - Number(e.key === "ArrowLeft");
      const dy = Number(e.key === "ArrowDown") - Number(e.key === "ArrowUp");
      if (!(dx && axis !== "height") && !(dy && axis !== "width")) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const size = dimensions(
        dx ? "width" : "height",
        measuredWidth + step * dx,
        measuredHeight + step * dy,
      );
      send("ddc-size-end", {
        panel,
        id: selected,
        ...size,
        spanRow: size.width !== undefined && size.width > selectedTrack + 1,
      });
    });
  }
  layer.addEventListener("pointerdown", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-item]",
    )?.dataset.item;
    if (!id || e.button !== 0 || drag || sizing) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    drag = {
      id,
      x: e.clientX,
      y: e.clientY,
      pointer: e.pointerId,
      moved: false,
      target: "",
      after: false,
    };
  });
  layer.addEventListener("pointermove", (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!drag.moved && Math.hypot(lastX - drag.x, lastY - drag.y) > 5) {
      drag.moved = true;
      layer.classList.add("dragging");
      autoScroll();
    }
    if (drag.moved) dropPosition(lastX, lastY);
  });
  function finish(e: PointerEvent, commit: boolean) {
    if (!drag || drag.pointer !== e.pointerId) return;
    if (commit) {
      if (drag.moved) {
        dropPosition(e.clientX, e.clientY);
        if (drag.target)
          send("ddc-move", {
            panel,
            id: drag.id,
            target: drag.target,
            after: drag.after,
          });
      } else send("ddc-select", { panel, id: drag.id });
    }
    drag = null;
    cancelAnimationFrame(scrolling);
    marker.hidden = true;
    layer.classList.remove("dragging");
    if (layer.hasPointerCapture(e.pointerId))
      layer.releasePointerCapture(e.pointerId);
  }
  layer.addEventListener("pointerup", (e) => finish(e, true));
  layer.addEventListener("pointercancel", (e) => finish(e, false));
  layer.addEventListener("lostpointercapture", (e) => finish(e, false));
  return {
    update(next: string, id?: string) {
      if (next !== panel || (id || "") !== selected) finishGrip(false);
      panel = next;
      selected = id || "";
      schedule();
    },
    destroy() {
      observer.disconnect();
      resize.disconnect();
      controller.abort();
      cancelAnimationFrame(scheduled);
      cancelAnimationFrame(scrolling);
      layer.remove();
    },
  };
}
