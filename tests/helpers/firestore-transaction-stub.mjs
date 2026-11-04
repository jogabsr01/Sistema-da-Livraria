// Serial, atomic test double. This does not model Firestore contention or retries.
export function createTransactionStub() {
  const values = new Map(), writes = [];
  let failNext = false, tail = Promise.resolve();
  return {
    values, writes,
    doc: path => ({ path }),
    failNextCommit() { failNext = true; },
    runTransaction(work) {
      const run = async () => {
        const pending = new Map(); let written = false;
        const tx = {
          async get(ref) {
            if (written) throw Error('READ_AFTER_WRITE');
            const value = values.get(ref.path);
            return { exists: value !== undefined, data: () => structuredClone(value) };
          },
          create(ref, data) {
            written = true;
            if (values.has(ref.path) || pending.has(ref.path)) throw Error('ALREADY_EXISTS');
            pending.set(ref.path, structuredClone(data));
          },
          set(ref, data) { written = true; pending.set(ref.path, structuredClone(data)); },
        };
        const result = await work(tx);
        if (pending.size > 100) throw Error('TOO_MANY_WRITES');
        if (failNext && pending.size) { failNext = false; throw Error('SIMULATED_FAILURE'); }
        for (const [path, data] of pending) values.set(path, data);
        if (pending.size) writes.push([...pending.keys()]);
        return result;
      };
      const result = tail.then(run); tail = result.catch(() => {}); return result;
    },
  };
}