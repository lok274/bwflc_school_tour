import { createPhotoRepository, compressPhoto } from "../../src/photos.js";
import { DEVICE_TEST_LOCATION, DEVICE_TEST_DATABASE, DEVICE_TEST_STORAGE_KEY } from "../../src/device-test-data.js";

const button = document.querySelector("#seed"), status = document.querySelector("#status");
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    if (!["127.0.0.1", "localhost"].includes(location.hostname)) throw Error("只可在本機使用。");
    const repository = createPhotoRepository({ databaseName: DEVICE_TEST_DATABASE });
    if (localStorage.getItem(DEVICE_TEST_STORAGE_KEY) || (await repository.getAllPhotoRecords()).length) throw Error("已有測試資料；不覆蓋。");
    for (let index = 0; index < 6; index++) {
      const canvas = document.createElement("canvas"); canvas.width = index % 2 ? 480 : 640; canvas.height = index % 2 ? 640 : 480;
      const context = canvas.getContext("2d"); context.fillStyle = ["#124b52", "#c37535", "#447363", "#b48725", "#646aa0", "#854c6f"][index]; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#fff8eb"; context.font = "bold 30px sans-serif"; context.fillText(`SYNTHETIC ${index + 1}`, 30, canvas.height - 50);
      const source = new File([await new Promise(resolve => canvas.toBlob(resolve, "image/png"))], "synthetic.png", { type: "image/png" });
      const record = await compressPhoto(source, DEVICE_TEST_LOCATION.id);
      record.photoId = `synthetic-device-${index}`; record.writeId = record.photoId;
      await repository.savePhotoRecord(record);
    }
    status.textContent = "已建立六張合成測試相片；沒有新增打卡或身份資料。";
  } catch (error) { status.textContent = error.message; }
});
