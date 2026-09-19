interface SurfaceLease { release(): void }
interface SavedStyle {
  count: number;
  hadClass: boolean;
  declarations: Array<{ name: string; value: string; priority: string }>;
}

const surfaces = new WeakMap<HTMLElement, SavedStyle>();

/** WebView 아래 native 지도까지 모든 조상 배경을 열고, 중첩 지도는 요소별로 복구한다. */
export function acquireNativeMapTransparency(host: HTMLElement): SurfaceLease {
  const elements: HTMLElement[] = [];
  for (let element: HTMLElement | null = host; element; element = element.parentElement) {
    elements.push(element);
    const saved = surfaces.get(element);
    if (saved) saved.count += 1;
    else {
      surfaces.set(element, {
        count: 1,
        hadClass: element.classList.contains("hy-native-map-surface"),
        declarations: Array.from(element.style).filter((name) => name === "background" || name.startsWith("background-")).map((name) => ({
          name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
        })),
      });
      element.style.setProperty("background", "transparent", "important");
      element.classList.add("hy-native-map-surface");
    }
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      for (const element of elements) {
        const saved = surfaces.get(element);
        if (!saved || --saved.count > 0) continue;
        element.style.removeProperty("background");
        for (const { name, value, priority } of saved.declarations) element.style.setProperty(name, value, priority);
        if (!saved.hadClass) element.classList.remove("hy-native-map-surface");
        surfaces.delete(element);
      }
    },
  };
}
