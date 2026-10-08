// These fixtures use an empty origin; activation keeps exactly one app-shell cache.
export async function getAppShellCache() {
  const names = (await caches.keys()).filter(name => /^outdoor-learning-day-v\d+$/.test(name));
  if (names.length !== 1) throw new Error("未能確認目前啟用的離線快取。");
  return caches.open(names[0]);
}
