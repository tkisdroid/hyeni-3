interface SurfaceLease { release(): void }
interface SavedStyle { element: HTMLElement; background: string; backgroundColor: string }

let leaseCount = 0;
let savedStyles: SavedStyle[] = [];

export function acquireNativeMapTransparency(host: HTMLElement): SurfaceLease {
  if (leaseCount === 0) {
    const candidates = [document.getElementById("root"), host.closest<HTMLElement>(".hy-app"), host.closest<HTMLElement>(".hy-screen"), host]
      .filter((element): element is HTMLElement => Boolean(element));
    savedStyles = [...new Set(candidates)].map((element) => ({
      element,
      background: element.style.background,
      backgroundColor: element.style.backgroundColor,
    }));
    for (const item of savedStyles) {
      item.element.style.background = "transparent";
      item.element.style.backgroundColor = "transparent";
    }
  }
  leaseCount += 1;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      leaseCount = Math.max(0, leaseCount - 1);
      if (leaseCount !== 0) return;
      for (const item of savedStyles) {
        item.element.style.background = item.background;
        item.element.style.backgroundColor = item.backgroundColor;
      }
      savedStyles = [];
    },
  };
}
