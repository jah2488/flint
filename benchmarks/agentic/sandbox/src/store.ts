// In-memory task store. The imperative shell: the one place state lives and mutates.
export interface Task {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
}

const tasks = new Map<string, Task>();
let seq = 0;

export function reset(): void {
  tasks.clear();
  seq = 0;
}

export function create(fields: { title: string }): Task {
  const id = String(++seq);
  const task: Task = { id, title: fields.title, done: false, createdAt: new Date().toISOString() };
  tasks.set(id, task);
  return task;
}

export function list(): Task[] {
  return [...tasks.values()];
}

export function get(id: string): Task | undefined {
  return tasks.get(id);
}

export function update(id: string, patch: Partial<Omit<Task, "id">>): Task | undefined {
  const task = tasks.get(id);
  if (!task) return undefined;
  const next = { ...task, ...patch, id: task.id };
  tasks.set(id, next);
  return next;
}
