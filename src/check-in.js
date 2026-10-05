import { evaluateGeofence, formatDistance } from "./geo.js";
import { getAttraction } from "./formatting.js";

export function createCheckInController({
  getState, isResetting, operationToken, isCurrentOperation,
  persist, render, showToast, askConfirmation, celebrateStamp, navigator
}) {
  function recordCheckIn(attraction, method, verified, token) {
    if (!isCurrentOperation(attraction.id, token) || getState().checkIns[attraction.id]) return false;
    getState().checkIns[attraction.id] = {
      attractionId: attraction.id,
      checkedInAt: new Date().toISOString(),
      method,
      verified
    };
    const saved = persist();
    render();
    celebrateStamp(attraction);
    showToast(
      saved ? `${attraction.name}打卡完成！` : "打卡只暫存於目前頁面，未能寫入這部裝置。",
      saved ? "success" : "warning"
    );
    return true;
  }

  async function offerManualCheckIn(attraction, reason, token) {
    if (!isCurrentOperation(attraction.id, token)) return false;
    const accepted = await askConfirmation({
      title: `在${attraction.name}手動記錄？`,
      message: `${reason} 你可以把這次到訪記錄為「未核實手動打卡」，但它不會顯示 GPS 已核實。`,
      isRelevant: () => isCurrentOperation(attraction.id, token) && !getState().checkIns[attraction.id],
      confirmText: "手動打卡"
    });
    return accepted ? recordCheckIn(attraction, "manual", false, token) : false;
  }

  async function startCheckIn(attractionId, button) {
    const attraction = getAttraction(attractionId);
    if (isResetting() || !attraction || getState().checkIns[attractionId]) return;
    const token = operationToken(attractionId);
    button?.setAttribute("aria-busy", "true");
    if (button) button.disabled = true;

    if (!navigator.geolocation) {
      await offerManualCheckIn(attraction, "此瀏覽器不支援位置功能。 ", token);
      if (isCurrentOperation(attractionId, token)) render();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (!isCurrentOperation(attractionId, token) || getState().checkIns[attractionId]) return;
        const result = evaluateGeofence(
          { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy },
          attraction.geo
        );
        if (result.status === "verified") {
          recordCheckIn(attraction, "gps", true, token);
        } else if (result.status === "inaccurate") {
          await offerManualCheckIn(attraction, `目前定位誤差約 ${Math.round(result.accuracy || 0)} 米，未能可靠核實。`, token);
          if (isCurrentOperation(attractionId, token)) render();
        } else {
          showToast(`你的位置距離景點約 ${formatDistance(result.distance)}，尚未進入打卡範圍。`, "warning");
          if (isCurrentOperation(attractionId, token)) render();
        }
      },
      async (error) => {
        if (!isCurrentOperation(attractionId, token) || getState().checkIns[attractionId]) return;
        const reason = error.code === 1 ? "你沒有允許位置權限。" : error.code === 3 ? "位置要求逾時。" : "暫時未能取得位置。";
        await offerManualCheckIn(attraction, reason, token);
        if (isCurrentOperation(attractionId, token)) render();
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  return { startCheckIn };
}
