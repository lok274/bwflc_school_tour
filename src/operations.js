// Tokens are page-local cancellation guards, not cross-tab storage locks.
export function createOperationGuard({ isResetting }) {
  let dataGeneration = 0;
  const attractionGenerations = new Map();
  const activePhotoTasks = new Map();
  function operationToken(attractionId) {
    return {
      dataGeneration,
      attractionGeneration: attractionGenerations.get(attractionId) || 0
    };
  }

  function isCurrentOperation(attractionId, token) {
    return !isResetting() &&
      token?.dataGeneration === dataGeneration &&
      token?.attractionGeneration === (attractionGenerations.get(attractionId) || 0);
  }

  function invalidateAttractionOperations(attractionId) {
    attractionGenerations.set(attractionId, (attractionGenerations.get(attractionId) || 0) + 1);
  }

  function invalidateAllOperations() {
    dataGeneration += 1;
  }

  function isCurrentDataGeneration(token) {
    return !isResetting() && token === dataGeneration;
  }

  function trackPhotoTask(attractionId, task) {
    const tasks = activePhotoTasks.get(attractionId) || new Set();
    tasks.add(task);
    activePhotoTasks.set(attractionId, tasks);
    const finish = () => {
      tasks.delete(task);
      if (!tasks.size) activePhotoTasks.delete(attractionId);
    };
    task.then(finish, finish);
    return task;
  }

  async function waitForPhotoTasks(attractionId) {
    const tasks = attractionId
      ? [...(activePhotoTasks.get(attractionId) || [])]
      : [...activePhotoTasks.values()].flatMap((items) => [...items]);
    if (tasks.length) await Promise.allSettled(tasks);
  }

  return { operationToken, isCurrentOperation, invalidateAttractionOperations, invalidateAllOperations, isCurrentDataGeneration, trackPhotoTask, waitForPhotoTasks, get generation() { return dataGeneration; } };
}
