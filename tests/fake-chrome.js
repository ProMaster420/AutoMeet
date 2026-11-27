// A small in-memory stand-in for the chrome.* APIs AutoMeet uses, so the scheduling and
// lifecycle logic can be tested in Node. fake.reset() returns it to a clean state.

export function installFakeChrome() {
  const fresh = () => ({
    local: {},
    sync: {},
    alarms: new Map(),
    tabs: new Map(),
    sent: [], // messages sent to tabs: {id, msg}
    nextTab: 100,
    failCreate: false,
    sendMessageImpl: null, // override (id, msg) => reply
    notifications: new Map(), // id -> options
    offscreen: false,
    sounds: 0,
  });
  const fake = { state: fresh() };
  fake.reset = () => {
    fake.state = fresh();
  };

  const area = (name) => ({
    async get(keys) {
      const store = fake.state[name];
      if (keys == null) return structuredClone(store);
      if (typeof keys === 'string') return keys in store ? { [keys]: structuredClone(store[keys]) } : {};
      const out = {};
      for (const [k, d] of Object.entries(keys)) out[k] = k in store ? structuredClone(store[k]) : d;
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) fake.state[name][k] = structuredClone(v);
    },
  });

  globalThis.chrome = {
    runtime: {
      id: 'test',
      getURL: (p) => `chrome-extension://test/${p}`,
      async sendMessage(msg) {
        if (msg && msg.type === 'AM_PLAY_SOUND') fake.state.sounds += 1;
      },
    },
    notifications: {
      async create(id, opts) {
        fake.state.notifications.set(id, opts);
      },
      async clear(id) {
        return fake.state.notifications.delete(id);
      },
    },
    offscreen: {
      async createDocument() {
        if (fake.state.offscreen) throw new Error('Only a single offscreen document may be created.');
        fake.state.offscreen = true;
      },
    },
    storage: { local: area('local'), sync: area('sync') },
    alarms: {
      async create(name, info) {
        fake.state.alarms.set(name, {
          name,
          scheduledTime: info.when ?? Date.now() + (info.delayInMinutes ?? 0) * 60000,
          periodInMinutes: info.periodInMinutes,
        });
      },
      async getAll() {
        return [...fake.state.alarms.values()];
      },
      async clear(name) {
        return fake.state.alarms.delete(name);
      },
    },
    tabs: {
      async create({ url }) {
        if (fake.state.failCreate) throw new Error('no window');
        const tab = { id: fake.state.nextTab++, url };
        fake.state.tabs.set(tab.id, tab);
        return tab;
      },
      async remove(id) {
        if (!fake.state.tabs.has(id)) throw new Error('No tab');
        fake.state.tabs.delete(id);
      },
      async get(id) {
        if (!fake.state.tabs.has(id)) throw new Error('No tab');
        return fake.state.tabs.get(id);
      },
      async sendMessage(id, msg) {
        if (!fake.state.tabs.has(id)) throw new Error('No tab');
        fake.state.sent.push({ id, msg });
        if (fake.state.sendMessageImpl) return fake.state.sendMessageImpl(id, msg);
        return { ok: true };
      },
    },
    windows: {
      async create({ url }) {
        const tab = { id: fake.state.nextTab++, url };
        fake.state.tabs.set(tab.id, tab);
        return { tabs: [tab] };
      },
    },
  };
  return fake;
}
