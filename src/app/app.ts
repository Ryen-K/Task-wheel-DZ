import { Component, computed, signal, effect, ElementRef, viewChild, afterNextRender } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

const STORAGE_KEY = 'task-wheel-data';

interface Member {
  name: string;
  weight: number;
  busy: boolean;
  taskName?: string;
}

interface Task {
  id: string;
  name: string;
  complexity: number;
  done: boolean;
}

interface HistoryEntry {
  kind: 'prise' | 'finie';
  userName: string;
  taskName: string;
  timestamp: number;
}

interface StoredData {
  members: Member[];
  tasks: Task[];
  history: HistoryEntry[];
}

const COLORS = [
  '#b2a616','#832dfc','#657f7a','#ff3e96','#9eb226',
  '#18ffff','#0a6664','#cc6633','#4a7db4','#d4a017'
];

const TAU = 2 * Math.PI;
const POINTER_ANGLE = -Math.PI / 2;

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly nameInput = new FormControl('');
  readonly taskInput = new FormControl('');
  readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('wheelCanvas');

  readonly members = signal<Member[]>([]);
  readonly tasks = signal<Task[]>([]);
  readonly history = signal<HistoryEntry[]>([]);
  readonly spinning = signal(false);
  readonly draggedIdx = signal<number | null>(null);
  readonly historyVisible = signal(true);

  readonly available = computed(() => this.members().filter(m => !m.busy));
  readonly busyList = computed(() => this.members().filter(m => m.busy));
  readonly allBusy = computed(() => this.members().length > 0 && this.available().length === 0);
  readonly currentTask = computed(() => this.tasks().find(t => !t.done) ?? null);
  readonly allTasksDone = computed(() => this.tasks().length > 0 && this.tasks().every(t => t.done));
  readonly pendingTasks = computed(() => this.tasks().filter(t => !t.done));
  readonly doneTasks = computed(() => this.tasks().filter(t => t.done));

  private animId = 0;
  private currentRot = 0;
  private resizeObs: ResizeObserver | null = null;
  private taskIdCounter = 0;

  constructor() {
    this.loadState();

    effect(() => { this.members(); this.saveState(); this.scheduleDraw(); });
    effect(() => { this.tasks(); this.saveState(); });
    effect(() => { this.history(); this.saveState(); });

    afterNextRender(() => {
      this.scheduleDraw();
      const el = this.canvasRef()?.nativeElement;
      if (el) {
        this.resizeObs = new ResizeObserver(() => this.scheduleDraw());
        this.resizeObs.observe(el);
      }
    });
  }

  private loadState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d: StoredData = JSON.parse(raw);
        this.members.set((d.members ?? []).map(m => ({ ...m, busy: m.busy ?? false, taskName: m.taskName })));
        this.tasks.set(d.tasks ?? []);
        this.history.set(d.history ?? []);
        this.taskIdCounter = Math.max(0, ...this.tasks().map(t => parseInt(t.id) || 0)) + 1;
      }
    } catch { /* ignore */ }
  }

  private saveState(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      members: this.members(),
      tasks: this.tasks(),
      history: this.history()
    }));
  }

  private scheduleDraw(): void {
    cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(() => this.drawWheel());
  }

  private totalWeight(): number {
    return this.available().reduce((s, m) => s + m.weight, 0);
  }

  // ─── Members ───

  addMember(): void {
    const name = this.nameInput.value?.trim();
    if (!name) return;
    if (this.members().some(m => m.name === name)) { this.nameInput.reset(); return; }
    this.members.update(list => [...list, { name, weight: 5, busy: false }]);
    this.nameInput.reset();
  }

  removeMember(name: string): void {
    this.members.update(list => list.filter(m => m.name !== name));
  }

  setWeight(name: string, w: number): void {
    this.members.update(list => list.map(m => m.name === name ? { ...m, weight: w } : m));
  }

  private markBusy(name: string, taskName: string): void {
    this.members.update(list => list.map(m =>
      m.name === name ? { ...m, busy: true, taskName } : m
    ));
  }

  unbusy(name: string): void {
    const now = Date.now();
    const entry = this.members().find(m => m.name === name);
    const t = entry?.taskName;
    if (t !== undefined) {
      this.history.update(h => [{ kind: 'finie', userName: name, taskName: t, timestamp: now }, ...h]);
    }
    this.members.update(list => list.map(m =>
      m.name === name ? { ...m, busy: false, taskName: undefined } : m
    ));
  }

  unbusyAll(): void {
    const now = Date.now();
    const entries: HistoryEntry[] = [];
    this.members.update(list => list.map(m => {
      if (m.busy && m.taskName) {
        entries.push({ kind: 'finie', userName: m.name, taskName: m.taskName, timestamp: now });
      }
      return { ...m, busy: false, taskName: undefined };
    }));
    if (entries.length > 0) {
      this.history.update(h => [...entries, ...h]);
    }
  }

  // ─── Tasks ───

  addTask(): void {
    const name = this.taskInput.value?.trim();
    if (!name) return;
    this.tasks.update(list => [...list, { id: String(this.taskIdCounter++), name, complexity: 5, done: false }]);
    this.taskInput.reset();
  }

  updateTaskName(id: string, name: string): void {
    this.tasks.update(list => list.map(t => t.id === id ? { ...t, name } : t));
  }

  updateTaskComplexity(id: string, c: number): void {
    this.tasks.update(list => list.map(t => t.id === id ? { ...t, complexity: c } : t));
  }

  removeTask(id: string): void {
    this.tasks.update(list => list.filter(t => t.id !== id));
  }

  recoverTask(id: string): void {
    this.tasks.update(list => list.map(t => t.id === id ? { ...t, done: false } : t));
  }

  onDragStart(i: number): void {
    this.draggedIdx.set(i);
  }

  onDragOver(e: DragEvent, i: number): void {
    e.preventDefault();
    const from = this.draggedIdx();
    if (from === null || from === i) return;
    this.tasks.update(list => {
      const copy = [...list];
      const [moved] = copy.splice(from, 1);
      copy.splice(i, 0, moved);
      return copy;
    });
    this.draggedIdx.set(i);
  }

  onDragEnd(): void {
    this.draggedIdx.set(null);
  }

  // ─── Action ───

  get buttonLabel(): string {
    if (this.spinning()) return 'En cours…';
    if (this.allBusy()) return 'Remettre tout le monde disponible';
    if (this.allTasksDone()) return 'Toutes les tâches sont faites';
    return 'Attribuer une tâche';
  }

  handleAction(): void {
    if (this.spinning()) return;
    if (this.allBusy()) { this.unbusyAll(); return; }
    if (this.members().length < 2) return;
    if (this.allTasksDone()) return;

    const task = this.currentTask();
    const avail = this.available();
    if (!task) return;

    if (avail.length === 1) {
      const picked = avail[0];
      this.assignAndRecord(picked.name, task.name);
      this.markBusy(picked.name, task.name);
      this.markTaskDone(task.id);
      return;
    }

    this.doSpin(task);
  }

  private doSpin(task: Task): void {
    const list = this.available();
    const totalW = this.totalWeight();

    let rand = Math.random() * totalW;
    let picked = list[0];
    for (const m of list) { rand -= m.weight; if (rand <= 0) { picked = m; break; } }

    let cum = 0;
    for (const m of list) {
      if (m.name === picked.name) break;
      cum += (m.weight / totalW) * TAU;
    }
    const segAngle = (picked.weight / totalW) * TAU;
    const targetMid = cum + segAngle / 2;

    const spins = 5 + Math.floor(Math.random() * 3);
    const targetMod = ((POINTER_ANGLE - targetMid) % TAU + TAU) % TAU;
    const prevMod = ((this.currentRot % TAU) + TAU) % TAU;
    let delta = targetMod - prevMod;
    if (delta <= 0) delta += TAU;
    const prevRot = this.currentRot;
    this.currentRot = prevRot + delta + spins * TAU;
    this.spinning.set(true);

    const onDone = () => {
      this.spinning.set(false);
      this.assignAndRecord(picked.name, task.name);
      this.markBusy(picked.name, task.name);
      this.markTaskDone(task.id);
    };

    this.animateSpin(prevRot, this.currentRot, onDone);
  }

  private assignAndRecord(userName: string, taskName: string): void {
    this.history.update(h => [{ kind: 'prise', userName, taskName, timestamp: Date.now() }, ...h]);
  }

  private markTaskDone(id: string): void {
    this.tasks.update(list => list.map(t => t.id === id ? { ...t, done: true } : t));
  }

  private animateSpin(fromRad: number, toRad: number, onDone: () => void): void {
    const duration = 3000;
    const startTime = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);

    const tick = (time: number) => {
      const p = Math.min((time - startTime) / duration, 1);
      this.drawWheel(fromRad + (toRad - fromRad) * ease(p));
      if (p < 1) {
        this.animId = requestAnimationFrame(tick);
      } else {
        onDone();
      }
    };

    cancelAnimationFrame(this.animId);
    this.animId = requestAnimationFrame(tick);
  }

  // ─── Wheel canvas ───

  private drawWheel(rotation?: number): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const size = Math.min(w, h);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    const cx = w / 2;
    const cy = h / 2;
    const r = size / 2 - 12;
    ctx.clearRect(0, 0, w, h);

    const list = this.available();
    const totalW = this.totalWeight();
    const rot = rotation ?? this.currentRot;

    if (list.length === 0) {
      ctx.fillStyle = '#ccc';
      ctx.font = `${size * 0.05}px Quicksand`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Aucun membre disponible', cx, cy - 10);
      ctx.font = `${size * 0.035}px Quicksand`;
      ctx.fillText('Ajoutez des membres ou libérez les occupés', cx, cy + 14);
      return;
    }

    let cumAngle = rot;

    for (let i = 0; i < list.length; i++) {
      const segAngle = (list[i].weight / totalW) * TAU;
      const startA = cumAngle;
      const endA = startA + segAngle;
      const midA = startA + segAngle / 2;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startA, endA);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      const lr = r * 0.6;
      ctx.save();
      ctx.translate(cx + Math.cos(midA) * lr, cy + Math.sin(midA) * lr);
      ctx.rotate(midA + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.min(size * 0.042, 13)}px Quicksand`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(list[i].name, 0, 0);
      ctx.restore();

      cumAngle = endA;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.15, 0, TAU);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();

    const ps = r * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx - ps, cy - r + 4);
    ctx.lineTo(cx + ps, cy - r + 4);
    ctx.lineTo(cx, cy - r - ps * 1.8);
    ctx.closePath();
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  resetHistory(): void {
    this.history.set([]);
  }

  resetAll(): void {
    this.members.set([]);
    this.tasks.set([]);
    this.history.set([]);
  }

  resetWithDefaults(): void {
    this.taskIdCounter = 0;
    this.members.set([
      { name: 'Alice', weight: 5, busy: false },
      { name: 'Bob', weight: 5, busy: false },
      { name: 'Charlie', weight: 5, busy: false },
      { name: 'Diana', weight: 5, busy: false }
    ]);
    this.tasks.set([
      { id: '1', name: 'Design mockup', complexity: 5, done: false },
      { id: '2', name: 'Développement API', complexity: 5, done: false },
      { id: '3', name: 'Tests unitaires', complexity: 5, done: false },
      { id: '4', name: 'Documentation', complexity: 5, done: false },
      { id: '5', name: 'Déploiement', complexity: 5, done: false }
    ]);
    this.taskIdCounter = 6;
    this.history.set([]);
  }
}
