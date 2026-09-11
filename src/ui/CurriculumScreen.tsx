import { useSimStore } from '@/app/store';
import { CURRICULUM } from '@/education/curriculum';
import { listCases } from '@/cases';

/** Staged curriculum screen (proposal 7): modules → lessons → tasks with completion state and the reason each task matters. */
export function CurriculumScreen() {
  const s = useSimStore();
  const done = s.progress.completedTasks;
  const cases = listCases();
  const total = CURRICULUM.flatMap((m) => m.lessons.flatMap((l) => l.tasks)).length;
  const completed = Object.keys(done).length;
  return (
    <div className="screen curriculum">
      <h2>Currículo por etapas</h2>
      <p className="small">
        {completed}/{total} tareas completadas. Las tareas se verifican automáticamente mientras trabajas en el simulador (modo sandbox o guiado); ninguna mueve la sonda por ti.
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
                  const caseTitle = t.caseId ? cases.find((c) => c.id === t.caseId)?.title : null;
                  return (
                    <li key={t.id} className={ok ? 'done' : ''} data-task={t.id} data-done={ok ? '1' : '0'}>
                      <span className={`pill ${ok ? 'ok' : ''}`}>{ok ? 'hecha' : 'pendiente'}</span> <b>{t.title}</b>
                      <div className="small why">{t.why}</div>
                      {t.caseId && t.caseId !== s.caseId && (
                        <button
                          className="small"
                          onClick={() => {
                            s.loadCase(t.caseId!);
                            if (s.mode === 'exam') s.setMode('guided');
                            s.setUi({ screen: 'simulator' });
                          }}
                        >
                          Abrir caso: {caseTitle}
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
