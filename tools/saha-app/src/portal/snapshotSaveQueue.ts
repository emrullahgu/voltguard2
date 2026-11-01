type Snapshot = { id: string; serverRevision?: number };

// Called only after the user has reviewed a fresh server snapshot and explicitly
// chosen to apply the draft. Keep server metadata and replace editor fields only.
export function rebaseSnapshotDraft<T extends Snapshot>(draft: T, current: T, fields: readonly (keyof T)[]): T {
  const next = { ...current };
  for (const field of fields) next[field] = draft[field];
  return next;
}

// One queue belongs to one loaded editor. Only that editor's acknowledged
// commits advance its token; reads and other editors cannot rebase a draft.
export function createSnapshotSaveQueue<T extends Snapshot>(commit: (snapshot: T) => Promise<T>) {
  let generation = 0;
  let id = '';
  let revision: number | undefined;
  let failure: unknown = null;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    reset(snapshot: T) {
      generation++;
      id = snapshot.id; revision = snapshot.serverRevision; failure = null;
    },
    save(snapshot: T): Promise<T> {
      const expectedGeneration = generation;
      const job = tail.catch(() => {}).then(async () => {
        if (generation !== expectedGeneration || id !== snapshot.id) throw new Error('Düzenlenen kayıt değişti. Kaydı yeniden açın.');
        // After an uncertain or rejected write, later drafts stay in the form.
        // Reloading is required before any further submission from this editor.
        if (failure) throw failure;
        try {
          const saved = await commit({ ...snapshot, serverRevision: revision });
          if (generation === expectedGeneration) revision = saved.serverRevision;
          return saved;
        } catch (error) {
          if (generation === expectedGeneration) failure = error;
          throw error;
        }
      });
      tail = job;
      return job;
    },
  };
}
