import { useSimStore } from '@/app/store';
import { useShallow } from 'zustand/shallow';
import { allTasks, CURRICULUM, isUnlocked } from '@/education/curriculum';
import { listCases } from '@/cases';
import { getViewTarget } from '@/simulator/windows/viewDefinitions';

/** Staged curriculum screen (proposal 7): modules → lessons → tasks with completion state and the reason each task matters. */
export function CurriculumScreen() {
  const s = useSimStore(
    useShallow((st) => ({
      openTask: st.openTask,
      progress: st.progress,
    })),
  );
  const done = s.progress.completedTasks;
  const cases = listCases();
  const tasks = allTasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const total = tasks.length;
  const completed = Object.keys(done).length;
  return (
    <div className="screen curriculum">
      <h2>Currículo por etapas</h2>
      <p className="small">
        {completed}/{total} tareas completadas. Las tareas se verifican automáticamente mientras
        trabajas en el simulador (modo libre o guiado); ninguna mueve la sonda por ti.
      </p>
      {CURRICULUM.map((m) => (
        <section key={m.id} className="module">
          <h3>{m.title}</h3>
          {m.lessons.map((l) => (
            <div key={l.id} className="lesson">
              <h4>{l.title}</h4>
              <p className="small">{l.goal}</p>
              <ul className="tasks">
                {l.tasks.map((t) => {
                  const ok = Boolean(done[t.id]);
                  // a task waits for the ones it builds on (decision 260)
                  const locked = !ok && !isUnlocked(t, done);
                  const caseTitle = t.caseId ? cases.find((c) => c.id === t.caseId)?.title : null;
                  const before = (t.requires ?? [])
                    .filter((id) => !done[id])
                    .map((id) => byId.get(id)?.title ?? id);
                  return (
                    <li
                      key={t.id}
                      className={ok ? 'done' : locked ? 'locked' : ''}
                      data-task={t.id}
                      data-done={ok ? '1' : '0'}
                      data-locked={locked ? '1' : '0'}
                    >
                      <span className={`pill ${ok ? 'ok' : ''}`}>
                        {ok ? 'hecha' : locked ? 'bloqueada' : 'pendiente'}
                      </span>{' '}
                      <b>{t.title}</b>
                      <div className="small why">{t.why}</div>
                      {locked && <div className="small requires">Antes: {before.join(' · ')}</div>}
                      {!locked && (t.caseId || t.viewId) && (
                        <button
                          className="small"
                          data-open-task={t.id}
                          data-tip={[caseTitle, t.viewId ? getViewTarget(t.viewId).name : null]
                            .filter(Boolean)
                            .join(' · ')}
                          onClick={() => s.openTask(t)}
                        >
                          Abrir tarea
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
