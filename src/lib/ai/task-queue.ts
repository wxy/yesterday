// src/lib/analysis-task-queue.ts
// 通用 AI 分析任务队列，串行执行，支持优先级

export type AnalysisTask = () => Promise<void>;

class TaskQueue {
  private queue: Array<{ task: AnalysisTask; key?: string; priority: boolean }> = [];
  private running = false;
  private keySet = new Set<string>();

  addTask(task: AnalysisTask, options?: { key?: string; priority?: boolean }) {
    const key = options?.key;
    const priority = options?.priority ?? false;
    if (key) {
      if (this.keySet.has(key)) return; // 已有同 key 任务在队列中，去重
      this.keySet.add(key);
    }
    if (priority) this.queue.unshift({ task, key, priority });
    else this.queue.push({ task, key, priority });
    this.runNext();
  }

  /**
   * 手动触发插队（高优先级）
   * @param task 分析任务
   */
  addPriorityTask(task: AnalysisTask, key?: string) {
    this.addTask(task, { key, priority: true });
  }

  private async runNext() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const { task, key } = this.queue.shift()!;
    try {
      await task();
    } catch (err) {
      // 可记录日志
    } finally {
      if (key) this.keySet.delete(key);
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
