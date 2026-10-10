const frame = document.getElementById("signature-frame");
const result = document.getElementById("responsive-result");
const cardMode = new URL(location.href).searchParams.has("card");
if (cardMode) {
  frame.src = "./check-in-card.html?preview=review";
  document.title = document.querySelector("h1").textContent = "五站打卡紀錄卡尺寸驗證";
  document.querySelector("main > p").textContent = "使用合成身份及打卡紀錄，不讀取正式旅程。內嵌視窗驗證實際螢幕寬度。";
  frame.title = "五站紀錄卡合成資料預覽";
}

function inspect() {
  const doc = frame.contentDocument;
  const editor = doc?.querySelector(".artwork-editor, .checkin-card-editor");
  if (!editor) return;
  const width = frame.contentWindow.innerWidth;
  const overflow = doc.documentElement.scrollWidth > width || editor.scrollWidth > editor.clientWidth;
  result.textContent = `${width}px：${overflow ? "失敗，橫向溢出" : "通過，沒有橫向溢出"}；最新視窗結構：${Boolean(doc.querySelector("#ai-artwork-dialog > .memory-dialog-content, #checkin-card-dialog > .memory-dialog-content"))}`;
  result.dataset.width = width;
  result.dataset.failed = String(overflow);
}

frame.addEventListener("load", inspect);
for (const button of document.querySelectorAll("[data-width]")) {
  button.addEventListener("click", () => {
    frame.width = button.dataset.width;
    requestAnimationFrame(inspect);
  });
}
