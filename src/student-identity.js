export const STUDENT_IDENTITY_LIMITS = Object.freeze({ studentName: 40, className: 20, studentNumber: 20 });
export const STUDENT_IDENTITY_LABELS = Object.freeze({ studentName: "姓名", className: "班別", studentNumber: "學號" });
export const STUDENT_IDENTITY_STORAGE_KEY = "outdoorLearningDay.identity.v1";

export function studentIdentityErrors(identity) {
  return Object.fromEntries(Object.entries(STUDENT_IDENTITY_LIMITS).flatMap(([key, max]) => {
    const text = typeof identity?.[key] === "string" ? identity[key].trim() : "";
    const message = !text || Array.from(text).length > max ? `請填寫${STUDENT_IDENTITY_LABELS[key]}（最多 ${max} 字）。`
      : /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(text) ? `「${STUDENT_IDENTITY_LABELS[key]}」有不支援的控制字元，請修改。` : "";
    return message ? [[key, message]] : [];
  }));
}

export function createStudentIdentityStore(storage) {
  return Object.freeze({
    read() {
      const raw = storage.getItem(STUDENT_IDENTITY_STORAGE_KEY);
      if (!raw) return null;
      if (raw.length > 4096) return null;
      try {
        const data = JSON.parse(raw);
        if (!data || Array.isArray(data) || data.version !== 1 || Object.keys(data).length !== 4
          || !Object.keys(STUDENT_IDENTITY_LIMITS).every(key => Object.hasOwn(data, key))) return null;
        return validateStudentIdentity(data);
      } catch { return null; }
    },
    save(identity) {
      const valid = validateStudentIdentity(identity);
      const value = JSON.stringify({ version: 1, ...valid });
      storage.setItem(STUDENT_IDENTITY_STORAGE_KEY, value);
      if (storage.getItem(STUDENT_IDENTITY_STORAGE_KEY) !== value) throw Error("未能記住學生資料。");
      return valid;
    },
    clear() {
      storage.removeItem(STUDENT_IDENTITY_STORAGE_KEY);
      if (storage.getItem(STUDENT_IDENTITY_STORAGE_KEY) != null) throw Error("未能清除學生資料。");
    }
  });
}

// Profile storage and local image exports share validation, never silent truncation.
export function validateStudentIdentity(identity) {
  const errors = studentIdentityErrors(identity);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return Object.fromEntries(Object.keys(STUDENT_IDENTITY_LIMITS).map(key => {
    const text = typeof identity?.[key] === "string" ? identity[key].trim() : "";
    return [key, text];
  }));
}
