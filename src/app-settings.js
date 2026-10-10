// Shared UI rules. Activity content and persistent identifiers stay in their own data modules.
export const PHOTO_PAGE_SIZE = 12;
export const STUDENT_IDENTITY_LIMITS = Object.freeze({ studentName: 40, className: 20, studentNumber: 20 });
export const STUDENT_IDENTITY_LABELS = Object.freeze({ studentName: "姓名", className: "班別", studentNumber: "學號" });
export const MAX_WORKBOOK_PHOTOS = 6;

// Local image exports share identity rules without persisting or truncating drafts.
export function validateStudentIdentity(identity) {
  return Object.fromEntries(Object.entries(STUDENT_IDENTITY_LIMITS).map(([key, max]) => {
    const text = typeof identity?.[key] === "string" ? identity[key].trim() : "";
    if (!text || Array.from(text).length > max) throw new Error(`請填寫${STUDENT_IDENTITY_LABELS[key]}（最多 ${max} 字）。`);
    if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text)) throw new Error(`「${STUDENT_IDENTITY_LABELS[key]}」有不支援的控制字元，請修改。`);
    return [key, text];
  }));
}

// Use the activity's written local dates, independent of the device's time zone or current year.
export function activityDateLabels(startAt, endAt) {
  const dateParts = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("活動日期無效。");
    const date = value.slice(0, 10);
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("活動日期無效。");
    return { date, year: date.slice(0, 4), month: date.slice(5, 7), day: date.slice(8, 10) };
  };
  const start = dateParts(startAt), end = dateParts(endAt);
  if (Date.parse(endAt) < Date.parse(startAt) || end.date < start.date) throw new Error("活動結束日期不能早於開始日期。");
  const sameYear = start.year === end.year, sameMonth = sameYear && start.month === end.month;
  const endLabel = `${sameYear ? "" : `${end.year}年`}${sameMonth ? "" : `${Number(end.month)}月`}${Number(end.day)}日`;
  const endFilename = sameMonth ? end.day : sameYear ? `${end.month}-${end.day}` : end.date;
  return Object.freeze({ year: start.year, dateLabel: `${start.year}年${Number(start.month)}月${Number(start.day)}日至${endLabel}`,
    filenamePrefix: `${start.date}至${endFilename}` });
}
