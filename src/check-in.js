import { evaluateGeofence, formatDistance } from "./geo.js";
import { getAttraction } from "./formatting.js";

export function createCheckInController({
  hasCheckIn, commitCheckIn, canUseAttraction, operationToken, isCurrentOperation,
  render, showToast, askConfirmation, celebrateStamp, navigator,
  lookupAttraction = getAttraction, onLocationResult = () => {}
}) {
  function recordCheckIn(attraction, method, verified, token) {
    if (!isCurrentOperation(attraction.id, token) || hasCheckIn(attraction.id)) return false;
    const result = commitCheckIn(attraction.id, {
      attractionId: attraction.id,
      checkedInAt: new Date().toISOString(),
      method,
      verified
    }, token);
    if (!result.accepted) return false;
    const saved = result.saved;
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
      isRelevant: () => isCurrentOperation(attraction.id, token) && !hasCheckIn(attraction.id),
      confirmText: "手動打卡"
    });
    return accepted ? recordCheckIn(attraction, "manual", false, token) : false;
  }

  async function startCheckIn(attractionId, button) {
    const attraction = lookupAttraction(attractionId);
    if (!canUseAttraction(attractionId) || !attraction || hasCheckIn(attractionId)) return;
    const token = operationToken(attractionId);
    button?.setAttribute("aria-busy", "true");
    if (button) button.disabled = true;

    if (!navigator.geolocation) {
      onLocationResult({ status: "unsupported", reason: "此瀏覽器不支援位置功能。" });
      await offerManualCheckIn(attraction, "此瀏覽器不支援位置功能。 ", token);
      if (isCurrentOperation(attractionId, token)) render();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (!isCurrentOperation(attractionId, token) || hasCheckIn(attractionId)) return;
        const result = evaluateGeofence(
          { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy },
          attraction.geo
        );
        // Report derived diagnostics only; never expose or persist the device coordinates.
        onLocationResult({ status: result.status, distance: result.distance, accuracy: result.accuracy });
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
        if (!isCurrentOperation(attractionId, token) || hasCheckIn(attractionId)) return;
        const reason = error.code === 1 ? "你沒有允許位置權限。" : error.code === 3 ? "位置要求逾時。" : "暫時未能取得位置。";
        onLocationResult({ status: "error", reason });
        await offerManualCheckIn(attraction, reason, token);
        if (isCurrentOperation(attractionId, token)) render();
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  return { startCheckIn };
}
