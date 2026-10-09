import { emptyWorkbook, validateWorkbook } from "../../src/workbook-data.js";
import { WorkbookConflict } from "../../src/workbook-storage.js";
export function memoryWorkbookRepository(initialDraft = emptyWorkbook()) {
  let record = { revision: 0, draft: validateWorkbook(initialDraft, { allowLegacyText: true }) };
  return {
    read: async () => structuredClone(record),
    write: async (draft, revision) => {
      if (record.revision !== revision) throw new WorkbookConflict();
      record = { revision: revision + 1, draft: validateWorkbook(draft) }; return structuredClone(record);
    },
    clear: async () => { record = { revision: record.revision + 1, draft: emptyWorkbook() }; return structuredClone(record); }
  };
}
