// src/lib/analysis-task-queue.ts
// 通用 AI 分析任务队列，串行执行，支持优先级

export type AnalysisTaskStatus = 'pending' | 'running' | 'done';
export type AnalysisTask = () => Promise<void>;
export type TaskStatusCallback = (status: AnalysisTaskStatus, key?: string) => void;

class TaskQueue {
  private queue: Array<{ task: AnalysisTask; key?: string; priority: boolean; statusCallback?: TaskStatusCallback; enqueuedAt: number }> = [];
  private running = false;
  private keySet = new Set<string>();

  addTask(task: AnalysisTask, options?: { key?: string; priority?: boolean; statusCallback?: TaskStatusCallback }) {
    const key = options?.key;
    const priority = options?.priority ?? false;
    const statusCallback = options?.statusCallback;
    if (key) {
      if (this.keySet.has(key)) return; // 已有同 key 任务在队列中，去重
      this.keySet.add(key);
    }
    const enqueuedAt = Date.now();
    const taskObj = { task, key, priority, statusCallback, enqueuedAt };
    if (priority) this.queue.unshift(taskObj);
    else this.queue.push(taskObj);
    // 入队时回调“pending”
    if (statusCallback) statusCallback('pending', key);
    this.runNext();
  }

  /**
   * 手动触发插队（高优先级）
   * @param task 分析任务
   */
  addPriorityTask(task: AnalysisTask, key?: string, statusCallback?: TaskStatusCallback) {
    this.addTask(task, { key, priority: true, statusCallback });
  }

  private async runNext() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const { task, key, statusCallback } = this.queue.shift()!;
    // 开始执行时回调“running”
    if (statusCallback) statusCallback('running', key);
    try {
      await task();
    } catch (err) {
      // 可记录日志
    } finally {
      if (key) this.keySet.delete(key);
      // 完成时回调“done”
      if (statusCallback) statusCallback('done', key);
      this.running = false;
      setTimeout(() => this.runNext(), 500);
    }
  }

  // 资源空闲检测：直接返回 true，不检测 CPU/GPU，仅保证串行
  private async isResourceIdle(): Promise<boolean> {
    return true;
  }
}

export const taskQueue = new TaskQueue();
